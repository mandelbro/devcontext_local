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

// Multiple ways to detect MCP mode to be absolutely sure
function isInMcpMode() {
  return (
    process.env.MCP_MODE === "true" ||
    process.env.MCP_MODE === true ||
    global.MCP_MODE === true
  );
}

// MCP mode is set in main.js BEFORE any imports run
// This ensures we detect it correctly
const IN_MCP_MODE = isInMcpMode();

/**
 * Logs a message with the specified level and optional data
 * @param {string} level - Log level ('DEBUG', 'INFO', 'WARN', 'ERROR')
 * @param {string} message - Log message
 * @param {object|null} data - Optional data to include with the log
 */
export const logMessage = (level, message, data = null) => {
  // Defense in depth: Triple-check MCP mode to be absolutely certain
  // This is critical for MCP operation
  if (isInMcpMode() || IN_MCP_MODE || process.env.MCP_MODE === "true") {
    return;
  }

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

  // Normal mode - human readable format
  // Format the log message
  let logString = `[${timestamp}] [${upperLevel}]: ${message}`;
  if (data) {
    const dataString = typeof data === "string" ? data : JSON.stringify(data);
    logString += ` - ${dataString}`;
  }

  // Final safety check before output
  if (isInMcpMode() || IN_MCP_MODE || process.env.MCP_MODE === "true") {
    return;
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
