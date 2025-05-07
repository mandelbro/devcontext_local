/**
 * Database client module for TursoDB connections
 * Manages the connection to the TursoDB database and provides query utilities
 */

import { createClient } from "@libsql/client";
import { TURSO_DATABASE_URL, TURSO_AUTH_TOKEN } from "./config.js";
import { logMessage } from "./utils/logger.js";

// Module-scoped singleton instance
let dbClient = null;

/**
 * Initialize and return a TursoDB client instance (singleton)
 * @returns {Object} TursoDB client instance
 * @throws {Error} If database URL or auth token is missing
 */
export const getDbClient = () => {
  // Check if we're in MCP mode - never log in MCP mode
  const inMcpMode = process.env.MCP_MODE === "true";

  if (dbClient) {
    return dbClient;
  }

  if (!TURSO_DATABASE_URL) {
    const errorMsg =
      "TURSO_DATABASE_URL is not defined in environment variables";
    if (inMcpMode) {
      // In MCP mode, don't throw with a message that could be logged
      throw new Error();
    } else {
      throw new Error(errorMsg);
    }
  }

  if (!TURSO_AUTH_TOKEN) {
    const errorMsg = "TURSO_AUTH_TOKEN is not defined in environment variables";
    if (inMcpMode) {
      // In MCP mode, don't throw with a message that could be logged
      throw new Error();
    } else {
      throw new Error(errorMsg);
    }
  }

  dbClient = createClient({
    url: TURSO_DATABASE_URL,
    authToken: TURSO_AUTH_TOKEN,
  });

  // Only log in non-MCP mode
  if (!inMcpMode) {
    logMessage("info", "Database client created", {
      url: TURSO_DATABASE_URL.substring(0, 20) + "...", // Don't log full URL for security
    });
  }

  return dbClient;
};

/**
 * Test the database connection by executing a simple query
 * @param {Object} client - TursoDB client instance from getDbClient()
 * @returns {Promise<boolean>} True if connection is successful
 * @throws {Error} If connection fails
 */
export const testDbConnection = async (client = null) => {
  // Check if we're in MCP mode - never log in MCP mode
  const inMcpMode = process.env.MCP_MODE === "true";

  try {
    // Maximum number of retry attempts
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        const dbClient = client || getDbClient();
        await dbClient.execute("SELECT 1");
        return true;
      } catch (connError) {
        retryCount++;

        // If we've reached max retries, handle the error
        if (retryCount >= maxRetries) {
          // In MCP mode, just return false instead of throwing
          if (inMcpMode) {
            return false;
          }
          throw new Error(
            `Database connection test failed: ${connError.message}`
          );
        }

        // Wait before retrying (exponential backoff)
        const waitTime = Math.pow(2, retryCount) * 100;
        await new Promise((resolve) => setTimeout(resolve, waitTime));

        // Reset client for retry if we're using the singleton
        if (!client) {
          dbClient = null;
        }
      }
    }

    return true; // Should never reach here but just in case
  } catch (error) {
    // In MCP mode, just return false instead of throwing
    if (inMcpMode) {
      return false;
    }
    throw new Error(`Database connection test failed: ${error.message}`);
  }
};

/**
 * Execute a SQL query with optional parameters
 * @param {string} sqlQuery - SQL query to execute
 * @param {Array} [args=[]] - Optional array of query parameters for parameterized queries
 * @returns {Promise<Object>} Query result
 * @throws {Error} If query execution fails
 */
export const executeQuery = async (sqlQuery, args = []) => {
  // Strict MCP mode check to prevent any possible logging
  const inMcpMode = process.env.MCP_MODE === "true";

  try {
    // Only log if not in MCP mode - double check to be absolutely sure
    if (!inMcpMode) {
      // Log the query for debugging
      logMessage("debug", "DB - EXECUTING QUERY", {
        sql: sqlQuery.substring(0, 150) + (sqlQuery.length > 150 ? "..." : ""),
        args:
          args.length > 0
            ? JSON.stringify(args.slice(0, 3)) + (args.length > 3 ? "..." : "")
            : "[]",
      });
    }

    // Maximum number of retry attempts
    const maxRetries = 3;
    let retryCount = 0;
    let result;

    while (retryCount < maxRetries) {
      try {
        const client = getDbClient();
        result = await client.execute({
          sql: sqlQuery,
          args: args,
        });
        break; // If query succeeds, exit the retry loop
      } catch (queryError) {
        retryCount++;

        // Check if this is a connection error that can be retried
        const isConnectionError =
          queryError.message?.includes("connection") ||
          queryError.message?.includes("timeout") ||
          queryError.message?.includes("closed");

        // If we've reached max retries or it's not a connection error, rethrow
        if (retryCount >= maxRetries || !isConnectionError) {
          throw queryError;
        }

        // Wait before retrying (exponential backoff)
        const waitTime = Math.pow(2, retryCount) * 100;
        await new Promise((resolve) => setTimeout(resolve, waitTime));

        // Reset client for retry
        dbClient = null;
      }
    }

    // Only log if not in MCP mode - double check to be absolutely sure
    if (!inMcpMode) {
      // Log the result for debugging
      logMessage("debug", "DB - QUERY RESULT", {
        rowCount: result.rows?.length || 0,
        rowsPreview:
          result.rows?.length > 0
            ? JSON.stringify(result.rows[0]).substring(0, 100) + "..."
            : "No rows",
        affectedRows: result.rowsAffected || 0,
      });
    }

    return result;
  } catch (error) {
    // Only log if not in MCP mode - double check to be absolutely sure
    if (!inMcpMode) {
      logMessage("error", "DB - QUERY ERROR", {
        message: error.message,
        query: sqlQuery.substring(0, 150),
        args: args.length > 0 ? JSON.stringify(args.slice(0, 3)) : "[]",
      });
    }

    // In MCP mode, throw a plain error without any message to prevent logging
    if (inMcpMode) {
      throw new Error();
    } else {
      throw new Error(
        `Query execution failed: ${error.message}\nQuery: ${sqlQuery}`
      );
    }
  }
};

/**
 * Migrate the project_patterns table to add the language column if it doesn't exist
 * @returns {Promise<void>}
 */
async function migrateProjectPatternsTable() {
  // Silent operation in MCP mode - triple check to be safe
  const inMcpMode = process.env.MCP_MODE === "true";

  try {
    // First check if the table exists - use a more robust approach with error handling
    let tableExists = false;
    try {
      const tableExistsQuery = await executeQuery(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='project_patterns'
      `);

      tableExists =
        tableExistsQuery &&
        tableExistsQuery.rows &&
        tableExistsQuery.rows.length > 0;
    } catch (tableCheckError) {
      // If error checking table existence, assume table doesn't exist
      if (!inMcpMode) {
        logMessage(
          "warn",
          `Error checking table existence: ${tableCheckError.message}`
        );
      }
      return; // Exit early, nothing to migrate
    }

    // If table doesn't exist, nothing to migrate
    if (!tableExists) {
      if (!inMcpMode) {
        logMessage(
          "info",
          "project_patterns table doesn't exist yet, skipping migration"
        );
      }
      return;
    }

    // Check if the language column exists directly with a query
    // This avoids relying on the columnExists function that might get minified
    let hasLanguageColumn = false;
    try {
      const columnCheckQuery = await executeQuery(`
        PRAGMA table_info(project_patterns)
      `);

      if (columnCheckQuery && columnCheckQuery.rows) {
        // Check each row for the language column
        for (const row of columnCheckQuery.rows) {
          if (row && row.name === "language") {
            hasLanguageColumn = true;
            break;
          }
        }
      }
    } catch (columnCheckError) {
      // If error checking column existence, be safe and skip migration
      if (!inMcpMode) {
        logMessage(
          "warn",
          `Error checking column existence: ${columnCheckError.message}`
        );
      }
      return; // Exit early, skip migration on error
    }

    // If language column already exists, nothing to do
    if (hasLanguageColumn) {
      if (!inMcpMode) {
        logMessage(
          "debug",
          "Language column already exists in project_patterns table"
        );
      }
      return;
    }

    // Only reach here if table exists and column doesn't exist
    if (!inMcpMode) {
      logMessage("info", "Adding language column to project_patterns table");
    }

    try {
      // Add the language column to the table - wrap in try/catch
      await executeQuery(
        "ALTER TABLE project_patterns ADD COLUMN language TEXT"
      );

      if (!inMcpMode) {
        logMessage(
          "info",
          "Successfully added language column to project_patterns table"
        );
      }
    } catch (alterError) {
      // Handle column already exists error - SQLite specific
      if (
        alterError.message &&
        alterError.message.includes("duplicate column")
      ) {
        if (!inMcpMode) {
          logMessage("info", "Language column already exists, skipping");
        }
      } else {
        // For other errors in non-MCP mode, log warning but don't fail
        if (!inMcpMode) {
          logMessage(
            "warn",
            `Error adding language column: ${alterError.message}`
          );
        }
        return; // Skip index creation on error
      }
    }

    // Create index for the language column if needed - with separate error handling
    try {
      await executeQuery(
        "CREATE INDEX IF NOT EXISTS idx_project_patterns_language ON project_patterns(language)"
      );
      if (!inMcpMode) {
        logMessage("info", "Created index for language column");
      }
    } catch (indexError) {
      // Log index creation error but don't fail - not critical
      if (!inMcpMode) {
        logMessage("warn", `Error creating index: ${indexError.message}`);
      }
    }
  } catch (error) {
    // In MCP mode, don't throw or log errors - just silently fail
    if (!inMcpMode) {
      // Log error but don't throw - make migration non-fatal
      logMessage("warn", `Migration warning: ${error.message}`);
    }
  }
}

/**
 * Initialize the database schema by creating all required tables and indexes
 * This function executes all CREATE TABLE, CREATE INDEX and CREATE TRIGGER statements
 * defined in the project blueprint
 * @returns {Promise<boolean>} True if schema initialization was successful
 */
export const initializeDatabaseSchema = async () => {
  // Check if we're in MCP mode - triple check to prevent any logging
  const inMcpMode = process.env.MCP_MODE === "true";

  try {
    const client = getDbClient();
    let success = true;

    // First, check if we need to migrate the project_patterns table by adding the language column
    // Wrap in try/catch and continue regardless of migration outcome
    try {
      await migrateProjectPatternsTable();
    } catch (migrationError) {
      // Completely ignore migration errors in MCP mode
      if (!inMcpMode) {
        logMessage("warn", `Migration warning: ${migrationError.message}`);
      }
      // Continue with schema initialization, migration error is not fatal
    }

    // Array of SQL statements to execute sequentially
    const schemaStatements = [
      // ========= CODE ENTITIES =========
      `CREATE TABLE IF NOT EXISTS code_entities (
        entity_id TEXT PRIMARY KEY, -- UUID
        file_path TEXT, -- Full path for file entities, or path to file containing the entity
        entity_type TEXT NOT NULL, -- e.g., 'file', 'function', 'class', 'method', 'variable', 'interface', 'comment_block'
        name TEXT, -- Name of the function, class, variable etc.
        start_line INTEGER,
        end_line INTEGER,
        content_hash TEXT, -- Hash of the raw content to detect changes
        raw_content TEXT,
        summary TEXT, -- AI or rule-based summary
        language TEXT, -- Programming language
        parent_entity_id TEXT, -- For hierarchical structure (e.g., function inside a class, class inside a file)
        last_modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- For recency
        importance_score REAL DEFAULT 1.0, -- For prioritization, can decay
        custom_metadata TEXT, -- JSON blob for other properties
        FOREIGN KEY (parent_entity_id) REFERENCES code_entities(entity_id) ON DELETE CASCADE
      )`,

      // Indexes for code_entities
      `CREATE INDEX IF NOT EXISTS idx_code_entities_file_path ON code_entities(file_path)`,
      `CREATE INDEX IF NOT EXISTS idx_code_entities_type ON code_entities(entity_type)`,
      `CREATE INDEX IF NOT EXISTS idx_code_entities_name ON code_entities(name)`,
      `CREATE INDEX IF NOT EXISTS idx_code_entities_last_accessed ON code_entities(last_accessed_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_code_entities_importance ON code_entities(importance_score DESC)`,

      // ========= ENTITY KEYWORDS =========
      `CREATE TABLE IF NOT EXISTS entity_keywords (
        keyword_id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_id TEXT NOT NULL,
        keyword TEXT NOT NULL,
        term_frequency REAL,
        weight REAL DEFAULT 1.0,
        keyword_type TEXT, -- e.g., 'identifier', 'comment', 'string_literal', 'n_gram_2', 'n_gram_3'
        FOREIGN KEY (entity_id) REFERENCES code_entities(entity_id) ON DELETE CASCADE
      )`,

      // Indexes for entity_keywords
      `CREATE INDEX IF NOT EXISTS idx_entity_keywords_keyword ON entity_keywords(keyword)`,
      `CREATE INDEX IF NOT EXISTS idx_entity_keywords_entity ON entity_keywords(entity_id)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_keywords_entity_keyword_type ON entity_keywords(entity_id, keyword, keyword_type)`,

      // ========= FULL-TEXT SEARCH =========
      `CREATE VIRTUAL TABLE IF NOT EXISTS code_entities_fts USING fts5(
        entity_id UNINDEXED,
        name,
        searchable_content
      )`,

      // Triggers to keep FTS table in sync with code_entities
      `CREATE TRIGGER IF NOT EXISTS code_entities_ai AFTER INSERT ON code_entities BEGIN
        INSERT INTO code_entities_fts (entity_id, name, searchable_content)
        VALUES (new.entity_id, new.name, new.raw_content || ' ' || COALESCE(new.summary, ''));
      END`,

      `CREATE TRIGGER IF NOT EXISTS code_entities_ad AFTER DELETE ON code_entities BEGIN
        DELETE FROM code_entities_fts WHERE entity_id = old.entity_id;
      END`,

      `CREATE TRIGGER IF NOT EXISTS code_entities_au AFTER UPDATE ON code_entities BEGIN
        UPDATE code_entities_fts SET
          name = new.name,
          searchable_content = new.raw_content || ' ' || COALESCE(new.summary, '')
        WHERE entity_id = old.entity_id;
      END`,

      // ========= CODE RELATIONSHIPS =========
      `CREATE TABLE IF NOT EXISTS code_relationships (
        relationship_id TEXT PRIMARY KEY, -- UUID
        source_entity_id TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        metadata TEXT, -- JSON blob
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (source_entity_id) REFERENCES code_entities(entity_id) ON DELETE CASCADE,
        FOREIGN KEY (target_entity_id) REFERENCES code_entities(entity_id) ON DELETE CASCADE
      )`,

      // Indexes for code_relationships
      `CREATE INDEX IF NOT EXISTS idx_code_relationships_source ON code_relationships(source_entity_id, relationship_type)`,
      `CREATE INDEX IF NOT EXISTS idx_code_relationships_target ON code_relationships(target_entity_id, relationship_type)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_code_relationships_unique ON code_relationships(source_entity_id, target_entity_id, relationship_type)`,

      // ========= CONVERSATION HISTORY =========
      `CREATE TABLE IF NOT EXISTS conversation_history (
        message_id TEXT PRIMARY KEY, -- UUID
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL, -- 'user', 'assistant', 'system'
        content TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        related_context_entity_ids TEXT, -- JSON array of entity_ids
        summary TEXT,
        user_intent TEXT,
        topic_segment_id TEXT,        -- Reference to topic segment
        semantic_markers TEXT,        -- JSON array of semantic markers found in message
        sentiment_indicators TEXT      -- JSON structure for sentiment analysis
      )`,

      // Indexes for conversation_history
      `CREATE INDEX IF NOT EXISTS idx_conversation_history_conversation_ts ON conversation_history(conversation_id, timestamp DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_conversation_history_topic ON conversation_history(topic_segment_id)`,

      // ========= CONVERSATION TOPICS =========
      `CREATE TABLE IF NOT EXISTS conversation_topics (
        topic_id TEXT PRIMARY KEY, -- UUID
        conversation_id TEXT NOT NULL,
        topic_name TEXT NOT NULL,
        description TEXT,
        start_message_id TEXT NOT NULL,
        end_message_id TEXT,    -- NULL if ongoing
        start_timestamp TIMESTAMP NOT NULL,
        end_timestamp TIMESTAMP,  -- NULL if ongoing
        primary_entities TEXT,    -- JSON array of entity_ids
        keywords TEXT,            -- JSON array of keywords
        summary TEXT,
        parent_topic_id TEXT,     -- For hierarchical topic structure
        FOREIGN KEY (start_message_id) REFERENCES conversation_history(message_id) ON DELETE CASCADE,
        FOREIGN KEY (parent_topic_id) REFERENCES conversation_topics(topic_id) ON DELETE SET NULL
      )`,

      // Indexes for conversation_topics
      `CREATE INDEX IF NOT EXISTS idx_conversation_topics_conversation ON conversation_topics(conversation_id)`,
      `CREATE INDEX IF NOT EXISTS idx_conversation_topics_timestamps ON conversation_topics(start_timestamp, end_timestamp)`,

      // ========= CONVERSATION PURPOSES =========
      `CREATE TABLE IF NOT EXISTS conversation_purposes (
        purpose_id TEXT PRIMARY KEY, -- UUID
        conversation_id TEXT NOT NULL,
        purpose_type TEXT NOT NULL,  -- 'debugging', 'feature_planning', 'code_review', etc.
        confidence REAL DEFAULT 0.0, -- Confidence score (0.0 to 1.0)
        start_timestamp TEXT NOT NULL, -- ISO timestamp
        end_timestamp TEXT, -- ISO timestamp, NULL if still active
        metadata TEXT -- Additional metadata in JSON format
      )`,

      // Indexes for conversation_purposes
      `CREATE INDEX IF NOT EXISTS idx_conversation_purposes_conversation ON conversation_purposes(conversation_id)`,
      `CREATE INDEX IF NOT EXISTS idx_conversation_purposes_type ON conversation_purposes(purpose_type, confidence DESC)`,

      // ========= TIMELINE EVENTS =========
      `CREATE TABLE IF NOT EXISTS timeline_events (
        event_id TEXT PRIMARY KEY, -- UUID
        event_type TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        data TEXT, -- JSON blob
        associated_entity_ids TEXT, -- JSON array of code_entity_ids
        conversation_id TEXT -- If related to a specific conversation
      )`,

      // Indexes for timeline_events
      `CREATE INDEX IF NOT EXISTS idx_timeline_events_ts ON timeline_events(timestamp DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_timeline_events_type ON timeline_events(event_type)`,

      // ========= CONTEXT SNAPSHOTS =========
      `CREATE TABLE IF NOT EXISTS context_snapshots (
        snapshot_id TEXT PRIMARY KEY, -- UUID
        name TEXT,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        timeline_event_id TEXT,
        snapshot_data TEXT NOT NULL, -- JSON blob
        FOREIGN KEY (timeline_event_id) REFERENCES timeline_events(event_id) ON DELETE SET NULL
      )`,

      // Indexes for context_snapshots
      `CREATE INDEX IF NOT EXISTS idx_context_snapshots_name ON context_snapshots(name)`,

      // ========= FOCUS AREAS =========
      `CREATE TABLE IF NOT EXISTS focus_areas (
        focus_id TEXT PRIMARY KEY, -- UUID
        focus_type TEXT NOT NULL,
        identifier TEXT,
        description TEXT,
        related_entity_ids TEXT, -- JSON array of code_entity_ids
        keywords TEXT, -- JSON array of defining keywords
        last_activated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT FALSE
      )`,

      // Indexes for focus_areas
      `CREATE INDEX IF NOT EXISTS idx_focus_areas_active ON focus_areas(is_active, last_activated_at DESC)`,

      // ========= PROJECT PATTERNS =========
      `CREATE TABLE IF NOT EXISTS project_patterns (
        pattern_id TEXT PRIMARY KEY, -- UUID
        pattern_type TEXT NOT NULL,
        name TEXT,
        description TEXT,
        representation TEXT NOT NULL, -- JSON or textual
        detection_rules TEXT,
        frequency INTEGER DEFAULT 0,
        last_detected_at TIMESTAMP,
        utility_score REAL DEFAULT 0.0,
        confidence_score REAL DEFAULT 0.5, -- confidence in pattern validity
        reinforcement_count INTEGER DEFAULT 1, -- times pattern was reinforced
        is_global BOOLEAN DEFAULT FALSE, -- indicates if promoted to global status
        session_origin_id TEXT, -- originating session if any
        language TEXT, -- NEW COLUMN: programming language the pattern applies to
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,

      // Indexes for project_patterns
      `CREATE INDEX IF NOT EXISTS idx_project_patterns_type ON project_patterns(pattern_type)`,
      `CREATE INDEX IF NOT EXISTS idx_project_patterns_global ON project_patterns(is_global, confidence_score DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_project_patterns_utility ON project_patterns(utility_score DESC)`,

      // ========= PATTERN OBSERVATIONS =========
      `CREATE TABLE IF NOT EXISTS pattern_observations (
        observation_id TEXT PRIMARY KEY, -- UUID
        pattern_id TEXT NOT NULL,
        conversation_id TEXT,
        context_entities TEXT, -- JSON array of entity_ids
        observation_type TEXT NOT NULL, -- 'usage', 'confirmation', 'rejection'
        observation_data TEXT, -- JSON with details
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (pattern_id) REFERENCES project_patterns(pattern_id) ON DELETE CASCADE
      )`,

      // Indexes for pattern_observations
      `CREATE INDEX IF NOT EXISTS idx_pattern_observations_pattern ON pattern_observations(pattern_id)`,
      `CREATE INDEX IF NOT EXISTS idx_pattern_observations_type_ts ON pattern_observations(observation_type, timestamp DESC)`,

      // ========= SYSTEM LOGS =========
      `CREATE TABLE IF NOT EXISTS system_logs (
        log_id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        level TEXT NOT NULL, -- 'INFO', 'WARN', 'ERROR', 'DEBUG'
        message TEXT NOT NULL,
        data TEXT -- Optional JSON blob
      )`,

      // Indexes for system_logs
      `CREATE INDEX IF NOT EXISTS idx_system_logs_timestamp_level ON system_logs(timestamp DESC, level)`,

      // Make sure knowledge_items table exists
      `CREATE TABLE IF NOT EXISTS knowledge_items (
        item_id TEXT PRIMARY KEY, -- UUID
        item_type TEXT NOT NULL, -- Type of knowledge item (concept, code_pattern, domain_term, etc.)
        name TEXT NOT NULL, -- Display name of the knowledge item
        content TEXT, -- JSON or raw content depending on type
        metadata TEXT, -- Additional metadata as JSON
        confidence_score REAL DEFAULT 0.5, -- Confidence score
        created_at TEXT NOT NULL, -- Creation timestamp
        updated_at TEXT NOT NULL, -- Last update timestamp
        conversation_id TEXT -- Source conversation ID
      )`,

      // Indexes for knowledge_items
      `CREATE INDEX IF NOT EXISTS idx_knowledge_items_type ON knowledge_items(item_type)`,
      `CREATE INDEX IF NOT EXISTS idx_knowledge_items_conversation ON knowledge_items(conversation_id)`,
      `CREATE INDEX IF NOT EXISTS idx_knowledge_items_confidence ON knowledge_items(confidence_score DESC)`,

      // Make sure context_states table exists
      `CREATE TABLE IF NOT EXISTS context_states (
        state_id TEXT PRIMARY KEY, -- UUID
        milestone_id TEXT,
        conversation_id TEXT,
        topic_id TEXT,
        state_type TEXT NOT NULL, -- Type of context state
        state_data TEXT, -- JSON data representing the state
        created_at TEXT NOT NULL, -- Creation timestamp
        metadata TEXT -- Additional metadata as JSON
      )`,

      // Indexes for context_states
      `CREATE INDEX IF NOT EXISTS idx_context_states_milestone ON context_states(milestone_id)`,
      `CREATE INDEX IF NOT EXISTS idx_context_states_conversation ON context_states(conversation_id)`,
    ];

    // Execute each statement in sequence
    for (const statement of schemaStatements) {
      try {
        await client.execute(statement);
      } catch (error) {
        // Only log error in non-MCP mode
        if (!inMcpMode) {
          logMessage(
            "error",
            `Error executing schema statement: ${error.message}`
          );
          logMessage(
            "error",
            `Failed statement: ${statement.substring(0, 100)}...`
          );
        }
        success = false;
      }
    }

    return success;
  } catch (error) {
    if (inMcpMode) {
      // In MCP mode, return false silently instead of throwing
      return false;
    }
    throw new Error(`Database schema initialization failed: ${error.message}`);
  }
};

export default {
  getDbClient,
  testDbConnection,
  executeQuery,
  initializeDatabaseSchema,
};
