const crypto = require("crypto");
const { BlacklistAllianceError } = require("./errors");

const BASE_URL = "https://api.blacklistalliance.net";

/**
 * @typedef {'v1' | 'v2' | 'v3' | 'v5'} ApiVersion
 * @typedef {'json' | 'raw'} ResponseFormat
 * @typedef {'json' | 'raw' | 'xml'} StandardResponseFormat
 * @typedef {'json' | 'phonecode'} BulkResponseFormat
 */

/**
 * @typedef {Object} CarrierInfo
 * @property {string} did
 * @property {string} type - e.g., 'PCS'
 * @property {string} name - Carrier name
 * @property {string} state - State code
 * @property {string} ratecenter
 * @property {string} country - Country code
 * @property {string} clli
 * @property {string|number} lata
 * @property {string} wireless - 'Y' or 'N'
 * @property {string|number} lrn
 * @property {string|number} npa
 * @property {string|number} nxx
 * @property {string|number} nxxx
 * @property {string|number} ocn
 * @property {string} port_type
 */

/**
 * @typedef {Object} SingleLookupResult
 * @property {string} sid - Session ID
 * @property {string} status - 'success' or error status
 * @property {string} message - e.g., 'Blacklisted', 'Clean'
 * @property {string} code - Blacklist codes (e.g., 'prelitigation1,federal-dnc')
 * @property {number} offset
 * @property {number} wireless - 0 or 1
 * @property {string} phone
 * @property {number} results
 * @property {number} time
 * @property {string} scrubs
 * @property {CarrierInfo} [carrier] - Present in v3+
 */

/**
 * @typedef {Object} BulkLookupResult
 * @property {string} status
 * @property {number} numbers - Total numbers submitted
 * @property {number} count - Numbers processed
 * @property {string[]} phones - All submitted phones
 * @property {string[]} supression - Blacklisted phones (suppression list)
 * @property {string[]} wireless - Wireless numbers
 * @property {Object<string, string>} reasons - Phone to reason codes mapping
 * @property {Object<string, CarrierInfo>} carrier - Phone to carrier info mapping
 */

/**
 * @typedef {Object} EmailBulkResult
 * @property {string[]} [good] - Emails not on blacklist
 * @property {string[]} [bad] - Emails on blacklist
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
	 * Check if error is retryable (5xx, network errors, timeouts)
	 * @private
	 */
	_isRetryable(error) {
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
		return crypto
			.createHash("md5")
			.update(email.toLowerCase().trim())
			.digest("hex");
	}

	/**
	 * Validate phone number format (basic check)
	 * @private
	 */
	_validatePhone(phone) {
		const cleaned = String(phone).replace(/\D/g, "");
		if (cleaned.length < 10 || cleaned.length > 11) {
			throw new BlacklistAllianceError(
				`Invalid phone number: ${phone}. Expected 10-11 digits.`,
				422,
				null
			);
		}
		return cleaned;
	}

	/**
	 * Make an HTTP request with timeout and retry logic
	 * @private
	 */
	async _request(url, options = {}) {
		let lastError;

		for (let attempt = 0; attempt <= this.retries; attempt++) {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), this.timeout);

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

				this._log("debug", "Request started", {
					url,
					method: options.method || "GET",
				});

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

				const contentType = response.headers.get("content-type");
				let data;

				if (contentType && contentType.includes("application/json")) {
					data = await response.json();
				} else {
					data = await response.text();
				}

				if (!response.ok) {
					const error = new BlacklistAllianceError(
						`API request failed: ${response.statusText}`,
						response.status,
						data
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
				return data;
			} catch (error) {
				clearTimeout(timeoutId);

				if (error.name === "AbortError") {
					lastError = new BlacklistAllianceError("Request timeout", 408, null);
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
				throw lastError;
			}
		}

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
	 * Merge multiple email bulk results into one
	 * @private
	 */
	_mergeEmailResults(results) {
		const merged = {
			good: [],
			bad: [],
		};

		for (const r of results) {
			if (r.good) merged.good.push(...r.good);
			if (r.bad) merged.bad.push(...r.bad);
		}

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

		return this._request(`${BASE_URL}/lookup?${params}`);
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
			throw new BlacklistAllianceError(
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
			return this._request(`${BASE_URL}/bulklookup?${params}`, {
				method: "POST",
				body: JSON.stringify({ phones: batches[0] }),
			});
		}

		// Multiple batches - execute sequentially and merge (JSON only)
		const results = [];
		for (const batch of batches) {
			const result = await this._request(`${BASE_URL}/bulklookup?${params}`, {
				method: "POST",
				body: JSON.stringify({ phones: batch }),
			});
			results.push(result);
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
			throw new BlacklistAllianceError(
				"emails must be a non-empty array",
				400,
				null
			);
		}

		// Convert to MD5 if requested
		let processedEmails = emails;
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
			return this._request(`${BASE_URL}/emailbulk?${params}`, {
				method: "POST",
				body: JSON.stringify({ emails: batches[0] }),
			});
		}

		// Multiple batches - execute sequentially and merge
		const results = [];
		for (const batch of batches) {
			const result = await this._request(`${BASE_URL}/emailbulk?${params}`, {
				method: "POST",
				body: JSON.stringify({ emails: batch }),
			});
			results.push(result);
		}

		return this._mergeEmailResults(results);
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

		return this._request(url);
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
			throw new BlacklistAllianceError(
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
			return this._request(url, {
				method: "POST",
				body: JSON.stringify({ phones: batches[0] }),
			});
		}

		// Multiple batches - execute sequentially and merge
		const results = [];
		for (const batch of batches) {
			const result = await this._request(url, {
				method: "POST",
				body: JSON.stringify({ phones: batch }),
			});
			results.push(result);
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
		return result.message === "Blacklisted" || result.supression?.length > 0;
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
		// Only the 'bad' list is a definitive indicator of a blacklisted email
		return result.bad?.includes(emailToCheck) ?? false;
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
}

module.exports = { BlacklistAlliance };
