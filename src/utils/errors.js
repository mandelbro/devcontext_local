/**
 * Custom error classes for the application.
 */

/**
 * Error class for API rate limit responses.
 * @extends Error
 */
export class RateLimitError extends Error {
  /**
   * Create a RateLimitError.
   * @param {string} message - The error message.
   * @param {number} [retryAfterSeconds] - The number of seconds to wait before retrying, if provided by the API.
   */
  constructor(message, retryAfterSeconds) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Error class for general errors from the AI provider (Google Gemini).
 * @extends Error
 */
export class AIProviderError extends Error {
  /**
   * Create an AIProviderError.
   * @param {string} message - The error message.
   */
  constructor(message) {
    super(message);
    this.name = "AIProviderError";
  }
}
