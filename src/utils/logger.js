/**
 * ApplicationLoggerService - Structured JSON logging to stderr with log level support
 *
 * This service provides logging functions that output structured JSON exclusively to process.stderr.
 * It respects the LOG_LEVEL environment variable for filtering logs based on severity.
 */

// Log levels with numeric values for comparison
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Get log level from environment or default to 'info'
const getCurrentLogLevel = () => {
  const logLevel = process.env.LOG_LEVEL?.toLowerCase() || "info";
  return LOG_LEVELS[logLevel] !== undefined ? logLevel : "info";
};

/**
 * Check if a given log level should be logged based on the current log level setting
 * @param {string} level - The log level to check
 * @returns {boolean} - Whether the log should be output
 */
const shouldLog = (level) => {
  const currentLevel = LOG_LEVELS[getCurrentLogLevel()];
  const targetLevel = LOG_LEVELS[level];
  return targetLevel >= currentLevel;
};

/**
 * Process message or error object to ensure proper serialization
 * @param {string|Error} message - Message string or Error object
 * @returns {Object} - Processed message object
 */
const processMessage = (message) => {
  if (message instanceof Error) {
    return {
      message: message.message,
      stack: message.stack,
    };
  }
  return { message };
};

/**
 * Process context object, handling Error objects specially
 * @param {Object|Error|undefined} context - Optional context object
 * @returns {Object|undefined} - Processed context
 */
const processContext = (context) => {
  if (!context) return undefined;

  if (context instanceof Error) {
    return {
      error: {
        message: context.message,
        stack: context.stack,
      },
    };
  }

  return context;
};

/**
 * Core logging function
 * @param {string} level - Log level
 * @param {string|Error} message - Log message or Error object
 * @param {Object} [context] - Optional context data
 */
const log = (level, message, context) => {
  if (!shouldLog(level)) return;

  const processedMessage = processMessage(message);
  const processedContext = processContext(context);

  const logObject = {
    timestamp: new Date().toISOString(),
    level,
    ...processedMessage,
    ...(processedContext ? { context: processedContext } : {}),
  };

  // Write to stderr as JSON with newline
  process.stderr.write(JSON.stringify(logObject) + "\n");
};

/**
 * Logger object with methods for different log levels
 */
const logger = {
  /**
   * Log debug message
   * @param {string|Error} message - Debug message or Error
   * @param {Object} [context] - Optional context
   */
  debug: (message, context) => log("debug", message, context),

  /**
   * Log informational message
   * @param {string|Error} message - Info message or Error
   * @param {Object} [context] - Optional context
   */
  info: (message, context) => log("info", message, context),

  /**
   * Log warning message
   * @param {string|Error} message - Warning message or Error
   * @param {Object} [context] - Optional context
   */
  warn: (message, context) => log("warn", message, context),

  /**
   * Log error message
   * @param {string|Error} message - Error message or Error object
   * @param {Object} [context] - Optional context
   */
  error: (message, context) => log("error", message, context),
};

// Export the logger instance
export default logger;
