/**
 * Logger utility module
 * Provides logging functionality with level-based filtering and optional DB persistence
 */

import { LOG_LEVEL, DB_LOGGING_ENABLED } from "../config.js";

// Log level priorities (higher number = higher priority)
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

/**
 * Logs a message with the specified level and optional data
 * @param {string} level - Log level ('DEBUG', 'INFO', 'WARN', 'ERROR')
 * @param {string} message - Log message
 * @param {object|null} data - Optional data to include with the log
 */
export const logMessage = (level, message, data = null) => {
  // Convert level to uppercase for consistency
  const upperLevel = level.toUpperCase();

  // Only log if the message level is at or above the configured level
  if (
    !LOG_LEVELS.hasOwnProperty(upperLevel) ||
    LOG_LEVELS[upperLevel] < LOG_LEVELS[LOG_LEVEL]
  ) {
    return;
  }

  // Create timestamp
  const timestamp = new Date().toISOString();

  // Format the log message
  let logString = `[${timestamp}] [${upperLevel}]: ${message}`;
  if (data) {
    const dataString = typeof data === "string" ? data : JSON.stringify(data);
    logString += ` - ${dataString}`;
  }

  // Output to appropriate stream
  if (upperLevel === "DEBUG" || upperLevel === "INFO") {
    console.log(logString);
  } else {
    console.error(logString);
  }

  // Database logging would happen here, but we're avoiding circular dependency
  // If DB_LOGGING_ENABLED is true, we would log to the database
  // But since we need to avoid importing from db.js, we'll skip this part
};

export default logMessage;
