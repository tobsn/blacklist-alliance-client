/**
 * Base error class for Blacklist Alliance API errors
 */
class BlacklistAllianceError extends Error {
	/**
	 * @param {string} message - Error message
	 * @param {number} statusCode - HTTP status code
	 * @param {*} response - Raw response data
	 */
	constructor(message, statusCode, response) {
		super(message);
		this.name = "BlacklistAllianceError";
		this.statusCode = statusCode;
		this.response = response;
	}

	/**
	 * Create appropriate error subclass based on status code
	 * @param {string} message
	 * @param {number} statusCode
	 * @param {*} response
	 * @param {Object} [options]
	 * @returns {BlacklistAllianceError}
	 */
	static fromResponse(message, statusCode, response, options = {}) {
		switch (statusCode) {
			case 401:
			case 403:
				return new AuthenticationError(message, statusCode, response);
			case 408:
				return new TimeoutError(message, response);
			case 429:
				return new RateLimitError(message, response, options.retryAfter);
			case 400:
			case 422:
				return new ValidationError(message, statusCode, response);
			default:
				if (statusCode >= 500) {
					return new ServerError(message, statusCode, response);
				}
				return new BlacklistAllianceError(message, statusCode, response);
		}
	}
}

/**
 * Authentication/authorization error (401, 403)
 */
class AuthenticationError extends BlacklistAllianceError {
	constructor(message, statusCode, response) {
		super(message, statusCode, response);
		this.name = "AuthenticationError";
	}
}

/**
 * Rate limit exceeded (429)
 */
class RateLimitError extends BlacklistAllianceError {
	/**
	 * @param {string} message
	 * @param {*} response
	 * @param {number} [retryAfter] - Seconds to wait before retrying
	 */
	constructor(message, response, retryAfter) {
		super(message, 429, response);
		this.name = "RateLimitError";
		this.retryAfter = retryAfter || null;
	}
}

/**
 * Validation error for invalid input (400, 422)
 */
class ValidationError extends BlacklistAllianceError {
	constructor(message, statusCode, response) {
		super(message, statusCode, response);
		this.name = "ValidationError";
	}
}

/**
 * Request timeout (408 or AbortError)
 */
class TimeoutError extends BlacklistAllianceError {
	constructor(message, response) {
		super(message, 408, response);
		this.name = "TimeoutError";
	}
}

/**
 * Network connectivity error
 */
class NetworkError extends BlacklistAllianceError {
	constructor(message, originalError) {
		super(message, 0, null);
		this.name = "NetworkError";
		this.originalError = originalError;
	}
}

/**
 * Server error (5xx)
 */
class ServerError extends BlacklistAllianceError {
	constructor(message, statusCode, response) {
		super(message, statusCode, response);
		this.name = "ServerError";
	}
}

/**
 * Circuit breaker is open
 */
class CircuitBreakerError extends BlacklistAllianceError {
	constructor(message) {
		super(message, 503, null);
		this.name = "CircuitBreakerError";
	}
}

module.exports = {
	BlacklistAllianceError,
	AuthenticationError,
	RateLimitError,
	ValidationError,
	TimeoutError,
	NetworkError,
	ServerError,
	CircuitBreakerError,
};
