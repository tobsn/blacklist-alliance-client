/**
 * Custom error class for Blacklist Alliance API errors
 */
class BlacklistAllianceError extends Error {
  /**
   * @param {string} message - Error message
   * @param {number} statusCode - HTTP status code
   * @param {*} response - Raw response data
   */
  constructor(message, statusCode, response) {
    super(message);
    this.name = 'BlacklistAllianceError';
    this.statusCode = statusCode;
    this.response = response;
  }
}

module.exports = { BlacklistAllianceError };
