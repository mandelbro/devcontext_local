/**
 * ConfigService - Loads and provides access to environment variables
 *
 * This service loads environment variables from .env files using dotenv,
 * and provides centralized access to configuration values for the application.
 */

import dotenv from "dotenv";
import logger from "./utils/logger.js";
import path from "path";
import * as git from "isomorphic-git";
import { promises as fs } from "fs";

// Load environment variables from .env file
dotenv.config();

/**
 * Validates the LOG_LEVEL environment variable
 * @param {string} level - The log level to validate
 * @returns {string} - Valid log level or default 'info'
 */
const validateLogLevel = (level) => {
  const validLevels = ["debug", "info", "warn", "error"];
  if (level && validLevels.includes(level.toLowerCase())) {
    return level.toLowerCase();
  }
  return "info"; // Default log level
};

/**
 * Parses the TREE_SITTER_LANGUAGES environment variable
 * @param {string} languages - Comma-separated list of languages
 * @returns {string[]} - Array of language names
 */
const parseTreeSitterLanguages = (languages) => {
  if (!languages || typeof languages !== "string") {
    // Default to javascript, python, typescript if not set
    return ["javascript", "python", "typescript"];
  }

  // Parse comma-separated string into an array and trim each value
  return languages
    .split(",")
    .map((lang) => lang.trim())
    .filter((lang) => lang.length > 0);
};

/**
 * Parses the MAX_TEXT_FILE_SIZE_MB environment variable
 * @param {string} size - Size in MB
 * @returns {number} - Size in bytes
 */
const parseMaxTextFileSize = (size) => {
  // Try to parse the size as a number
  const parsed = parseFloat(size);

  // Check if parsing was successful and the value is positive
  if (!isNaN(parsed) && parsed > 0) {
    // Convert MB to bytes
    return parsed * 1024 * 1024;
  }

  // Default to 5MB if not set or invalid
  return 5 * 1024 * 1024;
};

/**
 * Determines the project path using current working directory or environment variable
 * @returns {Object} - Object containing path and source
 */
const determineProjectPath = () => {
  // First try to use current working directory
  const cwd = process.cwd();

  // If for some reason cwd is not available (unlikely), try environment variable
  if (!cwd) {
    const envProjectPath = process.env.PROJECT_PATH;
    if (envProjectPath && envProjectPath.trim() !== "") {
      return {
        path: envProjectPath,
        source: "environment variable",
      };
    }
  }

  return {
    path: cwd,
    source: "current working directory",
  };
};

/**
 * Validates if the given path is a Git repository
 * @param {string} projectPath - Path to validate
 * @returns {Promise<Object>} - Object containing validation result
 */
const validateGitRepository = async (projectPath) => {
  try {
    // Attempt to resolve HEAD ref, which should exist in any valid Git repository
    await git.resolveRef({ fs, dir: projectPath, ref: "HEAD" });

    // If we got here, it's a valid Git repository
    logger.info(`PROJECT_PATH validated as Git repository: ${projectPath}`);

    return {
      isValid: true,
      error: null,
    };
  } catch (error) {
    // Failed to resolve HEAD, likely not a Git repository
    logger.error(
      `PROJECT_PATH validation failed: ${projectPath} is not a valid Git repository`,
      {
        error: error.message,
        stack: error.stack,
      }
    );

    return {
      isValid: false,
      error: error,
    };
  }
};

// Determine the project path
const projectPathInfo = determineProjectPath();

/**
 * Configuration object with environment variables
 */
const config = {
  // TursoDB connection settings
  TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
  TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,

  // Project path settings
  PROJECT_PATH: projectPathInfo.path,

  // Logging configuration
  LOG_LEVEL: validateLogLevel(process.env.LOG_LEVEL),

  // Indexing configuration
  MAX_TEXT_FILE_SIZE: parseMaxTextFileSize(process.env.MAX_TEXT_FILE_SIZE_MB),
  MAX_TEXT_FILE_SIZE_MB: parseFloat(process.env.MAX_TEXT_FILE_SIZE_MB) || 5, // Original value for reference
  TREE_SITTER_LANGUAGES: parseTreeSitterLanguages(
    process.env.TREE_SITTER_LANGUAGES
  ),

  // AI Configuration - Google Gemini API
  GOOGLE_GEMINI_API_KEY: process.env.GOOGLE_GEMINI_API_KEY,
  AI_MODEL_NAME: process.env.AI_MODEL_NAME || "gemini-2.5-flash-preview-05-20",
  AI_THINKING_BUDGET: parseInt(process.env.AI_THINKING_BUDGET) || 1000,

  // AI Job Processing Configuration
  AI_JOB_CONCURRENCY: parseInt(process.env.AI_JOB_CONCURRENCY) || 2,
  AI_JOB_DELAY_MS: parseInt(process.env.AI_JOB_DELAY_MS) || 500,
  MAX_AI_JOB_ATTEMPTS: parseInt(process.env.MAX_AI_JOB_ATTEMPTS) || 3,
  AI_JOB_POLLING_INTERVAL_MS:
    parseInt(process.env.AI_JOB_POLLING_INTERVAL_MS) || 5000,

  // Context Retrieval Configuration
  MAX_SEED_ENTITIES_FOR_EXPANSION:
    parseInt(process.env.MAX_SEED_ENTITIES_FOR_EXPANSION) || 3,

  // Git repository validation function
  validateGitRepository: async () => {
    return await validateGitRepository(config.PROJECT_PATH);
  },
};

/**
 * Key architecture document paths for context retrieval
 * These paths are relative to PROJECT_PATH and will be used by RetrievalService
 * to fetch key project documents for architecture context
 */
export const KEY_ARCHITECTURE_DOCUMENT_PATHS = [
  "README.md",
  "docs/architecture.md",
  "docs/prd.md",
  "docs/stories.md",
  "CHANGELOG.md",
  // Future consideration: 'docs/architecture/*.md' when glob patterns are supported
];

/**
 * Default relationship types for context expansion
 * These relationship types are considered most valuable for relationship-based context expansion
 * in RelationshipManager.getRelatedEntities when no specific types are provided
 */
export const DEFAULT_RELATIONSHIP_TYPES_FOR_EXPANSION = [
  // Function/method calls - high priority for understanding code flow
  "CALLS_FUNCTION",
  "CALLS_METHOD",

  // Class/interface relationships - very important for understanding structure
  "IMPLEMENTS_INTERFACE",
  "EXTENDS_CLASS",

  // Parent-child entity relationships - crucial for understanding code hierarchy
  "DEFINES_CHILD_ENTITY",

  // Type relationships - important for typed languages (TypeScript)
  "TYPE_REFERENCE",

  // Import/module relationships - useful for understanding dependencies
  "IMPORTS_MODULE",

  // Variable/property access - moderate relevance
  "ACCESSES_PROPERTY",
  "USES_VARIABLE",

  // Type definitions - helpful for understanding custom types
  "DEFINES_TYPE",
  "USES_TYPE",
];

/**
 * High-priority relationship types for selective expansion
 * A smaller subset of relationships for more focused context when less expansion is needed
 */
export const HIGH_PRIORITY_RELATIONSHIP_TYPES = [
  "CALLS_FUNCTION",
  "CALLS_METHOD",
  "IMPLEMENTS_INTERFACE",
  "EXTENDS_CLASS",
  "DEFINES_CHILD_ENTITY",
];

/**
 * Ranking factor weights configuration for context prioritization
 * These weights are used by RetrievalService to calculate consolidatedScore for candidate snippets
 * Values can be tuned based on empirical testing and user feedback
 */
export const RANKING_FACTOR_WEIGHTS = {
  // Source Type Weights - Applied as multipliers to the initial relevance score
  sourceType: {
    // Code entities from full-text search (highest priority for relevant code)
    code_entity_fts: 1.0,

    // Code entities from keyword matching (slightly lower than FTS)
    code_entity_keyword: 0.9,

    // Project documents from full-text search (good for documentation context)
    project_document_fts: 0.8,

    // Project documents from keyword matching
    project_document_keyword: 0.7,

    // Conversation messages (valuable for ongoing context, can be boosted for current conversation)
    conversation_message: 0.6,

    // Conversation topics (good for understanding past discussion themes)
    conversation_topic: 0.7,

    // Git commits (useful for understanding recent changes)
    git_commit: 0.5,

    // Git commit file changes (specific file-level change context)
    git_commit_file_change: 0.5,

    // Code entities found through relationship expansion (future implementation)
    code_entity_related: 0.85,
  },

  // AI Status Weights - Applied as multipliers to boost or reduce scores based on AI processing status
  aiStatus: {
    // AI summarized content gets a boost as it's more concise and relevant
    completed: 1.2,

    // Content pending AI processing (baseline)
    pending: 1.0,

    // Failed AI processing still has raw content value, slight reduction
    failed_ai: 0.8,

    // Content explicitly marked as not needing AI processing
    not_needed: 1.0,

    // Content in AI processing queue
    in_progress: 1.0,
  },

  // Recency Factor Configuration - Used for time-sensitive scoring adjustments
  recency: {
    // Maximum boost for very recent items (e.g., same day)
    maxBoost: 0.2,

    // Decay rate in hours - how quickly recency boost diminishes
    decayRateHours: 24,

    // Minimum age in hours before recency boost starts to decay
    minAgeForDecay: 1,

    // Maximum age in hours beyond which no recency boost is applied
    maxAgeForBoost: 168, // 1 week
  },

  // Relationship Type Weights - For future relationship-based context expansion
  // These will be used when implementing code_entity_related snippets
  relationshipType: {
    // Function/method calls - high relevance
    CALLS_FUNCTION: 1.1,
    CALLS_METHOD: 1.1,

    // Interface/class implementations - very high relevance for understanding structure
    IMPLEMENTS_INTERFACE: 1.2,
    EXTENDS_CLASS: 1.2,

    // Import/dependency relationships - moderate relevance
    IMPORTS_FROM: 0.9,
    REQUIRES_MODULE: 0.9,

    // Variable/property access - moderate relevance
    ACCESSES_PROPERTY: 0.8,
    USES_VARIABLE: 0.8,

    // Type relationships - high relevance for typed languages
    USES_TYPE: 1.0,
    DEFINES_TYPE: 1.1,

    // Generic relationships - baseline relevance
    REFERENCES: 0.7,
    MENTIONS: 0.6,
  },

  // Quality/Detail Factor Configuration - For assessing content richness
  quality: {
    // Boost for content with good structural information (future tree-sitter metrics)
    hasStructuralInfo: 0.1,

    // Boost for content with comprehensive documentation
    hasDocumentation: 0.05,

    // Boost for recently modified entities (separate from general recency)
    recentlyModified: 0.05,
  },
};

// Log configuration (excluding sensitive information)
logger.info("Configuration loaded", {
  LOG_LEVEL: config.LOG_LEVEL,
  TURSO_DATABASE_URL: config.TURSO_DATABASE_URL ? "(set)" : "(not set)",
  TURSO_AUTH_TOKEN: config.TURSO_AUTH_TOKEN ? "(set)" : "(not set)",
  MAX_TEXT_FILE_SIZE_MB: config.MAX_TEXT_FILE_SIZE_MB,
  MAX_TEXT_FILE_SIZE: config.MAX_TEXT_FILE_SIZE,
  TREE_SITTER_LANGUAGES: config.TREE_SITTER_LANGUAGES,
  GOOGLE_GEMINI_API_KEY: config.GOOGLE_GEMINI_API_KEY ? "(set)" : "(not set)",
  AI_MODEL_NAME: config.AI_MODEL_NAME,
  AI_THINKING_BUDGET: config.AI_THINKING_BUDGET,
  AI_JOB_CONCURRENCY: config.AI_JOB_CONCURRENCY,
  AI_JOB_DELAY_MS: config.AI_JOB_DELAY_MS,
  MAX_AI_JOB_ATTEMPTS: config.MAX_AI_JOB_ATTEMPTS,
  AI_JOB_POLLING_INTERVAL_MS: config.AI_JOB_POLLING_INTERVAL_MS,
  MAX_SEED_ENTITIES_FOR_EXPANSION: config.MAX_SEED_ENTITIES_FOR_EXPANSION,
  KEY_ARCHITECTURE_DOCUMENT_PATHS: KEY_ARCHITECTURE_DOCUMENT_PATHS,
  DEFAULT_RELATIONSHIP_TYPES_FOR_EXPANSION:
    DEFAULT_RELATIONSHIP_TYPES_FOR_EXPANSION,
  HIGH_PRIORITY_RELATIONSHIP_TYPES: HIGH_PRIORITY_RELATIONSHIP_TYPES,
  RANKING_FACTOR_WEIGHTS_CONFIGURED: {
    sourceTypeWeights: Object.keys(RANKING_FACTOR_WEIGHTS.sourceType).length,
    aiStatusWeights: Object.keys(RANKING_FACTOR_WEIGHTS.aiStatus).length,
    relationshipTypeWeights: Object.keys(
      RANKING_FACTOR_WEIGHTS.relationshipType
    ).length,
    recencyConfigured: !!RANKING_FACTOR_WEIGHTS.recency,
    qualityConfigured: !!RANKING_FACTOR_WEIGHTS.quality,
  },
});

// Log PROJECT_PATH resolution
logger.info(`PROJECT_PATH resolved to: ${config.PROJECT_PATH}`, {
  source: projectPathInfo.source,
  precedence: "current working directory takes precedence",
});

// Log sensitive information only at debug level
if (config.LOG_LEVEL === "debug") {
  logger.debug("Debug configuration details", {
    TURSO_DATABASE_URL: config.TURSO_DATABASE_URL,
    // Still don't log the actual token value, just indicate if it exists
    TURSO_AUTH_TOKEN_SET: Boolean(config.TURSO_AUTH_TOKEN),
  });
}

export default config;
