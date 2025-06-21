/**
 * Database client setup
 *
 * This module provides the database client instance using the connection factory
 * which supports both Turso cloud and local SQLite modes.
 */

import { createDatabaseClient } from "./connectionFactory.js";
import logger from "../utils/logger.js";

/**
 * Initializes and returns a database client instance
 * @returns {Object} The initialized database client (Turso or local SQLite based on configuration)
 */
export const initializeDbClient = () => {
  logger.info("Initializing database client");

  try {
    // Use the connection factory to create the appropriate client
    const client = createDatabaseClient();
    logger.info("Database client initialized successfully");
    return client;
  } catch (error) {
    logger.error("Failed to initialize database client", { error });
    throw error;
  }
};

export default initializeDbClient;
