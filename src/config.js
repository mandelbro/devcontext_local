/**
 * Configuration module that loads and exports environment variables
 */

import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// Critical TursoDB credentials - required for server operation
export const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
export const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

// Logging configuration
export const LOG_LEVEL = process.env.LOG_LEVEL || "INFO";
export const DB_LOGGING_ENABLED = process.env.DB_LOGGING_ENABLED === "true";

// Context retrieval configuration
export const DEFAULT_TOKEN_BUDGET = parseInt(
  process.env.DEFAULT_TOKEN_BUDGET || "4000",
  10
);
export const CONTEXT_DECAY_RATE = parseFloat(
  process.env.CONTEXT_DECAY_RATE || "0.95"
);
export const MAX_CACHE_SIZE = parseInt(
  process.env.MAX_CACHE_SIZE || "1000",
  10
);
