/**
 * TursoDB client setup
 *
 * This module configures and provides the TursoDB client instance
 * using the connection details from the ConfigService.
 */

import { createClient } from "@libsql/client";
import config from "../config.js";
import logger from "../utils/logger.js";

/**
 * Initializes and returns a TursoDB client instance
 * @returns {Object} The initialized TursoDB client
 */
export const initializeDbClient = () => {
  logger.info("Initializing TursoDB client");

  // Get database URL and auth token from configuration
  const { TURSO_DATABASE_URL, TURSO_AUTH_TOKEN } = config;

  // Validate that database URL is provided
  if (!TURSO_DATABASE_URL) {
    const error = new Error("TURSO_DATABASE_URL is required but not provided");
    logger.error("Failed to initialize TursoDB client", { error });
    throw error;
  }

  // Create client configuration object
  const clientConfig = {
    url: TURSO_DATABASE_URL,
  };

  // Only include auth token if it's provided
  if (TURSO_AUTH_TOKEN) {
    clientConfig.authToken = TURSO_AUTH_TOKEN;
    logger.debug("Including auth token in TursoDB client configuration");
  } else {
    logger.debug("No auth token provided for TursoDB client");
  }

  try {
    // Create and return the client instance
    const client = createClient(clientConfig);
    logger.info("TursoDB client initialized successfully");
    return client;
  } catch (error) {
    logger.error("Error creating TursoDB client", { error });
    throw error;
  }
};

export default initializeDbClient;
