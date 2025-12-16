const crypto = require("crypto");
const {
	BlacklistAllianceError,
	ValidationError,
	TimeoutError,
	NetworkError,
	CircuitBreakerError,
} = require("./errors");

const BASE_URL = "https://api.blacklistalliance.net";

/**
 * @typedef {'v1' | 'v2' | 'v3' | 'v5'} ApiVersion
 * @typedef {'json' | 'raw'} ResponseFormat
 * @typedef {'json' | 'raw' | 'xml'} StandardResponseFormat
 * @typedef {'json' | 'phonecode'} BulkResponseFormat
 */

/**
 * @typedef {Object} OcnInfo
 * @property {boolean} is_voip - Whether the number is VoIP
 * @property {string} carrier - Carrier name
 * @property {string} line_type - e.g., 'mobile', 'landline'
 */

/**
 * @typedef {Object} CarrierInfo
 * @property {string} did - Phone number
 * @property {string} type - e.g., 'WIRELESS', 'LANDLINE'
 * @property {string} name - Carrier name (e.g., 'AT&T')
 * @property {string} state - State code
 * @property {string} ratecenter
 * @property {string} country - Country code (e.g., 'US')
 * @property {string} clli
 * @property {string|number} lata
 * @property {string} wireless - 'Y' or 'N'
 * @property {string|number} lrn
 * @property {string|number} npa
 * @property {string|number} nxx
 * @property {string|number} nxxx
 * @property {string|number} ocn
 * @property {string} [port_type]
 * @property {OcnInfo} [ocn_info] - OCN info (in bulk results)
 */

/**
 * @typedef {Object} SingleLookupResult
 * @property {string} sid - Session ID
 * @property {string} status - 'success' or error status
 * @property {string} message - 'Good' for clean, 'Blacklisted' for flagged
 * @property {string} code - 'none' or comma-separated blacklist codes
 * @property {number} offset
 * @property {number} wireless - 0 for landline, 1 for wireless
 * @property {string} phone
 * @property {number} results - 0 for clean, 1 for blacklisted
 * @property {number} time
 * @property {boolean} scrubs
 * @property {CarrierInfo} [carrier] - Carrier info (v3+)
 * @property {OcnInfo} [ocn_info] - OCN info (v5)
 */

/**
 * @typedef {Object} BulkLookupResult
 * @property {string} status
 * @property {number} numbers - Total numbers submitted
 * @property {number} count - Numbers processed
 * @property {string[]} phones - Clean (not blacklisted) phone numbers
 * @property {string[]} supression - Blacklisted phones (note: API spelling)
 * @property {string[]} wireless - Wireless numbers
 * @property {Object<string, string>} reasons - Blacklisted phone to reason codes
 * @property {Object<string, CarrierInfo>} carrier - Phone to carrier info
 */

/**
 * @typedef {Object} EmailBulkResult
 * @property {string[]} good - Emails not on blacklist (from API)
 * @property {string[]} bad - Emails on blacklist (computed: submitted - good)
 */

/**
 * @typedef {Object} Logger
 * @property {function(string, Object=): void} [debug] - Debug level logging
 * @property {function(string, Object=): void} [info] - Info level logging
 * @property {function(string, Object=): void} [warn] - Warning level logging
 * @property {function(string, Object=): void} [error] - Error level logging
 */

/**
 * @typedef {Object} ClientOptions
 * @property {ApiVersion} [defaultVersion='v5'] - Default API version
 * @property {number} [timeout=30000] - Request timeout in ms
 * @property {number} [retries=3] - Number of retry attempts for failed requests
 * @property {Logger} [logger] - Logger instance (console, pino, winston compatible)
 */

/**
 * @typedef {Object} BulkOptions
 * @property {ApiVersion} [version] - API version
 * @property {BulkResponseFormat} [responseFormat='json'] - Response format
 * @property {boolean} [autoBatch=true] - Automatically batch if payload exceeds limit
 */

/**
 * @typedef {Object} EmailBulkOptions
 * @property {boolean} [hashEmails=false] - Convert emails to MD5 hashes before sending
 * @property {boolean} [autoBatch=true] - Automatically batch if payload exceeds limit
 */

/**
 * Blacklist Alliance API Client
 *
 * Supports both Simple API (/lookup, /bulklookup, /emailbulk)
 * and Standard RESTful API (/standard/api/...)
 */
class BlacklistAlliance {
	/**
	 * Create a Blacklist Alliance API client
	 * @param {string} apiKey - Your API key
	 * @param {ClientOptions} [options]
	 */
	constructor(apiKey, options = {}) {
		if (!apiKey) {
			throw new Error("API key is required");
		}
		this.apiKey = apiKey;
		this.defaultVersion = options.defaultVersion || "v5";
		this.timeout = options.timeout || 30000;
		this.retries = options.retries ?? 3;
		this.logger = options.logger || null;
		this.dryRun = options.dryRun || false;

		// Request/response hooks
		this.onRequest = options.onRequest || null;
		this.onResponse = options.onResponse || null;

		// Circuit breaker configuration
		this._circuitBreaker = options.circuitBreaker
			? {
					enabled: true,
					failureThreshold: options.circuitBreaker.failureThreshold || 5,
					resetTimeoutMs: options.circuitBreaker.resetTimeoutMs || 30000,
					state: "CLOSED", // CLOSED, OPEN, HALF_OPEN
					failures: 0,
					lastFailureTime: null,
					onStateChange: options.circuitBreaker.onStateChange || null,
				}
			: { enabled: false };
	}

	/**
	 * Log a message if logger is configured
	 * @private
	 */
	_log(level, message, meta = {}) {
		if (this.logger && typeof this.logger[level] === "function") {
			this.logger[level](message, meta);
		}
	}

	/**
	 * Sleep for specified milliseconds
	 * @private
	 */
	_sleep(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * Check circuit breaker state and transition if needed
	 * @private
	 */
	_checkCircuitBreaker() {
		if (!this._circuitBreaker.enabled) return;

		const cb = this._circuitBreaker;
		const now = Date.now();

		// OPEN → HALF_OPEN (after cooldown)
		if (cb.state === 'OPEN' && cb.lastFailureTime) {
			if (now - cb.lastFailureTime >= cb.resetTimeoutMs) {
				this._changeCircuitState('HALF_OPEN');
			}
		}

		// Block requests if OPEN
		if (cb.state === 'OPEN') {
			throw new CircuitBreakerError(
				`Circuit breaker is OPEN. Service unavailable. Will retry after ${cb.resetTimeoutMs}ms cooldown.`
			);
		}
	}

	/**
	 * Record successful request
	 * @private
	 */
	_recordSuccess() {
		if (!this._circuitBreaker.enabled) return;

		const cb = this._circuitBreaker;

		// HALF_OPEN → CLOSED on success
		if (cb.state === 'HALF_OPEN') {
			cb.failures = 0;
			this._changeCircuitState('CLOSED');
		} else if (cb.state === 'CLOSED') {
			// Reset failure count on success
			cb.failures = 0;
		}
	}

	/**
	 * Record failed request
	 * @private
	 */
	_recordFailure() {
		if (!this._circuitBreaker.enabled) return;

		const cb = this._circuitBreaker;
		cb.failures++;
		cb.lastFailureTime = Date.now();

		this._log('warn', 'Circuit breaker failure recorded', {
			failures: cb.failures,
			threshold: cb.failureThreshold,
			state: cb.state
		});

		// CLOSED → OPEN (threshold reached)
		if (cb.state === 'CLOSED' && cb.failures >= cb.failureThreshold) {
			this._changeCircuitState('OPEN');
		}

		// HALF_OPEN → OPEN (failure during test)
		if (cb.state === 'HALF_OPEN') {
			this._changeCircuitState('OPEN');
		}
	}

	/**
	 * Change circuit breaker state
	 * @private
	 */
	_changeCircuitState(newState) {
		const oldState = this._circuitBreaker.state;
		this._circuitBreaker.state = newState;

		this._log('warn', `Circuit breaker: ${oldState} → ${newState}`, {
			failures: this._circuitBreaker.failures,
			threshold: this._circuitBreaker.failureThreshold
		});

		if (this._circuitBreaker.onStateChange) {
			this._circuitBreaker.onStateChange(newState);
		}
	}

	/**
	 * Check if error is retryable (5xx, network errors, timeouts)
	 * @private
	 */
	_isRetryable(error) {
		// Retry on NetworkError and TimeoutError
		if (error instanceof NetworkError || error instanceof TimeoutError) {
			return true;
		}
		if (error instanceof BlacklistAllianceError) {
			const status = error.statusCode;
			// Retry on 5xx server errors, 408 timeout, 429 rate limit
			return status >= 500 || status === 408 || status === 429;
		}
		// Retry on network errors (fetch failures)
		return error.name === "TypeError" || error.code === "ECONNRESET";
	}

	/**
	 * Split array into batches (O(N) chunking)
	 * 5000 items is safely under 1MB for phones (~75KB) and emails
	 * @private
	 */
	_batchBySize(items) {
		const BATCH_LIMIT = 5000;
		const batches = [];
		for (let i = 0; i < items.length; i += BATCH_LIMIT) {
			batches.push(items.slice(i, i + BATCH_LIMIT));
		}
		return batches;
	}

	/**
	 * Convert email to MD5 hash
	 * @private
	 */
	_hashEmail(email) {
		// Sanitize: cast to string, trim whitespace and newlines
		const sanitized = String(email).replace(/[\r\n]/g, "").toLowerCase().trim();
		return crypto.createHash("md5").update(sanitized).digest("hex");
	}

	/**
	 * Validate email format (basic check)
	 * @private
	 */
	_validateEmail(email) {
		// Sanitize: cast to string, trim whitespace and newlines
		const sanitized = String(email).replace(/[\r\n]/g, "").trim();
		// Basic email regex - covers most valid emails without being overly strict
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(sanitized)) {
			throw new ValidationError(
				`Invalid email format: ${email}`,
				422,
				null
			);
		}
		if (sanitized.length > 254) {
			throw new ValidationError(
				`Email too long: ${email}. Max 254 characters.`,
				422,
				null
			);
		}
		return sanitized;
	}

	/**
	 * Validate phone number format (basic check)
	 * @private
	 */
	_validatePhone(phone) {
		const cleaned = String(phone).replace(/\D/g, "");
		if (cleaned.length < 10 || cleaned.length > 11) {
			throw new ValidationError(
				`Invalid phone number: ${phone}. Expected 10-11 digits.`,
				422,
				null
			);
		}
		return cleaned;
	}

	/**
	 * Generate mock response for dry run mode
	 * @private
	 */
	_getDryRunResponse(url, options) {
		// Determine response type based on URL
		if (url.includes("/lookup") && !url.includes("bulk")) {
			return {
				sid: "dry-run",
				status: "success",
				message: "Good",
				code: "none",
				offset: 0,
				wireless: 0,
				phone: "0000000000",
				results: 0,
				time: 0,
				scrubs: true,
			};
		}
		if (url.includes("bulk") || url.includes("bulklookup")) {
			const body = options.body ? JSON.parse(options.body) : {};
			const phones = body.phones || [];
			return {
				status: "success",
				numbers: phones.length,
				count: phones.length,
				phones: phones,
				supression: [],
				wireless: [],
				reasons: {},
				carrier: {},
			};
		}
		if (url.includes("emailbulk")) {
			const body = options.body ? JSON.parse(options.body) : {};
			const emails = body.emails || [];
			return {
				good: emails,
				bad: [],
			};
		}
		return { status: "success", dryRun: true };
	}

	/**
	 * Make an HTTP request with timeout and retry logic
	 * @private
	 * @param {string} url
	 * @param {Object} options
	 * @param {AbortSignal} [options.signal] - External abort signal for cancellation
	 */
	async _request(url, options = {}) {
		// Dry run mode - return mock data without making API call
		if (this.dryRun) {
			this._log("debug", "Dry run - skipping actual request", { url });
			return this._getDryRunResponse(url, options);
		}

		// Check circuit breaker
		this._checkCircuitBreaker();

		const externalSignal = options.signal;

		// Check if already aborted before starting
		if (externalSignal?.aborted) {
			throw new TimeoutError("Request aborted", null);
		}

		let lastError;

		for (let attempt = 0; attempt <= this.retries; attempt++) {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), this.timeout);

			// Link external signal to our controller
			const onExternalAbort = () => controller.abort();
			externalSignal?.addEventListener("abort", onExternalAbort);

			try {
				if (attempt > 0) {
					// Exponential backoff: 100ms, 200ms, 400ms, 800ms...
					const delay = Math.min(100 * Math.pow(2, attempt - 1), 10000);
					// Add jitter (±25%) to prevent thundering herd
					const jitter = delay * (0.75 + Math.random() * 0.5);
					this._log("warn", `Retry attempt ${attempt}/${this.retries}`, {
						url,
						delay: Math.round(jitter),
					});
					await this._sleep(jitter);
				}

				// Check again if aborted during backoff
				if (externalSignal?.aborted) {
					throw new TimeoutError("Request aborted", null);
				}

				this._log("debug", "Request started", {
					url,
					method: options.method || "GET",
				});

				// Call onRequest hook
				if (this.onRequest) {
					await this.onRequest(url, {
						method: options.method || "GET",
						headers: options.headers,
						body: options.body,
					});
				}

				const response = await fetch(url, {
					...options,
					signal: controller.signal,
					headers: {
						Accept: "application/json",
						"Content-Type": "application/json",
						...options.headers,
					},
				});

				clearTimeout(timeoutId);
				externalSignal?.removeEventListener("abort", onExternalAbort);

				const contentType = response.headers.get("content-type");
				let data;

				if (contentType && contentType.includes("application/json")) {
					data = await response.json();
				} else {
					data = await response.text();
				}

				if (!response.ok) {
					const retryAfter = response.headers.get("retry-after");
					const error = BlacklistAllianceError.fromResponse(
						`API request failed: ${response.statusText}`,
						response.status,
						data,
						{ retryAfter: retryAfter ? parseInt(retryAfter, 10) : undefined }
					);

					// Check if we should retry
					if (this._isRetryable(error) && attempt < this.retries) {
						lastError = error;
						this._log("warn", `Retryable error: ${response.status}`, { url });
						continue;
					}
					throw error;
				}

				this._log("debug", "Request completed", {
					url,
					status: response.status,
				});

				// Call onResponse hook
				if (this.onResponse) {
					await this.onResponse(
						{ status: response.status, headers: response.headers },
						data
					);
				}

				// Record success for circuit breaker
				this._recordSuccess();

				return data;
			} catch (error) {
				clearTimeout(timeoutId);
				externalSignal?.removeEventListener("abort", onExternalAbort);

				if (error.name === "AbortError") {
					// Check if abort was from external signal or internal timeout
					const wasExternalAbort = externalSignal?.aborted;
					lastError = new TimeoutError(
						wasExternalAbort ? "Request aborted" : "Request timeout",
						null
					);
					// Don't retry if user explicitly aborted
					if (wasExternalAbort) {
						throw lastError;
					}
				} else if (error.code === "ECONNRESET" || error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
					lastError = new NetworkError(error.message, error);
				} else {
					lastError = error;
				}

				// Check if we should retry
				if (this._isRetryable(lastError) && attempt < this.retries) {
					this._log("warn", `Request failed, will retry`, {
						url,
						error: lastError.message,
					});
					continue;
				}

				this._log("error", "Request failed", { url, error: lastError.message });

				// Record failure for circuit breaker
				this._recordFailure();

				throw lastError;
			}
		}

		// Record failure for circuit breaker (fallback if loop completes without throwing)
		this._recordFailure();

		throw lastError;
	}

	/**
	 * Merge multiple bulk lookup results into one
	 * @private
	 */
	_mergeBulkResults(results) {
		const merged = {
			status: "success",
			numbers: 0,
			count: 0,
			phones: [],
			supression: [],
			wireless: [],
			reasons: {},
			carrier: {},
		};

		for (const result of results) {
			// Handle array response (API returns array with single object)
			const r = Array.isArray(result) ? result[0] : result;
			if (!r) continue;

			merged.numbers += r.numbers || 0;
			merged.count += r.count || 0;
			merged.phones.push(...(r.phones || []));
			merged.supression.push(...(r.supression || []));
			merged.wireless.push(...(r.wireless || []));
			Object.assign(merged.reasons, r.reasons || {});
			Object.assign(merged.carrier, r.carrier || {});
		}

		return merged;
	}

	/**
	 * Compute "bad" emails as submitted minus "good" (API only returns good)
	 * @private
	 */
	_computeBadEmails(result, submittedEmails) {
		const goodSet = new Set((result.good || []).map(e => e.toLowerCase()));
		const bad = submittedEmails.filter(e => !goodSet.has(e.toLowerCase()));
		return {
			good: result.good || [],
			bad: bad,
		};
	}

	/**
	 * Merge multiple email bulk results into one
	 * @private
	 */
	_mergeEmailResults(results, submittedEmails) {
		const merged = {
			good: [],
			bad: [],
		};

		for (const r of results) {
			if (r.good) merged.good.push(...r.good);
		}

		// Compute "bad" as submitted minus all "good" (API only returns good)
		const goodSet = new Set(merged.good.map(e => e.toLowerCase()));
		merged.bad = submittedEmails.filter(e => !goodSet.has(e.toLowerCase()));

		return merged;
	}

	// ============================================
	// SIMPLE API (Query Parameter Style)
	// ============================================

	/**
	 * Lookup a single phone number (Simple API)
	 * @param {string} phone - Phone number to lookup (e.g., '2223334444')
	 * @param {Object} [options]
	 * @param {ApiVersion} [options.version] - API version (v1, v2, v3, v5)
	 * @param {ResponseFormat} [options.responseFormat='json'] - Response format
	 * @param {boolean} [options.validate=true] - Validate phone format
	 * @returns {Promise<SingleLookupResult>}
	 *
	 * @example
	 * const result = await client.lookupSingle('2223334444');
	 * if (result.message === 'Blacklisted') {
	 *   console.log('Reasons:', result.code);
	 * }
	 */
	async lookupSingle(phone, options = {}) {
		const cleanPhone =
			options.validate !== false ? this._validatePhone(phone) : phone;

		const params = new URLSearchParams({
			key: this.apiKey,
			phone: cleanPhone,
			ver: options.version || this.defaultVersion,
			resp: options.responseFormat || "json",
		});

		return this._request(`${BASE_URL}/lookup?${params}`, { signal: options.signal });
	}

	/**
	 * Lookup multiple phone numbers in bulk (Simple API)
	 * Auto-batches requests for JSON format (disabled for raw/phonecode formats).
	 *
	 * @param {string[]} phones - Array of phone numbers
	 * @param {BulkOptions} [options]
	 * @returns {Promise<BulkLookupResult|string>} JSON object or raw string based on responseFormat
	 *
	 * @example
	 * const result = await client.bulkLookupSimple(['2223334444', '5556667777']);
	 * console.log('Blacklisted:', result.supression);
	 * console.log('Reasons:', result.reasons);
	 */
	async bulkLookupSimple(phones, options = {}) {
		if (!Array.isArray(phones) || phones.length === 0) {
			throw new ValidationError(
				"phones must be a non-empty array",
				400,
				null
			);
		}

		const responseFormat = options.responseFormat || "json";
		// Only auto-batch for JSON format (can't merge raw/text responses)
		const canBatch = responseFormat === "json";
		const autoBatch = canBatch && options.autoBatch !== false;
		const batches = autoBatch ? this._batchBySize(phones) : [phones];

		const params = new URLSearchParams({
			key: this.apiKey,
			ver: options.version || this.defaultVersion,
			resp: responseFormat,
		});

		if (batches.length === 1) {
			const result = await this._request(`${BASE_URL}/bulklookup?${params}`, {
				method: "POST",
				body: JSON.stringify({ phones: batches[0] }),
				signal: options.signal,
			});
			if (options.onProgress) {
				options.onProgress({ completed: phones.length, total: phones.length, batch: 1, totalBatches: 1 });
			}
			return result;
		}

		// Multiple batches - execute sequentially and merge (JSON only)
		const results = [];
		let completed = 0;
		for (let i = 0; i < batches.length; i++) {
			const batch = batches[i];
			const result = await this._request(`${BASE_URL}/bulklookup?${params}`, {
				method: "POST",
				body: JSON.stringify({ phones: batch }),
				signal: options.signal,
			});
			results.push(result);
			completed += batch.length;
			if (options.onProgress) {
				options.onProgress({ completed, total: phones.length, batch: i + 1, totalBatches: batches.length });
			}
		}

		return this._mergeBulkResults(results);
	}

	/**
	 * Check emails against blacklist (Simple API)
	 * Auto-batches if payload exceeds 1MB limit.
	 *
	 * @param {string[]} emails - Array of email addresses or MD5 hashes
	 * @param {EmailBulkOptions} [options]
	 * @returns {Promise<EmailBulkResult>}
	 *
	 * @example
	 * // Send raw emails
	 * const result = await client.emailBulk(['test@example.com']);
	 *
	 * // Send as MD5 hashes for privacy
	 * const result = await client.emailBulk(['test@example.com'], { hashEmails: true });
	 *
	 * console.log('Clean emails:', result.good);
	 * console.log('Blacklisted:', result.bad);
	 */
	async emailBulk(emails, options = {}) {
		if (!Array.isArray(emails) || emails.length === 0) {
			throw new ValidationError(
				"emails must be a non-empty array",
				400,
				null
			);
		}

		// Validate emails unless disabled (skip validation for pre-hashed emails)
		let processedEmails = emails;
		if (options.validate !== false && !options.hashEmails) {
			processedEmails = emails.map((email) => this._validateEmail(email));
		}

		// Convert to MD5 if requested
		if (options.hashEmails) {
			processedEmails = emails.map((email) => this._hashEmail(email));
		}

		const autoBatch = options.autoBatch !== false;
		const batches = autoBatch
			? this._batchBySize(processedEmails)
			: [processedEmails];

		const params = new URLSearchParams({
			key: this.apiKey,
		});

		if (batches.length === 1) {
			const result = await this._request(`${BASE_URL}/emailbulk?${params}`, {
				method: "POST",
				body: JSON.stringify({ emails: batches[0] }),
				signal: options.signal,
			});
			if (options.onProgress) {
				options.onProgress({ completed: processedEmails.length, total: processedEmails.length, batch: 1, totalBatches: 1 });
			}
			// Compute "bad" as submitted minus "good" (API only returns good)
			return this._computeBadEmails(result, processedEmails);
		}

		// Multiple batches - execute sequentially and merge
		const results = [];
		let completed = 0;
		for (let i = 0; i < batches.length; i++) {
			const batch = batches[i];
			const result = await this._request(`${BASE_URL}/emailbulk?${params}`, {
				method: "POST",
				body: JSON.stringify({ emails: batch }),
				signal: options.signal,
			});
			results.push(result);
			completed += batch.length;
			if (options.onProgress) {
				options.onProgress({ completed, total: processedEmails.length, batch: i + 1, totalBatches: batches.length });
			}
		}

		return this._mergeEmailResults(results, processedEmails);
	}

	// ============================================
	// STANDARD API (RESTful Path Style)
	// ============================================

	/**
	 * Lookup a single phone number (Standard RESTful API)
	 * @param {string} phone - 10-digit phone number
	 * @param {Object} [options]
	 * @param {ApiVersion} [options.version] - API version (v3 adds carrier info)
	 * @param {StandardResponseFormat} [options.responseFormat='json'] - Response format
	 * @param {boolean} [options.validate=true] - Validate phone format
	 * @returns {Promise<SingleLookupResult>}
	 *
	 * @example
	 * const result = await client.lookup('2223334444', { version: 'v3' });
	 * console.log('Carrier:', result.carrier?.name);
	 */
	async lookup(phone, options = {}) {
		const cleanPhone =
			options.validate !== false ? this._validatePhone(phone) : phone;
		const version = options.version || this.defaultVersion;
		const responseFormat = options.responseFormat || "json";

		const url = `${BASE_URL}/standard/api/${version}/Lookup/key/${this.apiKey}/phone/${cleanPhone}/response/${responseFormat}`;

		return this._request(url, { signal: options.signal });
	}

	/**
	 * Lookup multiple phone numbers in bulk (Standard RESTful API)
	 * Auto-batches if payload exceeds 1MB limit.
	 *
	 * @param {string[]} phones - Array of phone numbers
	 * @param {Object} [options]
	 * @param {ApiVersion} [options.version] - API version
	 * @param {boolean} [options.autoBatch=true] - Automatically batch if payload exceeds limit
	 * @returns {Promise<BulkLookupResult>}
	 *
	 * @example
	 * const result = await client.bulkLookup(['2223334444', '5556667777']);
	 * console.log('Blacklisted:', result.supression);
	 */
	async bulkLookup(phones, options = {}) {
		if (!Array.isArray(phones) || phones.length === 0) {
			throw new ValidationError(
				"phones must be a non-empty array",
				400,
				null
			);
		}

		const autoBatch = options.autoBatch !== false;
		const batches = autoBatch ? this._batchBySize(phones) : [phones];
		const version = options.version || this.defaultVersion;

		const url = `${BASE_URL}/standard/api/${version}/bulklookup/key/${this.apiKey}`;

		if (batches.length === 1) {
			const result = await this._request(url, {
				method: "POST",
				body: JSON.stringify({ phones: batches[0] }),
				signal: options.signal,
			});
			if (options.onProgress) {
				options.onProgress({ completed: phones.length, total: phones.length, batch: 1, totalBatches: 1 });
			}
			return result;
		}

		// Multiple batches - execute sequentially and merge
		const results = [];
		let completed = 0;
		for (let i = 0; i < batches.length; i++) {
			const batch = batches[i];
			const result = await this._request(url, {
				method: "POST",
				body: JSON.stringify({ phones: batch }),
				signal: options.signal,
			});
			results.push(result);
			completed += batch.length;
			if (options.onProgress) {
				options.onProgress({ completed, total: phones.length, batch: i + 1, totalBatches: batches.length });
			}
		}

		return this._mergeBulkResults(results);
	}

	// ============================================
	// CONVENIENCE METHODS
	// ============================================

	/**
	 * Check if a single phone number is blacklisted
	 * @param {string} phone - Phone number to check
	 * @returns {Promise<boolean>}
	 *
	 * @example
	 * if (await client.isBlacklisted('9999999999')) {
	 *   console.log('Do not call this number');
	 * }
	 */
	async isBlacklisted(phone) {
		const result = await this.lookupSingle(phone);
		return result.message === "Blacklisted";
	}

	/**
	 * Check if an email is blacklisted
	 * @param {string} email - Email address or MD5 hash
	 * @param {Object} [options]
	 * @param {boolean} [options.hashEmail=false] - Convert email to MD5 before sending
	 * @returns {Promise<boolean>}
	 *
	 * @example
	 * if (await client.isEmailBlacklisted('spam@example.com')) {
	 *   console.log('Email is blacklisted');
	 * }
	 */
	async isEmailBlacklisted(email, options = {}) {
		const emailToCheck = options.hashEmail ? this._hashEmail(email) : email;
		const result = await this.emailBulk([emailToCheck], { hashEmails: false });
		// Check if email is in "bad" list (case-insensitive)
		const badLower = (result.bad || []).map(e => e.toLowerCase());
		return badLower.includes(emailToCheck.toLowerCase());
	}

	/**
	 * Get blacklist reasons for a phone number
	 * @param {string} phone - Phone number
	 * @returns {Promise<string[]>} Array of reason codes
	 *
	 * @example
	 * const reasons = await client.getBlacklistReasons('9999999999');
	 * // ['prelitigation1', 'federal-dnc']
	 */
	async getBlacklistReasons(phone) {
		const result = await this.lookupSingle(phone);
		if (!result.code) return [];
		return result.code.split(",").map((r) => r.trim());
	}

	/**
	 * Hash an email to MD5 (utility method)
	 * @param {string} email - Email address
	 * @returns {string} MD5 hash
	 *
	 * @example
	 * const hash = client.hashEmail('test@example.com');
	 */
	hashEmail(email) {
		return this._hashEmail(email);
	}

	/**
	 * Check API connectivity (health check)
	 * Makes a simple lookup request to verify the API is reachable and credentials are valid.
	 * @returns {Promise<boolean>} True if API is reachable and responding
	 *
	 * @example
	 * if (await client.ping()) {
	 *   console.log('API is healthy');
	 * }
	 */
	async ping() {
		try {
			// Use a simple lookup with a test phone number
			await this.lookupSingle("0000000000", { validate: false });
			return true;
		} catch (error) {
			// AuthenticationError means API is reachable but creds are bad
			if (error.name === "AuthenticationError") {
				return false;
			}
			// For other errors, API may still be reachable
			// A "not found" or similar response still means API is up
			if (error.statusCode && error.statusCode < 500) {
				return true;
			}
			return false;
		}
	}
}

module.exports = { BlacklistAlliance };
