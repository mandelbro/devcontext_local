/**
 * Database Connection Factory
 *
 * This module provides a factory function to create database connections
 * supporting both Turso cloud and local SQLite modes based on configuration.
 */

import { createClient } from "@libsql/client";
import config from "../config.js";
import logger from "../utils/logger.js";
import path from "path";

/**
 * Creates a database client based on the configured DATABASE_MODE
 * @returns {Object} The initialized database client (either Turso or local SQLite)
 * @throws {Error} If database configuration is invalid or connection fails
 */
export const createDatabaseClient = () => {
  const { DATABASE_MODE, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, LOCAL_SQLITE_PATH } = config;

  logger.info(`Creating database client in '${DATABASE_MODE}' mode`);

  // Validate DATABASE_MODE
  const validModes = ['turso', 'local'];
  if (!validModes.includes(DATABASE_MODE)) {
    const errorMsg = DATABASE_MODE
      ? `Invalid DATABASE_MODE: '${DATABASE_MODE}'. Must be either 'turso' or 'local'.`
      : `DATABASE_MODE is not set. Please set DATABASE_MODE to either 'turso' or 'local' in your environment variables.`;

    logger.error(errorMsg);
    throw new Error(errorMsg + '\n\nFor quick start, use: DATABASE_MODE=local');
  }

  try {
    if (DATABASE_MODE === 'turso') {
      return createTursoClient();
    } else if (DATABASE_MODE === 'local') {
      return createLocalSQLiteClient();
    }
  } catch (error) {
    logger.error(`Failed to create database client in '${DATABASE_MODE}' mode`, {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

/**
 * Creates a Turso cloud database client
 * @returns {Object} The initialized Turso client
 * @throws {Error} If Turso configuration is missing or invalid
 */
const createTursoClient = () => {
  const { TURSO_DATABASE_URL, TURSO_AUTH_TOKEN } = config;

  logger.debug("Creating Turso cloud database client");

  // Validate Turso configuration
  if (!TURSO_DATABASE_URL) {
    const errorMsg =
      "TURSO_DATABASE_URL is required for 'turso' mode but not provided.\n\n" +
      "To fix this, you can either:\n" +
      "1. Set TURSO_DATABASE_URL in your environment variables\n" +
      "2. Switch to local mode by setting DATABASE_MODE=local\n\n" +
      "For local mode, use these environment variables:\n" +
      "  DATABASE_MODE=local\n" +
      "  LOCAL_SQLITE_PATH=./devcontext.db";

    logger.error("Missing Turso database URL");
    throw new Error(errorMsg);
  }

  // Validate URL format
  if (!TURSO_DATABASE_URL.startsWith('libsql://') && !TURSO_DATABASE_URL.startsWith('http')) {
    const errorMsg =
      `Invalid TURSO_DATABASE_URL format: ${TURSO_DATABASE_URL}\n\n` +
      "Turso URLs should start with 'libsql://' or 'https://'\n" +
      "Example: libsql://your-database.turso.io\n\n" +
      "If you don't have a Turso account, switch to local mode:\n" +
      "  DATABASE_MODE=local";

    logger.error("Invalid Turso URL format");
    throw new Error(errorMsg);
  }

  // Create client configuration
  const clientConfig = {
    url: TURSO_DATABASE_URL,
  };

  // Include auth token if provided
  if (TURSO_AUTH_TOKEN) {
    clientConfig.authToken = TURSO_AUTH_TOKEN;
    logger.debug("Including auth token in Turso client configuration");
  } else {
    logger.warn(
      "No TURSO_AUTH_TOKEN provided. This may cause authentication issues with Turso cloud.\n" +
      "If you experience connection errors, either:\n" +
      "1. Set TURSO_AUTH_TOKEN in your environment\n" +
      "2. Switch to local mode with DATABASE_MODE=local"
    );
  }

  // Create and validate the client
  const client = createClient(clientConfig);
  logger.info("Turso cloud database client created successfully", {
    url: TURSO_DATABASE_URL
  });

  return client;
};

/**
 * Creates a local SQLite database client
 * @returns {Object} The initialized local SQLite client
 * @throws {Error} If local database configuration is invalid
 */
const createLocalSQLiteClient = () => {
  const { LOCAL_SQLITE_PATH } = config;

  logger.debug("Creating local SQLite database client");

  // Validate local database path
  if (!LOCAL_SQLITE_PATH) {
    const errorMsg =
      "LOCAL_SQLITE_PATH is required for 'local' mode but not provided.\n\n" +
      "Please set LOCAL_SQLITE_PATH in your environment variables.\n" +
      "Example: LOCAL_SQLITE_PATH=./devcontext.db";

    logger.error("Missing local SQLite path");
    throw new Error(errorMsg);
  }

  // Resolve the path to get absolute path
  const resolvedPath = path.resolve(LOCAL_SQLITE_PATH);

  // Warn if using absolute path
  if (path.isAbsolute(LOCAL_SQLITE_PATH)) {
    logger.warn(
      `Using absolute path for database: ${LOCAL_SQLITE_PATH}\n` +
      "Consider using a relative path for better portability."
    );
  }

  // Ensure the path starts with 'file:' protocol for local SQLite
  const dbUrl = LOCAL_SQLITE_PATH.startsWith('file:')
    ? LOCAL_SQLITE_PATH
    : `file:${resolvedPath}`;

  // Create client configuration for local SQLite
  const clientConfig = {
    url: dbUrl,
  };

  // Create the local SQLite client
  const client = createClient(clientConfig);
  logger.info("Local SQLite database client created successfully", {
    path: LOCAL_SQLITE_PATH,
    resolvedPath: resolvedPath,
    url: dbUrl
  });

  return client;
};

/**
 * Validates database connection by executing a simple query
 * @param {Object} client - The database client to validate
 * @returns {Promise<boolean>} True if connection is valid, throws otherwise
 */
export const validateConnection = async (client) => {
  try {
    logger.debug("Validating database connection");

    // Execute a simple query to test the connection
    const result = await client.execute("SELECT 1 as test");

    if (result && result.rows && result.rows.length > 0) {
      logger.info("Database connection validated successfully");
      return true;
    } else {
      throw new Error("Connection validation query returned unexpected result");
    }
  } catch (error) {
    logger.error("Database connection validation failed", {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

export default createDatabaseClient;
