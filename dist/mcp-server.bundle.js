#!/usr/bin/env node
"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};

// src/config.js
import dotenv from "dotenv";
var TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, LOG_LEVEL, DB_LOGGING_ENABLED, DEFAULT_TOKEN_BUDGET, CONTEXT_DECAY_RATE, MAX_CACHE_SIZE;
var init_config = __esm({
  "src/config.js"() {
    dotenv.config();
    TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
    TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;
    LOG_LEVEL = process.env.LOG_LEVEL || "INFO";
    DB_LOGGING_ENABLED = process.env.DB_LOGGING_ENABLED === "true";
    DEFAULT_TOKEN_BUDGET = parseInt(
      process.env.DEFAULT_TOKEN_BUDGET || "4000",
      10
    );
    CONTEXT_DECAY_RATE = parseFloat(
      process.env.CONTEXT_DECAY_RATE || "0.95"
    );
    MAX_CACHE_SIZE = parseInt(
      process.env.MAX_CACHE_SIZE || "1000",
      10
    );
  }
});

// src/utils/logger.js
var LOG_LEVELS, logMessage;
var init_logger = __esm({
  "src/utils/logger.js"() {
    init_config();
    LOG_LEVELS = {
      DEBUG: 0,
      INFO: 1,
      WARN: 2,
      ERROR: 3
    };
    logMessage = (level, message, data = null) => {
      const upperLevel = level.toUpperCase();
      if (!LOG_LEVELS.hasOwnProperty(upperLevel) || LOG_LEVELS[upperLevel] < LOG_LEVELS[LOG_LEVEL]) {
        return;
      }
      const timestamp = (/* @__PURE__ */ new Date()).toISOString();
      let logString = `[${timestamp}] [${upperLevel}]: ${message}`;
      if (data) {
        const dataString = typeof data === "string" ? data : JSON.stringify(data);
        logString += ` - ${dataString}`;
      }
      if (upperLevel === "DEBUG" || upperLevel === "INFO") {
        console.log(logString);
      } else {
        console.error(logString);
      }
    };
  }
});

// src/db.js
import { createClient } from "@libsql/client";
async function columnExists(tableName, columnName) {
  try {
    if (!tableName || !columnName) {
      logMessage("error", "Invalid table or column name provided");
      return false;
    }
    const client = getDbClient();
    const result = await client.execute({
      sql: `PRAGMA table_info(${tableName})`
    });
    if (!result || !result.rows || result.rows.length === 0) {
      logMessage("warn", `No table info found for ${tableName}`);
      return false;
    }
    for (const row of result.rows) {
      if (row && row.name === columnName) {
        return true;
      }
    }
    logMessage("debug", `Column ${columnName} not found in ${tableName}`);
    return false;
  } catch (error) {
    logMessage("error", `Error checking if column exists: ${error.message}`);
    return false;
  }
}
async function migrateProjectPatternsTable() {
  try {
    const tableExistsQuery = await executeQuery(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='project_patterns'
    `);
    const tableExists = tableExistsQuery && tableExistsQuery.rows && tableExistsQuery.rows.length > 0;
    if (!tableExists) {
      logMessage(
        "info",
        "project_patterns table doesn't exist yet, skipping migration"
      );
      return;
    }
    const hasLanguageColumn = await columnExists(
      "project_patterns",
      "language"
    );
    if (!hasLanguageColumn) {
      logMessage("info", "Adding language column to project_patterns table");
      try {
        await executeQuery(
          "ALTER TABLE project_patterns ADD COLUMN language TEXT"
        );
        logMessage(
          "info",
          "Successfully added language column to project_patterns table"
        );
      } catch (alterError) {
        if (alterError.message.includes("duplicate column")) {
          logMessage("info", "Language column already exists, skipping");
        } else {
          throw alterError;
        }
      }
      try {
        await executeQuery(
          "CREATE INDEX IF NOT EXISTS idx_project_patterns_language ON project_patterns(language)"
        );
        logMessage("info", "Created index for language column");
      } catch (indexError) {
        logMessage("warn", `Error creating index: ${indexError.message}`);
      }
    } else {
      logMessage(
        "debug",
        "Language column already exists in project_patterns table"
      );
    }
  } catch (error) {
    throw new Error(`Migration failed: ${error.message}`);
  }
}
var dbClient, getDbClient, testDbConnection, executeQuery, initializeDatabaseSchema;
var init_db = __esm({
  "src/db.js"() {
    init_config();
    init_logger();
    dbClient = null;
    getDbClient = () => {
      if (dbClient) {
        return dbClient;
      }
      if (!TURSO_DATABASE_URL) {
        throw new Error(
          "TURSO_DATABASE_URL is not defined in environment variables"
        );
      }
      if (!TURSO_AUTH_TOKEN) {
        throw new Error("TURSO_AUTH_TOKEN is not defined in environment variables");
      }
      dbClient = createClient({
        url: TURSO_DATABASE_URL,
        authToken: TURSO_AUTH_TOKEN
      });
      return dbClient;
    };
    testDbConnection = async (client = null) => {
      try {
        const dbClient2 = client || getDbClient();
        await dbClient2.execute("SELECT 1");
        return true;
      } catch (error) {
        throw new Error(`Database connection test failed: ${error.message}`);
      }
    };
    executeQuery = async (sqlQuery, args = []) => {
      try {
        console.log("DB - EXECUTING QUERY:", {
          sql: sqlQuery.substring(0, 150) + (sqlQuery.length > 150 ? "..." : ""),
          args: args.length > 0 ? JSON.stringify(args.slice(0, 3)) + (args.length > 3 ? "..." : "") : "[]"
        });
        const client = getDbClient();
        const result = await client.execute({
          sql: sqlQuery,
          args
        });
        console.log("DB - QUERY RESULT:", {
          rowCount: result.rows?.length || 0,
          rowsPreview: result.rows?.length > 0 ? JSON.stringify(result.rows[0]).substring(0, 100) + "..." : "No rows",
          affectedRows: result.rowsAffected
        });
        return result;
      } catch (error) {
        console.error("DB - QUERY ERROR:", {
          message: error.message,
          query: sqlQuery.substring(0, 150),
          args: args.length > 0 ? JSON.stringify(args.slice(0, 3)) : "[]"
        });
        throw new Error(
          `Query execution failed: ${error.message}
Query: ${sqlQuery}`
        );
      }
    };
    initializeDatabaseSchema = async () => {
      try {
        const client = getDbClient();
        let success = true;
        try {
          await migrateProjectPatternsTable();
        } catch (migrationError) {
          logMessage("warn", `Migration warning: ${migrationError.message}`);
        }
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
        confidence REAL NOT NULL DEFAULT 0.0,
        start_timestamp TIMESTAMP NOT NULL,
        end_timestamp TIMESTAMP,     -- NULL if ongoing
        metadata TEXT                -- JSON with additional classification data
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
          `CREATE INDEX IF NOT EXISTS idx_system_logs_timestamp_level ON system_logs(timestamp DESC, level)`
        ];
        for (const statement of schemaStatements) {
          try {
            await client.execute(statement);
          } catch (error) {
            logMessage(
              "error",
              `Error executing schema statement: ${error.message}`
            );
            logMessage(
              "error",
              `Failed statement: ${statement.substring(0, 100)}...`
            );
            success = false;
          }
        }
        return success;
      } catch (error) {
        throw new Error(`Database schema initialization failed: ${error.message}`);
      }
    };
  }
});

// src/logic/RelationshipContextManagerLogic.js
import { v4 as uuidv4 } from "uuid";
async function addRelationship(sourceEntityId, targetEntityId, relationshipType, weight = 1, metadata = {}) {
  if (!sourceEntityId || !targetEntityId || !relationshipType) {
    throw new Error(
      "Source entity ID, target entity ID, and relationship type are required"
    );
  }
  const relationshipId = uuidv4();
  const metadataJson = JSON.stringify(metadata);
  try {
    const query = `
      INSERT INTO code_relationships (
        relationship_id, source_entity_id, target_entity_id, relationship_type, weight, metadata
      ) VALUES (?, ?, ?, ?, ?, ?)
    `;
    await executeQuery(query, [
      relationshipId,
      sourceEntityId,
      targetEntityId,
      relationshipType,
      weight,
      metadataJson
    ]);
  } catch (error) {
    if (error.message && error.message.includes("UNIQUE constraint failed")) {
      const updateQuery = `
        UPDATE code_relationships 
        SET weight = ?, metadata = ? 
        WHERE source_entity_id = ? AND target_entity_id = ? AND relationship_type = ?
      `;
      await executeQuery(updateQuery, [
        weight,
        metadataJson,
        sourceEntityId,
        targetEntityId,
        relationshipType
      ]);
    } else {
      console.error(
        `Error adding relationship between ${sourceEntityId} and ${targetEntityId}:`,
        error
      );
      throw error;
    }
  }
}
async function getRelationships(entityId, direction = "outgoing", types = []) {
  if (!entityId) {
    throw new Error("Entity ID is required");
  }
  if (!["outgoing", "incoming", "both"].includes(direction)) {
    throw new Error("Direction must be 'outgoing', 'incoming', or 'both'");
  }
  let query = `
    SELECT 
      relationship_id, 
      source_entity_id, 
      target_entity_id, 
      relationship_type, 
      weight, 
      metadata
    FROM code_relationships
    WHERE 
  `;
  const queryParams = [];
  if (direction === "outgoing") {
    query += "source_entity_id = ?";
    queryParams.push(entityId);
  } else if (direction === "incoming") {
    query += "target_entity_id = ?";
    queryParams.push(entityId);
  } else {
    query += "(source_entity_id = ? OR target_entity_id = ?)";
    queryParams.push(entityId, entityId);
  }
  if (types.length > 0) {
    const typePlaceholders = types.map(() => "?").join(", ");
    query += ` AND relationship_type IN (${typePlaceholders})`;
    queryParams.push(...types);
  }
  try {
    const relationships = await executeQuery(query, queryParams);
    return relationships.map((relationship) => ({
      ...relationship,
      // Parse metadata JSON string to object, default to empty object if null or invalid
      metadata: relationship.metadata ? JSON.parse(relationship.metadata) : {}
    }));
  } catch (error) {
    console.error(`Error getting relationships for entity ${entityId}:`, error);
    throw error;
  }
}
var init_RelationshipContextManagerLogic = __esm({
  "src/logic/RelationshipContextManagerLogic.js"() {
    init_db();
  }
});

// src/main.js
init_config();
init_db();
init_logger();
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// src/tools/initializeConversationContext.tool.js
init_db();
import { z as z2 } from "zod";
import { v4 as uuidv49 } from "uuid";

// src/logic/ConversationIntelligence.js
init_db();
import { v4 as uuidv45 } from "uuid";

// src/logic/TextTokenizerLogic.js
function tokenize(text, language = "plaintext") {
  const normalizedText = text.toLowerCase();
  switch (language) {
    case "javascript":
    case "typescript":
    case "jsx":
    case "tsx":
      return tokenizeJavaScript(normalizedText);
    case "python":
      return tokenizePython(normalizedText);
    case "java":
    case "csharp":
    case "c#":
      return tokenizeJavaLike(normalizedText);
    case "ruby":
      return tokenizeRuby(normalizedText);
    case "go":
      return tokenizeGo(normalizedText);
    case "plaintext":
    default:
      return tokenizeGeneric(normalizedText);
  }
}
function generateNgrams(tokens, n) {
  if (!tokens || tokens.length === 0)
    return [];
  if (n <= 0)
    return [];
  if (tokens.length < n)
    return [tokens.join(" ")];
  const ngrams = [];
  const semanticBoundaries = /* @__PURE__ */ new Set();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith("__") && token.endsWith("__")) {
      semanticBoundaries.add(i);
      semanticBoundaries.add(i + 1);
    }
    if ([";", ".", "{", "}", "(", ")", "[", "]"].includes(token)) {
      semanticBoundaries.add(i);
      semanticBoundaries.add(i + 1);
    }
  }
  for (let i = 0; i <= tokens.length - n; i++) {
    let hasBoundary = false;
    for (let j = i; j < i + n - 1; j++) {
      if (semanticBoundaries.has(j + 1)) {
        hasBoundary = true;
        break;
      }
    }
    if (!hasBoundary) {
      const ngram = tokens.slice(i, i + n).join(" ");
      ngrams.push(ngram);
    }
  }
  return ngrams;
}
function extractNGrams(tokens, n) {
  return generateNgrams(tokens, n);
}
function identifyLanguageSpecificIdioms(text, language) {
  if (!text)
    return [];
  const idioms = [];
  const normalizedLanguage = language.toLowerCase();
  switch (normalizedLanguage) {
    case "javascript":
    case "typescript":
    case "jsx":
    case "tsx":
      identifyJavaScriptIdioms(text, idioms);
      break;
    case "python":
      identifyPythonIdioms(text, idioms);
      break;
    case "csharp":
    case "c#":
      identifyCSharpIdioms(text, idioms);
      break;
  }
  return idioms;
}
function identifyJavaScriptIdioms(text, idioms) {
  const promiseChainRegex = /\.\s*then\s*\(\s*(?:function\s*\([^)]*\)|[^=>(]*=>\s*[^)]*)\s*\)(?:\s*\.(?:then|catch|finally)\s*\([^)]*\))+/g;
  let match;
  while ((match = promiseChainRegex.exec(text)) !== null) {
    idioms.push({
      idiom: match[0],
      type: "js_promise_chain",
      location: {
        start: match.index,
        end: match.index + match[0].length
      }
    });
  }
  const asyncAwaitRegex = /\basync\s+(?:function\s*[a-zA-Z0-9_$]*\s*\([^)]*\)|(?:[a-zA-Z0-9_$]+\s*=>)|(?:\([^)]*\)\s*=>))(?:(?:.|\n)*?\bawait\b(?:.|\n)*?)/g;
  while ((match = asyncAwaitRegex.exec(text)) !== null) {
    idioms.push({
      idiom: match[0],
      type: "js_async_await",
      location: {
        start: match.index,
        end: match.index + match[0].length
      }
    });
  }
  const arrowCallbackRegex = /(?:\.|\()(?:[a-zA-Z0-9_$]+)?\s*\(\s*(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>\s*(?:{[^}]*}|[^);,]*)/g;
  while ((match = arrowCallbackRegex.exec(text)) !== null) {
    const isDuplicate = idioms.some(
      (idiom) => idiom.type === "js_promise_chain" && match.index >= idiom.location.start && match.index + match[0].length <= idiom.location.end
    );
    if (!isDuplicate) {
      idioms.push({
        idiom: match[0],
        type: "js_arrow_callback",
        location: {
          start: match.index,
          end: match.index + match[0].length
        }
      });
    }
  }
}
function identifyPythonIdioms(text, idioms) {
  const listComprehensionRegex = /\[\s*[^\[\]]*\s+for\s+[^\[\]]+\s+in\s+[^\[\]]+(?:\s+if\s+[^\[\]]+)?\s*\]/g;
  let match;
  while ((match = listComprehensionRegex.exec(text)) !== null) {
    idioms.push({
      idiom: match[0],
      type: "python_list_comprehension",
      location: {
        start: match.index,
        end: match.index + match[0].length
      }
    });
  }
  const dictComprehensionRegex = /\{\s*[^{}]*\s*:\s*[^{}]*\s+for\s+[^{}]+\s+in\s+[^{}]+(?:\s+if\s+[^{}]+)?\s*\}/g;
  while ((match = dictComprehensionRegex.exec(text)) !== null) {
    idioms.push({
      idiom: match[0],
      type: "python_dict_comprehension",
      location: {
        start: match.index,
        end: match.index + match[0].length
      }
    });
  }
  const lambdaRegex = /lambda\s+[^:]+:[^,\n)]+/g;
  while ((match = lambdaRegex.exec(text)) !== null) {
    idioms.push({
      idiom: match[0],
      type: "python_lambda",
      location: {
        start: match.index,
        end: match.index + match[0].length
      }
    });
  }
  const generatorRegex = /\(\s*[^()]*\s+for\s+[^()]+\s+in\s+[^()]+(?:\s+if\s+[^()]+)?\s*\)/g;
  while ((match = generatorRegex.exec(text)) !== null) {
    idioms.push({
      idiom: match[0],
      type: "python_generator_expression",
      location: {
        start: match.index,
        end: match.index + match[0].length
      }
    });
  }
}
function identifyCSharpIdioms(text, idioms) {
  const linqMethodRegex = /\.\s*(?:Where|Select|OrderBy|OrderByDescending|GroupBy|Join|Skip|Take|First|FirstOrDefault|Any|All|Count)\s*\(\s*[^)]*\)(?:\s*\.\s*(?:Where|Select|OrderBy|OrderByDescending|GroupBy|Join|Skip|Take|First|FirstOrDefault|Any|All|Count)\s*\(\s*[^)]*\))*/g;
  let match;
  while ((match = linqMethodRegex.exec(text)) !== null) {
    idioms.push({
      idiom: match[0],
      type: "csharp_linq_method",
      location: {
        start: match.index,
        end: match.index + match[0].length
      }
    });
  }
  const linqQueryRegex = /from\s+\w+\s+in\s+[^{]+(?:where\s+[^{]+)?(?:orderby\s+[^{]+)?(?:select\s+[^{;]+)?(?:group\s+[^{;]+by\s+[^{;]+)?/g;
  while ((match = linqQueryRegex.exec(text)) !== null) {
    idioms.push({
      idiom: match[0],
      type: "csharp_linq_query",
      location: {
        start: match.index,
        end: match.index + match[0].length
      }
    });
  }
  const asyncAwaitRegex = /\basync\s+[^(]*\([^)]*\)(?:\s*<[^>]*>)?\s*(?:=>)?\s*{(?:(?:.|\n)*?\bawait\b(?:.|\n)*?)}/g;
  while ((match = asyncAwaitRegex.exec(text)) !== null) {
    idioms.push({
      idiom: match[0],
      type: "csharp_async_await",
      location: {
        start: match.index,
        end: match.index + match[0].length
      }
    });
  }
  const lambdaRegex = /(?:\([^)]*\)|\w+)\s*=>\s*(?:{[^}]*}|[^;]+)/g;
  while ((match = lambdaRegex.exec(text)) !== null) {
    const isDuplicate = idioms.some(
      (idiom) => (idiom.type === "csharp_linq_method" || idiom.type === "csharp_linq_query") && match.index >= idiom.location.start && match.index + match[0].length <= idiom.location.end
    );
    if (!isDuplicate) {
      idioms.push({
        idiom: match[0],
        type: "csharp_lambda",
        location: {
          start: match.index,
          end: match.index + match[0].length
        }
      });
    }
  }
}
function extractKeywords(tokens, topN = 10, language = "plaintext") {
  const stopWords = getStopWords(language);
  const termFrequencies = {};
  for (const token of tokens) {
    if (!termFrequencies[token]) {
      termFrequencies[token] = 0;
    }
    termFrequencies[token]++;
  }
  const scoredKeywords = [];
  for (const [token, frequency] of Object.entries(termFrequencies)) {
    if (stopWords.has(token) && token.length < 6 && !/[_\-$#@]/.test(token)) {
      continue;
    }
    let score = frequency;
    if (isDomainSpecificToken(token, language)) {
      score *= 2;
    }
    if (token.length > 6) {
      score *= 1.5;
    }
    if (/[_$]/.test(token)) {
      score *= 1.2;
    }
    if (token.length < 3 && !/[_\-$#@]/.test(token)) {
      score *= 0.5;
    }
    score = applyLanguageSpecificBoosts(token, score, language);
    scoredKeywords.push({
      keyword: token,
      score
    });
  }
  return scoredKeywords.sort((a, b) => b.score - a.score).slice(0, topN);
}
function isDomainSpecificToken(token, language) {
  if (/[a-z][A-Z]/.test(token) || /^[A-Z][a-z]/.test(token)) {
    return true;
  }
  if (token.includes("_") && token.length > 4) {
    return true;
  }
  if (/^(on|handle|process|get|set|is|has|should|with)/i.test(token)) {
    return true;
  }
  if (/[a-z][0-9]/.test(token)) {
    return true;
  }
  if ((language === "javascript" || language === "typescript") && (/\$/.test(token) || // Angular, jQuery
  /^use[A-Z]/.test(token))) {
    return true;
  }
  if (language === "python" && (/^__.*__$/.test(token) || // dunder methods
  /^self\./.test(token))) {
    return true;
  }
  return false;
}
function applyLanguageSpecificBoosts(token, score, language) {
  switch (language) {
    case "javascript":
    case "typescript":
    case "jsx":
    case "tsx":
      if (/^(use|component|props|state|render|effect|memo|callback)/.test(token)) {
        score *= 1.5;
      }
      if (/^(on[A-Z]|handle[A-Z])/.test(token)) {
        score *= 1.3;
      }
      break;
    case "python":
      if (/^(def|class|self|super|__init__|__main__)/.test(token)) {
        score *= 1.3;
      }
      if (/^@/.test(token)) {
        score *= 1.4;
      }
      break;
    case "java":
    case "csharp":
    case "c#":
      if (/^(public|private|protected|static|final|override|virtual|abstract)/.test(
        token
      )) {
        score *= 1.2;
      }
      if (/^(class|interface|enum|record|struct)/.test(token)) {
        score *= 1.3;
      }
      break;
    case "ruby":
      if (/^(attr_|def|class|module|require|include|extend)/.test(token)) {
        score *= 1.3;
      }
      if (/^:/.test(token)) {
        score *= 1.2;
      }
      break;
    case "go":
      if (/^(func|struct|interface|type|go|chan|defer|goroutine)/.test(token)) {
        score *= 1.3;
      }
      break;
  }
  return score;
}
function getStopWords(language) {
  const commonStopWords = /* @__PURE__ */ new Set([
    "a",
    "an",
    "the",
    "and",
    "or",
    "but",
    "if",
    "then",
    "else",
    "when",
    "at",
    "from",
    "by",
    "for",
    "with",
    "about",
    "against",
    "between",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "to",
    "is",
    "am",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "having",
    "do",
    "does",
    "did",
    "doing",
    "would",
    "should",
    "could",
    "ought",
    "i",
    "you",
    "he",
    "she",
    "it",
    "we",
    "they",
    "their",
    "this",
    "that",
    "these",
    "those",
    "of",
    "in",
    "as",
    "on",
    "not",
    "no",
    "its",
    "his",
    "her"
  ]);
  const commonProgrammingStopWords = /* @__PURE__ */ new Set([
    "function",
    "class",
    "if",
    "else",
    "for",
    "while",
    "do",
    "switch",
    "case",
    "break",
    "continue",
    "return",
    "try",
    "catch",
    "finally",
    "throw",
    "throws",
    "public",
    "private",
    "protected",
    "static",
    "final",
    "abstract",
    "interface",
    "extends",
    "implements",
    "import",
    "export",
    "package",
    "namespace",
    "var",
    "let",
    "const",
    "new",
    "this",
    "super",
    "null",
    "undefined",
    "true",
    "false"
  ]);
  const stopWords = /* @__PURE__ */ new Set([
    ...commonStopWords,
    ...commonProgrammingStopWords
  ]);
  switch (language) {
    case "javascript":
    case "typescript":
    case "jsx":
    case "tsx":
      [
        "typeof",
        "instanceof",
        "async",
        "await",
        "yield",
        "void",
        "delete",
        "module",
        "require",
        "console",
        "log",
        "window",
        "document",
        "event",
        "prototype",
        "constructor",
        "string",
        "number",
        "boolean",
        "object",
        "array"
      ].forEach((word) => stopWords.add(word));
      break;
    case "python":
      [
        "def",
        "lambda",
        "from",
        "as",
        "import",
        "with",
        "is",
        "in",
        "not",
        "and",
        "or",
        "global",
        "nonlocal",
        "pass",
        "yield",
        "assert",
        "del",
        "raise",
        "except",
        "print",
        "exec",
        "eval",
        "None",
        "True",
        "False",
        "range",
        "len",
        "self"
      ].forEach((word) => stopWords.add(word));
      break;
    case "java":
      [
        "void",
        "boolean",
        "byte",
        "char",
        "short",
        "int",
        "long",
        "float",
        "double",
        "instanceof",
        "strictfp",
        "synchronized",
        "transient",
        "volatile",
        "native",
        "package",
        "throws",
        "throw",
        "exception",
        "assert",
        "enum"
      ].forEach((word) => stopWords.add(word));
      break;
    case "csharp":
    case "c#":
      [
        "using",
        "namespace",
        "where",
        "select",
        "from",
        "group",
        "into",
        "orderby",
        "join",
        "equals",
        "out",
        "ref",
        "in",
        "value",
        "is",
        "as",
        "void",
        "int",
        "string",
        "bool",
        "decimal",
        "object",
        "char",
        "byte",
        "sbyte",
        "uint",
        "long",
        "ulong",
        "short",
        "ushort",
        "double",
        "float",
        "dynamic",
        "delegate",
        "event",
        "async",
        "await",
        "partial",
        "virtual",
        "override",
        "sealed",
        "base"
      ].forEach((word) => stopWords.add(word));
      break;
    case "ruby":
      [
        "def",
        "end",
        "module",
        "require",
        "include",
        "extend",
        "attr",
        "attr_reader",
        "attr_writer",
        "attr_accessor",
        "lambda",
        "proc",
        "yield",
        "self",
        "nil",
        "true",
        "false",
        "unless",
        "until",
        "begin",
        "rescue",
        "ensure",
        "alias"
      ].forEach((word) => stopWords.add(word));
      break;
    case "go":
      [
        "func",
        "type",
        "struct",
        "interface",
        "map",
        "chan",
        "go",
        "select",
        "package",
        "import",
        "const",
        "var",
        "iota",
        "make",
        "new",
        "append",
        "len",
        "cap",
        "nil",
        "true",
        "false",
        "int",
        "int8",
        "int16",
        "int32",
        "int64",
        "uint",
        "uint8",
        "uint16",
        "uint32",
        "uint64",
        "float32",
        "float64",
        "string",
        "byte",
        "rune",
        "defer",
        "panic",
        "recover"
      ].forEach((word) => stopWords.add(word));
      break;
  }
  return stopWords;
}
function tokenizeGeneric(text) {
  const withSpaces = text.replace(/([a-z0-9])[-_]([a-z0-9])/g, "$1$2").replace(/[.,;:(){}[\]<>?!]/g, " $& ").replace(/\u0001/g, "_");
  let tokens = withSpaces.split(/\s+/).filter((token) => token.length > 0);
  return tokens;
}
function tokenizeJavaScript(text) {
  let tokens = [];
  const commentPlaceholders = {};
  let commentCounter = 0;
  const withoutBlockComments = text.replace(/\/\*[\s\S]*?\*\//g, (match) => {
    const placeholder = `__COMMENT_BLOCK_${commentCounter++}__`;
    commentPlaceholders[placeholder] = match;
    return placeholder;
  });
  const withoutComments = withoutBlockComments.replace(
    /\/\/[^\n]*/g,
    (match) => {
      const placeholder = `__COMMENT_LINE_${commentCounter++}__`;
      commentPlaceholders[placeholder] = match;
      return placeholder;
    }
  );
  const stringPlaceholders = {};
  let stringCounter = 0;
  const withoutRegex = withoutComments.replace(
    /(?<![a-zA-Z0-9_\)\]\}])\/(?:\\\/|[^\/\n])+\/[gimuy]*/g,
    (match) => {
      const placeholder = `__REGEX_${stringCounter++}__`;
      stringPlaceholders[placeholder] = match;
      return placeholder;
    }
  );
  const withoutTemplateLiterals = withoutRegex.replace(
    /`(?:\\`|\\\\|[^`])*`/g,
    (match) => {
      const placeholder = `__TEMPLATE_${stringCounter++}__`;
      stringPlaceholders[placeholder] = match;
      const expressions = [];
      let expContent = match.match(/\${([^}]*)}/g);
      if (expContent) {
        expContent.forEach((exp) => {
          expressions.push(exp.slice(2, -1));
        });
        expressions.forEach((exp) => {
          const expTokens = tokenizeJavaScript(exp);
          tokens.push(...expTokens);
        });
      }
      return placeholder;
    }
  );
  const withoutStrings = withoutTemplateLiterals.replace(
    /'(?:\\'|\\\\|[^'])*'|"(?:\\"|\\\\|[^"])*"/g,
    (match) => {
      const placeholder = `__STRING_${stringCounter++}__`;
      stringPlaceholders[placeholder] = match;
      return placeholder;
    }
  );
  const withoutJSX = withoutStrings.replace(
    /<([A-Z][a-zA-Z0-9]*|[a-z][a-z0-9]*)((?:\s+[a-zA-Z0-9_]+(?:=(?:"|'|\{).*?(?:"|'|\}))?)*)\s*(?:\/)?>/g,
    (match, tagName, attributes) => {
      const placeholder = `__JSX_TAG_${stringCounter++}__`;
      stringPlaceholders[placeholder] = match;
      tokens.push(tagName);
      if (attributes) {
        const attrMatches = attributes.match(/[a-zA-Z0-9_]+(?==)/g);
        if (attrMatches) {
          tokens.push(...attrMatches);
        }
      }
      return placeholder;
    }
  );
  const withoutJSXClosing = withoutJSX.replace(
    /<\/([A-Z][a-zA-Z0-9]*|[a-z][a-z0-9]*)>/g,
    (match, tagName) => {
      const placeholder = `__JSX_CLOSING_${stringCounter++}__`;
      stringPlaceholders[placeholder] = match;
      tokens.push(tagName);
      return placeholder;
    }
  );
  const withoutDecorators = withoutJSXClosing.replace(
    /@([a-zA-Z][a-zA-Z0-9_]*)(?:\((?:[^)(]*|\([^)(]*\))*\))?/g,
    (match, decoratorName) => {
      const placeholder = `__DECORATOR_${stringCounter++}__`;
      stringPlaceholders[placeholder] = match;
      tokens.push(decoratorName);
      const paramMatch = match.match(/\((.*)\)/);
      if (paramMatch && paramMatch[1]) {
        const paramTokens = tokenizeGeneric(paramMatch[1]);
        tokens.push(...paramTokens);
      }
      return placeholder;
    }
  );
  const withoutArrows = withoutDecorators.replace(/=>/g, (match) => {
    tokens.push("arrow_function");
    return " => ";
  });
  const withSpecialOps = withoutArrows.replace(/\?\./g, (match) => {
    tokens.push("optional_chaining");
    return " ?. ";
  }).replace(/\?\?/g, (match) => {
    tokens.push("nullish_coalescing");
    return " ?? ";
  });
  const withoutImports = withSpecialOps.replace(
    /import\s+(?:{[^}]*}|\*\s+as\s+[a-zA-Z][a-zA-Z0-9_]*|[a-zA-Z][a-zA-Z0-9_]*)\s+from\s+['"][^'"]*['"]/g,
    (match) => {
      tokens.push("import");
      const moduleMatch = match.match(/from\s+['"]([^'"]*)['"]/);
      if (moduleMatch && moduleMatch[1]) {
        tokens.push(moduleMatch[1]);
      }
      const importedMatch = match.match(
        /import\s+({[^}]*}|\*\s+as\s+[a-zA-Z][a-zA-Z0-9_]*|[a-zA-Z][a-zA-Z0-9_]*)/
      );
      if (importedMatch && importedMatch[1]) {
        const importSection = importedMatch[1];
        if (importSection.startsWith("{")) {
          const namedImports = importSection.replace(/[{}]/g, "").split(",").map((part) => part.trim()).filter((part) => part.length > 0);
          tokens.push(...namedImports);
        } else if (importSection.includes("* as")) {
          const nsMatch = importSection.match(
            /\*\s+as\s+([a-zA-Z][a-zA-Z0-9_]*)/
          );
          if (nsMatch && nsMatch[1]) {
            tokens.push(nsMatch[1]);
          }
        } else {
          tokens.push(importSection.trim());
        }
      }
      return " ";
    }
  );
  let mainTokens = tokenizeGeneric(withoutImports);
  const processedTokens = [];
  for (const token of mainTokens) {
    if (token.startsWith("__") && token.endsWith("__")) {
      processedTokens.push(token);
      continue;
    }
    if (["=>", "?.", "??"].includes(token)) {
      processedTokens.push(token);
      continue;
    }
    const camelTokens = token.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(" ");
    processedTokens.push(token);
    if (camelTokens.length > 1) {
      processedTokens.push(...camelTokens);
    }
  }
  const finalTokens = [];
  for (const token of processedTokens) {
    if (stringPlaceholders[token]) {
      if (token.startsWith("__REGEX_")) {
        finalTokens.push("regex_literal");
      } else if (token.startsWith("__JSX_")) {
        finalTokens.push("jsx_element");
      } else if (token.startsWith("__DECORATOR_")) {
        finalTokens.push("decorator");
      } else {
        finalTokens.push(token);
      }
      if (token.startsWith("__STRING_") || token.startsWith("__TEMPLATE_")) {
        const content = stringPlaceholders[token];
        const strContent = content.replace(/^[`'"](.*)[`'"]$/s, "$1");
        const contentTokens = tokenizeGeneric(strContent);
        finalTokens.push(...contentTokens);
      }
    } else if (commentPlaceholders[token]) {
      finalTokens.push("code_comment");
      const commentContent = commentPlaceholders[token].replace(/^\/\*|\*\/$/g, "").replace(/^\/\//g, "");
      const commentTokens = commentContent.split(/\s+/).filter((word) => /^[a-z0-9_]{3,}$/i.test(word)).map((word) => word.toLowerCase());
      finalTokens.push(...commentTokens);
    } else {
      finalTokens.push(token);
    }
  }
  return [...new Set(finalTokens)];
}
function tokenizePython(text) {
  let tokens = [];
  const commentPlaceholders = {};
  let commentCounter = 0;
  const withoutDocstrings = text.replace(
    /(?:'''[\s\S]*?'''|"""[\s\S]*?""")/g,
    (match) => {
      const placeholder = `__PYCOMMENT_BLOCK_${commentCounter++}__`;
      commentPlaceholders[placeholder] = match;
      return placeholder;
    }
  );
  const withoutComments = withoutDocstrings.replace(/#[^\n]*/g, (match) => {
    const placeholder = `__PYCOMMENT_LINE_${commentCounter++}__`;
    commentPlaceholders[placeholder] = match;
    return placeholder;
  });
  const stringPlaceholders = {};
  let placeholderCounter = 0;
  const withoutFStrings = withoutComments.replace(
    /(?:f|fr|rf)(?:'''[\s\S]*?'''|"""[\s\S]*?"""|'(?:\\'|\\\\|[^'])*'|"(?:\\"|\\\\|[^"])*")/g,
    (match) => {
      const placeholder = `__PYFSTRING_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;
      const expressions = [];
      let expContent = match.match(/(?<!\\){([^{}]*)}/g);
      if (expContent) {
        expContent.forEach((exp) => {
          expressions.push(exp.slice(1, -1));
        });
        expressions.forEach((exp) => {
          const expTokens = tokenizePython(exp);
          tokens.push(...expTokens);
        });
      }
      return placeholder;
    }
  );
  const withoutSpecialStrings = withoutFStrings.replace(
    /(?:r|b|rb|br)?(?:'''[\s\S]*?'''|"""[\s\S]*?"""|'(?:\\'|\\\\|[^'])*'|"(?:\\"|\\\\|[^"])*")/g,
    (match) => {
      const placeholder = `__PYSTRING_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;
      return placeholder;
    }
  );
  const withoutDecorators = withoutSpecialStrings.replace(
    /@([a-zA-Z][a-zA-Z0-9_.]*)(?:\((?:[^)(]*|\([^)(]*\))*\))?/g,
    (match, decoratorName) => {
      const placeholder = `__PYDECORATOR_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;
      tokens.push(decoratorName);
      const paramMatch = match.match(/\((.*)\)/);
      if (paramMatch && paramMatch[1]) {
        const paramTokens = tokenizeGeneric(paramMatch[1]);
        tokens.push(...paramTokens);
      }
      return placeholder;
    }
  );
  const withSpecialOps = withoutDecorators.replace(/:=/g, (match) => {
    tokens.push("walrus_operator");
    return " := ";
  }).replace(/\[.*:.*\]/g, (match) => {
    tokens.push("slice_operation");
    const innerContent = match.slice(1, -1);
    const sliceParts = innerContent.split(":");
    sliceParts.forEach((part) => {
      if (part.trim()) {
        const partTokens = tokenizeGeneric(part.trim());
        tokens.push(...partTokens);
      }
    });
    return match;
  });
  const lines = withSpecialOps.split("\n");
  let previousIndentLevel = 0;
  for (const line of lines) {
    if (line.trim() === "")
      continue;
    const indentMatch = line.match(/^(\s*)/);
    const leadingSpaces = indentMatch ? indentMatch[1].length : 0;
    if (leadingSpaces !== previousIndentLevel) {
      if (leadingSpaces > previousIndentLevel) {
        tokens.push("indent");
      } else {
        const dedentLevels = Math.floor(
          (previousIndentLevel - leadingSpaces) / 4
        );
        for (let i = 0; i < dedentLevels; i++) {
          tokens.push("dedent");
        }
      }
      previousIndentLevel = leadingSpaces;
    }
    const lineContent = line.trim();
    if (lineContent) {
      const pythonKeywords = [
        "def",
        "class",
        "lambda",
        "return",
        "yield",
        "from",
        "import",
        "as",
        "with",
        "try",
        "except",
        "finally",
        "raise",
        "assert",
        "if",
        "elif",
        "else",
        "while",
        "for",
        "in",
        "continue",
        "break",
        "pass",
        "global",
        "nonlocal",
        "del",
        "is",
        "not",
        "and",
        "or",
        "async",
        "await",
        "comprehension",
        "self"
      ];
      for (const keyword of pythonKeywords) {
        if (lineContent.includes(keyword)) {
          const keywordRegex = new RegExp(`\\b${keyword}\\b`, "g");
          if (keywordRegex.test(lineContent)) {
            tokens.push(keyword);
          }
        }
      }
      const lineTokens = tokenizeGeneric(lineContent);
      tokens.push(...lineTokens);
    }
  }
  if (withSpecialOps.includes("append(") || withSpecialOps.includes(".extend(")) {
    tokens.push("list_operation");
  }
  if (withSpecialOps.includes(".get(") || withSpecialOps.includes(".items()") || withSpecialOps.includes(".keys()") || withSpecialOps.includes(".values()")) {
    tokens.push("dict_operation");
  }
  const snakeCaseTokens = [];
  for (const token of tokens) {
    if (token.startsWith("__") && token.endsWith("__")) {
      snakeCaseTokens.push(token);
      continue;
    }
    if (token.includes("_")) {
      const parts = token.split("_").filter((part) => part.length > 0);
      snakeCaseTokens.push(token);
      snakeCaseTokens.push(...parts);
    } else {
      snakeCaseTokens.push(token);
    }
  }
  const finalTokens = [];
  for (const token of snakeCaseTokens) {
    if (stringPlaceholders[token]) {
      if (token.startsWith("__PYFSTRING_")) {
        finalTokens.push("f_string");
      } else if (token.startsWith("__PYSTRING_")) {
        finalTokens.push("string_literal");
      } else if (token.startsWith("__PYDECORATOR_")) {
        finalTokens.push("decorator");
      } else {
        finalTokens.push(token);
      }
      if (token.startsWith("__PYSTRING_") || token.startsWith("__PYFSTRING_")) {
        const content = stringPlaceholders[token];
        let strContent = content;
        if (strContent.startsWith("f") || strContent.startsWith("r") || strContent.startsWith("fr") || strContent.startsWith("rf") || strContent.startsWith("b") || strContent.startsWith("rb") || strContent.startsWith("br")) {
          const prefixLength = /^[a-z]+/.exec(strContent)[0].length;
          strContent = strContent.substring(prefixLength);
        }
        strContent = strContent.replace(/^['"]|['"]$/g, "");
        strContent = strContent.replace(/^'''|'''$/g, "");
        strContent = strContent.replace(/^"""|"""$/g, "");
        strContent = strContent.replace(/{[^{}]*}/g, " ");
        const contentTokens = tokenizeGeneric(strContent);
        finalTokens.push(...contentTokens);
      }
    } else if (commentPlaceholders[token]) {
      finalTokens.push("code_comment");
      const commentContent = commentPlaceholders[token].replace(/^#{1}/, "").replace(/^'''|'''$/g, "").replace(/^"""|"""$/g, "");
      const commentTokens = commentContent.split(/\s+/).filter((word) => /^[a-z0-9_]{3,}$/i.test(word)).map((word) => word.toLowerCase());
      finalTokens.push(...commentTokens);
    } else {
      finalTokens.push(token);
    }
  }
  return [...new Set(finalTokens)];
}
function tokenizeJavaLike(text) {
  let tokens = [];
  const commentPlaceholders = {};
  let commentCounter = 0;
  const withoutBlockComments = text.replace(/\/\*[\s\S]*?\*\//g, (match) => {
    const placeholder = `__JAVA_COMMENT_BLOCK_${commentCounter++}__`;
    commentPlaceholders[placeholder] = match;
    return placeholder;
  });
  const withoutComments = withoutBlockComments.replace(
    /\/\/[^\n]*/g,
    (match) => {
      const placeholder = `__JAVA_COMMENT_LINE_${commentCounter++}__`;
      commentPlaceholders[placeholder] = match;
      return placeholder;
    }
  );
  const stringPlaceholders = {};
  let placeholderCounter = 0;
  const withoutStrings = withoutComments.replace(
    /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g,
    (match) => {
      const placeholder = `__JAVASTRING_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;
      return placeholder;
    }
  );
  const withoutAnnotations = withoutStrings.replace(
    /@([a-zA-Z][a-zA-Z0-9_.]*)(?:\s*\((?:[^)(]*|\([^)(]*\))*\))?/g,
    (match, annotationName) => {
      const placeholder = `__ANNOTATION_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;
      tokens.push("annotation");
      tokens.push(annotationName.toLowerCase());
      const paramMatch = match.match(/\((.*)\)/);
      if (paramMatch && paramMatch[1]) {
        const params = paramMatch[1];
        const keyValuePairs = params.split(",");
        for (const pair of keyValuePairs) {
          const parts = pair.split("=");
          if (parts.length === 2) {
            tokens.push(parts[0].trim());
          }
          const valueTokens = tokenizeGeneric(pair);
          tokens.push(...valueTokens);
        }
      }
      return placeholder;
    }
  );
  const withoutGenerics = withoutAnnotations.replace(
    /<([^<>]*(?:<[^<>]*(?:<[^<>]*>)*[^<>]*>)*[^<>]*)>/g,
    (match) => {
      const placeholder = `__GENERIC_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;
      tokens.push("generic_type");
      const content = match.slice(1, -1);
      const typeParams = content.split(/,(?![^<>]*>)/);
      for (const param of typeParams) {
        const paramTokens = tokenizeGeneric(param.trim());
        tokens.push(...paramTokens);
      }
      return placeholder;
    }
  );
  const withoutLambdas = withoutGenerics.replace(
    /(?:\(.*?\)|[a-zA-Z_][a-zA-Z0-9_]*)\s*(?:->|=>)\s*(?:{[\s\S]*?}|[^;]*)/g,
    (match) => {
      const placeholder = `__LAMBDA_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;
      tokens.push("lambda_expression");
      const lambdaTokens = tokenizeGeneric(match);
      tokens.push(...lambdaTokens);
      return placeholder;
    }
  );
  const accessModifiers = [
    "public",
    "private",
    "protected",
    "internal",
    "static",
    "final",
    "abstract",
    "override",
    "virtual",
    "readonly",
    "const",
    "sealed",
    "partial",
    "async",
    "volatile",
    "transient",
    "synchronized",
    "unsafe",
    "extern"
  ];
  let withAccessModifiers = withoutLambdas;
  for (const modifier of accessModifiers) {
    const regex = new RegExp(`\\b${modifier}\\b`, "gi");
    withAccessModifiers = withAccessModifiers.replace(regex, (match) => {
      tokens.push(match.toLowerCase());
      tokens.push("access_modifier");
      return match;
    });
  }
  withAccessModifiers = withAccessModifiers.replace(
    /\b(?:package|namespace)\s+([a-zA-Z_][a-zA-Z0-9_.]*)/g,
    (match, packageName) => {
      tokens.push("package_declaration");
      const packageParts = packageName.split(".");
      tokens.push(packageName);
      tokens.push(...packageParts);
      return match;
    }
  );
  withAccessModifiers = withAccessModifiers.replace(
    /\b(?:import|using)\s+(?:static\s+)?([a-zA-Z_][a-zA-Z0-9_.]*(?:\.\*)?)/g,
    (match, importName) => {
      tokens.push("import_statement");
      const importParts = importName.split(".");
      tokens.push(importName);
      if (importParts.length > 0 && importParts[importParts.length - 1] === "*") {
        importParts.pop();
        tokens.push("wildcard_import");
      }
      tokens.push(...importParts);
      return match;
    }
  );
  if (/\bfrom\b.*\bin\b.*\bselect\b/i.test(withAccessModifiers)) {
    tokens.push("linq_expression");
    const linqKeywords = [
      "from",
      "in",
      "select",
      "where",
      "group",
      "by",
      "into",
      "orderby",
      "join",
      "let",
      "on",
      "equals"
    ];
    for (const keyword of linqKeywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, "gi");
      if (regex.test(withAccessModifiers)) {
        tokens.push(`linq_${keyword}`);
      }
    }
  }
  const mainTokens = tokenizeGeneric(withAccessModifiers);
  tokens.push(...mainTokens);
  const processedTokens = [];
  for (const token of tokens) {
    if (token.startsWith("__") && token.endsWith("__")) {
      processedTokens.push(token);
      continue;
    }
    if (token.includes(".")) {
      const parts = token.split(".");
      processedTokens.push(token);
      processedTokens.push(...parts);
      continue;
    }
    processedTokens.push(token);
    if (/[a-z][A-Z]/.test(token)) {
      const parts = token.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(" ");
      if (parts.length > 1) {
        processedTokens.push(...parts);
      }
    }
  }
  const finalTokens = [];
  for (const token of processedTokens) {
    if (stringPlaceholders[token]) {
      if (token.startsWith("__JAVASTRING_")) {
        finalTokens.push("string_literal");
      } else if (token.startsWith("__ANNOTATION_")) {
        finalTokens.push("annotation");
      } else if (token.startsWith("__GENERIC_")) {
        finalTokens.push("generic");
      } else if (token.startsWith("__LAMBDA_")) {
        finalTokens.push("lambda");
      } else {
        finalTokens.push(token);
      }
      if (token.startsWith("__JAVASTRING_")) {
        const content = stringPlaceholders[token];
        const strContent = content.replace(/^"|"$/g, "").replace(/^'|'$/g, "");
        if (strContent.trim().length > 0) {
          const contentTokens = tokenizeGeneric(strContent);
          finalTokens.push(...contentTokens);
        }
      }
    } else if (commentPlaceholders[token]) {
      finalTokens.push("code_comment");
      const commentContent = commentPlaceholders[token].replace(/^\/\*|\*\/$/g, "").replace(/^\/\//g, "");
      const commentTokens = commentContent.split(/\s+/).filter((word) => /^[a-z0-9_]{3,}$/i.test(word)).map((word) => word.toLowerCase());
      finalTokens.push(...commentTokens);
    } else {
      finalTokens.push(token);
    }
  }
  return [...new Set(finalTokens)];
}
function tokenizeRuby(text) {
  let tokens = [];
  const commentPlaceholders = {};
  let commentCounter = 0;
  const withoutBlockComments = text.replace(/=begin[\s\S]*?=end/g, (match) => {
    const placeholder = `__RUBY_COMMENT_BLOCK_${commentCounter++}__`;
    commentPlaceholders[placeholder] = match;
    return placeholder;
  });
  const withoutComments = withoutBlockComments.replace(/#[^\n]*/g, (match) => {
    const placeholder = `__RUBY_COMMENT_LINE_${commentCounter++}__`;
    commentPlaceholders[placeholder] = match;
    return placeholder;
  });
  const stringPlaceholders = {};
  let placeholderCounter = 0;
  const withoutInterpolation = withoutComments.replace(
    /"(?:[^"\\]|\\.|#\{[^}]*\})*"/g,
    (match) => {
      const placeholder = `__RUBY_INTERPOLATED_STRING_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;
      const expressions = [];
      let expContent = match.match(/#\{([^}]*)\}/g);
      if (expContent) {
        expContent.forEach((exp) => {
          expressions.push(exp.slice(2, -1));
        });
        expressions.forEach((exp) => {
          const expTokens = tokenizeRuby(exp);
          tokens.push(...expTokens);
        });
      }
      return placeholder;
    }
  );
  const withoutStrings = withoutInterpolation.replace(
    /('(?:[^'\\]|\\.)*'|%[qQ]?\{(?:[^\\}]|\\.)*\}|%[qQ]?\((?:[^\\)]|\\.)*\)|%[qQ]?\[(?:[^\\]]|\\.)*\]|%[qQ]?<(?:[^\\>]|\\.)*>|<<-?(['"]?)(\w+)\1[\s\S]*?\2)/g,
    (match) => {
      const placeholder = `__RUBY_STRING_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;
      return placeholder;
    }
  );
  const withoutRegexps = withoutStrings.replace(
    /\/(?:[^\/\\]|\\.)*\/[iomxneus]*/g,
    (match) => {
      const placeholder = `__RUBY_REGEXP_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;
      tokens.push("regexp");
      return placeholder;
    }
  );
  const withoutSymbols = withoutRegexps.replace(
    /:(?:@?[a-zA-Z_][a-zA-Z0-9_]*(?:[?!]|=(?!=))?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+)/g,
    (match) => {
      const placeholder = `__RUBY_SYMBOL_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;
      const symbolName = match.substring(1);
      tokens.push("symbol");
      tokens.push(`symbol_${symbolName}`);
      if (symbolName.endsWith("?") || symbolName.endsWith("!")) {
        tokens.push(`symbol_${symbolName.slice(0, -1)}`);
      }
      return placeholder;
    }
  );
  let withoutBlocks = withoutSymbols;
  withoutBlocks = withoutBlocks.replace(
    /\bdo\s*(?:\|[^|]*\|)?[\s\S]*?\bend\b/g,
    (match) => {
      const placeholder = `__RUBY_BLOCK_DO_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;
      tokens.push("block_do_end");
      const paramMatch = match.match(/\|\s*([^|]*)\s*\|/);
      if (paramMatch && paramMatch[1]) {
        const params = paramMatch[1].split(",");
        params.forEach((param) => {
          tokens.push(param.trim());
        });
      }
      const blockContent = match.replace(/\bdo\s*(?:\|[^|]*\|)?/, "").replace(/\bend\b$/, "");
      const contentTokens = tokenizeGeneric(blockContent);
      tokens.push(...contentTokens);
      return placeholder;
    }
  );
  withoutBlocks = withoutBlocks.replace(
    /\{(?:\s*\|[^|]*\|\s*)?[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g,
    (match) => {
      if (/^\{\s*:/.test(match) || /^\{\s*['"]/.test(match)) {
        return match;
      }
      const placeholder = `__RUBY_BLOCK_BRACE_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;
      tokens.push("block_brace");
      const paramMatch = match.match(/\|\s*([^|]*)\s*\|/);
      if (paramMatch && paramMatch[1]) {
        const params = paramMatch[1].split(",");
        params.forEach((param) => {
          tokens.push(param.trim());
        });
      }
      let blockContent = match.slice(1, -1);
      if (paramMatch) {
        blockContent = blockContent.replace(/\|\s*[^|]*\s*\|/, "");
      }
      const contentTokens = tokenizeGeneric(blockContent);
      tokens.push(...contentTokens);
      return placeholder;
    }
  );
  let withRangeOps = withoutBlocks.replace(/\.\.(\.)?/g, (match) => {
    tokens.push(
      match === ".." ? "range_operator_inclusive" : "range_operator_exclusive"
    );
    return " " + match + " ";
  });
  withRangeOps = withRangeOps.replace(
    /\bdef\s+(?:self\.)?([a-zA-Z_][a-zA-Z0-9_]*[?!=]?)/g,
    (match, methodName) => {
      tokens.push("method_definition");
      tokens.push(methodName);
      if (methodName.endsWith("?") || methodName.endsWith("!") || methodName.endsWith("=")) {
        tokens.push(methodName.slice(0, -1));
      }
      return match;
    }
  );
  withRangeOps = withRangeOps.replace(
    /\b(?:class|module)\s+([A-Z][a-zA-Z0-9_]*(?:::[A-Z][a-zA-Z0-9_]*)*)/g,
    (match, className) => {
      tokens.push(
        match.startsWith("class") ? "class_definition" : "module_definition"
      );
      tokens.push(className);
      if (className.includes("::")) {
        const parts = className.split("::");
        tokens.push(...parts);
      }
      return match;
    }
  );
  const genericTokens = tokenizeGeneric(withRangeOps);
  const rubyKeywords = [
    "if",
    "unless",
    "else",
    "elsif",
    "end",
    "begin",
    "rescue",
    "ensure",
    "while",
    "until",
    "for",
    "break",
    "next",
    "redo",
    "retry",
    "return",
    "super",
    "self",
    "nil",
    "true",
    "false",
    "and",
    "or",
    "not",
    "yield"
  ];
  for (const keyword of rubyKeywords) {
    const regex = new RegExp(`\\b${keyword}\\b`, "g");
    if (regex.test(withRangeOps)) {
      tokens.push(keyword);
    }
  }
  tokens.push(...genericTokens);
  const processedTokens = [];
  for (const token of tokens) {
    if (token.startsWith("__RUBY_")) {
      processedTokens.push(token);
      continue;
    }
    processedTokens.push(token);
    if (token.endsWith("?") || token.endsWith("!")) {
      processedTokens.push(token.slice(0, -1));
    }
    if (token.endsWith("=") && !["==", "!=", ">=", "<=", "=>"].includes(token)) {
      processedTokens.push(token.slice(0, -1));
    }
  }
  const finalTokens = [];
  for (const token of processedTokens) {
    if (stringPlaceholders[token]) {
      if (token.startsWith("__RUBY_STRING_") || token.startsWith("__RUBY_INTERPOLATED_STRING_")) {
        finalTokens.push("string_literal");
        const content = stringPlaceholders[token];
        let strContent = content;
        if (strContent.startsWith("'") && strContent.endsWith("'")) {
          strContent = strContent.slice(1, -1);
        } else if (strContent.startsWith('"') && strContent.endsWith('"')) {
          strContent = strContent.slice(1, -1);
        } else if (strContent.startsWith("%q") || strContent.startsWith("%Q")) {
          strContent = strContent.slice(3, -1);
        }
        strContent = strContent.replace(/#\{[^}]*\}/g, " ");
        if (strContent.trim()) {
          const contentTokens = tokenizeGeneric(strContent);
          finalTokens.push(...contentTokens);
        }
      } else if (token.startsWith("__RUBY_SYMBOL_")) {
        finalTokens.push("symbol");
      } else if (token.startsWith("__RUBY_BLOCK_")) {
        finalTokens.push("block");
      } else if (token.startsWith("__RUBY_REGEXP_")) {
        finalTokens.push("regexp");
      } else {
        finalTokens.push(token);
      }
    } else if (commentPlaceholders[token]) {
      finalTokens.push("code_comment");
      const commentContent = commentPlaceholders[token].replace(/^#/, "").replace(/^=begin\s*|\s*=end$/g, "");
      const commentTokens = commentContent.split(/\s+/).filter((word) => /^[a-z0-9_]{3,}$/i.test(word)).map((word) => word.toLowerCase());
      finalTokens.push(...commentTokens);
    } else {
      finalTokens.push(token);
    }
  }
  return [...new Set(finalTokens)];
}
function tokenizeGo(text) {
  let tokens = [];
  const commentPlaceholders = {};
  let commentCounter = 0;
  const withoutBlockComments = text.replace(/\/\*[\s\S]*?\*\//g, (match) => {
    const placeholder = `__GO_COMMENT_BLOCK_${commentCounter++}__`;
    commentPlaceholders[placeholder] = match;
    return placeholder;
  });
  const withoutComments = withoutBlockComments.replace(
    /\/\/[^\n]*/g,
    (match) => {
      const placeholder = `__GO_COMMENT_LINE_${commentCounter++}__`;
      commentPlaceholders[placeholder] = match;
      return placeholder;
    }
  );
  const stringPlaceholders = {};
  let placeholderCounter = 0;
  const withoutRawStrings = withoutComments.replace(/`[^`]*`/g, (match) => {
    const placeholder = `__GO_RAW_STRING_${placeholderCounter++}__`;
    stringPlaceholders[placeholder] = match;
    return placeholder;
  });
  const withoutStrings = withoutRawStrings.replace(
    /"(?:[^"\\]|\\.)*"/g,
    (match) => {
      const placeholder = `__GO_STRING_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;
      return placeholder;
    }
  );
  const withoutRunes = withoutStrings.replace(/'(?:[^'\\]|\\.)*'/g, (match) => {
    const placeholder = `__GO_RUNE_${placeholderCounter++}__`;
    stringPlaceholders[placeholder] = match;
    return placeholder;
  });
  const withoutStructTags = withoutRunes.replace(
    /`(?:[a-zA-Z0-9_]+:"[^"]*")+`/g,
    (match) => {
      const placeholder = `__GO_STRUCT_TAG_${placeholderCounter++}__`;
      stringPlaceholders[placeholder] = match;
      tokens.push("struct_tag");
      const tagPairs = match.slice(1, -1).split(" ");
      for (const pair of tagPairs) {
        if (!pair.trim())
          continue;
        const [key, quotedValue] = pair.split(":");
        if (key && quotedValue) {
          tokens.push(`tag_${key}`);
          const value = quotedValue.replace(/^"|"$/g, "");
          if (value) {
            if (value.includes(",")) {
              const valueParts = value.split(",");
              tokens.push(...valueParts);
            } else {
              tokens.push(value);
            }
          }
        }
      }
      return placeholder;
    }
  );
  const withoutChannelOps = withoutStructTags.replace(/<-/g, (match) => {
    tokens.push("channel_operation");
    return " <- ";
  });
  const withoutGoroutines = withoutChannelOps.replace(
    /\bgo\s+(?:func\b|[a-zA-Z_][a-zA-Z0-9_]*\s*\()/g,
    (match) => {
      tokens.push("goroutine");
      const funcCallMatch = match.match(/go\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
      if (funcCallMatch && funcCallMatch[1]) {
        tokens.push(funcCallMatch[1]);
      }
      return match;
    }
  );
  const withoutSelect = withoutGoroutines.replace(
    /\bselect\s*{[\s\S]*?}/g,
    (match) => {
      tokens.push("select_statement");
      const cases = match.match(/case\s+[^:]+:/g);
      if (cases) {
        for (const caseStr of cases) {
          const caseContent = caseStr.slice(4, -1).trim();
          const caseTokens = tokenizeGeneric(caseContent);
          tokens.push(...caseTokens);
        }
      }
      return match;
    }
  );
  const withoutDefer = withoutSelect.replace(
    /\bdefer\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\(/g,
    (match) => {
      tokens.push("defer");
      const funcMatch = match.match(/defer\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
      if (funcMatch && funcMatch[1]) {
        tokens.push(funcMatch[1]);
      }
      return match;
    }
  );
  const withoutTypeDecls = withoutDefer.replace(
    /\btype\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+(?:struct|interface)\s*{[\s\S]*?}/g,
    (match, typeName) => {
      tokens.push("type_declaration");
      tokens.push(typeName);
      if (match.includes("struct")) {
        tokens.push("struct_type");
        const fieldMatches = match.match(
          /([a-zA-Z_][a-zA-Z0-9_]*)\s+([a-zA-Z_][a-zA-Z0-9_.*[\]]*)/g
        );
        if (fieldMatches) {
          for (const fieldMatch of fieldMatches) {
            const parts = fieldMatch.trim().split(/\s+/);
            if (parts.length >= 2) {
              tokens.push(parts[0]);
              tokens.push(parts[1]);
            }
          }
        }
      } else if (match.includes("interface")) {
        tokens.push("interface_type");
        const methodMatches = match.match(
          /([a-zA-Z_][a-zA-Z0-9_]*)\s*\([\s\S]*?\)(?:\s*\([\s\S]*?\))?\s*[,{]/g
        );
        if (methodMatches) {
          for (const methodMatch of methodMatches) {
            const methodName = methodMatch.match(/([a-zA-Z_][a-zA-Z0-9_]*)/);
            if (methodName && methodName[1]) {
              tokens.push(methodName[1]);
            }
          }
        }
      }
      return match;
    }
  );
  let withBuiltins = withoutTypeDecls;
  const goBuiltins = [
    "make",
    "new",
    "len",
    "cap",
    "append",
    "copy",
    "delete",
    "close",
    "complex",
    "real",
    "imag",
    "panic",
    "recover"
  ];
  for (const builtin of goBuiltins) {
    const regex = new RegExp(`\\b${builtin}\\s*\\(`, "g");
    withBuiltins = withBuiltins.replace(regex, (match) => {
      tokens.push(`builtin_${builtin}`);
      return match;
    });
  }
  const goKeywords = [
    "package",
    "import",
    "func",
    "return",
    "var",
    "const",
    "type",
    "struct",
    "interface",
    "map",
    "chan",
    "go",
    "select",
    "case",
    "default",
    "defer",
    "if",
    "else",
    "switch",
    "for",
    "range",
    "continue",
    "break",
    "fallthrough",
    "goto",
    "nil",
    "iota",
    "true",
    "false"
  ];
  for (const keyword of goKeywords) {
    const regex = new RegExp(`\\b${keyword}\\b`, "g");
    if (regex.test(withBuiltins)) {
      tokens.push(keyword);
    }
  }
  const genericTokens = tokenizeGeneric(withBuiltins);
  tokens.push(...genericTokens);
  const processedTokens = [];
  for (const token of tokens) {
    if (token.startsWith("__GO_")) {
      processedTokens.push(token);
      continue;
    }
    processedTokens.push(token);
    if (/[a-z][A-Z]/.test(token)) {
      const parts = token.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(" ");
      if (parts.length > 1) {
        processedTokens.push(...parts);
      }
    }
  }
  const finalTokens = [];
  for (const token of processedTokens) {
    if (stringPlaceholders[token]) {
      if (token.startsWith("__GO_STRING_")) {
        finalTokens.push("string_literal");
        const content = stringPlaceholders[token];
        const strContent = content.slice(1, -1);
        if (strContent.trim().length > 0) {
          const contentTokens = tokenizeGeneric(strContent);
          finalTokens.push(...contentTokens);
        }
      } else if (token.startsWith("__GO_RAW_STRING_")) {
        finalTokens.push("raw_string_literal");
        const content = stringPlaceholders[token];
        const rawContent = content.slice(1, -1);
        if (rawContent.includes("\n")) {
          const lines = rawContent.split("\n");
          for (const line of lines) {
            if (line.trim()) {
              const lineTokens = tokenizeGeneric(line.trim());
              finalTokens.push(...lineTokens);
            }
          }
        } else if (rawContent.trim()) {
          const contentTokens = tokenizeGeneric(rawContent);
          finalTokens.push(...contentTokens);
        }
      } else if (token.startsWith("__GO_STRUCT_TAG_")) {
        finalTokens.push("struct_tag");
      } else if (token.startsWith("__GO_RUNE_")) {
        finalTokens.push("rune_literal");
      } else {
        finalTokens.push(token);
      }
    } else if (commentPlaceholders[token]) {
      finalTokens.push("code_comment");
      const commentContent = commentPlaceholders[token].replace(/^\/\*|\*\/$/g, "").replace(/^\/\//g, "");
      const commentTokens = commentContent.split(/\s+/).filter((word) => /^[a-z0-9_]{3,}$/i.test(word)).map((word) => word.toLowerCase());
      finalTokens.push(...commentTokens);
    } else {
      finalTokens.push(token);
    }
  }
  return [...new Set(finalTokens)];
}
function stem(word) {
  if (typeof word !== "string")
    return "";
  const lowerWord = word.toLowerCase();
  if (lowerWord.length <= 2)
    return lowerWord;
  if (lowerWord.endsWith("ing")) {
    const stemmed = lowerWord.slice(0, -3);
    if (stemmed.length > 2)
      return stemmed;
    return lowerWord;
  }
  if (lowerWord.endsWith("ed")) {
    const stemmed = lowerWord.slice(0, -2);
    if (stemmed.length > 2)
      return stemmed;
    return lowerWord;
  }
  if (lowerWord.endsWith("s") && !lowerWord.endsWith("ss")) {
    return lowerWord.slice(0, -1);
  }
  if (lowerWord.endsWith("es")) {
    return lowerWord.slice(0, -2);
  }
  if (lowerWord.endsWith("ly")) {
    return lowerWord.slice(0, -2);
  }
  if (lowerWord.endsWith("er")) {
    return lowerWord.slice(0, -2);
  }
  return lowerWord;
}

// src/logic/ContextIndexerLogic.js
init_db();
import { v4 as uuidv42 } from "uuid";
import crypto from "crypto";
import path from "path";
import * as acorn2 from "acorn";
init_RelationshipContextManagerLogic();

// src/logic/CodeStructureAnalyzerLogic.js
init_db();
import * as acorn from "acorn";
async function buildAST(content, language) {
  if (!content || content.trim() === "") {
    console.warn("Empty code content provided to buildAST");
    return null;
  }
  const normalizedLanguage = language.toLowerCase();
  if (["javascript", "typescript", "js", "ts", "jsx", "tsx"].includes(
    normalizedLanguage
  )) {
    try {
      const options = {
        ecmaVersion: "latest",
        sourceType: "module",
        locations: true,
        ranges: true,
        // Enable JSX parsing if the language includes 'jsx' or 'tsx'
        allowAwaitOutsideFunction: true,
        allowImportExportEverywhere: true,
        allowReserved: true,
        allowReturnOutsideFunction: false,
        allowSuperOutsideMethod: false
      };
      const ast = acorn.parse(content, options);
      return ast;
    } catch (error) {
      console.error(`Error parsing ${normalizedLanguage} code:`, error.message);
      return {
        error: true,
        message: error.message,
        location: error.loc,
        type: "AST_PARSE_ERROR"
      };
    }
  } else {
    console.log(
      `AST generation is not yet supported for ${normalizedLanguage}`
    );
    return null;
  }
}
function extractStructuralFeatures(ast) {
  if (!ast || ast.error) {
    return { features: [], complexity: 0 };
  }
  const result = {
    features: [],
    complexity: 1
    // Base complexity is 1
  };
  let maxNestingDepth = 0;
  let currentNestingDepth = 0;
  const visitedNodes = /* @__PURE__ */ new WeakSet();
  function visit(node, parentNode = null, currentScope = "global") {
    if (!node || visitedNodes.has(node)) {
      return;
    }
    visitedNodes.add(node);
    if (typeof node !== "object") {
      return;
    }
    const line = node.loc?.start?.line;
    switch (node.type) {
      case "IfStatement":
        result.features.push({
          type: "control_flow",
          statement: "if",
          line,
          nesting: currentNestingDepth
        });
        result.complexity++;
        break;
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement":
        result.features.push({
          type: "control_flow",
          statement: "for",
          line,
          nesting: currentNestingDepth
        });
        result.complexity++;
        break;
      case "WhileStatement":
      case "DoWhileStatement":
        result.features.push({
          type: "control_flow",
          statement: "while",
          line,
          nesting: currentNestingDepth
        });
        result.complexity++;
        break;
      case "SwitchStatement":
        result.features.push({
          type: "control_flow",
          statement: "switch",
          line,
          nesting: currentNestingDepth
        });
        const caseCount = node.cases?.length || 0;
        result.complexity += caseCount > 0 ? caseCount - 1 : 0;
        break;
      case "TryStatement":
        result.features.push({
          type: "control_flow",
          statement: "try",
          line,
          nesting: currentNestingDepth
        });
        break;
      case "ConditionalExpression":
        result.features.push({
          type: "control_flow",
          statement: "conditional",
          line,
          nesting: currentNestingDepth
        });
        result.complexity++;
        break;
      case "LogicalExpression":
        if (node.operator === "&&" || node.operator === "||") {
          result.features.push({
            type: "control_flow",
            statement: "logical",
            operator: node.operator,
            line,
            nesting: currentNestingDepth
          });
          result.complexity++;
        }
        break;
      case "FunctionDeclaration":
        result.features.push({
          type: "function_declaration",
          name: node.id?.name || "anonymous",
          params: node.params?.length || 0,
          line,
          async: node.async || false,
          generator: node.generator || false
        });
        currentScope = node.id?.name || "anonymous";
        break;
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        result.features.push({
          type: "function_expression",
          name: node.id?.name || "anonymous",
          params: node.params?.length || 0,
          line,
          async: node.async || false,
          generator: node.type === "FunctionExpression" ? node.generator || false : false,
          arrow: node.type === "ArrowFunctionExpression"
        });
        currentScope = node.id?.name || "anonymous";
        break;
      case "CallExpression":
        let callName = "unknown";
        if (node.callee.type === "Identifier") {
          callName = node.callee.name;
        } else if (node.callee.type === "MemberExpression") {
          if (node.callee.property && node.callee.property.type === "Identifier") {
            callName = node.callee.property.name;
            if (node.callee.object && node.callee.object.type === "Identifier") {
              callName = `${node.callee.object.name}.${callName}`;
            }
          }
        }
        result.features.push({
          type: "function_call",
          name: callName,
          arguments: node.arguments?.length || 0,
          line
        });
        break;
      case "VariableDeclaration":
        node.declarations.forEach((declarator) => {
          if (declarator.id && declarator.id.type === "Identifier") {
            result.features.push({
              type: "variable_declaration",
              name: declarator.id.name,
              kind: node.kind,
              // 'var', 'let', or 'const'
              scope: currentScope,
              line,
              initialized: declarator.init !== null
            });
          }
        });
        break;
      case "ClassDeclaration":
        result.features.push({
          type: "class_declaration",
          name: node.id?.name || "anonymous",
          extends: node.superClass ? node.superClass.name || "unknown" : null,
          line
        });
        break;
      case "ImportDeclaration":
        result.features.push({
          type: "import",
          source: node.source?.value,
          line
        });
        break;
      case "ExportNamedDeclaration":
      case "ExportDefaultDeclaration":
        result.features.push({
          type: "export",
          default: node.type === "ExportDefaultDeclaration",
          line
        });
        break;
    }
    if (node.type === "BlockStatement") {
      currentNestingDepth++;
      maxNestingDepth = Math.max(maxNestingDepth, currentNestingDepth);
    }
    for (const key in node) {
      const child = node[key];
      if (key === "type" || key === "loc" || key === "range" || key === "parent" || key === "leadingComments" || key === "trailingComments") {
        continue;
      }
      if (Array.isArray(child)) {
        for (const item of child) {
          visit(item, node, currentScope);
        }
      } else if (child && typeof child === "object") {
        visit(child, node, currentScope);
      }
    }
    if (node.type === "BlockStatement") {
      currentNestingDepth--;
    }
  }
  visit(ast);
  result.features.push({
    type: "metadata",
    name: "max_nesting_depth",
    value: maxNestingDepth
  });
  return result;
}

// src/logic/ContextIndexerLogic.js
function calculateContentHash(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}
function extractFilename(filePath) {
  return path.basename(filePath);
}
function detectLanguage(filePath, languageHint) {
  if (languageHint) {
    return languageHint.toLowerCase();
  }
  const extension = path.extname(filePath).toLowerCase();
  const extensionMap = {
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".py": "python",
    ".rb": "ruby",
    ".java": "java",
    ".go": "go",
    ".rs": "rust",
    ".php": "php",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c",
    ".hpp": "cpp",
    ".cs": "csharp",
    ".swift": "swift",
    ".kt": "kotlin",
    ".html": "html",
    ".css": "css",
    ".scss": "scss",
    ".json": "json",
    ".md": "markdown",
    ".xml": "xml",
    ".yaml": "yaml",
    ".yml": "yaml"
  };
  return extensionMap[extension] || "unknown";
}
function getLineFromPosition(content, position) {
  const lines = content.substring(0, position).split("\n");
  return lines.length;
}
function extractEntitiesWithRegex(content, language) {
  const entities = [];
  const patterns = {
    // Function patterns
    function: {
      python: /def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)\s*:/g,
      ruby: /def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(\([^)]*\))?\s*(do|\n)/g,
      java: /(public|private|protected|static|\s) +[\w\<\>\[\]]+\s+(\w+) *\([^\)]*\) *(\{?|[^;])/g,
      go: /func\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)\s*(?:\([^)]*\))?\s*\{/g,
      php: /function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)\s*\{/g,
      default: /function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)\s*\{/g
    },
    // Class patterns
    class: {
      python: /class\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(\([^)]*\))?\s*:/g,
      ruby: /class\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*((<|::)\s*[A-Za-z0-9_:]*)?/g,
      java: /class\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(extends\s+[A-Za-z0-9_]+)?\s*(implements\s+[A-Za-z0-9_,\s]+)?\s*\{/g,
      go: /type\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+struct\s*\{/g,
      php: /class\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(extends\s+[A-Za-z0-9_]+)?\s*(implements\s+[A-Za-z0-9_,\s]+)?\s*\{/g,
      default: /class\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(extends\s+[A-Za-z0-9_]+)?\s*\{/g
    },
    // Variable/constant patterns
    variable: {
      python: /(^|\s)([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?!==)/g,
      ruby: /(^|\s)([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?!=)/g,
      java: /(private|protected|public|static|\s) +[\w\<\>\[\]]+\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*[^;]+;/g,
      go: /var\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+[\w\[\]]+(\s*=\s*[^;]+)?/g,
      php: /(\$[a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?!=)/g,
      default: /(const|let|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*[^;]+;/g
    }
  };
  const functionPattern = patterns.function[language] || patterns.function.default;
  let match;
  while ((match = functionPattern.exec(content)) !== null) {
    const name = match[1] || match[2];
    const startPosition = match.index;
    const startLine = getLineFromPosition(content, startPosition);
    let endLine = startLine + 10;
    entities.push({
      type: "function",
      name,
      start_position: startPosition,
      start_line: startLine,
      end_line: endLine,
      // Approximation
      raw_content: content.substring(
        startPosition,
        startPosition + match[0].length + 100
      )
      // Approximate content
    });
  }
  const classPattern = patterns.class[language] || patterns.class.default;
  while ((match = classPattern.exec(content)) !== null) {
    const name = match[1];
    const startPosition = match.index;
    const startLine = getLineFromPosition(content, startPosition);
    let endLine = startLine + 20;
    entities.push({
      type: "class",
      name,
      start_position: startPosition,
      start_line: startLine,
      end_line: endLine,
      // Approximation
      raw_content: content.substring(
        startPosition,
        startPosition + match[0].length + 500
      )
      // Approximate content
    });
  }
  return entities;
}
function extractEntitiesFromAST(ast, content) {
  const entities = [];
  const relationships = [];
  const idMap = /* @__PURE__ */ new Map();
  const visitedNodes = /* @__PURE__ */ new WeakSet();
  function createEntity(type, name, startPosition, endPosition, startLine, endLine, rawContent, parentEntity = null, customMetadata = {}) {
    const entity = {
      type,
      name,
      start_position: startPosition,
      end_position: endPosition,
      start_line: startLine,
      end_line: endLine,
      raw_content: rawContent,
      custom_metadata: customMetadata
    };
    entities.push(entity);
    if (parentEntity) {
      relationships.push({
        source: parentEntity,
        target: entity,
        type: "contains"
      });
    }
    return entity;
  }
  function visit(node, parentNode = null, parentEntity = null, scope = null) {
    if (!node || typeof node !== "object" || visitedNodes.has(node)) {
      return;
    }
    visitedNodes.add(node);
    if (!node.loc) {
      return;
    }
    const startLine = node.loc?.start?.line;
    const endLine = node.loc?.end?.line;
    const startPosition = node.start;
    const endPosition = node.end;
    const rawContent = content.substring(startPosition, endPosition);
    let currentEntity = null;
    switch (node.type) {
      case "FunctionDeclaration": {
        const name = node.id?.name || "anonymous";
        const params = node.params?.map(
          (p) => p.type === "Identifier" ? p.name : "param"
        );
        currentEntity = createEntity(
          "function",
          name,
          startPosition,
          endPosition,
          startLine,
          endLine,
          rawContent,
          parentEntity,
          {
            ast_node_type: node.type,
            params: params || [],
            is_async: node.async || false,
            is_generator: node.generator || false
          }
        );
        idMap.set(node, currentEntity);
        if (node.body) {
          visit(node.body, node, currentEntity, name);
        }
        break;
      }
      case "FunctionExpression":
      case "ArrowFunctionExpression": {
        let name = "anonymous";
        let functionType = "function_expression";
        if (parentNode && parentNode.type === "VariableDeclarator" && parentNode.id) {
          name = parentNode.id.name;
          functionType = "function";
        } else if (parentNode && parentNode.type === "AssignmentExpression" && parentNode.left) {
          if (parentNode.left.type === "Identifier") {
            name = parentNode.left.name;
            functionType = "function";
          } else if (parentNode.left.type === "MemberExpression" && parentNode.left.property) {
            name = parentNode.left.property.name;
            functionType = "method";
          }
        } else if (parentNode && parentNode.type === "Property" && parentNode.key) {
          name = parentNode.key.name || parentNode.key.value || "anonymous";
          functionType = "method";
        } else if (parentNode && parentNode.type === "MethodDefinition" && parentNode.key) {
          name = parentNode.key.name || "anonymous";
          functionType = "method";
        }
        const params = node.params?.map(
          (p) => p.type === "Identifier" ? p.name : "param"
        );
        currentEntity = createEntity(
          functionType,
          name,
          startPosition,
          endPosition,
          startLine,
          endLine,
          rawContent,
          parentEntity,
          {
            ast_node_type: node.type,
            params: params || [],
            is_async: node.async || false,
            is_generator: node.generator || false,
            is_arrow: node.type === "ArrowFunctionExpression"
          }
        );
        idMap.set(node, currentEntity);
        if (node.body) {
          visit(node.body, node, currentEntity, name);
        }
        break;
      }
      case "ClassDeclaration": {
        const name = node.id?.name || "anonymous";
        currentEntity = createEntity(
          "class",
          name,
          startPosition,
          endPosition,
          startLine,
          endLine,
          rawContent,
          parentEntity,
          {
            ast_node_type: node.type
          }
        );
        idMap.set(node, currentEntity);
        if (node.superClass) {
          if (node.superClass.type === "Identifier") {
            relationships.push({
              source: currentEntity,
              target: { name: node.superClass.name, type: "class" },
              type: "extends"
            });
          }
        }
        if (node.body) {
          visit(node.body, node, currentEntity, name);
        }
        break;
      }
      case "ClassExpression": {
        let name = node.id?.name || "anonymous";
        if (parentNode && parentNode.type === "VariableDeclarator" && parentNode.id) {
          name = parentNode.id.name;
        }
        currentEntity = createEntity(
          "class",
          name,
          startPosition,
          endPosition,
          startLine,
          endLine,
          rawContent,
          parentEntity,
          {
            ast_node_type: node.type
          }
        );
        idMap.set(node, currentEntity);
        if (node.superClass) {
          if (node.superClass.type === "Identifier") {
            relationships.push({
              source: currentEntity,
              target: { name: node.superClass.name, type: "class" },
              type: "extends"
            });
          }
        }
        if (node.body) {
          visit(node.body, node, currentEntity, name);
        }
        break;
      }
      case "MethodDefinition": {
        const name = node.key?.name || node.key?.value || "anonymous";
        const kind = node.kind || "method";
        currentEntity = createEntity(
          kind === "constructor" ? "constructor" : "method",
          name,
          startPosition,
          endPosition,
          startLine,
          endLine,
          rawContent,
          parentEntity,
          {
            ast_node_type: node.type,
            kind,
            is_static: !!node.static,
            is_async: node.value?.async || false,
            is_generator: node.value?.generator || false
          }
        );
        idMap.set(node, currentEntity);
        if (node.value) {
          visit(node.value, node, currentEntity, name);
        }
        break;
      }
      case "VariableDeclaration": {
        node.declarations.forEach((declarator) => {
          visit(declarator, node, parentEntity, scope);
        });
        break;
      }
      case "VariableDeclarator": {
        if (node.id && node.id.type === "Identifier") {
          const name = node.id.name;
          let shouldCreateEntity = false;
          let entityType = "variable";
          if (!node.init) {
            shouldCreateEntity = true;
          } else if ([
            "FunctionExpression",
            "ArrowFunctionExpression",
            "ClassExpression",
            "ObjectExpression",
            "NewExpression"
          ].includes(node.init.type)) {
            shouldCreateEntity = true;
            if (node.init.type === "ObjectExpression") {
              entityType = "object";
            }
          } else if (node.init.type === "Literal" && typeof node.init.value === "object") {
            shouldCreateEntity = true;
            entityType = "object";
          } else if (parentEntity && parentEntity.type !== "variable") {
            shouldCreateEntity = true;
          }
          if (shouldCreateEntity) {
            currentEntity = createEntity(
              entityType,
              name,
              startPosition,
              endPosition,
              startLine,
              endLine,
              rawContent,
              parentEntity,
              {
                ast_node_type: node.type,
                variable_kind: parentNode?.kind || "var"
                // 'var', 'let', or 'const'
              }
            );
            idMap.set(node, currentEntity);
          }
        }
        if (node.init) {
          visit(node.init, node, parentEntity || currentEntity, scope);
        }
        break;
      }
      case "ImportDeclaration": {
        const source = node.source.value;
        const specifiers = node.specifiers.map((specifier) => {
          if (specifier.type === "ImportDefaultSpecifier") {
            return { type: "default", name: specifier.local.name };
          } else if (specifier.type === "ImportNamespaceSpecifier") {
            return { type: "namespace", name: specifier.local.name };
          } else {
            return {
              type: "named",
              name: specifier.local.name,
              imported: specifier.imported?.name || specifier.local.name
            };
          }
        });
        currentEntity = createEntity(
          "import",
          source,
          startPosition,
          endPosition,
          startLine,
          endLine,
          rawContent,
          parentEntity,
          {
            ast_node_type: node.type,
            specifiers
          }
        );
        idMap.set(node, currentEntity);
        specifiers.forEach((spec) => {
          relationships.push({
            source: currentEntity,
            target: { name: spec.name, type: "imported" },
            type: "imports",
            metadata: {
              source_module: source,
              import_type: spec.type,
              original_name: spec.imported
            }
          });
        });
        break;
      }
      case "ExportNamedDeclaration": {
        let name = "named_export";
        if (node.declaration) {
          if (node.declaration.type === "FunctionDeclaration" || node.declaration.type === "ClassDeclaration") {
            name = node.declaration.id?.name || "anonymous";
          } else if (node.declaration.type === "VariableDeclaration" && node.declaration.declarations.length > 0) {
            name = node.declaration.declarations[0].id?.name || "anonymous";
          }
        } else if (node.specifiers && node.specifiers.length > 0) {
          name = node.specifiers.map((s) => s.exported?.name || s.local?.name || "anonymous").join(",");
        }
        currentEntity = createEntity(
          "export",
          name,
          startPosition,
          endPosition,
          startLine,
          endLine,
          rawContent,
          parentEntity,
          {
            ast_node_type: node.type,
            source: node.source?.value
          }
        );
        idMap.set(node, currentEntity);
        if (node.declaration) {
          visit(node.declaration, node, parentEntity, scope);
        }
        if (node.specifiers) {
          node.specifiers.forEach((spec) => {
            if (spec.local && spec.exported) {
              relationships.push({
                source: currentEntity,
                target: { name: spec.local.name, type: "exported" },
                type: "exports",
                metadata: {
                  exported_as: spec.exported.name,
                  source_module: node.source?.value
                }
              });
            }
          });
        }
        break;
      }
      case "ExportDefaultDeclaration": {
        let name = "default";
        if (node.declaration) {
          if (node.declaration.type === "FunctionDeclaration" || node.declaration.type === "ClassDeclaration") {
            name = node.declaration.id?.name || "default";
          } else if (node.declaration.type === "Identifier") {
            name = node.declaration.name;
          }
        }
        currentEntity = createEntity(
          "export",
          name,
          startPosition,
          endPosition,
          startLine,
          endLine,
          rawContent,
          parentEntity,
          {
            ast_node_type: node.type,
            is_default: true
          }
        );
        idMap.set(node, currentEntity);
        if (node.declaration) {
          visit(node.declaration, node, parentEntity, scope);
        }
        relationships.push({
          source: currentEntity,
          target: { name, type: "exported" },
          type: "exports",
          metadata: { is_default: true }
        });
        break;
      }
      case "InterfaceDeclaration": {
        const name = node.id?.name || "anonymous";
        currentEntity = createEntity(
          "interface",
          name,
          startPosition,
          endPosition,
          startLine,
          endLine,
          rawContent,
          parentEntity,
          {
            ast_node_type: node.type
          }
        );
        idMap.set(node, currentEntity);
        if (node.extends) {
          node.extends.forEach((ext) => {
            if (ext.expression && ext.expression.type === "Identifier") {
              relationships.push({
                source: currentEntity,
                target: { name: ext.expression.name, type: "interface" },
                type: "extends"
              });
            }
          });
        }
        if (node.body) {
          visit(node.body, node, currentEntity, name);
        }
        break;
      }
      case "TypeAliasDeclaration": {
        const name = node.id?.name || "anonymous";
        currentEntity = createEntity(
          "type_alias",
          name,
          startPosition,
          endPosition,
          startLine,
          endLine,
          rawContent,
          parentEntity,
          {
            ast_node_type: node.type
          }
        );
        idMap.set(node, currentEntity);
        if (node.typeAnnotation) {
          visit(node.typeAnnotation, node, currentEntity, name);
        }
        break;
      }
      case "EnumDeclaration": {
        const name = node.id?.name || "anonymous";
        currentEntity = createEntity(
          "enum",
          name,
          startPosition,
          endPosition,
          startLine,
          endLine,
          rawContent,
          parentEntity,
          {
            ast_node_type: node.type
          }
        );
        idMap.set(node, currentEntity);
        if (node.members) {
          node.members.forEach((member) => {
            visit(member, node, currentEntity, name);
          });
        }
        break;
      }
      case "CallExpression": {
        if (parentEntity) {
          if (node.callee.type === "Identifier") {
            relationships.push({
              source: parentEntity,
              target: { name: node.callee.name, type: "function" },
              type: "calls"
            });
          } else if (node.callee.type === "MemberExpression") {
            if (node.callee.property && node.callee.property.type === "Identifier") {
              relationships.push({
                source: parentEntity,
                target: { name: node.callee.property.name, type: "method" },
                type: "calls",
                metadata: {
                  object: node.callee.object.type === "Identifier" ? node.callee.object.name : null
                }
              });
            }
          }
        }
        if (node.callee) {
          visit(node.callee, node, parentEntity, scope);
        }
        if (node.arguments) {
          node.arguments.forEach((arg) => {
            visit(arg, node, parentEntity, scope);
          });
        }
        break;
      }
      default: {
        for (const key in node) {
          const child = node[key];
          if (key === "type" || key === "loc" || key === "range" || key === "parent") {
            continue;
          }
          if (Array.isArray(child)) {
            for (const item of child) {
              visit(item, node, parentEntity || currentEntity, scope);
            }
          } else if (child && typeof child === "object") {
            visit(child, node, parentEntity || currentEntity, scope);
          }
        }
      }
    }
  }
  visit(ast);
  return { entities, relationships };
}
async function indexCodeFile(filePath, fileContent, languageHint) {
  try {
    const contentHash = calculateContentHash(fileContent);
    const filename = extractFilename(filePath);
    const language = detectLanguage(filePath, languageHint);
    const existingFileQuery = `
      SELECT entity_id, content_hash 
      FROM code_entities 
      WHERE file_path = ? AND entity_type = 'file'
    `;
    const existingFile = await executeQuery(existingFileQuery, [filePath]);
    let fileEntityId;
    if (existingFile && existingFile.length > 0) {
      fileEntityId = existingFile[0].entity_id;
      if (existingFile[0].content_hash === contentHash) {
        console.log(`File ${filePath} is unchanged, skipping indexing`);
        return;
      }
      await executeQuery(
        `
        UPDATE code_entities
        SET raw_content = ?, content_hash = ?, language = ?, last_modified_at = CURRENT_TIMESTAMP
        WHERE entity_id = ?
      `,
        [fileContent, contentHash, language, fileEntityId]
      );
      await executeQuery(
        `
        DELETE FROM code_entities
        WHERE parent_entity_id = ?
      `,
        [fileEntityId]
      );
      await executeQuery(
        `
        DELETE FROM entity_keywords
        WHERE entity_id = ?
      `,
        [fileEntityId]
      );
    } else {
      fileEntityId = uuidv42();
      await executeQuery(
        `
        INSERT INTO code_entities (
          entity_id, file_path, entity_type, name, content_hash, raw_content, language, created_at, last_modified_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
        [
          fileEntityId,
          filePath,
          "file",
          filename,
          contentHash,
          fileContent,
          language
        ]
      );
    }
    let codeEntities = [];
    let relationships = [];
    if (language === "javascript" || language === "typescript") {
      const ast = await buildAST(fileContent, language);
      if (ast && !ast.error) {
        const extracted = extractEntitiesFromAST(ast, fileContent);
        codeEntities = extracted.entities;
        relationships = extracted.relationships;
      } else {
        console.error(
          `Error building AST for ${filePath}:`,
          ast?.error || "Unknown error"
        );
        codeEntities = extractEntitiesWithRegex(fileContent, language);
      }
    } else {
      codeEntities = extractEntitiesWithRegex(fileContent, language);
    }
    for (const entity of codeEntities) {
      const entityId = uuidv42();
      const customMetadataJson = entity.custom_metadata ? JSON.stringify(entity.custom_metadata) : null;
      await executeQuery(
        `
        INSERT INTO code_entities (
          entity_id, parent_entity_id, file_path, entity_type, name, 
          start_line, end_line, raw_content, language, custom_metadata,
          created_at, last_modified_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
        [
          entityId,
          fileEntityId,
          // All sub-entities have the file as parent by default
          filePath,
          entity.type,
          entity.name,
          entity.start_line,
          entity.end_line,
          entity.raw_content,
          language,
          customMetadataJson
        ]
      );
      const tokens = tokenize(entity.raw_content);
      const keywords = extractKeywords(tokens, 20, language);
      for (const keyword of keywords) {
        await executeQuery(
          `
          INSERT INTO entity_keywords (
            entity_id, keyword, term_frequency, weight, keyword_type
          ) VALUES (?, ?, ?, ?, ?)
        `,
          [
            entityId,
            keyword.keyword,
            keyword.score || 1,
            keyword.score || 1,
            "term"
          ]
        );
      }
      entity.db_entity_id = entityId;
    }
    for (const rel of relationships) {
      if (!rel.source || !rel.target)
        continue;
      const sourceId = rel.source.db_entity_id;
      const targetId = rel.target.db_entity_id;
      if (rel.type === "contains" && sourceId && targetId) {
        await executeQuery(
          `
          UPDATE code_entities
          SET parent_entity_id = ?
          WHERE entity_id = ?
          `,
          [sourceId, targetId]
        );
      } else if (sourceId && targetId) {
        await addRelationship(
          sourceId,
          targetId,
          rel.type,
          1,
          rel.metadata || {}
        );
      } else if (sourceId && !targetId && rel.target.name) {
        const targetQuery = `
          SELECT entity_id 
          FROM code_entities 
          WHERE name = ? AND entity_type = ?
        `;
        const targetEntity = await executeQuery(targetQuery, [
          rel.target.name,
          rel.target.type
        ]);
        if (targetEntity && targetEntity.length > 0) {
          await addRelationship(
            sourceId,
            targetEntity[0].entity_id,
            rel.type,
            1,
            rel.metadata || {}
          );
        }
      }
    }
    console.log(`Successfully indexed file ${filePath}`);
  } catch (error) {
    console.error(`Error indexing file ${filePath}:`, error);
    throw error;
  }
}
async function indexConversationMessage(message) {
  try {
    if (!message.message_id || !message.conversation_id || !message.role || !message.content) {
      throw new Error("Message object missing required properties");
    }
    console.log("===== INDEX MESSAGE - START =====");
    console.log("Input parameters:");
    console.log("- message_id:", message.message_id);
    console.log("- conversation_id:", message.conversation_id);
    console.log("- role:", message.role);
    console.log(
      "- content:",
      message.content && message.content.substring(0, 50) + (message.content.length > 50 ? "..." : "")
    );
    console.log("- timestamp:", message.timestamp);
    const relatedContextEntityIds = message.relatedContextEntityIds ? message.relatedContextEntityIds : null;
    const semanticMarkers = message.semantic_markers ? message.semantic_markers : null;
    const sentimentIndicators = message.sentiment_indicators ? message.sentiment_indicators : null;
    const timestamp = message.timestamp instanceof Date ? message.timestamp.toISOString() : message.timestamp || (/* @__PURE__ */ new Date()).toISOString();
    const existingMessageQuery = `
      SELECT message_id FROM conversation_history 
      WHERE message_id = ?
    `;
    console.log("Checking if message exists:", message.message_id);
    const existingMessage = await executeQuery(existingMessageQuery, [
      message.message_id
    ]);
    console.log(
      "Existing message check result:",
      JSON.stringify(existingMessage)
    );
    if (existingMessage && existingMessage.rows && existingMessage.rows.length > 0) {
      console.log("Updating existing message:", message.message_id);
      try {
        const updateQuery = `UPDATE conversation_history 
         SET content = ?, 
             summary = ?, 
             user_intent = ?, 
             topic_segment_id = ?, 
             related_context_entity_ids = ?, 
             semantic_markers = ?, 
             sentiment_indicators = ?
         WHERE message_id = ?`;
        const updateParams = [
          message.content,
          message.summary || null,
          message.userIntent || null,
          message.topicSegmentId || null,
          relatedContextEntityIds,
          semanticMarkers,
          sentimentIndicators,
          message.message_id
        ];
        console.log("Update query parameters:", {
          message_id: message.message_id,
          content_length: message.content ? message.content.length : 0
        });
        const updateResult = await executeQuery(updateQuery, updateParams);
        console.log("Message update result:", JSON.stringify(updateResult));
      } catch (updateError) {
        console.error("Update error:", updateError);
        throw updateError;
      }
    } else {
      console.log("Inserting new message:", message.message_id);
      try {
        const insertQuery = `INSERT INTO conversation_history (
          message_id, 
          conversation_id, 
          role, 
          content, 
          timestamp, 
          summary, 
          user_intent, 
          topic_segment_id, 
          related_context_entity_ids, 
          semantic_markers, 
          sentiment_indicators
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const insertParams = [
          message.message_id,
          message.conversation_id,
          message.role,
          message.content,
          timestamp,
          message.summary || null,
          message.userIntent || null,
          message.topicSegmentId || null,
          relatedContextEntityIds,
          semanticMarkers,
          sentimentIndicators
        ];
        console.log("Insert query parameters:", {
          message_id: message.message_id,
          conversation_id: message.conversation_id,
          role: message.role,
          timestamp
        });
        const insertResult = await executeQuery(insertQuery, insertParams);
        console.log("Message insert result:", JSON.stringify(insertResult));
      } catch (insertError) {
        console.error("Insert error:", insertError);
        console.error("Error stack:", insertError.stack);
        throw insertError;
      }
    }
    const tokens = tokenize(message.content);
    const keywords = extractKeywords(tokens);
    console.log("===== INDEX MESSAGE - COMPLETE =====");
    console.log("Successfully indexed message:", message.message_id);
    return {
      messageId: message.message_id,
      keywords
    };
  } catch (error) {
    console.error("===== INDEX MESSAGE - ERROR =====");
    console.error(`Error indexing message ${message?.message_id}:`, error);
    console.error("Error stack:", error.stack);
    throw error;
  }
}

// src/logic/ConversationSegmenter.js
init_db();
import { v4 as uuidv43 } from "uuid";

// src/logic/ContextCompressorLogic.js
function manageTokenBudget(contextSnippets, budget, queryKeywords = []) {
  if (!contextSnippets || contextSnippets.length === 0) {
    return [];
  }
  const processedSnippets = [];
  let remainingBudget = budget;
  const totalScore = contextSnippets.reduce(
    (sum, snippet) => sum + snippet.score,
    0
  );
  const budgetAllocations = contextSnippets.map((snippet) => {
    return Math.max(100, Math.floor(snippet.score / totalScore * budget));
  });
  for (let i = 0; i < contextSnippets.length; i++) {
    const snippet = contextSnippets[i];
    const content = snippet.content || snippet.entity.raw_content || "";
    if (!content) {
      continue;
    }
    let snippetBudget = Math.min(budgetAllocations[i], remainingBudget);
    if (snippetBudget < 50) {
      continue;
    }
    if (content.length <= snippetBudget) {
      processedSnippets.push({
        entity_id: snippet.entity.entity_id,
        summarizedContent: content,
        originalScore: snippet.score
      });
      remainingBudget -= content.length;
    } else {
      let summarizedContent;
      if (snippet.entity.entity_type) {
        summarizedContent = summarizeCodeEntity(
          snippet.entity,
          snippetBudget,
          queryKeywords
        );
      } else {
        summarizedContent = summarizeText(content, snippetBudget);
      }
      if (summarizedContent) {
        processedSnippets.push({
          entity_id: snippet.entity.entity_id,
          summarizedContent,
          originalScore: snippet.score
        });
        remainingBudget -= summarizedContent.length;
      }
    }
    if (remainingBudget <= 50) {
      break;
    }
    if (i < contextSnippets.length - 1) {
      const remainingSnippets = contextSnippets.length - i - 1;
      const remainingScores = contextSnippets.slice(i + 1).reduce((sum, s) => sum + s.score, 0);
      for (let j = i + 1; j < contextSnippets.length; j++) {
        budgetAllocations[j] = Math.max(
          100,
          Math.floor(
            contextSnippets[j].score / remainingScores * remainingBudget
          )
        );
      }
    }
  }
  if (remainingBudget > 200 && processedSnippets.length > 0) {
    redistributeRemainingBudget(
      processedSnippets,
      contextSnippets,
      remainingBudget,
      queryKeywords
    );
  }
  return processedSnippets;
}
function redistributeRemainingBudget(processedSnippets, originalSnippets, remainingBudget, queryKeywords) {
  const processedMap = /* @__PURE__ */ new Map();
  processedSnippets.forEach((ps) => {
    processedMap.set(ps.entity_id, ps);
  });
  const snippetsToExpand = originalSnippets.filter((s) => processedMap.has(s.entity.entity_id)).sort((a, b) => b.score - a.score);
  const additionalBudgetPerSnippet = Math.floor(
    remainingBudget / snippetsToExpand.length
  );
  for (const snippet of snippetsToExpand) {
    const processedSnippet = processedMap.get(snippet.entity.entity_id);
    const currentLength = processedSnippet.summarizedContent.length;
    const newBudget = currentLength + additionalBudgetPerSnippet;
    const content = snippet.content || snippet.entity.raw_content || "";
    if (content.length <= newBudget) {
      processedSnippet.summarizedContent = content;
      remainingBudget -= content.length - currentLength;
    } else {
      let expandedContent;
      if (snippet.entity.entity_type) {
        expandedContent = summarizeCodeEntity(
          snippet.entity,
          newBudget,
          queryKeywords
        );
      } else {
        expandedContent = summarizeText(content, newBudget);
      }
      if (expandedContent && expandedContent.length > currentLength) {
        remainingBudget -= expandedContent.length - currentLength;
        processedSnippet.summarizedContent = expandedContent;
      }
    }
    if (remainingBudget < 100) {
      break;
    }
  }
}
function summarizeText(text, maxLength, method = "rule-based") {
  if (!text)
    return "";
  if (text.length <= maxLength)
    return text;
  if (method === "ml-light") {
    console.log(
      "ML-light summarization not fully implemented, falling back to rule-based method"
    );
    method = "rule-based";
  }
  return ruleBased(text, maxLength);
}
function summarizeCodeEntity(entity, budget, queryKeywords = []) {
  if (!entity)
    return "";
  if (entity.summary && entity.summary.length <= budget) {
    return entity.summary;
  }
  if (!entity.raw_content) {
    return `${entity.name} (${entity.entity_type})`;
  }
  if (entity.raw_content.length <= budget) {
    return entity.raw_content;
  }
  const entityType = (entity.entity_type || "").toLowerCase();
  switch (entityType) {
    case "function":
    case "method":
      return summarizeFunction(entity, budget, queryKeywords);
    case "class":
      return summarizeClass(entity, budget, queryKeywords);
    case "file":
      return summarizeFile(entity, budget, queryKeywords);
    default:
      return summarizeText(entity.raw_content, budget);
  }
}
function summarizeFunction(entity, budget, queryKeywords) {
  const content = entity.raw_content;
  const lines = content.split("\n");
  const signatureLine = extractFunctionSignature(lines);
  if (signatureLine.length >= budget - 10) {
    return truncateToMaxLength(signatureLine, budget);
  }
  const scoredLines = scoreCodeLines(lines, queryKeywords, "function");
  let summary = signatureLine;
  let remainingBudget = budget - signatureLine.length;
  const commentBlock = extractCommentBlock(lines);
  if (commentBlock && commentBlock.length < remainingBudget * 0.4) {
    summary += "\n" + commentBlock;
    remainingBudget -= commentBlock.length;
  }
  summary += "\n" + selectImportantLines(scoredLines, remainingBudget);
  return truncateToMaxLength(summary, budget);
}
function summarizeClass(entity, budget, queryKeywords) {
  const content = entity.raw_content;
  const lines = content.split("\n");
  const classSignature = extractClassSignature(lines);
  const methodList = extractMethodList(lines);
  let summary = classSignature;
  let remainingBudget = budget - classSignature.length;
  if (methodList && methodList.length < remainingBudget) {
    summary += "\n" + methodList;
    remainingBudget -= methodList.length;
  }
  if (remainingBudget > 50) {
    const scoredLines = scoreCodeLines(lines, queryKeywords, "class");
    summary += "\n" + selectImportantLines(scoredLines, remainingBudget);
  }
  return truncateToMaxLength(summary, budget);
}
function summarizeFile(entity, budget, queryKeywords) {
  const content = entity.raw_content;
  const lines = content.split("\n");
  const isDocFile = (entity.name || "").toLowerCase().includes("readme") || (entity.name || "").toLowerCase().includes("doc");
  if (isDocFile) {
    return summarizeText(content, budget);
  }
  const importStatements = lines.filter(
    (line) => line.trim().startsWith("import ") || line.trim().startsWith("require(") || line.trim().startsWith("from ") || line.trim().includes(" from ")
  ).join("\n");
  const exportStatements = lines.filter(
    (line) => line.trim().startsWith("export ") || line.trim().startsWith("module.exports")
  ).join("\n");
  let summary = `// File: ${entity.name || "Unnamed"}
`;
  if (importStatements && importStatements.length < budget * 0.3) {
    summary += `// Imports:
${importStatements}
`;
  }
  const remainingAfterImports = budget - summary.length;
  if (exportStatements && exportStatements.length < remainingAfterImports * 0.3) {
    summary += `// Exports:
${exportStatements}
`;
  }
  const remainingBudget = budget - summary.length;
  if (remainingBudget > 100) {
    const scoredLines = scoreCodeLines(lines, queryKeywords, "file");
    summary += `// Key sections:
${selectImportantLines(
      scoredLines,
      remainingBudget
    )}`;
  }
  return truncateToMaxLength(summary, budget);
}
function extractFunctionSignature(lines) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.match(
      /^(async\s+)?(function\s+\w+|\w+\s*=\s*(async\s+)?function|\w+\s*:\s*(async\s+)?function|const\s+\w+\s*=\s*(async\s+)?(\([^)]*\)|[^=]*)\s*=>)/
    )) {
      let signature = line;
      if (!line.includes("{") && !line.includes("=>")) {
        let j = i + 1;
        while (j < lines.length && !lines[j].includes("{")) {
          signature += " " + lines[j].trim();
          j++;
        }
        if (j < lines.length) {
          signature += " " + lines[j].trim().split("{")[0] + "{ ... }";
        }
      } else if (line.includes("{")) {
        signature = signature.split("{")[0] + "{ ... }";
      } else if (line.includes("=>")) {
        const arrowParts = signature.split("=>");
        signature = arrowParts[0] + "=> { ... }";
      }
      return signature;
    }
  }
  return "function() { ... }";
}
function extractClassSignature(lines) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("class ")) {
      let signature = line;
      if (!line.includes("{")) {
        let j = i + 1;
        while (j < lines.length && !lines[j].includes("{")) {
          signature += " " + lines[j].trim();
          j++;
        }
        if (j < lines.length) {
          signature += " " + lines[j].trim().split("{")[0] + "{ ... }";
        }
      } else {
        signature = signature.split("{")[0] + "{ ... }";
      }
      return signature;
    }
  }
  return "class { ... }";
}
function extractMethodList(lines) {
  const methods = [];
  const methodRegex = /^\s*(async\s+)?(\w+)\s*\([^)]*\)/;
  const startFromLine = Math.min(5, lines.length);
  for (let i = startFromLine; i < lines.length; i++) {
    const match = lines[i].match(methodRegex);
    if (match && !lines[i].trim().startsWith("//")) {
      methods.push(match[2]);
    }
  }
  if (methods.length === 0) {
    return "";
  }
  return `// Methods: ${methods.join(", ")}`;
}
function extractCommentBlock(lines) {
  let inComment = false;
  let commentLines = [];
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    const line = lines[i].trim();
    if (line.startsWith("/**")) {
      inComment = true;
      commentLines.push(line);
      continue;
    }
    if (inComment) {
      commentLines.push(line);
      if (line.endsWith("*/")) {
        break;
      }
    }
    if (!inComment && commentLines.length === 0 && line.startsWith("//")) {
      commentLines.push(line);
    } else if (!inComment && commentLines.length > 0 && line.startsWith("//")) {
      commentLines.push(line);
    } else if (!inComment && commentLines.length > 0) {
      break;
    }
  }
  return commentLines.join("\n");
}
function scoreCodeLines(lines, queryKeywords, entityType) {
  const scoredLines = [];
  const importantPatterns = {
    function: [
      /\breturn\s+/,
      // Return statements
      /\bthrow\s+/,
      // Error handling
      /\bif\s*\(/,
      // Conditionals
      /\bfor\s*\(/,
      // Loops
      /\bcatch\s*\(/,
      // Error catching
      /\bswitch\s*\(/,
      // Switch statements
      /\bconst\s+\w+\s*=/,
      // Important variable declarations
      /\blet\s+\w+\s*=/,
      // Variable declarations
      /\/\/ [A-Z]/
      // Comments that start with capital letters (likely important)
    ],
    class: [
      /\bconstructor\s*\(/,
      // Constructor
      /\bstatic\s+/,
      // Static methods/properties
      /\bget\s+\w+\s*\(/,
      // Getters
      /\bset\s+\w+\s*\(/,
      // Setters
      /\bextends\s+/,
      // Inheritance
      /\bimplements\s+/,
      // Interface implementation
      /\breturn\s+/
      // Return statements
    ],
    file: [
      /\bexport\s+(default\s+)?function\s+/,
      // Exported functions
      /\bexport\s+(default\s+)?class\s+/,
      // Exported classes
      /\bexport\s+(default\s+)?const\s+/,
      // Exported constants
      /\bmodule\.exports\s*=/,
      // CommonJS exports
      /\bimport\s+/,
      // Imports
      /\brequire\s*\(/
      // Requires
    ]
  };
  const commonPatterns = [
    /\/\/ TODO:/,
    // TODOs
    /\/\/ FIXME:/,
    // FIXMEs
    /\/\/ NOTE:/,
    // Notes
    /\/\*\*/
    // JSDoc comments
  ];
  const patterns = [
    ...importantPatterns[entityType] || [],
    ...commonPatterns
  ];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line)
      continue;
    let score = 0;
    if (queryKeywords.length > 0) {
      const tokens = tokenize(line, { includeIdentifiers: true });
      const keywordMatches = queryKeywords.filter(
        (keyword) => tokens.includes(keyword.toLowerCase()) || line.toLowerCase().includes(keyword.toLowerCase())
      );
      score += keywordMatches.length * 3;
    }
    for (const pattern of patterns) {
      if (pattern.test(line)) {
        score += 2;
        break;
      }
    }
    if (i < 5) {
      score += 1;
    }
    if (line.includes("{") || line.includes("}")) {
      score += 0.5;
    }
    scoredLines.push({
      line,
      score,
      index: i
    });
  }
  return scoredLines.sort((a, b) => b.score - a.score);
}
function selectImportantLines(scoredLines, budget) {
  const selectedLines = [];
  let usedBudget = 0;
  const highScoreLines = scoredLines.filter((item) => item.score >= 3);
  for (const item of highScoreLines) {
    if (usedBudget + item.line.length + 1 <= budget) {
      selectedLines.push(item);
      usedBudget += item.line.length + 1;
    }
  }
  if (usedBudget < budget) {
    const remainingLines = scoredLines.filter((item) => item.score < 3).sort((a, b) => b.score - a.score);
    for (const item of remainingLines) {
      if (usedBudget + item.line.length + 1 <= budget) {
        selectedLines.push(item);
        usedBudget += item.line.length + 1;
      }
    }
  }
  selectedLines.sort((a, b) => a.index - b.index);
  return selectedLines.map((item) => item.line).join("\n");
}
function ruleBased(text, maxLength) {
  const sentences = splitIntoSentences(text);
  if (sentences.length <= 3) {
    return truncateToMaxLength(text, maxLength);
  }
  const scoredSentences = sentences.map((sentence, index) => ({
    text: sentence,
    score: scoreSentence(sentence, index, sentences.length),
    index
  }));
  scoredSentences.sort((a, b) => b.score - a.score);
  const selectedSentences = [];
  let currentLength = 0;
  for (const scored of scoredSentences) {
    if (currentLength + scored.text.length + 1 <= maxLength) {
      selectedSentences.push(scored);
      currentLength += scored.text.length + 1;
    } else {
      if (selectedSentences.length === 0) {
        return truncateToMaxLength(scored.text, maxLength);
      }
      break;
    }
  }
  selectedSentences.sort((a, b) => a.index - b.index);
  const summary = selectedSentences.map((s) => s.text).join(" ");
  return truncateToMaxLength(summary, maxLength);
}
function splitIntoSentences(text) {
  const sentenceRegex = /[^.!?]*[.!?](?:\s|$)/g;
  const matches = text.match(sentenceRegex);
  if (!matches) {
    return [text];
  }
  return matches.map((s) => s.trim()).filter((s) => s.length > 0);
}
function scoreSentence(sentence, index, totalSentences) {
  let score = 0;
  if (index === 0) {
    score += 3;
  } else if (index === totalSentences - 1) {
    score += 2;
  } else if (index === 1 || index === totalSentences - 2) {
    score += 1;
  }
  const wordCount = sentence.split(/\s+/).length;
  if (wordCount >= 5 && wordCount <= 20) {
    score += 1;
  } else if (wordCount < 3 || wordCount > 30) {
    score -= 1;
  }
  const importantPhrases = [
    "key",
    "important",
    "significant",
    "critical",
    "essential",
    "main",
    "primary",
    "crucial",
    "fundamental",
    "vital",
    "result",
    "conclude",
    "summary",
    "therefore",
    "thus",
    "implement",
    "function",
    "method",
    "class",
    "object",
    "return",
    "export",
    "import",
    "require",
    "define"
  ];
  const lowerSentence = sentence.toLowerCase();
  for (const phrase of importantPhrases) {
    if (lowerSentence.includes(phrase)) {
      score += 1;
      break;
    }
  }
  if (lowerSentence.includes("function") || lowerSentence.includes("class") || lowerSentence.includes("=") || lowerSentence.includes("return") || sentence.includes("()") || sentence.includes("{}") || sentence.includes("[]")) {
    score += 2;
  }
  return score;
}
function truncateToMaxLength(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }
  for (let i = maxLength - 1; i >= 0; i--) {
    if (text[i] === "." || text[i] === "!" || text[i] === "?") {
      return text.substring(0, i + 1);
    }
  }
  for (let i = maxLength - 1; i >= 0; i--) {
    if (text[i] === " ") {
      return text.substring(0, i) + "...";
    }
  }
  return text.substring(0, maxLength - 3) + "...";
}
async function compressContext(contextItems, options = {}) {
  if (!contextItems || contextItems.length === 0) {
    return [];
  }
  const detailLevel = options.detailLevel || "medium";
  const targetTokens = options.targetTokens || 2e3;
  const queryKeywords = options.queryKeywords || [];
  const tokensPerChar = 1 / 6;
  const charBudget = Math.floor(targetTokens / tokensPerChar);
  const scoredSnippets = contextItems.map((item) => ({
    entity: {
      entity_id: item.entity_id,
      entity_type: item.type,
      raw_content: item.content,
      name: item.name,
      file_path: item.path
    },
    score: item.relevanceScore || 0.5,
    content: item.content
  }));
  let modifiedBudget = charBudget;
  switch (detailLevel) {
    case "high":
      modifiedBudget = Math.floor(charBudget * 1.3);
      break;
    case "low":
      modifiedBudget = Math.floor(charBudget * 0.7);
      break;
    default:
      break;
  }
  const processedSnippets = manageTokenBudget(
    scoredSnippets,
    modifiedBudget,
    queryKeywords
  );
  return processedSnippets.map((processed) => {
    const originalItem = contextItems.find(
      (item) => item.entity_id === processed.entity_id
    );
    if (!originalItem)
      return null;
    return {
      ...originalItem,
      content: processed.summarizedContent,
      // Add compression metadata
      compression: {
        originalLength: originalItem.content.length,
        compressedLength: processed.summarizedContent.length,
        compressionRatio: processed.summarizedContent.length / originalItem.content.length,
        detailLevel
      }
    };
  }).filter(Boolean);
}

// src/logic/ConversationSegmenter.js
var TOPIC_SHIFT_MARKERS = [
  "anyway",
  "moving on",
  "changing subject",
  "regarding",
  "switching to",
  "on another note",
  "back to",
  "speaking of",
  "about",
  "let's talk about",
  "with respect to",
  "turning to",
  "shifting to",
  "let's discuss",
  "instead"
];
var QUESTION_STARTERS = [
  "what",
  "how",
  "why",
  "can",
  "could",
  "would",
  "should",
  "is",
  "are",
  "do",
  "does",
  "did",
  "have",
  "has",
  "will"
];
async function detectTopicShift(newMessage, conversationHistory) {
  try {
    if (!newMessage?.content || !conversationHistory || conversationHistory.length === 0) {
      return false;
    }
    const recentHistory = conversationHistory.slice(-5);
    const keywordNoveltyScore = calculateKeywordNovelty(
      newMessage,
      recentHistory
    );
    const entityShiftScore = calculateEntityShift(newMessage, recentHistory);
    const hasConversationalMarkers = detectConversationalMarkers(
      newMessage.content
    );
    const questionShiftScore = detectQuestionAnswerShift(
      newMessage,
      recentHistory
    );
    const topicShiftScore = keywordNoveltyScore * 0.4 + entityShiftScore * 0.3 + (hasConversationalMarkers ? 0.8 : 0) * 0.2 + questionShiftScore * 0.1;
    return topicShiftScore > 0.45;
  } catch (error) {
    console.error("Error detecting topic shift:", error);
    return false;
  }
}
function calculateKeywordNovelty(newMessage, recentHistory) {
  const newTokens = tokenize(newMessage.content);
  const newKeywords = extractKeywords(newTokens, 10);
  const newKeywordSet = new Set(newKeywords);
  if (newKeywordSet.size === 0) {
    return 0;
  }
  const historyKeywordSet = /* @__PURE__ */ new Set();
  for (const message of recentHistory) {
    const historyTokens = tokenize(message.content);
    const historyKeywords = extractKeywords(
      historyTokens,
      10
    );
    historyKeywords.forEach((keyword) => historyKeywordSet.add(keyword));
  }
  let novelKeywordCount = 0;
  for (const keyword of newKeywordSet) {
    if (!historyKeywordSet.has(keyword)) {
      novelKeywordCount++;
    }
  }
  return novelKeywordCount / newKeywordSet.size;
}
function calculateEntityShift(newMessage, recentHistory) {
  if (!newMessage.entity_ids || !Array.isArray(newMessage.entity_ids) || newMessage.entity_ids.length === 0) {
    return 0;
  }
  const historyEntitySet = /* @__PURE__ */ new Set();
  for (const message of recentHistory) {
    if (message.entity_ids && Array.isArray(message.entity_ids)) {
      message.entity_ids.forEach((id) => historyEntitySet.add(id));
    }
  }
  if (historyEntitySet.size === 0) {
    return newMessage.entity_ids.length > 0 ? 1 : 0;
  }
  let newEntityCount = 0;
  for (const entityId of newMessage.entity_ids) {
    if (!historyEntitySet.has(entityId)) {
      newEntityCount++;
    }
  }
  return newEntityCount / newMessage.entity_ids.length;
}
function detectConversationalMarkers(messageContent) {
  if (!messageContent)
    return false;
  const lowerContent = messageContent.toLowerCase();
  for (const marker of TOPIC_SHIFT_MARKERS) {
    const regex = new RegExp(`\\b${marker}\\b`, "i");
    if (regex.test(lowerContent)) {
      return true;
    }
  }
  return false;
}
function detectQuestionAnswerShift(newMessage, recentHistory) {
  const isNewMessageQuestion = isQuestion(newMessage.content);
  if (!isNewMessageQuestion) {
    return 0;
  }
  let previousQuestionCount = 0;
  let questionAnswerPairCount = 0;
  for (let i = 0; i < recentHistory.length - 1; i++) {
    if (recentHistory[i].role === "user" && isQuestion(recentHistory[i].content)) {
      previousQuestionCount++;
      if (i + 1 < recentHistory.length && recentHistory[i + 1].role === "assistant") {
        questionAnswerPairCount++;
      }
    }
  }
  if (previousQuestionCount > 0 && questionAnswerPairCount > 0) {
    const lastUserQuestionIndex = findLastIndex(
      recentHistory,
      (msg) => msg.role === "user" && isQuestion(msg.content)
    );
    if (lastUserQuestionIndex >= 0) {
      const lastUserQuestion = recentHistory[lastUserQuestionIndex].content;
      return calculateQuestionDifference(newMessage.content, lastUserQuestion);
    }
  }
  return 0.2;
}
function isQuestion(content) {
  if (!content)
    return false;
  if (content.includes("?")) {
    return true;
  }
  const lowerContent = content.toLowerCase().trim();
  for (const starter of QUESTION_STARTERS) {
    if (lowerContent.startsWith(starter + " ")) {
      return true;
    }
  }
  return false;
}
function calculateQuestionDifference(newQuestion, previousQuestion) {
  const newTokens = tokenize(newQuestion);
  const prevTokens = tokenize(previousQuestion);
  const newSet = new Set(newTokens);
  const prevSet = new Set(prevTokens);
  let intersectionSize = 0;
  for (const token of newSet) {
    if (prevSet.has(token)) {
      intersectionSize++;
    }
  }
  const unionSize = newSet.size + prevSet.size - intersectionSize;
  const similarity = unionSize > 0 ? intersectionSize / unionSize : 0;
  return 1 - similarity;
}
function findLastIndex(array, predicate) {
  for (let i = array.length - 1; i >= 0; i--) {
    if (predicate(array[i])) {
      return i;
    }
  }
  return -1;
}
async function createNewTopicSegment(conversationId, startMessageId, topicInfo = {}) {
  try {
    const topic_id = uuidv43();
    let topic_name = topicInfo.name;
    if (!topic_name) {
      topic_name = `New Topic ${(/* @__PURE__ */ new Date()).toISOString()}`;
      try {
        const messageQuery = "SELECT content FROM conversation_history WHERE message_id = ?";
        const messageResult = await executeQuery(messageQuery, [
          startMessageId
        ]);
        if (messageResult && messageResult.length > 0) {
          const content = messageResult[0].content;
          const words = content.split(/\s+/).slice(0, 5).join(" ");
          if (words.length > 3) {
            topic_name = `Topic: ${words}${words.length < content.length ? "..." : ""}`;
          }
        }
      } catch (error) {
        console.warn(
          "Could not fetch message content for topic naming:",
          error
        );
      }
    }
    const primary_entities = topicInfo.primaryEntities ? JSON.stringify(topicInfo.primaryEntities) : "[]";
    const keywords = topicInfo.keywords ? JSON.stringify(topicInfo.keywords) : "[]";
    const start_timestamp = (/* @__PURE__ */ new Date()).toISOString();
    await executeQuery("PRAGMA foreign_keys = OFF;");
    const insertQuery = `
      INSERT INTO conversation_topics (
        topic_id,
        conversation_id,
        topic_name,
        description,
        start_message_id,
        start_timestamp,
        primary_entities,
        keywords
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      topic_id,
      conversationId,
      topic_name,
      topicInfo.description || "",
      startMessageId,
      start_timestamp,
      primary_entities,
      keywords
    ];
    await executeQuery(insertQuery, params);
    await executeQuery("PRAGMA foreign_keys = ON;");
    console.log(`Created new topic segment: ${topic_name} (${topic_id})`);
    return topic_id;
  } catch (error) {
    console.error("Error creating new topic segment:", error);
    throw new Error(`Failed to create new topic segment: ${error.message}`);
  }
}
async function buildTopicHierarchy(conversationId) {
  try {
    const query = `
      SELECT * FROM conversation_topics
      WHERE conversation_id = ?
      ORDER BY start_timestamp ASC
    `;
    const topics = await executeQuery(query, [conversationId]);
    if (!topics || topics.length === 0) {
      return { rootTopics: [], topicMap: {} };
    }
    const topicMap = {};
    for (const topic of topics) {
      try {
        topic.primary_entities = topic.primary_entities ? JSON.parse(topic.primary_entities) : [];
        topic.keywords = topic.keywords ? JSON.parse(topic.keywords) : [];
        topic.children = [];
        topicMap[topic.topic_id] = topic;
      } catch (jsonError) {
        console.warn(
          `Error parsing JSON fields for topic ${topic.topic_id}:`,
          jsonError
        );
        topic.primary_entities = [];
        topic.keywords = [];
        topic.children = [];
        topicMap[topic.topic_id] = topic;
      }
    }
    const rootTopics = [];
    for (const topic of topics) {
      if (topic.parent_topic_id && topicMap[topic.parent_topic_id]) {
        topicMap[topic.parent_topic_id].children.push(topic);
      } else {
        rootTopics.push(topic);
      }
    }
    return { rootTopics, topicMap };
  } catch (error) {
    console.error(
      `Error building topic hierarchy for conversation ${conversationId}:`,
      error
    );
    throw new Error(`Failed to build topic hierarchy: ${error.message}`);
  }
}

// src/logic/ConversationPurposeDetector.js
init_db();
import { v4 as uuidv44 } from "uuid";
var PURPOSE_TYPES = {
  debugging: {
    keywords: [
      "error",
      "stacktrace",
      "bug",
      "fix",
      "not working",
      "exception",
      "issue",
      "failed",
      "failing",
      "crash",
      "debug",
      "broken",
      "incorrect",
      "problem",
      "trouble",
      "unexpected",
      "diagnose",
      "investigate"
    ],
    patterns: [
      /TypeError:/i,
      /Error:/i,
      /Exception:/i,
      /failed with/i,
      /doesn't work/i,
      /not working/i,
      /unexpected behavior/i
    ],
    weight: 1
  },
  feature_planning: {
    keywords: [
      "requirement",
      "design",
      "new feature",
      "implement",
      "proposal",
      "roadmap",
      "spec",
      "specification",
      "plan",
      "architecture",
      "blueprint",
      "feature",
      "enhancement",
      "improvement",
      "add",
      "create",
      "develop",
      "extend"
    ],
    patterns: [
      /could we add/i,
      /we need to implement/i,
      /design for/i,
      /planning to/i,
      /we should build/i,
      /requirement is to/i
    ],
    weight: 0.9
  },
  code_review: {
    keywords: [
      "PR",
      "pull request",
      "LGTM",
      "suggestion",
      "change request",
      "review",
      "approve",
      "feedback",
      "comment",
      "revision",
      "looks good",
      "merge",
      "style",
      "convention",
      "readability",
      "clarity"
    ],
    patterns: [
      /pull request #\d+/i,
      /PR #\d+/i,
      /please review/i,
      /looks good to me/i,
      /suggested changes/i,
      /can you review/i
    ],
    weight: 0.85
  },
  learning: {
    keywords: [
      "learn",
      "understand",
      "explanation",
      "tutorial",
      "example",
      "how does",
      "what is",
      "meaning",
      "concept",
      "definition",
      "help me understand",
      "documentation",
      "guide",
      "explain",
      "clarify",
      "teach"
    ],
    patterns: [
      /how does (it|this) work/i,
      /what (is|does|are)/i,
      /could you explain/i,
      /I'm trying to understand/i,
      /explain how/i
    ],
    weight: 0.8
  },
  code_generation: {
    keywords: [
      "generate",
      "create",
      "build",
      "write",
      "implement",
      "code for",
      "function",
      "class",
      "method",
      "module",
      "script",
      "algorithm",
      "solution"
    ],
    patterns: [
      /can you (write|create|generate)/i,
      /implement a/i,
      /create a function/i,
      /generate code for/i,
      /need code to/i
    ],
    weight: 0.9
  },
  optimization: {
    keywords: [
      "optimize",
      "performance",
      "efficiency",
      "slow",
      "faster",
      "speed up",
      "reduce",
      "improve",
      "bottleneck",
      "memory",
      "CPU",
      "utilization",
      "profiling",
      "benchmark"
    ],
    patterns: [
      /too slow/i,
      /needs to be faster/i,
      /performance issue/i,
      /optimize for/i,
      /reduce (memory|time|usage)/i
    ],
    weight: 0.85
  },
  refactoring: {
    keywords: [
      "refactor",
      "restructure",
      "rewrite",
      "reorganize",
      "clean up",
      "improve",
      "modernize",
      "update",
      "simplify",
      "decouple",
      "modularity",
      "readability"
    ],
    patterns: [
      /need to refactor/i,
      /code smells/i,
      /technical debt/i,
      /simplify the code/i,
      /make it more maintainable/i
    ],
    weight: 0.8
  },
  general_query: {
    keywords: [
      "question",
      "ask",
      "wondering",
      "curious",
      "thoughts",
      "opinion",
      "advice",
      "suggestion",
      "recommend",
      "help",
      "guidance"
    ],
    patterns: [
      /I have a question/i,
      /can you help/i,
      /what do you think/i,
      /do you have any advice/i
    ],
    weight: 0.7
    // Lower weight as this is the default fallback
  }
};
async function detectConversationPurpose(messages) {
  try {
    if (!messages || messages.length === 0) {
      return { purposeType: "general_query", confidence: 0.5 };
    }
    let concatenatedContent = "";
    const userMessages = messages.filter((msg) => msg.role === "user");
    if (userMessages.length > 0) {
      concatenatedContent = userMessages.map((msg) => msg.content).join(" ");
    } else {
      concatenatedContent = messages.map((msg) => msg.content).join(" ");
    }
    const tokens = tokenize(concatenatedContent);
    const extractedKeywords = extractKeywords(tokens, 20);
    const purposeScores = {};
    for (const [purposeType, purposeData] of Object.entries(PURPOSE_TYPES)) {
      let score = 0;
      for (const keyword of purposeData.keywords) {
        if (concatenatedContent.toLowerCase().includes(keyword.toLowerCase())) {
          score += 1;
        }
        if (extractedKeywords.some(
          (k) => typeof k === "string" && k.toLowerCase() === keyword.toLowerCase()
        )) {
          score += 2;
        }
      }
      for (const pattern of purposeData.patterns) {
        if (pattern.test(concatenatedContent)) {
          score += 3;
        }
      }
      score *= purposeData.weight;
      purposeScores[purposeType] = score;
    }
    let highestScore = 0;
    let detectedPurpose = "general_query";
    for (const [purposeType, score] of Object.entries(purposeScores)) {
      if (score > highestScore) {
        highestScore = score;
        detectedPurpose = purposeType;
      }
    }
    const maxPossibleScore = PURPOSE_TYPES[detectedPurpose].keywords.length * 3 + // Max keyword match score
    PURPOSE_TYPES[detectedPurpose].patterns.length * 3;
    let confidence = 0.3 + 0.7 * (highestScore / (maxPossibleScore * PURPOSE_TYPES[detectedPurpose].weight));
    confidence = Math.min(confidence, 1);
    if (highestScore < 3 && detectedPurpose !== "general_query") {
      return { purposeType: "general_query", confidence: 0.6 };
    }
    return { purposeType: detectedPurpose, confidence };
  } catch (error) {
    console.error("Error detecting conversation purpose:", error);
    return { purposeType: "general_query", confidence: 0.5 };
  }
}
async function getActivePurpose(conversationId) {
  try {
    const query = `
      SELECT * FROM conversation_purposes
      WHERE conversation_id = ?
        AND end_timestamp IS NULL
      ORDER BY start_timestamp DESC
      LIMIT 1
    `;
    const result = await executeQuery(query, [conversationId]);
    const rows = result && result.rows && Array.isArray(result.rows) ? result.rows : Array.isArray(result) ? result : [];
    if (rows.length === 0) {
      return null;
    }
    return rows[0];
  } catch (error) {
    console.error(
      `Error getting active purpose for conversation ${conversationId}:`,
      error
    );
    throw new Error(`Failed to get active purpose: ${error.message}`);
  }
}
async function trackPurposeTransition(conversationId, newPurposeType, confidence) {
  try {
    const activePurpose = await getActivePurpose(conversationId);
    if (activePurpose && activePurpose.purpose_type !== newPurposeType) {
      const currentTime = (/* @__PURE__ */ new Date()).toISOString();
      const updateQuery = `
        UPDATE conversation_purposes
        SET end_timestamp = ?
        WHERE purpose_id = ?
      `;
      await executeQuery(updateQuery, [currentTime, activePurpose.purpose_id]);
      console.log(
        `Closed purpose ${activePurpose.purpose_type} for conversation ${conversationId}`
      );
    } else if (activePurpose && activePurpose.purpose_type === newPurposeType) {
      return activePurpose.purpose_id;
    }
    const purpose_id = uuidv44();
    const start_timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const insertQuery = `
      INSERT INTO conversation_purposes (
        purpose_id,
        conversation_id,
        purpose_type,
        confidence,
        start_timestamp
      ) VALUES (?, ?, ?, ?, ?)
    `;
    const params = [
      purpose_id,
      conversationId,
      newPurposeType,
      confidence,
      start_timestamp
    ];
    await executeQuery(insertQuery, params);
    console.log(
      `Created new purpose record: ${newPurposeType} (${purpose_id}) for conversation ${conversationId}`
    );
    return purpose_id;
  } catch (error) {
    console.error(
      `Error tracking purpose transition for conversation ${conversationId}:`,
      error
    );
    throw new Error(`Failed to track purpose transition: ${error.message}`);
  }
}
async function detectInitialPurpose(conversationId, initialQuery) {
  try {
    const message = {
      content: initialQuery,
      role: "user"
    };
    const result = await detectConversationPurpose([message]);
    if (!result || !result.purposeType) {
      result.purposeType = "general_query";
      result.confidence = 0.5;
    }
    try {
      await trackPurposeTransition(
        conversationId,
        result.purposeType,
        result.confidence
      );
      console.log(
        `Initial purpose for conversation ${conversationId}: ${result.purposeType} (${result.confidence})`
      );
    } catch (trackingError) {
      console.error("Error tracking purpose transition:", trackingError);
      console.log(
        "Continuing with initialization despite purpose tracking error"
      );
    }
    return result;
  } catch (error) {
    console.error("Error detecting initial purpose:", error);
    return {
      purposeType: "general_query",
      confidence: 0.5
    };
  }
}
async function setActivePurpose(conversationId, purposeType, confidence) {
  try {
    if (!conversationId) {
      throw new Error("Conversation ID is required");
    }
    if (!purposeType) {
      throw new Error("Purpose type is required");
    }
    confidence = Math.max(0, Math.min(1, confidence));
    const query1 = `
      UPDATE conversation_purposes
      SET end_timestamp = ?
      WHERE conversation_id = ? AND end_timestamp IS NULL
    `;
    await executeQuery(query1, [(/* @__PURE__ */ new Date()).toISOString(), conversationId]);
    const purposeId = uuidv44();
    const startTimestamp = (/* @__PURE__ */ new Date()).toISOString();
    const query2 = `
      INSERT INTO conversation_purposes (
        purpose_id,
        conversation_id,
        purpose_type,
        confidence,
        start_timestamp,
        end_timestamp
      ) VALUES (?, ?, ?, ?, ?, NULL)
    `;
    await executeQuery(query2, [
      purposeId,
      conversationId,
      purposeType,
      confidence,
      startTimestamp
    ]);
    console.log(
      `Set active purpose for conversation ${conversationId} to ${purposeType} (${confidence})`
    );
  } catch (error) {
    console.error("Error setting active purpose:", error);
    throw new Error("Failed to set active purpose: " + error.message);
  }
}

// src/logic/ConversationIntelligence.js
async function recordMessage(messageContent, role, conversationId, relatedContextEntityIds = [], topicSegmentId) {
  try {
    const message_id = uuidv45();
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    console.log("===== RECORD MESSAGE - START =====");
    console.log("Input parameters:");
    console.log("- message_id:", message_id);
    console.log("- conversation_id:", conversationId);
    console.log("- role:", role);
    console.log(
      "- content:",
      messageContent && messageContent.substring(0, 50) + (messageContent.length > 50 ? "..." : "")
    );
    console.log("- timestamp:", timestamp);
    console.log("- topic_segment_id:", topicSegmentId || "null");
    console.log(
      "- related_context_entity_ids:",
      JSON.stringify(relatedContextEntityIds || [])
    );
    let semantic_markers = [];
    if (role === "user" && identifyLanguageSpecificIdioms) {
      semantic_markers = identifyLanguageSpecificIdioms(
        messageContent,
        "plaintext"
      ) || [];
    } else {
      if (messageContent.includes("!"))
        semantic_markers.push("emphasis");
      if (messageContent.includes("?"))
        semantic_markers.push("question");
    }
    const positiveKeywords = [
      "great",
      "good",
      "excellent",
      "awesome",
      "love",
      "like",
      "well done",
      "thanks",
      "thank you",
      "perfect",
      "amazing",
      "fantastic",
      "nice",
      "happy",
      "success",
      "yay"
    ];
    const negativeKeywords = [
      "bad",
      "error",
      "fail",
      "hate",
      "problem",
      "issue",
      "bug",
      "broken",
      "wrong",
      "difficult",
      "hard",
      "annoy",
      "frustrate",
      "sad",
      "unhappy",
      "disappoint",
      "no",
      "not working",
      "doesn't work",
      "crash",
      "stuck"
    ];
    const foundPositive = positiveKeywords.filter(
      (kw) => messageContent.toLowerCase().includes(kw)
    );
    const foundNegative = negativeKeywords.filter(
      (kw) => messageContent.toLowerCase().includes(kw)
    );
    const sentiment_indicators = {
      positive_keywords: foundPositive,
      negative_keywords: foundNegative
    };
    const messageObject = {
      message_id,
      conversation_id: conversationId,
      role,
      content: messageContent,
      timestamp,
      relatedContextEntityIds: JSON.stringify(relatedContextEntityIds || []),
      summary: null,
      userIntent: null,
      topicSegmentId: topicSegmentId || null,
      semantic_markers: JSON.stringify(semantic_markers),
      sentiment_indicators: JSON.stringify(sentiment_indicators)
    };
    console.log("Message object to be indexed:", {
      message_id: messageObject.message_id,
      conversation_id: messageObject.conversation_id,
      role: messageObject.role
    });
    await indexConversationMessage(messageObject);
    console.log("===== RECORD MESSAGE - COMPLETE =====");
    console.log("Successfully recorded message with ID:", message_id);
    return message_id;
  } catch (error) {
    console.error("===== RECORD MESSAGE - ERROR =====");
    console.error("Failed to record message:", error);
    console.error("Error stack:", error.stack);
    throw new Error("Failed to record message: " + error.message);
  }
}
async function getConversationTopics(conversationId, hierarchical = false) {
  if (hierarchical) {
    return await buildTopicHierarchy(conversationId);
  }
  const query = `
    SELECT * FROM conversation_topics
    WHERE conversation_id = ?
    ORDER BY start_timestamp ASC
  `;
  const topics = await executeQuery(query, [conversationId]);
  if (!topics || topics.length === 0)
    return [];
  return topics.map((topic) => {
    try {
      topic.primary_entities = topic.primary_entities ? JSON.parse(topic.primary_entities) : [];
      topic.keywords = topic.keywords ? JSON.parse(topic.keywords) : [];
    } catch (err) {
      topic.primary_entities = topic.primary_entities || [];
      topic.keywords = topic.keywords || [];
    }
    return topic;
  });
}
async function summarizeConversation(conversationId) {
  const query = `
    SELECT role, content FROM conversation_history
    WHERE conversation_id = ?
    ORDER BY timestamp ASC
  `;
  const messages = await executeQuery(query, [conversationId]);
  if (!messages || messages.length === 0)
    return "";
  const concatenated = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
  const summary = await summarizeText(concatenated, {
    targetLength: 250,
    preserveKeyPoints: true
  });
  return summary;
}
async function initializeConversation(conversationId, initialQuery) {
  try {
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const messageId = uuidv45();
    const query = `
      INSERT INTO conversation_history (
        message_id,
        conversation_id, 
        role,
        content,
        timestamp,
        related_context_entity_ids,
        summary,
        user_intent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await executeQuery(query, [
      messageId,
      conversationId,
      "system",
      initialQuery || "Conversation started",
      timestamp,
      JSON.stringify([]),
      "Conversation initialization",
      "start_conversation"
    ]);
    if (initialQuery) {
      await detectInitialPurpose(
        conversationId,
        initialQuery
      );
    }
    await createNewTopicSegment(
      conversationId,
      messageId,
      {
        name: "Initial conversation",
        description: initialQuery || "Conversation start",
        primaryEntities: [],
        keywords: []
      }
    );
    console.log(`Conversation initialized with ID: ${conversationId}`);
  } catch (error) {
    console.error("Error initializing conversation:", error);
    throw new Error("Failed to initialize conversation: " + error.message);
  }
}
async function getConversationHistory(conversationId, limit = 50, offset = 0) {
  try {
    if (!conversationId) {
      throw new Error("Conversation ID is required");
    }
    const query = `
      SELECT 
        message_id,
        conversation_id,
        role,
        content,
        timestamp,
        related_context_entity_ids,
        summary,
        user_intent,
        topic_segment_id,
        semantic_markers,
        sentiment_indicators
      FROM 
        conversation_history
      WHERE 
        conversation_id = ?
      ORDER BY 
        timestamp ASC
      LIMIT ? OFFSET ?
    `;
    const results = await executeQuery(query, [conversationId, limit, offset]);
    if (!results || !results.rows || !Array.isArray(results.rows)) {
      console.warn("No valid rows returned from conversation history query");
      return [];
    }
    return results.rows.map((message) => {
      try {
        const mappedMessage = {
          messageId: message.message_id,
          conversationId: message.conversation_id,
          role: message.role,
          content: message.content,
          timestamp: message.timestamp,
          relatedContextEntityIds: [],
          summary: message.summary,
          userIntent: message.user_intent,
          topicSegmentId: message.topic_segment_id,
          semanticMarkers: [],
          sentimentIndicators: {}
        };
        if (message.related_context_entity_ids) {
          mappedMessage.relatedContextEntityIds = JSON.parse(
            message.related_context_entity_ids
          );
        }
        if (message.semantic_markers) {
          mappedMessage.semanticMarkers = JSON.parse(message.semantic_markers);
        }
        if (message.sentiment_indicators) {
          mappedMessage.sentimentIndicators = JSON.parse(
            message.sentiment_indicators
          );
        }
        return mappedMessage;
      } catch (err) {
        console.error(
          "Error parsing JSON fields in conversation message:",
          err
        );
        return {
          messageId: message.message_id,
          conversationId: message.conversation_id,
          role: message.role,
          content: message.content,
          timestamp: message.timestamp,
          relatedContextEntityIds: [],
          summary: message.summary,
          userIntent: message.user_intent,
          topicSegmentId: message.topic_segment_id,
          semanticMarkers: [],
          sentimentIndicators: {}
        };
      }
    });
  } catch (error) {
    console.error(
      `Error getting conversation history for ${conversationId}:`,
      error
    );
    return [];
  }
}
async function getConversationPurpose(conversationId) {
  try {
    if (!conversationId) {
      throw new Error("Conversation ID is required");
    }
    const activePurpose = await getActivePurpose(
      conversationId
    );
    if (!activePurpose) {
      return {
        purposeType: "general_query",
        confidence: 0.5,
        startTimestamp: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    return activePurpose;
  } catch (error) {
    console.error(
      `Error getting conversation purpose for ${conversationId}:`,
      error
    );
    return {
      purposeType: "general_query",
      confidence: 0.5,
      startTimestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
}
async function getRecentMessages(conversationId, count = 5) {
  try {
    if (!conversationId) {
      throw new Error("Conversation ID is required");
    }
    const query = `
      SELECT 
        message_id,
        conversation_id,
        role,
        content,
        timestamp,
        related_context_entity_ids,
        summary,
        user_intent,
        topic_segment_id,
        semantic_markers,
        sentiment_indicators
      FROM 
        conversation_history
      WHERE 
        conversation_id = ?
      ORDER BY 
        timestamp DESC
      LIMIT ?
    `;
    const results = await executeQuery(query, [conversationId, count]);
    if (!results || !results.rows || !Array.isArray(results.rows)) {
      console.warn("No valid rows returned from recent messages query");
      return [];
    }
    return results.rows.map((message) => {
      try {
        const mappedMessage = {
          messageId: message.message_id,
          conversationId: message.conversation_id,
          role: message.role,
          content: message.content,
          timestamp: message.timestamp,
          relatedContextEntityIds: [],
          summary: message.summary,
          userIntent: message.user_intent,
          topicSegmentId: message.topic_segment_id,
          semanticMarkers: [],
          sentimentIndicators: {}
        };
        if (message.related_context_entity_ids) {
          mappedMessage.relatedContextEntityIds = JSON.parse(
            message.related_context_entity_ids
          );
        }
        if (message.semantic_markers) {
          mappedMessage.semanticMarkers = JSON.parse(message.semantic_markers);
        }
        if (message.sentiment_indicators) {
          mappedMessage.sentimentIndicators = JSON.parse(
            message.sentiment_indicators
          );
        }
        return mappedMessage;
      } catch (err) {
        console.error(
          "Error parsing JSON fields in conversation message:",
          err
        );
        return {
          messageId: message.message_id,
          conversationId: message.conversation_id,
          role: message.role,
          content: message.content,
          timestamp: message.timestamp,
          relatedContextEntityIds: [],
          summary: message.summary,
          userIntent: message.user_intent,
          topicSegmentId: message.topic_segment_id,
          semanticMarkers: [],
          sentimentIndicators: {}
        };
      }
    });
  } catch (error) {
    console.error(
      `Error getting recent messages for ${conversationId}:`,
      error
    );
    return [];
  }
}

// src/logic/IntentPredictorLogic.js
init_db();
import { v4 as uuidv47 } from "uuid";

// src/logic/TimelineManagerLogic.js
init_db();
import { v4 as uuidv46 } from "uuid";
async function recordEvent(type, data, associatedEntityIds = [], conversationId = null) {
  try {
    const eventId = uuidv46();
    const dataJson = JSON.stringify(data);
    const entityIdsJson = JSON.stringify(associatedEntityIds);
    const timestamp = Date.now();
    const query = `
      INSERT INTO timeline_events (
        event_id, 
        event_type, 
        timestamp, 
        data, 
        associated_entity_ids,
        conversation_id
      ) VALUES (?, ?, ?, ?, ?, ?)
    `;
    await executeQuery(query, [
      eventId,
      type,
      timestamp,
      dataJson,
      entityIdsJson,
      conversationId
    ]);
    return eventId;
  } catch (error) {
    console.error(`Error recording timeline event (${type}):`, error);
    throw error;
  }
}
async function createSnapshot(activeContextData, name = null, description = null, timeline_event_id = null) {
  try {
    const snapshot_id = uuidv46();
    const snapshot_data = JSON.stringify(activeContextData);
    const query = `
      INSERT INTO context_snapshots (
        snapshot_id,
        name,
        description,
        snapshot_data,
        timeline_event_id
      ) VALUES (?, ?, ?, ?, ?)
    `;
    await executeQuery(query, [
      snapshot_id,
      name,
      description,
      snapshot_data,
      timeline_event_id
    ]);
    return snapshot_id;
  } catch (error) {
    console.error("Error creating context snapshot:", error);
    throw error;
  }
}
async function getEvents(options = {}) {
  try {
    const {
      types,
      limit,
      conversationId,
      includeMilestones = true,
      excludeConversationId
    } = options;
    let query = "SELECT * FROM timeline_events WHERE 1=1";
    const params = [];
    if (types && types.length > 0) {
      query += ` AND event_type IN (${types.map(() => "?").join(",")})`;
      params.push(...types);
    }
    if (conversationId) {
      query += " AND conversation_id = ?";
      params.push(conversationId);
    }
    if (excludeConversationId) {
      query += " AND (conversation_id != ? OR conversation_id IS NULL)";
      params.push(excludeConversationId);
    }
    if (!includeMilestones) {
      const milestoneEventTypes = [
        "milestone_created",
        "implicit_checkpoint_creation",
        "checkpoint_created"
      ];
      query += ` AND event_type NOT IN (${milestoneEventTypes.map(() => "?").join(",")})`;
      params.push(...milestoneEventTypes);
      query += ` AND NOT EXISTS (
        SELECT 1 FROM context_snapshots 
        WHERE context_snapshots.timeline_event_id = timeline_events.event_id
      )`;
    }
    query += " ORDER BY timestamp DESC";
    if (limit && Number.isInteger(limit) && limit > 0) {
      query += " LIMIT ?";
      params.push(limit);
    }
    const events = await executeQuery(query, params);
    const rows = events && events.rows && Array.isArray(events.rows) ? events.rows : Array.isArray(events) ? events : [];
    if (rows.length === 0) {
      console.warn("No valid timeline events found");
      return [];
    }
    return rows.map((event) => ({
      ...event,
      data: JSON.parse(event.data || "{}"),
      associated_entity_ids: JSON.parse(event.associated_entity_ids || "[]")
    }));
  } catch (error) {
    console.error("Error retrieving timeline events:", error);
    throw error;
  }
}
async function getRecentEventsForConversation(conversationId, limit = 10, eventTypes = null) {
  try {
    if (!conversationId) {
      throw new Error("Conversation ID is required");
    }
    let query = `
      SELECT 
        event_id,
        event_type,
        timestamp,
        data,
        associated_entity_ids,
        conversation_id
      FROM 
        timeline_events
      WHERE 
        conversation_id = ?
    `;
    const params = [conversationId];
    if (eventTypes && Array.isArray(eventTypes) && eventTypes.length > 0) {
      const placeholders = eventTypes.map(() => "?").join(",");
      query += ` AND event_type IN (${placeholders})`;
      params.push(...eventTypes);
    }
    query += `
      ORDER BY 
        timestamp DESC
      LIMIT ?
    `;
    params.push(limit);
    const results = await executeQuery(query, params);
    const rows = results && results.rows && Array.isArray(results.rows) ? results.rows : Array.isArray(results) ? results : [];
    if (rows.length === 0) {
      console.warn("No recent events found for conversation:", conversationId);
      return [];
    }
    return rows.map((event) => ({
      ...event,
      data: JSON.parse(event.data || "{}"),
      associated_entity_ids: JSON.parse(event.associated_entity_ids || "[]")
    }));
  } catch (error) {
    console.error(
      `Error getting recent events for conversation ${conversationId}:`,
      error
    );
    return [];
  }
}

// src/logic/IntentPredictorLogic.js
function inferIntentFromQuery(query, conversationHistory = []) {
  const intents = {
    GENERAL_QUERY: "general_query",
    CODE_SEARCH: "code_search",
    EXPLANATION_REQUEST: "explanation_request",
    DEBUGGING_ASSIST: "debugging_assist",
    REFACTORING_SUGGESTION: "refactoring_suggestion",
    IMPLEMENTATION_REQUEST: "implementation_request",
    DOCUMENTATION_REQUEST: "documentation_request"
  };
  const intentScores = {
    [intents.GENERAL_QUERY]: 0.1,
    // Base score
    [intents.CODE_SEARCH]: 0,
    [intents.EXPLANATION_REQUEST]: 0,
    [intents.DEBUGGING_ASSIST]: 0,
    [intents.REFACTORING_SUGGESTION]: 0,
    [intents.IMPLEMENTATION_REQUEST]: 0,
    [intents.DOCUMENTATION_REQUEST]: 0
  };
  const normalizedQuery = query.toLowerCase();
  const tokens = tokenize(query);
  const keywords = extractKeywords(tokens);
  if (normalizedQuery.includes("?")) {
    intentScores[intents.EXPLANATION_REQUEST] += 0.3;
  }
  const codePatterns = [
    /```[\s\S]*?```/,
    // Code blocks
    /function\s+\w+\s*\(.*?\)/,
    // Function declarations
    /const|let|var\s+\w+\s*=/,
    // Variable declarations
    /class\s+\w+/,
    // Class declarations
    /import\s+.*?from/
    // Import statements
  ];
  for (const pattern of codePatterns) {
    if (pattern.test(query)) {
      intentScores[intents.CODE_SEARCH] += 0.2;
      intentScores[intents.DEBUGGING_ASSIST] += 0.2;
      break;
    }
  }
  const keywordPatterns = [
    // Search related
    {
      patterns: ["find", "search", "where is", "locate", "look for"],
      intent: intents.CODE_SEARCH,
      score: 0.6
    },
    // Explanation related
    {
      patterns: [
        "explain",
        "how does",
        "what is",
        "why",
        "how to",
        "tell me about"
      ],
      intent: intents.EXPLANATION_REQUEST,
      score: 0.6
    },
    // Debugging related
    {
      patterns: [
        "error",
        "bug",
        "issue",
        "problem",
        "fix",
        "debug",
        "not working",
        "exception",
        "fail"
      ],
      intent: intents.DEBUGGING_ASSIST,
      score: 0.7
    },
    // Refactoring related
    {
      patterns: [
        "refactor",
        "improve",
        "optimize",
        "clean",
        "better way",
        "restructure",
        "revise"
      ],
      intent: intents.REFACTORING_SUGGESTION,
      score: 0.65
    },
    // Implementation related
    {
      patterns: [
        "implement",
        "create",
        "make",
        "build",
        "develop",
        "code",
        "add",
        "new feature"
      ],
      intent: intents.IMPLEMENTATION_REQUEST,
      score: 0.6
    },
    // Documentation related
    {
      patterns: [
        "document",
        "comment",
        "describe",
        "explain code",
        "documentation"
      ],
      intent: intents.DOCUMENTATION_REQUEST,
      score: 0.55
    }
  ];
  for (const { patterns, intent, score } of keywordPatterns) {
    for (const pattern of patterns) {
      if (normalizedQuery.includes(pattern)) {
        intentScores[intent] += score;
        break;
      }
    }
  }
  if (conversationHistory && conversationHistory.length > 0) {
    const recentMessages = conversationHistory.slice(-3).filter((msg) => msg.content);
    for (const message of recentMessages) {
      const normalizedContent = message.content.toLowerCase();
      if (/error|bug|issue|problem|fix|debug|not working|exception|fail/.test(
        normalizedContent
      )) {
        intentScores[intents.DEBUGGING_ASSIST] += 0.2;
      }
      if (/refactor|improve|optimize|clean|better|restructure|architecture/.test(
        normalizedContent
      )) {
        intentScores[intents.REFACTORING_SUGGESTION] += 0.2;
      }
      if (/explain|how does|what is|why|how to|understand/.test(normalizedContent)) {
        intentScores[intents.EXPLANATION_REQUEST] += 0.15;
      }
    }
  }
  let maxScore = 0;
  let inferredIntent = intents.GENERAL_QUERY;
  for (const [intent, score] of Object.entries(intentScores)) {
    if (score > maxScore) {
      maxScore = score;
      inferredIntent = intent;
    }
  }
  return {
    intent: inferredIntent,
    keywords
  };
}
async function predictFocusArea(recentActivity = [], currentCodeEdits = []) {
  try {
    const pathFrequency = /* @__PURE__ */ new Map();
    const entityFrequency = /* @__PURE__ */ new Map();
    const activityTypes = /* @__PURE__ */ new Map();
    let keywordsSet = /* @__PURE__ */ new Set();
    for (const event of recentActivity) {
      activityTypes.set(
        event.event_type,
        (activityTypes.get(event.event_type) || 0) + 1
      );
      if (event.data && event.data.path) {
        const path2 = event.data.path;
        pathFrequency.set(path2, (pathFrequency.get(path2) || 0) + 1);
        const segments = path2.split("/");
        for (let i = 1; i < segments.length; i++) {
          const dirPath = segments.slice(0, i).join("/");
          if (dirPath) {
            pathFrequency.set(dirPath, (pathFrequency.get(dirPath) || 0) + 0.3);
          }
        }
      }
      if (event.associated_entity_ids && event.associated_entity_ids.length > 0) {
        for (const entityId of event.associated_entity_ids) {
          entityFrequency.set(
            entityId,
            (entityFrequency.get(entityId) || 0) + 1
          );
        }
      }
      if (event.data && typeof event.data === "object") {
        const textFields = [
          event.data.description,
          event.data.message,
          event.data.content,
          event.data.query
        ].filter(Boolean);
        for (const text of textFields) {
          if (text && typeof text === "string") {
            const tokens = tokenize(text);
            const extractedKeywords = extractKeywords(tokens);
            extractedKeywords.forEach((keyword) => keywordsSet.add(keyword));
          }
        }
      }
    }
    for (const edit of currentCodeEdits) {
      const path2 = edit.path;
      pathFrequency.set(path2, (pathFrequency.get(path2) || 0) + 3);
      const segments = path2.split("/");
      for (let i = 1; i < segments.length; i++) {
        const dirPath = segments.slice(0, i).join("/");
        if (dirPath) {
          pathFrequency.set(dirPath, (pathFrequency.get(dirPath) || 0) + 0.5);
        }
      }
      if (edit.content) {
        const tokens = tokenize(edit.content);
        const extractedKeywords = extractKeywords(tokens);
        extractedKeywords.forEach((keyword) => keywordsSet.add(keyword));
      }
    }
    let primaryFocusPath = "";
    let maxFrequency = 0;
    let focusType = "file";
    for (const [path2, frequency] of pathFrequency.entries()) {
      if (frequency > maxFrequency) {
        maxFrequency = frequency;
        primaryFocusPath = path2;
        focusType = path2.includes(".") && !path2.endsWith("/") ? "file" : "directory";
      }
    }
    if (!primaryFocusPath && activityTypes.size > 0) {
      let primaryActivityType = "";
      maxFrequency = 0;
      for (const [type, frequency] of activityTypes.entries()) {
        if (frequency > maxFrequency) {
          maxFrequency = frequency;
          primaryActivityType = type;
        }
      }
      if (primaryActivityType) {
        primaryFocusPath = `activity:${primaryActivityType}`;
        focusType = "task_type";
      }
    }
    if (!primaryFocusPath) {
      return null;
    }
    let description = "";
    if (focusType === "file") {
      description = `Working on file ${primaryFocusPath}`;
    } else if (focusType === "directory") {
      description = `Working in directory ${primaryFocusPath}`;
    } else {
      description = `${primaryFocusPath.replace("activity:", "")} activity`;
    }
    const relatedEntityIds = Array.from(entityFrequency.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([entityId]) => entityId);
    const keywords = Array.from(keywordsSet).slice(0, 20);
    const focusArea = {
      focus_id: uuidv47(),
      focus_type: focusType,
      identifier: primaryFocusPath,
      description,
      related_entity_ids: JSON.stringify(relatedEntityIds),
      keywords: JSON.stringify(keywords),
      last_activated_at: Date.now(),
      is_active: true
    };
    try {
      await updateFocusAreaInDb(focusArea);
    } catch (error) {
      console.error("Error updating focus area in database:", error);
    }
    return focusArea;
  } catch (error) {
    console.error("Error predicting focus area:", error);
    return null;
  }
}
async function updateFocusAreaInDb(focus) {
  try {
    const relatedEntityIds = typeof focus.related_entity_ids === "string" ? focus.related_entity_ids : JSON.stringify(focus.related_entity_ids || []);
    const keywords = typeof focus.keywords === "string" ? focus.keywords : JSON.stringify(focus.keywords || []);
    const lastActivated = focus.last_activated_at || Date.now();
    await executeQuery("BEGIN TRANSACTION");
    try {
      await executeQuery(
        "UPDATE focus_areas SET is_active = FALSE WHERE is_active = TRUE"
      );
      const existingFocus = await executeQuery(
        "SELECT focus_id FROM focus_areas WHERE identifier = ?",
        [focus.identifier]
      );
      if (existingFocus && existingFocus.length > 0) {
        await executeQuery(
          `UPDATE focus_areas SET 
            focus_type = ?,
            description = ?,
            related_entity_ids = ?,
            keywords = ?,
            last_activated_at = ?,
            is_active = TRUE
          WHERE focus_id = ?`,
          [
            focus.focus_type,
            focus.description,
            relatedEntityIds,
            keywords,
            lastActivated,
            existingFocus[0].focus_id
          ]
        );
      } else {
        await executeQuery(
          `INSERT INTO focus_areas (
            focus_id,
            focus_type,
            identifier,
            description,
            related_entity_ids,
            keywords,
            last_activated_at,
            is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
          [
            focus.focus_id,
            focus.focus_type,
            focus.identifier,
            focus.description,
            relatedEntityIds,
            keywords,
            lastActivated
          ]
        );
      }
      await executeQuery("COMMIT");
    } catch (error) {
      await executeQuery("ROLLBACK");
      throw error;
    }
  } catch (error) {
    console.error("Error updating focus area in database:", error);
    throw error;
  }
}
async function updateIntent(params) {
  try {
    const {
      conversationId,
      newMessage,
      isUser = false,
      activeFile,
      codeChanges = []
    } = params;
    let newIntent = null;
    let focusUpdated = false;
    let currentFocus = null;
    if (newMessage && isUser) {
      const recentMessages = await executeQuery(
        `SELECT content, role, timestamp 
         FROM conversation_history 
         WHERE conversation_id = ? 
         ORDER BY timestamp DESC 
         LIMIT 5`,
        [conversationId]
      );
      const messages = recentMessages.map((msg) => ({
        content: msg.content,
        role: msg.role
      }));
      messages.unshift({
        content: newMessage,
        role: "user"
      });
      const { intent, keywords } = inferIntentFromQuery(newMessage, messages);
      const activeFocusAreas = await executeQuery(
        "SELECT * FROM focus_areas WHERE is_active = TRUE LIMIT 1"
      );
      let focusArea = null;
      if (activeFocusAreas && activeFocusAreas.length > 0) {
        const rawFocusArea = activeFocusAreas[0];
        focusArea = {
          ...rawFocusArea,
          related_entity_ids: JSON.parse(
            rawFocusArea.related_entity_ids || "[]"
          ),
          keywords: JSON.parse(rawFocusArea.keywords || "[]")
        };
      }
      let confidence = 0.5;
      if (intent !== "general_query" && focusArea) {
        confidence = 0.7;
        if (focusArea.keywords && keywords) {
          const matchingKeywords = keywords.filter(
            (k) => focusArea.keywords.includes(k)
          );
          if (matchingKeywords.length > 0) {
            confidence += Math.min(0.3, matchingKeywords.length * 0.05);
          }
        }
      }
      newIntent = {
        intent,
        confidence,
        keywords,
        focusArea
      };
    }
    const codeActivity = [];
    if (activeFile) {
      codeActivity.push({
        path: activeFile
      });
    }
    if (codeChanges && codeChanges.length > 0) {
      codeActivity.push(...codeChanges);
    }
    const recentEvents = await getEvents({
      limit: 20,
      types: ["code_change", "file_open", "cursor_move", "navigation"]
    });
    if (codeActivity.length > 0 || recentEvents.length > 0) {
      const newFocusArea = await predictFocusArea(recentEvents, codeActivity);
      if (newFocusArea) {
        focusUpdated = true;
        currentFocus = newFocusArea;
      } else {
        const activeFocusAreas = await executeQuery(
          "SELECT * FROM focus_areas WHERE is_active = TRUE LIMIT 1"
        );
        if (activeFocusAreas && activeFocusAreas.length > 0) {
          const rawFocusArea = activeFocusAreas[0];
          currentFocus = {
            ...rawFocusArea,
            related_entity_ids: JSON.parse(
              rawFocusArea.related_entity_ids || "[]"
            ),
            keywords: JSON.parse(rawFocusArea.keywords || "[]")
          };
        }
      }
    } else {
      const activeFocusAreas = await executeQuery(
        "SELECT * FROM focus_areas WHERE is_active = TRUE LIMIT 1"
      );
      if (activeFocusAreas && activeFocusAreas.length > 0) {
        const rawFocusArea = activeFocusAreas[0];
        currentFocus = {
          ...rawFocusArea,
          related_entity_ids: JSON.parse(
            rawFocusArea.related_entity_ids || "[]"
          ),
          keywords: JSON.parse(rawFocusArea.keywords || "[]")
        };
      }
    }
    if (newIntent && !newIntent.focusArea && currentFocus) {
      newIntent.focusArea = currentFocus;
    }
    return {
      newIntent,
      focusUpdated,
      currentFocus
    };
  } catch (error) {
    console.error("Error updating intent:", error);
    return {
      focusUpdated: false
    };
  }
}

// src/logic/SmartSearchServiceLogic.js
init_db();
async function searchByKeywords(keywords, options = {}) {
  try {
    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      throw new Error("Keywords array is required and cannot be empty");
    }
    if (keywords.length === 1 && /\s+(AND|OR|NOT|NEAR\/\d+)\s+/i.test(keywords[0])) {
    } else {
      keywords = keywords.map((kw) => kw.trim()).filter((kw) => kw.length > 0);
    }
    options = {
      strategy: "combined",
      // Default to combined search
      booleanOperator: "OR",
      // Default to OR for broader matches
      limit: 100,
      // Default result limit
      ...options
    };
    let searchResults = [];
    if (options.strategy === "fts" || options.strategy === "combined") {
      const ftsResults = await searchUsingFTS(keywords, options);
      searchResults = [...ftsResults];
    }
    if (options.strategy === "keywords" || options.strategy === "combined" || options.strategy === "fts" && searchResults.length === 0) {
      const keywordResults = await searchUsingKeywords(keywords, options);
      if (options.strategy === "combined" && searchResults.length > 0) {
        searchResults = mergeSearchResults(searchResults, keywordResults);
      } else {
        searchResults = keywordResults;
      }
    }
    if (options.minRelevance) {
      searchResults = searchResults.filter(
        (result) => result.relevanceScore >= options.minRelevance
      );
    }
    if (options.limit && searchResults.length > options.limit) {
      searchResults = searchResults.slice(0, options.limit);
    }
    return searchResults;
  } catch (error) {
    console.error("Error in searchByKeywords:", error);
    throw error;
  }
}
async function searchUsingFTS(keywords, options) {
  try {
    const processedKeywords = keywords.map((keyword) => {
      const stemmed = stem(keyword.toLowerCase());
      const sanitized = stemmed.replace(
        /[\\"\(\)\[\]\{\}\^\$\+\*\?\.]/g,
        (char) => `\\${char}`
      );
      return sanitized;
    });
    const booleanOperator = options.booleanOperator?.toUpperCase() === "AND" ? "AND" : "OR";
    let ftsQuery;
    if (options.useExactMatch) {
      ftsQuery = `"${processedKeywords.join(" ")}"`;
    } else if (options.useProximity && processedKeywords.length > 1) {
      const distance = options.proximityDistance || 10;
      ftsQuery = `${processedKeywords.join(` NEAR/${distance} `)}`;
    } else {
      ftsQuery = processedKeywords.join(` ${booleanOperator} `);
    }
    if (keywords.length === 1 && /\s+(AND|OR|NOT|NEAR\/\d+)\s+/i.test(keywords[0])) {
      ftsQuery = keywords[0];
    }
    let sql = `
      SELECT
        e.*,
        fts.rank as relevance_score
      FROM
        code_entities_fts fts
      JOIN
        code_entities e ON fts.rowid = e.rowid
      WHERE
        fts.code_entities_fts MATCH ?
    `;
    const queryParams = [ftsQuery];
    if (options.entityTypes && options.entityTypes.length > 0) {
      const placeholders = options.entityTypes.map(() => "?").join(", ");
      sql += ` AND e.entity_type IN (${placeholders})`;
      queryParams.push(...options.entityTypes);
    }
    if (options.filePaths && options.filePaths.length > 0) {
      sql += " AND (";
      const filePathConditions = [];
      for (const pathPattern of options.filePaths) {
        let sqlPattern = pathPattern.replace(/\*/g, "%").replace(/\?/g, "_");
        sqlPattern = sqlPattern.replace(/%\/%/g, "%");
        filePathConditions.push("e.file_path LIKE ?");
        queryParams.push(sqlPattern);
      }
      sql += filePathConditions.join(" OR ");
      sql += ")";
    }
    if (options.dateRange) {
      if (options.dateRange.start) {
        sql += " AND e.last_modified_at >= ?";
        queryParams.push(options.dateRange.start.toISOString());
      }
      if (options.dateRange.end) {
        sql += " AND e.last_modified_at <= ?";
        queryParams.push(options.dateRange.end.toISOString());
      }
    }
    if (options.customRanking) {
      sql += ` ORDER BY ${options.customRanking}`;
    } else {
      sql += `
        ORDER BY 
          relevance_score * 
          CASE 
            WHEN e.entity_type = 'file' THEN 1.2
            WHEN e.entity_type = 'class' THEN 1.1
            WHEN e.entity_type = 'function' THEN 1.0
            ELSE 0.9
          END DESC
      `;
    }
    const limit = options.limit && options.limit > 0 ? options.limit : 100;
    sql += " LIMIT ?";
    queryParams.push(limit);
    const results = await executeQuery(sql, queryParams);
    return mapToSearchResults(results);
  } catch (error) {
    console.error("Error in searchUsingFTS:", error);
    throw error;
  }
}
async function searchUsingKeywords(keywords, options) {
  try {
    let processedKeywords;
    if (keywords.length === 1 && /\s+(AND|OR|NOT)\s+/i.test(keywords[0])) {
      processedKeywords = keywords[0].split(/\s+(?:AND|OR|NOT)\s+/i).map((term) => term.trim()).filter((term) => term.length > 0);
    } else {
      processedKeywords = keywords;
    }
    const stemmedKeywords = processedKeywords.map(
      (keyword) => stem(keyword.toLowerCase())
    );
    let sql = `
      SELECT 
        e.*,
        SUM(ek.weight * (1.0 + (0.1 * count_matches))) as relevance_score
      FROM (
        SELECT 
          entity_id, 
          COUNT(DISTINCT keyword) as count_matches,
          MAX(weight) as weight
        FROM 
          entity_keywords
        WHERE 
          keyword IN (${stemmedKeywords.map(() => "?").join(",")})
        GROUP BY 
          entity_id
      ) as ek
      JOIN 
        code_entities e ON ek.entity_id = e.entity_id
    `;
    const queryParams = [...stemmedKeywords];
    sql = applyFilters(sql, options, queryParams);
    if (options.sortBy) {
      sql += ` ORDER BY e.${options.sortBy}`;
    } else {
      sql += `
        ORDER BY 
          relevance_score * 
          CASE 
            WHEN e.entity_type = 'file' THEN 1.2
            WHEN e.entity_type = 'class' THEN 1.1
            WHEN e.entity_type = 'function' THEN 1.0
            ELSE 0.9
          END DESC
      `;
    }
    const limit = options.limit && options.limit > 0 ? options.limit : 100;
    sql += " LIMIT ?";
    queryParams.push(limit);
    const results = await executeQuery(sql, queryParams);
    return mapToSearchResults(results);
  } catch (error) {
    console.error("Error in searchUsingKeywords:", error);
    throw error;
  }
}
function applyFilters(sql, options, queryParams) {
  if (options.entityTypes && options.entityTypes.length > 0) {
    const placeholders = options.entityTypes.map(() => "?").join(", ");
    sql += ` AND e.entity_type IN (${placeholders})`;
    queryParams.push(...options.entityTypes);
  }
  if (options.filePaths && options.filePaths.length > 0) {
    sql += " AND (";
    const filePathConditions = [];
    for (const pathPattern of options.filePaths) {
      let sqlPattern = pathPattern.replace(/\*/g, "%").replace(/\?/g, "_");
      sqlPattern = sqlPattern.replace(/%\/%/g, "%");
      filePathConditions.push("e.file_path LIKE ?");
      queryParams.push(sqlPattern);
    }
    sql += filePathConditions.join(" OR ");
    sql += ")";
  }
  if (options.dateRange) {
    if (options.dateRange.start) {
      sql += " AND e.last_modified_at >= ?";
      queryParams.push(options.dateRange.start.toISOString());
    }
    if (options.dateRange.end) {
      sql += " AND e.last_modified_at <= ?";
      queryParams.push(options.dateRange.end.toISOString());
    }
  }
  return sql;
}
function mapToSearchResults(results) {
  const rows = results && results.rows && Array.isArray(results.rows) ? results.rows : Array.isArray(results) ? results : [];
  if (rows.length === 0) {
    console.warn("No valid search results found to map");
    return [];
  }
  return rows.map((row) => ({
    entity: {
      entity_id: row.entity_id,
      file_path: row.file_path,
      entity_type: row.entity_type,
      name: row.name,
      parent_entity_id: row.parent_entity_id,
      content_hash: row.content_hash,
      raw_content: row.raw_content,
      start_line: row.start_line,
      end_line: row.end_line,
      language: row.language,
      created_at: row.created_at,
      last_modified_at: row.last_modified_at
    },
    relevanceScore: row.relevance_score
  }));
}
function mergeSearchResults(resultsA, resultsB) {
  const entityMap = /* @__PURE__ */ new Map();
  for (const result of resultsA) {
    entityMap.set(result.entity.entity_id, result);
  }
  for (const result of resultsB) {
    const entityId = result.entity.entity_id;
    if (entityMap.has(entityId)) {
      const existingResult = entityMap.get(entityId);
      const combinedScore = existingResult.relevanceScore * 0.7 + result.relevanceScore * 0.3;
      entityMap.set(entityId, {
        ...existingResult,
        relevanceScore: combinedScore
      });
    } else {
      entityMap.set(entityId, result);
    }
  }
  return Array.from(entityMap.values()).sort(
    (a, b) => b.relevanceScore - a.relevanceScore
  );
}

// src/logic/ActiveContextManager.js
init_db();

// src/logic/ContextPrioritizerLogic.js
init_RelationshipContextManagerLogic();
init_db();
init_config();

// src/logic/ActiveContextManager.js
var activeEntityIds = /* @__PURE__ */ new Set();
var activeFocus = null;
var contextHistory = [];
function getActiveFocus() {
  return activeFocus;
}
function setActiveFocus(focus) {
  activeFocus = focus;
  if (focus && Array.isArray(focus.related_entity_ids)) {
    updateActiveContext(focus.related_entity_ids, []);
  }
}
function updateActiveContext(addEntityIds = [], removeEntityIds = []) {
  const changeRecord = {
    timestamp: Date.now()
  };
  if (addEntityIds.length > 0) {
    addEntityIds.forEach((id) => activeEntityIds.add(id));
    changeRecord.added = [...addEntityIds];
  }
  if (removeEntityIds.length > 0) {
    removeEntityIds.forEach((id) => activeEntityIds.delete(id));
    changeRecord.removed = [...removeEntityIds];
  }
  if (addEntityIds.length > 0 || removeEntityIds.length > 0) {
    contextHistory.push(changeRecord);
    if (contextHistory.length > 50) {
      contextHistory.shift();
    }
  }
}
function getActiveContextEntityIds() {
  return [...activeEntityIds];
}
function clearActiveContext() {
  activeEntityIds.clear();
  activeFocus = null;
  contextHistory.push({
    timestamp: Date.now(),
    event: "clear_context"
  });
}
async function getActiveContextAsEntities() {
  const entityIds = getActiveContextEntityIds();
  if (entityIds.length === 0) {
    return [];
  }
  try {
    const placeholders = entityIds.map(() => "?").join(",");
    const query = `SELECT * FROM code_entities WHERE id IN (${placeholders})`;
    const entities = await executeQuery(query, entityIds);
    return entities;
  } catch (error) {
    console.error("Error retrieving active context entities:", error);
    return [];
  }
}
async function getActiveContextState() {
  try {
    const entities = await getActiveContextAsEntities();
    const focus = getActiveFocus();
    const recentHistory = contextHistory.slice(-10);
    return {
      activeEntityIds: [...activeEntityIds],
      activeFocus: focus,
      entities,
      recentChanges: recentHistory,
      timestamp: Date.now()
    };
  } catch (error) {
    console.error("Error getting active context state:", error);
    return {
      activeEntityIds: [...activeEntityIds],
      activeFocus,
      entities: [],
      recentChanges: [],
      timestamp: Date.now(),
      error: error.message
    };
  }
}

// src/logic/GlobalPatternRepository.js
init_db();
import { v4 as uuidv48 } from "uuid";
async function retrieveGlobalPatterns(filterOptions = {}) {
  try {
    const { type, minConfidence, limit, language } = filterOptions;
    let query = "SELECT * FROM project_patterns WHERE is_global = TRUE";
    const params = [];
    if (type) {
      query += " AND pattern_type = ?";
      params.push(type);
    }
    if (minConfidence !== void 0 && !isNaN(minConfidence)) {
      query += " AND confidence_score >= ?";
      params.push(minConfidence);
    }
    if (language) {
      query += " AND (language = ? OR language = ? OR language IS NULL)";
      params.push(language, "any");
    }
    query += " ORDER BY confidence_score DESC, utility_score DESC";
    if (limit !== void 0 && !isNaN(limit) && limit > 0) {
      query += " LIMIT ?";
      params.push(limit);
    }
    const patterns = await executeQuery(query, params);
    const rows = patterns && patterns.rows && Array.isArray(patterns.rows) ? patterns.rows : Array.isArray(patterns) ? patterns : [];
    if (rows.length === 0) {
      console.warn("No valid global patterns found");
      return [];
    }
    return rows.map((pattern) => ({
      ...pattern,
      detection_rules: JSON.parse(pattern.detection_rules || "{}"),
      is_global: Boolean(pattern.is_global)
      // Ensure is_global is a boolean
    }));
  } catch (error) {
    console.error("Error retrieving global patterns:", error);
    throw new Error(`Failed to retrieve global patterns: ${error.message}`);
  }
}
async function promotePatternToGlobal(patternId, newConfidence) {
  try {
    let query = "UPDATE project_patterns SET is_global = TRUE";
    const params = [];
    if (newConfidence !== void 0 && !isNaN(newConfidence)) {
      query += ", confidence_score = ?";
      params.push(newConfidence);
    }
    const updated_at = (/* @__PURE__ */ new Date()).toISOString();
    query += ", updated_at = ?";
    params.push(updated_at);
    query += " WHERE pattern_id = ?";
    params.push(patternId);
    const result = await executeQuery(query, params);
    const success = result.affectedRows > 0;
    if (success) {
      console.log(
        `Pattern ${patternId} successfully promoted to global status`
      );
      if (newConfidence !== void 0) {
        console.log(`Updated confidence score to ${newConfidence}`);
      }
    } else {
      console.warn(`No pattern with ID ${patternId} found to promote`);
    }
    return success;
  } catch (error) {
    console.error(`Error promoting pattern ${patternId} to global:`, error);
    throw new Error(`Failed to promote pattern: ${error.message}`);
  }
}
async function reinforcePattern(patternId, observationType, contextData = {}) {
  try {
    const observation_id = uuidv48();
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const observation_data = JSON.stringify(contextData || {});
    const confidenceAdjustments = {
      usage: 0.03,
      // Small increase for usage
      confirmation: 0.05,
      // Moderate increase for explicit confirmation
      rejection: -0.08
      // Larger decrease for rejection
    };
    const utilityAdjustments = {
      usage: 0.04,
      // Moderate increase for usage (indicates utility)
      confirmation: 0.03,
      // Small increase for confirmation
      rejection: -0.02
      // Small decrease for rejection
    };
    await executeQuery("BEGIN TRANSACTION");
    try {
      const insertObservationQuery = `
        INSERT INTO pattern_observations (
          observation_id,
          pattern_id,
          observation_type,
          observation_data,
          timestamp
        ) VALUES (?, ?, ?, ?, ?)
      `;
      await executeQuery(insertObservationQuery, [
        observation_id,
        patternId,
        observationType,
        observation_data,
        timestamp
      ]);
      const getPatternQuery = "SELECT confidence_score, utility_score, reinforcement_count FROM project_patterns WHERE pattern_id = ?";
      const patternResult = await executeQuery(getPatternQuery, [patternId]);
      if (patternResult.length === 0) {
        throw new Error(`Pattern with ID ${patternId} not found`);
      }
      const pattern = patternResult[0];
      let newConfidenceScore = pattern.confidence_score + (confidenceAdjustments[observationType] || 0);
      let newUtilityScore = pattern.utility_score + (utilityAdjustments[observationType] || 0);
      newConfidenceScore = Math.max(0, Math.min(1, newConfidenceScore));
      newUtilityScore = Math.max(0, Math.min(1, newUtilityScore));
      const updatePatternQuery = `
        UPDATE project_patterns SET
          reinforcement_count = reinforcement_count + 1,
          confidence_score = ?,
          utility_score = ?,
          updated_at = ?
      `;
      const updateLastDetected = observationType === "usage" ? ", last_detected_at = ?" : "";
      const updatePatternParams = [
        newConfidenceScore,
        newUtilityScore,
        timestamp
      ];
      if (observationType === "usage") {
        updatePatternParams.push(timestamp);
      }
      const finalUpdateQuery = updatePatternQuery + updateLastDetected + " WHERE pattern_id = ?";
      updatePatternParams.push(patternId);
      await executeQuery(finalUpdateQuery, updatePatternParams);
      await executeQuery("COMMIT");
      console.log(
        `Pattern ${patternId} reinforced with '${observationType}' observation`
      );
    } catch (error) {
      await executeQuery("ROLLBACK");
      throw error;
    }
  } catch (error) {
    console.error(`Error reinforcing pattern ${patternId}:`, error);
    throw new Error(`Failed to reinforce pattern: ${error.message}`);
  }
}

// src/schemas/toolSchemas.js
init_config();
import { z } from "zod";
var initializeConversationContextInputSchema = {
  // No projectId field as per the blueprint
  initialQuery: z.string().optional(),
  focusHint: z.object({
    type: z.string(),
    identifier: z.string()
  }).optional(),
  includeArchitecture: z.boolean().optional().default(true),
  includeRecentConversations: z.boolean().optional().default(true),
  maxCodeContextItems: z.number().optional().default(5),
  maxRecentChanges: z.number().optional().default(5),
  contextDepth: z.enum(["minimal", "standard", "comprehensive"]).optional().default("standard"),
  tokenBudget: z.number().optional().default(DEFAULT_TOKEN_BUDGET)
};
var initializeConversationContextOutputSchema = {
  conversationId: z.string(),
  initialContextSummary: z.string(),
  predictedIntent: z.string().optional(),
  comprehensiveContext: z.object({
    codeContext: z.array(z.any()).optional(),
    architectureContext: z.object({
      summary: z.string(),
      sources: z.array(
        z.object({
          name: z.string(),
          path: z.string()
        })
      )
    }).nullable(),
    recentConversations: z.array(
      z.object({
        timestamp: z.number(),
        summary: z.string(),
        purpose: z.string()
      })
    ).optional(),
    activeWorkflows: z.array(
      z.object({
        name: z.string(),
        description: z.string(),
        timestamp: z.number()
      })
    ).optional(),
    projectStructure: z.any().nullable(),
    recentChanges: z.array(
      z.object({
        timestamp: z.number(),
        files: z.array(z.string()),
        summary: z.string()
      })
    ).optional(),
    globalPatterns: z.array(
      z.object({
        name: z.string(),
        type: z.string(),
        description: z.string(),
        confidence: z.number()
      })
    ).optional()
  }).optional()
};
var updateConversationContextInputSchema = {
  // No projectId field as per the blueprint
  conversationId: z.string(),
  newMessages: z.array(
    z.object({
      role: z.enum(["user", "assistant", "system"]),
      content: z.string()
    })
  ).optional().default([]),
  codeChanges: z.array(
    z.object({
      filePath: z.string(),
      newContent: z.string(),
      languageHint: z.string().optional()
    })
  ).optional().default([]),
  preserveContextOnTopicShift: z.boolean().optional().default(true),
  contextIntegrationLevel: z.enum(["minimal", "balanced", "aggressive"]).optional().default("balanced"),
  trackIntentTransitions: z.boolean().optional().default(true),
  tokenBudget: z.number().optional().default(DEFAULT_TOKEN_BUDGET)
};
var updateConversationContextOutputSchema = {
  status: z.enum(["success", "partial", "failure"]),
  updatedFocus: z.object({
    type: z.string(),
    identifier: z.string()
  }).optional(),
  contextContinuity: z.object({
    preserved: z.boolean(),
    topicShift: z.boolean(),
    intentTransition: z.boolean()
  }),
  contextSynthesis: z.object({
    summary: z.string(),
    topPriorities: z.array(z.string()).optional()
  }).optional(),
  intentTransition: z.object({
    from: z.string().nullable(),
    to: z.string().nullable(),
    confidence: z.number()
  }).optional()
};
var retrieveRelevantContextInputSchema = {
  // No projectId field as per the blueprint
  conversationId: z.string(),
  query: z.string(),
  tokenBudget: z.number().optional().default(DEFAULT_TOKEN_BUDGET),
  constraints: z.object({
    entityTypes: z.array(z.string()).optional(),
    filePaths: z.array(z.string()).optional(),
    includeConversation: z.boolean().optional().default(true),
    crossTopicSearch: z.boolean().optional().default(false),
    focusOverride: z.object({ type: z.string(), identifier: z.string() }).optional()
  }).optional().default({}),
  contextFilters: z.object({
    minRelevanceScore: z.number().optional().default(0.3),
    excludeTypes: z.array(z.string()).optional(),
    preferredLanguages: z.array(z.string()).optional(),
    timeframe: z.object({
      from: z.number().optional(),
      to: z.number().optional()
    }).optional()
  }).optional().default({}),
  weightingStrategy: z.enum(["relevance", "recency", "hierarchy", "balanced"]).optional().default("balanced"),
  balanceStrategy: z.enum(["proportional", "equal_representation", "priority_based"]).optional().default("proportional"),
  contextBalance: z.union([
    z.enum(["auto", "code_heavy", "balanced", "documentation_focused"]),
    z.object({
      code: z.number().optional(),
      conversation: z.number().optional(),
      documentation: z.number().optional(),
      patterns: z.number().optional()
    })
  ]).optional().default("auto"),
  sourceTypePreferences: z.object({
    includePatterns: z.boolean().optional().default(true),
    includeDocumentation: z.boolean().optional().default(true),
    prioritizeTestCases: z.boolean().optional().default(false),
    prioritizeExamples: z.boolean().optional().default(false)
  }).optional().default({})
};
var retrieveRelevantContextOutputSchema = {
  contextSnippets: z.array(
    z.object({
      type: z.string(),
      // 'code', 'conversation', 'documentation', 'pattern'
      content: z.string(),
      entity_id: z.string(),
      relevanceScore: z.number(),
      confidenceScore: z.number(),
      metadata: z.any(),
      // Flexible metadata based on type
      sourceAttribution: z.string(),
      relevanceExplanation: z.string()
    })
  ),
  retrievalSummary: z.string(),
  contextMetrics: z.object({
    totalFound: z.number(),
    selected: z.number(),
    averageConfidence: z.number(),
    typeDistribution: z.object({
      code: z.number(),
      conversation: z.number(),
      documentation: z.number(),
      pattern: z.number()
    })
  }).optional()
};
var recordMilestoneContextInputSchema = {
  conversationId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  customData: z.any().optional(),
  milestoneCategory: z.enum([
    "bug_fix",
    "feature_completion",
    "refactoring",
    "documentation",
    "test",
    "configuration",
    "uncategorized"
  ]).optional().default("uncategorized"),
  assessImpact: z.boolean().optional().default(true)
};
var recordMilestoneContextOutputSchema = {
  milestoneId: z.string(),
  status: z.string(),
  milestoneCategory: z.string(),
  relatedEntitiesCount: z.number(),
  impactAssessment: z.object({
    impactScore: z.number(),
    impactLevel: z.string(),
    impactSummary: z.string(),
    scopeMetrics: z.object({
      directlyModifiedEntities: z.number(),
      potentiallyImpactedEntities: z.number(),
      impactedComponents: z.number(),
      criticalPathsCount: z.number()
    }).optional(),
    stabilityRisk: z.number().optional(),
    criticalPaths: z.array(
      z.object({
        sourceId: z.string(),
        path: z.string(),
        dependencyCount: z.number()
      })
    ).optional(),
    mostImpactedComponents: z.array(
      z.object({
        name: z.string(),
        count: z.number()
      })
    ).optional(),
    error: z.string().optional()
  }).nullable()
};
var finalizeConversationContextInputSchema = {
  conversationId: z.string(),
  clearActiveContext: z.boolean().optional().default(false),
  extractLearnings: z.boolean().optional().default(true),
  promotePatterns: z.boolean().optional().default(true),
  synthesizeRelatedTopics: z.boolean().optional().default(true),
  generateNextSteps: z.boolean().optional().default(true),
  outcome: z.enum(["completed", "abandoned", "paused", "reference_only"]).optional().default("completed")
};
var finalizeConversationContextOutputSchema = {
  status: z.string(),
  summary: z.string(),
  purpose: z.string(),
  // Extracted learnings with confidence scores
  extractedLearnings: z.object({
    learnings: z.array(
      z.object({
        type: z.string(),
        content: z.string(),
        confidence: z.number(),
        // Other properties depend on learning type
        patternId: z.string().optional(),
        context: z.array(z.any()).optional(),
        messageReference: z.string().optional(),
        relatedIssues: z.array(z.any()).optional(),
        alternatives: z.array(z.string()).optional(),
        rationale: z.string().optional(),
        codeReferences: z.array(z.any()).optional(),
        applicability: z.number().optional()
      })
    ),
    count: z.number(),
    byType: z.record(z.string(), z.number()),
    averageConfidence: z.number(),
    error: z.string().optional()
  }).nullable(),
  // Promoted patterns
  promotedPatterns: z.object({
    promoted: z.number(),
    patterns: z.array(
      z.object({
        patternId: z.string(),
        name: z.string(),
        type: z.string(),
        promoted: z.boolean(),
        confidence: z.number()
      })
    ),
    error: z.string().optional()
  }).nullable(),
  // Related conversations synthesis
  relatedConversations: z.object({
    relatedCount: z.number(),
    conversations: z.array(
      z.object({
        conversationId: z.string(),
        summary: z.string(),
        timestamp: z.number(),
        similarityScore: z.number(),
        commonTopics: z.array(z.string())
      })
    ),
    synthesizedInsights: z.array(
      z.object({
        topic: z.string(),
        insight: z.string(),
        conversationCount: z.number(),
        sourceSummaries: z.array(
          z.object({
            conversationId: z.string(),
            summary: z.string()
          })
        )
      })
    ),
    error: z.string().optional()
  }).nullable(),
  // Next steps and follow-up suggestions
  nextSteps: z.object({
    suggestedNextSteps: z.array(
      z.object({
        action: z.string(),
        priority: z.enum(["high", "medium", "low"]),
        rationale: z.string()
      })
    ),
    followUpTopics: z.array(
      z.object({
        topic: z.string(),
        priority: z.enum(["high", "medium", "low"]),
        rationale: z.string()
      })
    ),
    referenceMaterials: z.array(
      z.object({
        title: z.string(),
        path: z.string(),
        type: z.string(),
        relevance: z.number()
      })
    ),
    error: z.string().optional()
  }).nullable()
};

// src/tools/initializeConversationContext.tool.js
init_logger();
async function handler(input, sdkContext) {
  try {
    logMessage("INFO", `initialize_conversation_context tool started`, {
      initialQuery: input.initialQuery
    });
    const conversationId = input.conversationId || uuidv49();
    logMessage("DEBUG", `Using conversation ID: ${conversationId}`);
    const {
      initialQuery = "",
      focusHint,
      includeArchitecture = true,
      includeRecentConversations = true,
      maxCodeContextItems = 5,
      maxRecentChanges = 5,
      contextDepth = "standard",
      tokenBudget = 4e3
    } = input;
    try {
      await clearActiveContext();
      if (focusHint) {
        await setActiveFocus(
          focusHint.type,
          focusHint.identifier
        );
        logMessage("INFO", `Set initial focus`, {
          type: focusHint.type,
          identifier: focusHint.identifier
        });
      }
    } catch (err) {
      logMessage(
        "WARN",
        `Failed to set initial focus, continuing with initialization`,
        {
          error: err.message,
          focusHint
        }
      );
    }
    try {
      await recordEvent(
        "conversation_started",
        {
          initialQuery,
          focusHint,
          contextDepth
        },
        [],
        // No associated entity IDs yet
        conversationId
      );
      logMessage("DEBUG", `Recorded conversation start in timeline`, {
        conversationId
      });
    } catch (err) {
      logMessage("WARN", `Failed to record conversation start in timeline`, {
        error: err.message,
        conversationId
      });
    }
    try {
      await initializeConversation(
        conversationId,
        initialQuery
      );
      logMessage("DEBUG", `Initialized conversation intelligence tracker`, {
        conversationId
      });
    } catch (err) {
      logMessage("ERROR", `Failed to initialize conversation intelligence`, {
        error: err.message,
        conversationId
      });
      throw new Error(
        `Conversation intelligence initialization failed: ${err.message}`
      );
    }
    let predictedIntent = "";
    if (initialQuery) {
      try {
        const intentResult = await inferIntentFromQuery(
          initialQuery
        );
        predictedIntent = intentResult.intent;
        logMessage("INFO", `Predicted initial intent`, {
          intent: predictedIntent,
          confidence: intentResult.confidence || "N/A"
        });
      } catch (err) {
        logMessage(
          "WARN",
          `Intent prediction failed, continuing without intent`,
          {
            error: err.message,
            initialQuery
          }
        );
      }
    }
    logMessage("INFO", `Starting comprehensive context gathering`, {
      conversationId,
      includeArchitecture,
      maxCodeContextItems,
      contextDepth
    });
    const comprehensiveContext = await gatherComprehensiveContext(
      initialQuery,
      focusHint,
      conversationId,
      {
        includeArchitecture,
        includeRecentConversations,
        maxCodeContextItems,
        maxRecentChanges,
        contextDepth,
        tokenBudget
      }
    );
    const contextCounts = {
      codeContextItems: comprehensiveContext.codeContext?.length || 0,
      architectureItems: comprehensiveContext.architectureContext?.length || 0,
      recentChanges: comprehensiveContext.recentChanges?.length || 0,
      patterns: comprehensiveContext.globalPatterns?.length || 0
    };
    logMessage(
      "INFO",
      `Comprehensive context gathered successfully`,
      contextCounts
    );
    const initialContextSummary = generateInitialContextSummary(
      comprehensiveContext,
      initialQuery,
      predictedIntent
    );
    logMessage("INFO", `Generated initial context summary`, {
      summaryLength: initialContextSummary?.length || 0
    });
    const responseData = {
      message: `Conversation context initialized with ID: ${conversationId}`,
      conversationId,
      initialContextSummary,
      predictedIntent,
      comprehensiveContext
    };
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(responseData)
        }
      ]
    };
  } catch (error) {
    logMessage("ERROR", `Error in initialize_conversation_context tool`, {
      error: error.message,
      stack: error.stack,
      input: {
        initialQuery: input.initialQuery,
        focusHint: input.focusHint,
        contextDepth: input.contextDepth
      }
    });
    const errorResponse = {
      error: true,
      errorCode: error.code || "INITIALIZATION_FAILED",
      errorDetails: error.message
    };
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(errorResponse)
        }
      ]
    };
  }
}
async function gatherComprehensiveContext(initialQuery, focusHint, conversationId, options) {
  const context = {};
  try {
    logMessage("DEBUG", `Starting to gather code context`, {
      initialQuery: initialQuery?.substring(0, 50),
      focusHint
    });
    context.codeContext = await gatherCodeContext(
      initialQuery,
      focusHint,
      options
    );
    logMessage("DEBUG", `Gathered code context`, {
      itemCount: context.codeContext?.length || 0
    });
    if (options.includeArchitecture) {
      try {
        context.architectureContext = await gatherArchitectureContext(options);
        logMessage("DEBUG", `Gathered architecture context`, {
          itemCount: context.architectureContext?.length || 0
        });
      } catch (err) {
        logMessage("WARN", `Failed to gather architecture context`, {
          error: err.message
        });
        context.architectureContext = null;
      }
    } else {
      context.architectureContext = null;
    }
    try {
      context.projectStructure = await gatherProjectStructure();
      logMessage("DEBUG", `Gathered project structure`, {
        directoryCount: context.projectStructure?.directories?.length || 0,
        fileCount: context.projectStructure?.files?.length || 0
      });
    } catch (err) {
      logMessage("WARN", `Failed to gather project structure`, {
        error: err.message
      });
      context.projectStructure = { directories: [], files: [] };
    }
    if (options.includeRecentConversations) {
      try {
        context.recentConversations = await gatherRecentConversations(options);
        logMessage("DEBUG", `Gathered recent conversations`, {
          count: context.recentConversations?.length || 0
        });
      } catch (err) {
        logMessage("WARN", `Failed to gather recent conversations`, {
          error: err.message
        });
        context.recentConversations = [];
      }
    }
    try {
      context.recentChanges = await gatherRecentChanges(
        options.maxRecentChanges
      );
      logMessage("DEBUG", `Gathered recent changes`, {
        count: context.recentChanges?.length || 0
      });
    } catch (err) {
      logMessage("WARN", `Failed to gather recent changes`, {
        error: err.message
      });
      context.recentChanges = [];
    }
    try {
      context.activeWorkflows = await gatherActiveWorkflows();
      logMessage("DEBUG", `Gathered active workflows`, {
        count: context.activeWorkflows?.length || 0
      });
    } catch (err) {
      logMessage("WARN", `Failed to gather active workflows`, {
        error: err.message
      });
      context.activeWorkflows = [];
    }
    try {
      context.globalPatterns = await gatherGlobalPatterns(
        initialQuery,
        options
      );
      logMessage("DEBUG", `Gathered global patterns`, {
        count: context.globalPatterns?.length || 0
      });
    } catch (err) {
      logMessage("WARN", `Failed to gather global patterns`, {
        error: err.message
      });
      context.globalPatterns = [];
    }
    return context;
  } catch (error) {
    logMessage("ERROR", `Error gathering comprehensive context`, {
      error: error.message,
      conversationId
    });
    throw error;
  }
}
async function gatherCodeContext(query, focusHint, options) {
  try {
    const searchConstraints = {
      limit: options.maxCodeContextItems * 2
      // Get more than we need for filtering
    };
    if (focusHint) {
      if (focusHint.type === "file" || focusHint.type === "directory") {
        searchConstraints.filePaths = [focusHint.identifier];
      }
    }
    const searchTerms = query ? await extractKeywords2(query) : ["README", "main", "index", "config"];
    const searchResults = await searchByKeywords(
      searchTerms,
      searchConstraints
    );
    let codeItems = searchResults.map((result) => ({
      entity_id: result.entity.entity_id,
      path: result.entity.file_path,
      type: result.entity.entity_type,
      name: result.entity.name,
      content: result.entity.raw_content,
      relevanceScore: result.relevanceScore
    }));
    codeItems = codeItems.slice(0, options.maxCodeContextItems);
    const compressionOptions = {
      detailLevel: options.contextDepth,
      targetTokens: Math.floor(options.tokenBudget * 0.6)
      // Allocate 60% of token budget to code
    };
    const compressedItems = await compressContext(
      codeItems,
      compressionOptions
    );
    return compressedItems;
  } catch (error) {
    console.error(`[gatherCodeContext] Error: ${error.message}`);
    return [];
  }
}
async function gatherArchitectureContext(options) {
  try {
    const docSearchResults = await searchByKeywords(
      ["README", "documentation", "architecture", "overview", "guide", "setup"],
      {
        limit: 5,
        strategy: "keywords"
      }
    );
    if (docSearchResults.length === 0) {
      return null;
    }
    const docSources = docSearchResults.map((result) => ({
      name: result.entity.name,
      path: result.entity.file_path
    }));
    const docContents = docSearchResults.map((result) => result.entity.raw_content).join("\n\n");
    const compressionOptions = {
      detailLevel: options.contextDepth,
      targetTokens: Math.floor(options.tokenBudget * 0.2)
      // Allocate 20% of token budget to architecture docs
    };
    const summary = docContents.length > 1e3 ? docContents.substring(0, 1e3) + "..." : docContents;
    return {
      summary,
      sources: docSources
    };
  } catch (error) {
    console.error(`[gatherArchitectureContext] Error: ${error.message}`);
    return null;
  }
}
async function gatherProjectStructure() {
  try {
    const dirQuery = `
      SELECT 
        file_path,
        COUNT(*) as file_count
      FROM 
        code_entities
      WHERE 
        entity_type = 'file'
      GROUP BY 
        SUBSTR(file_path, 1, INSTR(file_path, '/'))
      ORDER BY 
        file_count DESC
      LIMIT 10
    `;
    const directories = await executeQuery(dirQuery);
    const rows = directories && directories.rows && Array.isArray(directories.rows) ? directories.rows : Array.isArray(directories) ? directories : [];
    if (rows.length === 0) {
      return {
        topLevelDirs: [],
        totalFiles: 0
      };
    }
    return {
      topLevelDirs: rows.map((dir) => ({
        path: dir.file_path.split("/")[0],
        fileCount: dir.file_count
      })),
      totalFiles: rows.reduce((sum, dir) => sum + dir.file_count, 0)
    };
  } catch (error) {
    console.error(`[gatherProjectStructure] Error: ${error.message}`);
    return null;
  }
}
async function gatherRecentConversations(options) {
  try {
    const recentConversationEvents = await getEvents({
      types: ["conversation_completed"],
      limit: 3
    });
    if (recentConversationEvents.length === 0) {
      return [];
    }
    return recentConversationEvents.map((event) => ({
      timestamp: event.timestamp,
      summary: event.data.summary || "Conversation completed",
      purpose: event.data.purpose || "Unknown purpose"
    }));
  } catch (error) {
    console.error(`[gatherRecentConversations] Error: ${error.message}`);
    return [];
  }
}
async function gatherRecentChanges(maxChanges) {
  try {
    const recentChangeEvents = await getEvents({
      types: ["file_change", "file_create", "code_commit"],
      limit: maxChanges
    });
    if (recentChangeEvents.length === 0) {
      return [];
    }
    return recentChangeEvents.map((event) => ({
      timestamp: event.timestamp,
      files: event.data.files || [event.data.filePath || "Unknown file"],
      summary: event.data.message || `${event.event_type} event occurred`
    }));
  } catch (error) {
    console.error(`[gatherRecentChanges] Error: ${error.message}`);
    return [];
  }
}
async function gatherActiveWorkflows() {
  try {
    const milestoneEvents = await getEvents({
      types: ["milestone"],
      limit: 3,
      includeMilestones: true
    });
    if (milestoneEvents.length === 0) {
      return [];
    }
    return milestoneEvents.map((event) => ({
      name: event.data.name || "Unnamed milestone",
      description: event.data.description || "No description provided",
      timestamp: event.timestamp
    }));
  } catch (error) {
    console.error(`[gatherActiveWorkflows] Error: ${error.message}`);
    return [];
  }
}
async function gatherGlobalPatterns(query, options) {
  try {
    const globalPatterns = await retrieveGlobalPatterns(
      {
        minConfidence: 0.4,
        limit: 5
      }
    );
    if (globalPatterns.length === 0) {
      return [];
    }
    return globalPatterns.map((pattern) => ({
      name: pattern.name,
      type: pattern.pattern_type,
      description: pattern.description,
      confidence: pattern.confidence_score
    }));
  } catch (error) {
    console.error(`[gatherGlobalPatterns] Error: ${error.message}`);
    return [];
  }
}
function generateInitialContextSummary(context, query, intent) {
  let summary = "Project context initialized";
  if (query) {
    summary += ` for query: "${query}"`;
  }
  if (intent) {
    summary += ` with intent: ${intent}`;
  }
  if (context.codeContext && context.codeContext.length > 0) {
    summary += `. Found ${context.codeContext.length} relevant code items`;
  }
  if (context.architectureContext) {
    summary += ". Project documentation available";
  }
  if (context.recentChanges && context.recentChanges.length > 0) {
    summary += `. ${context.recentChanges.length} recent file changes detected`;
  }
  if (context.globalPatterns && context.globalPatterns.length > 0) {
    summary += `. ${context.globalPatterns.length} relevant patterns identified`;
  }
  return summary;
}
async function extractKeywords2(text) {
  return text.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter((word) => word.length > 2).filter((word) => !["the", "and", "for", "with"].includes(word));
}
var initializeConversationContext_tool_default = {
  name: "initialize_conversation_context",
  description: "Initializes a new conversation context with comprehensive codebase information",
  inputSchema: initializeConversationContextInputSchema,
  outputSchema: initializeConversationContextOutputSchema,
  handler
};

// src/tools/updateConversationContext.tool.js
init_db();
import { z as z3 } from "zod";

// src/logic/KnowledgeProcessor.js
init_db();
async function processCodeChange(change) {
  if (!change || !change.filePath || !change.newContent) {
    console.error("Invalid code change object:", change);
    throw new Error("Invalid code change: missing required fields");
  }
  try {
    console.log(`Processing code change for ${change.filePath}`);
    await indexCodeFile(
      change.filePath,
      change.newContent,
      change.languageHint
    );
    const entities = await getEntitiesFromChangedFiles([change.filePath]);
    return {
      filePath: change.filePath,
      success: true,
      entityCount: entities.length,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
  } catch (error) {
    console.error(
      `Error processing code change for ${change.filePath}:`,
      error
    );
    throw new Error(`Failed to process code change: ${error.message}`);
  }
}
async function getEntitiesFromChangedFiles(filePaths) {
  if (!filePaths || filePaths.length === 0) {
    return [];
  }
  try {
    const placeholders = filePaths.map(() => "?").join(",");
    const query = `SELECT * FROM code_entities WHERE path IN (${placeholders})`;
    const fileEntities = await executeQuery(query, filePaths);
    const fileEntityIds = fileEntities.filter((entity) => entity.type === "file").map((entity) => entity.id);
    if (fileEntityIds.length > 0) {
      const childPlaceholders = fileEntityIds.map(() => "?").join(",");
      const childQuery = `SELECT * FROM code_entities WHERE parent_id IN (${childPlaceholders})`;
      const childEntities = await executeQuery(childQuery, fileEntityIds);
      const allEntities = [...fileEntities];
      const existingIds = new Set(allEntities.map((entity) => entity.id));
      for (const childEntity of childEntities) {
        if (!existingIds.has(childEntity.id)) {
          allEntities.push(childEntity);
          existingIds.add(childEntity.id);
        }
      }
      return allEntities;
    }
    return fileEntities;
  } catch (error) {
    console.error("Error retrieving entities from changed files:", error);
    throw error;
  }
}

// src/tools/updateConversationContext.tool.js
init_logger();
async function handler2(input, sdkContext) {
  try {
    logMessage("INFO", `update_conversation_context tool started`, {
      conversationId: input.conversationId,
      messageCount: input.newMessages?.length || 0,
      codeChangeCount: input.codeChanges?.length || 0
    });
    const {
      conversationId,
      newMessages = [],
      codeChanges = [],
      preserveContextOnTopicShift = true,
      contextIntegrationLevel = "balanced",
      trackIntentTransitions = true,
      tokenBudget = 4e3
    } = input;
    if (!conversationId) {
      const error = new Error("conversationId is required");
      error.code = "MISSING_CONVERSATION_ID";
      throw error;
    }
    logMessage("DEBUG", `Processing update with parameters`, {
      preserveContextOnTopicShift,
      contextIntegrationLevel,
      trackIntentTransitions
    });
    let topicShift = false;
    let intentTransition = false;
    let previousIntent = null;
    let currentIntent = null;
    let contextPreserved = true;
    let currentFocus = null;
    try {
      const previousContextState = await getActiveContextState();
      logMessage("DEBUG", `Retrieved previous context state`, {
        hasPreviousContext: !!previousContextState
      });
      if (trackIntentTransitions) {
        previousIntent = await getActivePurpose(
          conversationId
        );
        logMessage("DEBUG", `Retrieved previous intent`, { previousIntent });
      }
    } catch (err) {
      logMessage(
        "WARN",
        `Failed to retrieve previous context state, continuing with defaults`,
        {
          error: err.message
        }
      );
    }
    if (newMessages.length > 0) {
      logMessage("INFO", `Processing ${newMessages.length} new messages`);
      try {
        const processedMessages = await processNewMessages(
          conversationId,
          newMessages,
          {
            trackIntentTransitions
          }
        );
        topicShift = processedMessages.topicShift;
        logMessage("DEBUG", `Message processing completed`, {
          topicShift
        });
        if (trackIntentTransitions) {
          intentTransition = processedMessages.intentTransition;
          currentIntent = processedMessages.currentIntent;
          if (intentTransition) {
            logMessage("INFO", `Intent transition detected`, {
              from: previousIntent,
              to: currentIntent
            });
          }
        }
      } catch (err) {
        logMessage("ERROR", `Failed to process new messages`, {
          error: err.message,
          conversationId
        });
      }
    }
    if (codeChanges.length > 0) {
      logMessage("INFO", `Processing ${codeChanges.length} code changes`);
      try {
        const processedChanges = await processCodeChanges(
          conversationId,
          codeChanges
        );
        if (processedChanges.focusChanged) {
          logMessage("INFO", `Focus changed due to code changes`, {
            newFocus: processedChanges.newFocus
          });
          if (trackIntentTransitions && !intentTransition) {
            try {
              const intentResult = await updateIntent({
                conversationId,
                codeChanges
              });
              if (intentResult.intentChanged) {
                intentTransition = true;
                currentIntent = intentResult.newIntent;
                logMessage("INFO", `Intent changed due to code changes`, {
                  newIntent: currentIntent
                });
              }
            } catch (intentErr) {
              logMessage("WARN", `Failed to update intent from code changes`, {
                error: intentErr.message
              });
            }
          }
        }
      } catch (err) {
        logMessage("ERROR", `Failed to process code changes`, {
          error: err.message,
          conversationId
        });
      }
    }
    if (topicShift || intentTransition) {
      logMessage(
        "INFO",
        `Topic shift or intent transition detected, managing context continuity`,
        {
          topicShift,
          intentTransition,
          preserveContextOnTopicShift
        }
      );
      if (!preserveContextOnTopicShift) {
        try {
          await clearActiveContext();
          contextPreserved = false;
          logMessage("INFO", `Cleared previous context due to topic shift`);
          if (currentIntent) {
            try {
              const recentEvents = await getRecentEventsForConversation(
                conversationId,
                10
              );
              const focusResult = await predictFocusArea(
                recentEvents,
                codeChanges
              );
              if (focusResult) {
                await setActiveFocus(
                  focusResult.type,
                  focusResult.identifier
                );
                currentFocus = focusResult;
                logMessage("INFO", `Set new focus area based on intent`, {
                  type: focusResult.type,
                  identifier: focusResult.identifier
                });
              }
            } catch (focusErr) {
              logMessage("WARN", `Failed to set new focus area`, {
                error: focusErr.message
              });
            }
          }
        } catch (clearErr) {
          logMessage("ERROR", `Failed to clear context`, {
            error: clearErr.message
          });
        }
      } else {
        try {
          const previousContextState = await getActiveContextState() || {};
          const integratedContext = await _integrateContexts(
            previousContextState,
            {
              topicShift,
              intentTransition,
              previousIntent,
              currentIntent,
              codeChanges
            },
            contextIntegrationLevel
          );
          await updateActiveContext(integratedContext);
          contextPreserved = true;
          logMessage("INFO", `Integrated previous and new context`, {
            contextIntegrationLevel
          });
        } catch (integrateErr) {
          logMessage("ERROR", `Failed to integrate contexts`, {
            error: integrateErr.message
          });
        }
      }
    } else {
      logMessage(
        "DEBUG",
        `No topic shift or intent transition detected, preserving context`
      );
    }
    if (!currentFocus) {
      try {
        currentFocus = await getActiveFocus();
        logMessage("DEBUG", `Retrieved current focus`, {
          focus: currentFocus ? `${currentFocus.type}:${currentFocus.identifier}` : "none"
        });
      } catch (focusErr) {
        logMessage("WARN", `Failed to get current focus`, {
          error: focusErr.message
        });
      }
    }
    let contextSynthesis;
    try {
      contextSynthesis = await generateContextSynthesis(
        conversationId,
        currentIntent,
        topicShift || intentTransition
      );
      logMessage("DEBUG", `Generated context synthesis`, {
        synthesisLength: contextSynthesis?.length || 0
      });
    } catch (synthesisErr) {
      logMessage("WARN", `Failed to generate context synthesis`, {
        error: synthesisErr.message
      });
      contextSynthesis = null;
    }
    try {
      await recordEvent(
        "context_updated",
        {
          newMessagesCount: newMessages.length,
          codeChangesCount: codeChanges.length,
          topicShift,
          intentTransition: intentTransition ? {
            from: previousIntent,
            to: currentIntent
          } : null,
          contextPreserved,
          contextIntegrationLevel: contextPreserved ? contextIntegrationLevel : "none"
        },
        [],
        // No specific entity IDs
        conversationId
      );
      logMessage("DEBUG", `Recorded context update in timeline`);
    } catch (timelineErr) {
      logMessage("WARN", `Failed to record context update in timeline`, {
        error: timelineErr.message
      });
    }
    logMessage(
      "INFO",
      `update_conversation_context tool completed successfully`
    );
    const responseData = {
      status: "success",
      message: `Conversation context updated for ${conversationId}`,
      updatedFocus: currentFocus ? {
        type: currentFocus.type,
        identifier: currentFocus.identifier
      } : void 0,
      contextContinuity: {
        topicShift,
        intentTransition,
        contextPreserved
      },
      synthesis: contextSynthesis
    };
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(responseData)
        }
      ]
    };
  } catch (error) {
    logMessage("ERROR", `Error in update_conversation_context tool`, {
      error: error.message,
      stack: error.stack,
      input: {
        conversationId: input.conversationId,
        messageCount: input.newMessages?.length || 0,
        codeChangeCount: input.codeChanges?.length || 0
      }
    });
    const errorResponse = {
      error: true,
      errorCode: error.code || "UPDATE_FAILED",
      errorDetails: error.message
    };
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(errorResponse)
        }
      ]
    };
  }
}
async function processNewMessages(conversationId, messages, options = {}) {
  try {
    logMessage(
      "DEBUG",
      `Processing ${messages.length} messages for conversation ${conversationId}`
    );
    const result = {
      topicShift: false,
      intentTransition: false,
      currentIntent: null
    };
    for (const message of messages) {
      try {
        console.log("RECORDING MESSAGE - Input params:", {
          content: message.content,
          role: message.role,
          conversationId
        });
        const messageId = await recordMessage(
          message.content,
          message.role,
          conversationId,
          [],
          // relatedContextEntityIds
          null
          // topicSegmentId
        );
        console.log("RECORDING MESSAGE - Success:", {
          messageId,
          role: message.role
        });
        logMessage("DEBUG", `Recorded message from ${message.role}`);
      } catch (msgErr) {
        console.error("RECORDING MESSAGE - FAILED:", {
          error: msgErr.message,
          stack: msgErr.stack,
          messageRole: message.role,
          messageContent: message.content && message.content.substring(0, 50) + "..."
        });
        logMessage(
          "WARN",
          `Failed to record message in conversation intelligence`,
          {
            error: msgErr.message,
            messageRole: message.role
          }
        );
      }
    }
    try {
      const segmentationResult = await detectTopicShift(
        conversationId,
        messages
      );
      result.topicShift = segmentationResult.topicShift;
      if (result.topicShift) {
        logMessage("INFO", `Topic shift detected`, {
          previousTopic: segmentationResult.previousTopic,
          newTopic: segmentationResult.newTopic,
          confidence: segmentationResult.confidence
        });
      }
    } catch (segmentErr) {
      logMessage("WARN", `Failed to detect topic shift`, {
        error: segmentErr.message
      });
    }
    if (options.trackIntentTransitions) {
      try {
        const previousIntent = await getActivePurpose(conversationId);
        const intentUpdateResult = await updateIntent({
          conversationId,
          messages
        });
        if (intentUpdateResult.intentChanged) {
          result.intentTransition = true;
          result.currentIntent = intentUpdateResult.newIntent;
          logMessage("INFO", `Intent transition detected`, {
            from: previousIntent,
            to: result.currentIntent,
            confidence: intentUpdateResult.confidence
          });
          await setActivePurpose(
            conversationId,
            result.currentIntent
          );
        } else {
          result.currentIntent = previousIntent;
        }
      } catch (intentErr) {
        logMessage("WARN", `Failed to track intent transition`, {
          error: intentErr.message
        });
      }
    }
    return result;
  } catch (error) {
    logMessage("ERROR", `Error processing new messages`, {
      error: error.message,
      conversationId
    });
    throw error;
  }
}
async function processCodeChanges(conversationId, codeChanges) {
  try {
    logMessage(
      "DEBUG",
      `Processing ${codeChanges.length} code changes for conversation ${conversationId}`
    );
    const result = {
      focusChanged: false,
      newFocus: null
    };
    if (!codeChanges.length) {
      return result;
    }
    for (const change of codeChanges) {
      try {
        await processCodeChange(change);
        logMessage("DEBUG", `Processed code change for ${change.path}`);
      } catch (processErr) {
        logMessage("WARN", `Failed to process code change`, {
          error: processErr.message,
          path: change.path
        });
      }
    }
    const mostSignificantChange = codeChanges.reduce((prev, current) => {
      const prevChangedLines = prev.changedLines?.length || 0;
      const currentChangedLines = current.changedLines?.length || 0;
      return currentChangedLines > prevChangedLines ? current : prev;
    }, codeChanges[0]);
    try {
      await setActiveFocus(
        "file",
        mostSignificantChange.path
      );
      result.focusChanged = true;
      result.newFocus = {
        type: "file",
        identifier: mostSignificantChange.path
      };
      logMessage("INFO", `Set focus to most significantly changed file`, {
        path: mostSignificantChange.path,
        changedLines: mostSignificantChange.changedLines?.length || "N/A"
      });
    } catch (focusErr) {
      logMessage("WARN", `Failed to set focus to changed file`, {
        error: focusErr.message,
        path: mostSignificantChange.path
      });
    }
    try {
      await recordEvent(
        "code_changes",
        {
          count: codeChanges.length,
          paths: codeChanges.map((c) => c.path)
        },
        [],
        // No specific entity IDs
        conversationId
      );
      logMessage("DEBUG", `Recorded code changes in timeline`);
    } catch (timelineErr) {
      logMessage("WARN", `Failed to record code changes in timeline`, {
        error: timelineErr.message
      });
    }
    return result;
  } catch (error) {
    logMessage("ERROR", `Error processing code changes`, {
      error: error.message,
      conversationId
    });
    throw error;
  }
}
async function _integrateContexts(previousContextState, changes, integrationLevel) {
  const {
    topicShift,
    intentTransition,
    previousIntent,
    currentIntent,
    codeChanges
  } = changes;
  try {
    logMessage("INFO", `Integrating contexts with level: ${integrationLevel}`);
    const integratedContext = { ...previousContextState };
    switch (integrationLevel) {
      case "minimal":
        if (topicShift) {
          const currentFocus = integratedContext.focus;
          integratedContext.recentContextItems = [];
          integratedContext.focus = currentFocus;
        }
        break;
      case "aggressive":
        if (intentTransition) {
          integratedContext.currentIntent = currentIntent;
        }
        break;
      case "balanced":
      default:
        if (topicShift) {
          const currentFocus = integratedContext.focus;
          if (integratedContext.recentContextItems) {
            const changedFilePaths = codeChanges.map(
              (change) => change.filePath
            );
            integratedContext.recentContextItems = integratedContext.recentContextItems.filter((item) => {
              if (item.relatedTo && item.relatedTo.includes(currentFocus?.identifier)) {
                return true;
              }
              if (item.path && changedFilePaths.some((path2) => item.path.includes(path2))) {
                return true;
              }
              if (item.timestamp && Date.now() - item.timestamp < 5 * 60 * 1e3) {
                return true;
              }
              return false;
            });
          }
        }
        if (intentTransition) {
          integratedContext.currentIntent = currentIntent;
          if (codeChanges.length > 0 && integratedContext.recentContextItems) {
            integratedContext.recentContextItems.forEach((item) => {
              if (item.contentType === "code" && currentIntent) {
                if (currentIntent === "debugging" && item.path && item.path.includes("test")) {
                  item.priority = Math.min(item.priority + 0.2, 1);
                } else if (currentIntent === "feature_planning" && item.path && item.path.includes("docs")) {
                  item.priority = Math.min(item.priority + 0.2, 1);
                }
              }
            });
            integratedContext.recentContextItems.sort(
              (a, b) => b.priority - a.priority
            );
          }
        }
        break;
    }
    return integratedContext;
  } catch (error) {
    logMessage("ERROR", `Error integrating contexts`, {
      error: error.message
    });
    return previousContextState;
  }
}
async function generateContextSynthesis(conversationId, currentIntent, contextChanged) {
  try {
    logMessage("INFO", `Generating context synthesis`);
    const activeContext = await getActiveContextState();
    const activeFocus2 = await getActiveFocus();
    const recentMessages = await getRecentMessages(
      conversationId,
      5
    );
    let summaryText = "Current conversation context";
    if (contextChanged) {
      if (activeFocus2) {
        summaryText = `The conversation is now focused on ${activeFocus2.type} "${activeFocus2.identifier}"`;
        if (currentIntent) {
          summaryText += ` with the purpose of ${currentIntent.replace(
            /_/g,
            " "
          )}`;
        }
      } else if (currentIntent) {
        summaryText = `The conversation is focused on ${currentIntent.replace(
          /_/g,
          " "
        )}`;
      }
      if (recentMessages.length > 0) {
        const messageContent = recentMessages.map((msg) => msg.content).join(" ");
        const messageSummary = await summarizeText(
          messageContent,
          { targetLength: 150 }
        );
        summaryText += `. Recent discussion: ${messageSummary}`;
      }
    } else {
      if (activeFocus2) {
        summaryText = `Continuing focus on ${activeFocus2.type} "${activeFocus2.identifier}"`;
        if (currentIntent) {
          summaryText += ` with ${currentIntent.replace(/_/g, " ")}`;
        }
      } else if (currentIntent) {
        summaryText = `Continuing with ${currentIntent.replace(/_/g, " ")}`;
      }
    }
    const topPriorities = [];
    if (activeFocus2) {
      topPriorities.push(
        `Focus on ${activeFocus2.type}: ${activeFocus2.identifier}`
      );
    }
    if (currentIntent) {
      switch (currentIntent) {
        case "debugging":
          topPriorities.push("Identify and fix issues in the code");
          break;
        case "feature_planning":
          topPriorities.push("Design and plan new features");
          break;
        case "code_review":
          topPriorities.push("Review code for quality and correctness");
          break;
        case "learning":
          topPriorities.push("Explain concepts and provide information");
          break;
        case "code_generation":
          topPriorities.push("Generate or modify code");
          break;
        default:
          topPriorities.push("Address user's current needs");
      }
    }
    if (activeContext && activeContext.recentContextItems) {
      const priorityItems = activeContext.recentContextItems.slice(0, 2).map((item) => {
        if (item.type === "file") {
          return `Maintain context on file: ${item.name || item.path}`;
        } else if (item.type === "entity") {
          return `Keep focus on: ${item.name}`;
        }
        return null;
      }).filter(Boolean);
      topPriorities.push(...priorityItems);
    }
    return {
      summary: summaryText,
      topPriorities: topPriorities.length > 0 ? topPriorities : void 0
    };
  } catch (error) {
    logMessage("ERROR", `Error generating context synthesis`, {
      error: error.message
    });
    return {
      summary: "Context updated"
    };
  }
}
var updateConversationContext_tool_default = {
  name: "update_conversation_context",
  description: "Updates an existing conversation context with new messages, code changes, and context management",
  inputSchema: updateConversationContextInputSchema,
  outputSchema: updateConversationContextOutputSchema,
  handler: handler2
};

// src/tools/retrieveRelevantContext.tool.js
init_db();
import { z as z4 } from "zod";

// src/logic/InsightEngine.js
init_RelationshipContextManagerLogic();

// src/tools/retrieveRelevantContext.tool.js
init_RelationshipContextManagerLogic();
init_config();
init_logger();
async function handler3(input, sdkContext) {
  try {
    logMessage("INFO", `retrieve_relevant_context tool started`, {
      query: input.query?.substring(0, 50),
      conversationId: input.conversationId,
      tokenBudget: input.tokenBudget || DEFAULT_TOKEN_BUDGET
    });
    const {
      conversationId,
      query,
      tokenBudget = DEFAULT_TOKEN_BUDGET,
      constraints = {},
      contextFilters = {},
      weightingStrategy = "balanced",
      balanceStrategy = "proportional",
      contextBalance = "auto",
      sourceTypePreferences = {}
    } = input;
    if (!query) {
      const error = new Error("Query is required");
      error.code = "MISSING_QUERY";
      throw error;
    }
    if (!conversationId) {
      const error = new Error("Conversation ID is required");
      error.code = "MISSING_CONVERSATION_ID";
      throw error;
    }
    logMessage("DEBUG", `Context retrieval parameters`, {
      balanceStrategy,
      contextBalance,
      constraints: Object.keys(constraints),
      filters: Object.keys(contextFilters)
    });
    let conversationHistory = [];
    let currentTopic = null;
    let currentPurpose = null;
    try {
      conversationHistory = await getConversationHistory(
        conversationId,
        20
        // Get last 20 messages
      );
      logMessage("DEBUG", `Retrieved conversation history`, {
        messageCount: conversationHistory.length
      });
    } catch (err) {
      logMessage("WARN", `Failed to retrieve conversation history`, {
        error: err.message,
        conversationId
      });
    }
    const simplifiedResult = {
      relevantContext: [],
      conversationContext: conversationHistory.map((msg) => ({
        type: "conversation",
        content: msg.content,
        metadata: {
          role: msg.role,
          messageId: msg.messageId
        },
        relevanceScore: 0.9
      })),
      currentTopic,
      currentPurpose,
      statusMessage: "Retrieved conversation context successfully",
      metrics: {
        totalSnippets: conversationHistory.length,
        relevanceThreshold: 0.5,
        tokenUsage: conversationHistory.reduce(
          (acc, msg) => acc + _estimateTokenCount(msg.content),
          0
        )
      }
    };
    logMessage(
      "INFO",
      `Returning simplified context with ${simplifiedResult.conversationContext.length} conversation messages`
    );
    return simplifiedResult;
  } catch (error) {
    logMessage("ERROR", `Error in retrieve_relevant_context handler`, {
      error: error.message,
      code: error.code
    });
    throw error;
  }
}
function _estimateTokenCount(text) {
  try {
    if (!text)
      return 0;
    return Math.ceil(text.length / 4);
  } catch (error) {
    logMessage("WARN", `Error estimating token count`, {
      error: error.message,
      textLength: text?.length || 0
    });
    return text ? Math.ceil(text.length / 4) : 0;
  }
}
var retrieveRelevantContext_tool_default = {
  name: "retrieve_relevant_context",
  description: "Retrieves context from multiple sources that is relevant to the current query or conversation",
  inputSchema: retrieveRelevantContextInputSchema,
  outputSchema: retrieveRelevantContextOutputSchema,
  handler: handler3
};

// src/tools/recordMilestoneContext.tool.js
init_db();
import { z as z5 } from "zod";
import { v4 as uuidv412 } from "uuid";

// src/logic/LearningSystem.js
init_db();

// src/logic/SemanticPatternRecognizerLogic.js
init_RelationshipContextManagerLogic();
init_db();
import { v4 as uuidv410 } from "uuid";
async function recognizePatterns(entity) {
  try {
    const { content, raw_content, language, type, custom_metadata } = entity;
    if (!content && !raw_content) {
      return { patterns: [], confidence: 0 };
    }
    const entityContent = raw_content || content;
    let structuralFeatures = custom_metadata?.structuralFeatures;
    if (!structuralFeatures) {
      const ast = await buildAST(
        entityContent,
        language
      );
      structuralFeatures = await extractStructuralFeatures(ast);
    }
    const tokenizedContent = tokenize(entityContent);
    const keywords = extractKeywords(tokenizedContent);
    const codeNgrams = extractNGrams(tokenizedContent, 3);
    const knownPatterns = await getKnownPatterns({
      language,
      // Filter by entity's language
      minConfidence: 0.3
      // Only get reasonably confident patterns
    });
    if (knownPatterns.length === 0) {
      return { patterns: [], confidence: 0 };
    }
    const matchResults = await Promise.all(
      knownPatterns.map(
        (pattern) => matchPattern(
          pattern,
          entityContent,
          structuralFeatures,
          keywords,
          codeNgrams,
          type
        )
      )
    );
    const matchedPatterns = matchResults.filter((result) => result.confidence > 0.1).sort((a, b) => b.confidence - a.confidence);
    let overallConfidence = 0;
    let totalImportance = 0;
    if (matchedPatterns.length > 0) {
      for (const match of matchedPatterns) {
        const importance = match.pattern.importance || 0.5;
        overallConfidence += match.confidence * importance;
        totalImportance += importance;
      }
      overallConfidence = totalImportance > 0 ? overallConfidence / totalImportance : matchedPatterns[0].confidence;
    }
    return {
      patterns: matchedPatterns.map((match) => match.pattern),
      confidence: overallConfidence
    };
  } catch (error) {
    console.error("Error in pattern recognition:", error);
    return { patterns: [], confidence: 0 };
  }
}
async function getKnownPatterns(filterOptions = {}) {
  try {
    const { type, minConfidence, language } = filterOptions;
    let query = "SELECT * FROM project_patterns WHERE 1=1";
    const params = [];
    if (type) {
      query += " AND pattern_type = ?";
      params.push(type);
    }
    if (minConfidence !== void 0 && !isNaN(minConfidence)) {
      query += " AND confidence_score >= ?";
      params.push(minConfidence);
    }
    if (language) {
      query += " AND (language = ? OR language = ? OR language IS NULL)";
      params.push(language, "any");
    }
    query += " ORDER BY confidence_score DESC, frequency DESC";
    const patterns = await executeQuery(query, params);
    return patterns.map((pattern) => ({
      ...pattern,
      detection_rules: JSON.parse(pattern.detection_rules || "{}")
    }));
  } catch (error) {
    console.error("Error retrieving patterns with filters:", error);
    throw new Error(`Failed to retrieve patterns: ${error.message}`);
  }
}
async function matchPattern(pattern, content, structuralFeatures, keywords, codeNgrams, entityType) {
  try {
    const { detection_rules } = pattern;
    let textualMatchScore = 0;
    let structuralMatchScore = 0;
    let typeMatchScore = 0;
    if (detection_rules.applicable_types && Array.isArray(detection_rules.applicable_types)) {
      typeMatchScore = detection_rules.applicable_types.includes(entityType) ? 1 : 0;
      if (typeMatchScore === 0 && detection_rules.strict_type_matching) {
        return { pattern, confidence: 0 };
      }
    } else {
      typeMatchScore = 1;
    }
    if (detection_rules.keywords && Array.isArray(detection_rules.keywords)) {
      const keywordMatches = detection_rules.keywords.filter(
        (keyword) => keywords.includes(keyword)
      );
      textualMatchScore = keywordMatches.length / detection_rules.keywords.length;
    }
    if (detection_rules.text_patterns && Array.isArray(detection_rules.text_patterns)) {
      let patternMatchCount = 0;
      for (const textPattern of detection_rules.text_patterns) {
        if (typeof textPattern === "string") {
          if (content.includes(textPattern)) {
            patternMatchCount++;
          }
        } else if (textPattern instanceof RegExp || typeof textPattern === "object" && textPattern.pattern) {
          const pattern2 = textPattern instanceof RegExp ? textPattern : new RegExp(textPattern.pattern, textPattern.flags || "");
          if (pattern2.test(content)) {
            patternMatchCount++;
          }
        }
      }
      const textPatternScore = detection_rules.text_patterns.length > 0 ? patternMatchCount / detection_rules.text_patterns.length : 0;
      textualMatchScore = textualMatchScore > 0 ? (textualMatchScore + textPatternScore) / 2 : textPatternScore;
    }
    if (detection_rules.structural_rules && Array.isArray(detection_rules.structural_rules)) {
      let structRuleMatchCount = 0;
      for (const rule of detection_rules.structural_rules) {
        const { feature, condition, value } = rule;
        if (!feature || !condition || value === void 0)
          continue;
        const featureValue = structuralFeatures[feature];
        if (featureValue === void 0)
          continue;
        let matches = false;
        switch (condition) {
          case "equals":
            matches = featureValue === value;
            break;
          case "contains":
            matches = Array.isArray(featureValue) ? featureValue.includes(value) : String(featureValue).includes(String(value));
            break;
          case "greater_than":
            matches = Number(featureValue) > Number(value);
            break;
          case "less_than":
            matches = Number(featureValue) < Number(value);
            break;
          case "matches_regex":
            matches = new RegExp(value).test(String(featureValue));
            break;
          default:
            matches = false;
        }
        if (matches) {
          structRuleMatchCount++;
        }
      }
      structuralMatchScore = detection_rules.structural_rules.length > 0 ? structRuleMatchCount / detection_rules.structural_rules.length : 0;
    }
    const weights = detection_rules.weights || {
      textual: 0.4,
      structural: 0.4,
      type: 0.2
    };
    const confidence = textualMatchScore * weights.textual + structuralMatchScore * weights.structural + typeMatchScore * weights.type;
    return { pattern, confidence };
  } catch (error) {
    console.error(`Error matching pattern ${pattern.name}:`, error);
    return { pattern, confidence: 0 };
  }
}

// src/logic/LearningSystem.js
import { v4 as uuidv411 } from "uuid";
async function analyzePatternsAroundMilestone(milestoneSnapshotId) {
  try {
    console.log(
      `[LearningSystem] Analyzing patterns around milestone: ${milestoneSnapshotId}`
    );
    const snapshotQuery = `SELECT * FROM context_states WHERE milestone_id = ?`;
    const snapshots = await executeQuery(snapshotQuery, [milestoneSnapshotId]);
    if (!snapshots || snapshots.length === 0) {
      console.warn(
        `[LearningSystem] No context snapshot found for milestone ${milestoneSnapshotId}`
      );
      return;
    }
    const snapshot = snapshots[0];
    const { created_at, focus_areas, conversation_id } = snapshot;
    const milestoneTime = new Date(created_at).getTime();
    const windowBeforeMs = 2 * 60 * 60 * 1e3;
    const windowAfterMs = 1 * 60 * 60 * 1e3;
    const windowStart = new Date(milestoneTime - windowBeforeMs).toISOString();
    const windowEnd = new Date(milestoneTime + windowAfterMs).toISOString();
    const eventsQuery = `
      SELECT * FROM timeline_events
      WHERE conversation_id = ?
        AND timestamp >= ?
        AND timestamp <= ?
      ORDER BY timestamp ASC
    `;
    const events = await executeQuery(eventsQuery, [
      conversation_id,
      windowStart,
      windowEnd
    ]);
    const historyQuery = `
      SELECT * FROM conversation_history
      WHERE conversation_id = ?
        AND timestamp >= ?
        AND timestamp <= ?
      ORDER BY timestamp ASC
    `;
    const messages = await executeQuery(historyQuery, [
      conversation_id,
      windowStart,
      windowEnd
    ]);
    const entityAccessCounts = {};
    for (const event of events) {
      if (event.data) {
        try {
          const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
          if (data.activeFile) {
            entityAccessCounts[data.activeFile] = (entityAccessCounts[data.activeFile] || 0) + 1;
          }
          if (data.relatedFiles && Array.isArray(data.relatedFiles)) {
            for (const file of data.relatedFiles) {
              entityAccessCounts[file] = (entityAccessCounts[file] || 0) + 1;
            }
          }
        } catch (err) {
        }
      }
    }
    const searchQueries = events.filter((e) => e.type === "search_query").map((e) => {
      try {
        const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        return data && data.query ? data.query : null;
      } catch {
        return null;
      }
    }).filter(Boolean);
    const topicCounts = {};
    const purposeCounts = {};
    for (const msg of messages) {
      if (msg.topic_segment_id) {
        topicCounts[msg.topic_segment_id] = (topicCounts[msg.topic_segment_id] || 0) + 1;
      }
      if (msg.purpose_type) {
        purposeCounts[msg.purpose_type] = (purposeCounts[msg.purpose_type] || 0) + 1;
      }
    }
    console.log(
      `[LearningSystem] Milestone ${milestoneSnapshotId} context analysis:`
    );
    console.log(
      "  Most accessed code entities:",
      Object.entries(entityAccessCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
    );
    console.log("  Most common search queries:", searchQueries.slice(0, 5));
    console.log(
      "  Most discussed topics:",
      Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 3)
    );
    console.log(
      "  Most discussed purposes:",
      Object.entries(purposeCounts).sort((a, b) => b[1] - a[1]).slice(0, 3)
    );
    console.log(
      `[LearningSystem] Analysis around milestone ${milestoneSnapshotId} complete.`
    );
  } catch (error) {
    console.error(
      `[LearningSystem] Error analyzing patterns around milestone ${milestoneSnapshotId}:`,
      error
    );
  }
}
async function extractPatternsFromConversation(conversationId) {
  try {
    console.log(
      `[LearningSystem] Extracting patterns from conversation ${conversationId}`
    );
    const conversationHistory = await getConversationHistory(conversationId);
    if (!conversationHistory || conversationHistory.length === 0) {
      console.log(
        `[LearningSystem] No conversation history found for ${conversationId}`
      );
      return [];
    }
    const codeEntityIds = /* @__PURE__ */ new Set();
    for (const message of conversationHistory) {
      if (message.related_context_entity_ids && Array.isArray(message.related_context_entity_ids)) {
        message.related_context_entity_ids.forEach(
          (id) => codeEntityIds.add(id)
        );
      }
    }
    if (codeEntityIds.size === 0) {
      console.log(
        `[LearningSystem] No code entities found in conversation ${conversationId}`
      );
      return [];
    }
    const codeEntities = [];
    for (const entityId of codeEntityIds) {
      const entityQuery = `SELECT * FROM code_entities WHERE id = ?`;
      const entityResults = await executeQuery(entityQuery, [entityId]);
      if (entityResults && entityResults.length > 0) {
        codeEntities.push(entityResults[0]);
      }
    }
    const recognizedPatternIds = /* @__PURE__ */ new Set();
    for (const entity of codeEntities) {
      try {
        const { patterns: patterns2 } = await recognizePatterns(entity);
        if (patterns2 && patterns2.length > 0) {
          patterns2.forEach((pattern) => {
            if (pattern.pattern_id) {
              recognizedPatternIds.add(pattern.pattern_id);
            }
          });
        }
      } catch (error) {
        console.warn(
          `[LearningSystem] Error recognizing patterns in entity ${entity.id}:`,
          error
        );
      }
    }
    if (recognizedPatternIds.size === 0) {
      console.log(
        `[LearningSystem] No patterns recognized in conversation ${conversationId}`
      );
      return [];
    }
    const patternIdArray = Array.from(recognizedPatternIds);
    const placeholders = patternIdArray.map(() => "?").join(",");
    const patternsQuery = `
      SELECT * FROM project_patterns 
      WHERE pattern_id IN (${placeholders})
      ORDER BY confidence_score DESC
    `;
    const patterns = await executeQuery(patternsQuery, patternIdArray);
    console.log(
      `[LearningSystem] Found ${patterns.length} patterns in conversation ${conversationId}`
    );
    return patterns.map((pattern) => ({
      ...pattern,
      detection_rules: pattern.detection_rules ? JSON.parse(pattern.detection_rules) : {},
      is_global: Boolean(pattern.is_global)
    }));
  } catch (error) {
    console.error(
      `[LearningSystem] Error extracting patterns from conversation:`,
      error
    );
    return [];
  }
}
async function extractBugPatterns(conversationId) {
  try {
    console.log(
      `[LearningSystem] Extracting bug patterns from conversation ${conversationId}`
    );
    const messages = await getConversationHistory(
      conversationId
    );
    if (!messages || messages.length === 0) {
      return [];
    }
    const errorPatterns = [
      /error:?\s+([^\n.]+)/i,
      /exception:?\s+([^\n.]+)/i,
      /failed\s+(?:to|with):?\s+([^\n.]+)/i,
      /bug:?\s+([^\n.]+)/i,
      /issue:?\s+([^\n.]+)/i,
      /problem:?\s+([^\n.]+)/i
    ];
    const fixPatterns = [
      /fix(?:ed|ing)?:?\s+([^\n.]+)/i,
      /solv(?:ed|ing)?:?\s+([^\n.]+)/i,
      /resolv(?:ed|ing)?:?\s+([^\n.]+)/i,
      /solutions?:?\s+([^\n.]+)/i,
      /workaround:?\s+([^\n.]+)/i,
      /(?:the\s+)?(?:root\s+)?cause\s+(?:is|was):?\s+([^\n.]+)/i
    ];
    const bugDescriptions = [];
    const bugSolutions = [];
    for (const message of messages) {
      const content = message.content;
      if (!content)
        continue;
      for (const pattern of errorPatterns) {
        const matches = content.match(pattern);
        if (matches && matches[1]) {
          bugDescriptions.push({
            description: matches[1].trim(),
            confidence: 0.7,
            messageId: message.message_id,
            type: "error"
          });
        }
      }
      for (const pattern of fixPatterns) {
        const matches = content.match(pattern);
        if (matches && matches[1]) {
          bugSolutions.push({
            description: matches[1].trim(),
            confidence: 0.7,
            messageId: message.message_id,
            type: "solution"
          });
        }
      }
      const codeBlockMatches = content.match(/```[\s\S]*?```/g);
      if (codeBlockMatches) {
        for (const codeBlock of codeBlockMatches) {
          if (/error|exception|traceback|fail|bug|issue/i.test(codeBlock)) {
            bugDescriptions.push({
              description: codeBlock.replace(/```/g, "").trim().substring(0, 100) + "...",
              confidence: 0.8,
              messageId: message.message_id,
              type: "code_error"
            });
          }
        }
      }
    }
    const bugPatterns = [];
    for (const bug of bugDescriptions) {
      const bugTokens = tokenize(bug.description);
      const bugKeywords = extractKeywords(bugTokens);
      let bestSolution = null;
      let bestScore = 0;
      for (const solution of bugSolutions) {
        const solutionTokens = tokenize(
          solution.description
        );
        const solutionKeywords = extractKeywords(solutionTokens);
        let matchScore = 0;
        for (const bugKeyword of bugKeywords) {
          if (solutionKeywords.includes(bugKeyword)) {
            matchScore++;
          }
        }
        if (matchScore > bestScore) {
          bestScore = matchScore;
          bestSolution = solution;
        }
      }
      bugPatterns.push({
        description: bug.description,
        confidence: bug.confidence,
        solution: bestSolution ? bestSolution.description : void 0,
        relatedIssues: []
        // Would require additional lookup to find related issues
      });
    }
    for (const solution of bugSolutions) {
      const alreadyUsed = bugPatterns.some(
        (bp) => bp.solution === solution.description
      );
      if (!alreadyUsed) {
        bugPatterns.push({
          description: `Solution: ${solution.description}`,
          confidence: 0.6,
          relatedIssues: []
        });
      }
    }
    const seenDescriptions = /* @__PURE__ */ new Set();
    const uniquePatterns = [];
    for (const pattern of bugPatterns) {
      if (!seenDescriptions.has(pattern.description)) {
        seenDescriptions.add(pattern.description);
        uniquePatterns.push(pattern);
      }
    }
    console.log(
      `[LearningSystem] Extracted ${uniquePatterns.length} bug patterns from conversation ${conversationId}`
    );
    return uniquePatterns;
  } catch (error) {
    console.error(`[LearningSystem] Error extracting bug patterns:`, error);
    return [];
  }
}
async function extractKeyValuePairs(messages, conversationId) {
  try {
    console.log(
      `[LearningSystem] Extracting key-value pairs from conversation ${conversationId}`
    );
    if (!messages || messages.length === 0) {
      console.log(
        "[LearningSystem] No messages provided for key-value extraction"
      );
      return [];
    }
    const messageContents = messages.map((msg) => msg.content || "").filter((content) => content.trim().length > 0);
    if (messageContents.length === 0) {
      return [];
    }
    const extractedPairs = [];
    for (const content of messageContents) {
      const colonPattern = /^([^:]+):\s*(.+)$/gm;
      let match;
      while ((match = colonPattern.exec(content)) !== null) {
        const key = match[1].trim();
        const value = match[2].trim();
        if (key && value && key.length < 100 && !key.includes("\n")) {
          extractedPairs.push({
            key,
            value,
            confidence: 0.8
          });
        }
      }
      const isPattern = /(?:The\s+)?([A-Za-z0-9\s_-]+)\s+is\s+([^.]+)/g;
      while ((match = isPattern.exec(content)) !== null) {
        const key = match[1].trim();
        const value = match[2].trim();
        if (key && value && key.length < 50 && !key.includes("\n")) {
          extractedPairs.push({
            key,
            value,
            confidence: 0.6
          });
        }
      }
    }
    const keyMap = /* @__PURE__ */ new Map();
    for (const pair of extractedPairs) {
      const existingPair = keyMap.get(pair.key.toLowerCase());
      if (!existingPair || existingPair.confidence < pair.confidence) {
        keyMap.set(pair.key.toLowerCase(), pair);
      }
    }
    return Array.from(keyMap.values());
  } catch (error) {
    console.error("[LearningSystem] Error extracting key-value pairs:", error);
    return [];
  }
}
async function storePattern(pattern) {
  try {
    console.log(`[LearningSystem] Storing pattern: ${pattern.name}`);
    if (!pattern || !pattern.name || !pattern.description || !pattern.representation) {
      throw new Error("Invalid pattern: missing required fields");
    }
    const patternId = pattern.id || uuidv411();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const confidence = pattern.confidence || 0.7;
    const query = `
      INSERT INTO project_patterns 
      (pattern_id, pattern_type, name, description, representation, language, confidence_score, created_at, updated_at, session_origin_id) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pattern_id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        representation = excluded.representation,
        language = excluded.language,
        confidence_score = excluded.confidence_score,
        updated_at = excluded.updated_at
    `;
    await executeQuery(query, [
      patternId,
      pattern.category || "code_pattern",
      pattern.name,
      pattern.description,
      pattern.representation,
      pattern.language || null,
      confidence,
      now,
      now,
      pattern.conversationId || null
    ]);
    return {
      id: patternId,
      ...pattern,
      created_at: now,
      updated_at: now
    };
  } catch (error) {
    console.error("[LearningSystem] Error storing pattern:", error);
    throw new Error(`Failed to store pattern: ${error.message}`);
  }
}
async function storeBugPattern(bugPattern) {
  try {
    console.log(`[LearningSystem] Storing bug pattern: ${bugPattern.name}`);
    if (!bugPattern || !bugPattern.name || !bugPattern.description) {
      throw new Error("Invalid bug pattern: missing required fields");
    }
    const patternId = bugPattern.id || uuidv411();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const confidence = bugPattern.confidence || 0.7;
    let representation = bugPattern.representation;
    if (bugPattern.solution && typeof representation === "object") {
      representation = {
        ...JSON.parse(
          typeof representation === "string" ? representation : JSON.stringify(representation)
        ),
        solution: bugPattern.solution
      };
      representation = JSON.stringify(representation);
    } else if (bugPattern.solution && typeof representation === "string") {
      try {
        const parsed = JSON.parse(representation);
        parsed.solution = bugPattern.solution;
        representation = JSON.stringify(parsed);
      } catch (e) {
      }
    }
    const query = `
      INSERT INTO project_patterns 
      (pattern_id, pattern_type, name, description, representation, language, confidence_score, created_at, updated_at, session_origin_id) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pattern_id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        representation = excluded.representation,
        language = excluded.language,
        confidence_score = excluded.confidence_score,
        updated_at = excluded.updated_at
    `;
    await executeQuery(query, [
      patternId,
      "bug_pattern",
      bugPattern.name,
      bugPattern.description,
      representation,
      bugPattern.language || null,
      confidence,
      now,
      now,
      bugPattern.conversationId || null
    ]);
    return {
      id: patternId,
      ...bugPattern,
      created_at: now,
      updated_at: now,
      pattern_type: "bug_pattern"
    };
  } catch (error) {
    console.error("[LearningSystem] Error storing bug pattern:", error);
    throw new Error(`Failed to store bug pattern: ${error.message}`);
  }
}
async function storeKeyValuePair(keyValuePair) {
  try {
    console.log(
      `[LearningSystem] Storing knowledge key-value pair: ${keyValuePair.key}`
    );
    if (!keyValuePair || !keyValuePair.key || !keyValuePair.value) {
      throw new Error("Invalid key-value pair: missing required fields");
    }
    const knowledgeId = keyValuePair.id || uuidv411();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const confidence = keyValuePair.confidence || 0.7;
    const category = keyValuePair.category || "general";
    const query = `
      INSERT INTO knowledge_items 
      (item_id, item_type, name, content, metadata, confidence_score, created_at, updated_at, conversation_id) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET
        name = excluded.name,
        content = excluded.content,
        metadata = excluded.metadata,
        confidence_score = excluded.confidence_score,
        updated_at = excluded.updated_at
    `;
    const metadata = JSON.stringify({
      category,
      source: keyValuePair.conversationId ? "conversation" : "analysis",
      conversationId: keyValuePair.conversationId || null
    });
    await executeQuery(query, [
      knowledgeId,
      "concept_definition",
      keyValuePair.key,
      keyValuePair.value,
      metadata,
      confidence,
      now,
      now,
      keyValuePair.conversationId || null
    ]);
    return {
      id: knowledgeId,
      ...keyValuePair,
      created_at: now,
      updated_at: now,
      item_type: "concept_definition"
    };
  } catch (error) {
    console.error("[LearningSystem] Error storing key-value pair:", error);
    throw new Error(`Failed to store key-value pair: ${error.message}`);
  }
}

// src/tools/recordMilestoneContext.tool.js
init_RelationshipContextManagerLogic();
init_logger();
async function handler4(input, sdkContext) {
  try {
    logMessage("INFO", `record_milestone_context tool started`, {
      milestoneName: input.name,
      category: input.milestoneCategory || "uncategorized",
      conversationId: input.conversationId
    });
    const {
      conversationId,
      name,
      description = "",
      customData = {},
      milestoneCategory = "uncategorized",
      assessImpact = true
    } = input;
    if (!name) {
      const error = new Error("Milestone name is required");
      error.code = "MISSING_NAME";
      throw error;
    }
    let activeContextEntities = [];
    let activeFocus2 = null;
    let activeContextIds = [];
    try {
      activeContextEntities = await getActiveContextAsEntities();
      activeFocus2 = await getActiveFocus();
      activeContextIds = activeContextEntities.map((entity) => entity.id);
      logMessage("DEBUG", `Retrieved active context`, {
        entityCount: activeContextIds.length,
        hasFocus: !!activeFocus2
      });
    } catch (contextErr) {
      logMessage(
        "WARN",
        `Error retrieving active context, continuing with empty context`,
        {
          error: contextErr.message
        }
      );
    }
    const snapshotData = {
      milestoneCategory,
      name,
      description,
      activeFocus: activeFocus2,
      entityIds: activeContextIds,
      customData,
      timestamp: Date.now(),
      conversationId
    };
    let milestoneEventId;
    try {
      milestoneEventId = await recordEvent(
        "milestone_created",
        {
          name,
          category: milestoneCategory,
          entityCount: activeContextIds.length,
          timestamp: Date.now()
        },
        activeContextIds,
        conversationId
      );
      logMessage("DEBUG", `Recorded milestone event in timeline`, {
        eventId: milestoneEventId
      });
    } catch (timelineErr) {
      logMessage("ERROR", `Failed to record milestone event in timeline`, {
        error: timelineErr.message,
        name,
        category: milestoneCategory
      });
      throw timelineErr;
    }
    let milestoneId;
    try {
      milestoneId = await createSnapshot(
        snapshotData,
        name,
        description,
        milestoneEventId
      );
      logMessage("INFO", `Created milestone with ID: ${milestoneId}`);
    } catch (snapshotErr) {
      logMessage("ERROR", `Failed to create milestone snapshot`, {
        error: snapshotErr.message,
        name,
        eventId: milestoneEventId
      });
      throw snapshotErr;
    }
    let impactAssessment = null;
    if (assessImpact) {
      try {
        logMessage("INFO", `Starting impact assessment for milestone`, {
          milestoneId,
          category: milestoneCategory
        });
        impactAssessment = await _assessMilestoneImpact(
          milestoneId,
          milestoneCategory,
          activeContextIds
        );
      } catch (impactErr) {
        logMessage("WARN", `Failed to assess milestone impact`, {
          error: impactErr.message,
          milestoneId
        });
        impactAssessment = {
          impactScore: 0,
          impactLevel: "unknown",
          impactSummary: `Unable to assess impact: ${impactErr.message}`,
          error: impactErr.message,
          scopeMetrics: {
            directlyModifiedEntities: activeContextIds.length,
            potentiallyImpactedEntities: 0,
            impactedComponents: 0,
            criticalPathsCount: 0
          }
        };
      }
    } else {
      logMessage("DEBUG", `Skipping impact assessment (not requested)`);
    }
    setTimeout(() => {
      logMessage(
        "DEBUG",
        `Starting background pattern analysis for milestone: ${milestoneId}`
      );
      analyzePatternsAroundMilestone(milestoneId).catch(
        (error) => {
          logMessage("ERROR", `Error in background pattern analysis`, {
            error: error.message,
            milestoneId
          });
        }
      );
    }, 100);
    logMessage("INFO", `record_milestone_context tool completed successfully`, {
      milestoneId,
      entityCount: activeContextIds.length,
      hasImpactAssessment: !!impactAssessment
    });
    const responseData = {
      message: `Milestone "${name}" recorded successfully with ${activeContextIds.length} related entities.`,
      milestoneId,
      status: "success",
      milestoneCategory,
      relatedEntitiesCount: activeContextIds.length,
      impactAssessment
    };
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(responseData)
        }
      ]
    };
  } catch (error) {
    logMessage("ERROR", `Error in record_milestone_context tool`, {
      error: error.message,
      stack: error.stack,
      input: {
        name: input.name,
        category: input.milestoneCategory,
        conversationId: input.conversationId
      }
    });
    const errorResponse = {
      error: true,
      errorCode: error.code || "MILESTONE_RECORDING_FAILED",
      errorDetails: error.message,
      milestoneId: null,
      status: "error",
      milestoneCategory: input.milestoneCategory || "uncategorized",
      relatedEntitiesCount: 0,
      impactAssessment: {
        error: error.message
      }
    };
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(errorResponse)
        }
      ]
    };
  }
}
async function _assessMilestoneImpact(milestoneId, category, activeContextIds) {
  try {
    logMessage("DEBUG", `Assessing impact for milestone: ${milestoneId}`, {
      category,
      entityCount: activeContextIds?.length || 0
    });
    if (!activeContextIds || activeContextIds.length === 0) {
      logMessage(
        "DEBUG",
        `No active context entities, skipping detailed impact assessment`
      );
      return {
        impactScore: 0,
        impactLevel: "none",
        impactSummary: "No code entities were modified in this milestone.",
        scopeMetrics: {
          directlyModifiedEntities: 0,
          potentiallyImpactedEntities: 0,
          impactedComponents: 0,
          criticalPathsCount: 0
        }
      };
    }
    let entities = [];
    try {
      logMessage(
        "DEBUG",
        `Fetching details for ${activeContextIds.length} entities`
      );
      const entityDetails = await Promise.all(
        activeContextIds.map(async (id) => {
          try {
            const query = `SELECT * FROM code_entities WHERE entity_id = ?`;
            const result = await executeQuery(query, [id]);
            return result.length > 0 ? result[0] : null;
          } catch (queryErr) {
            logMessage("WARN", `Failed to fetch entity details`, {
              error: queryErr.message,
              entityId: id
            });
            return null;
          }
        })
      );
      entities = entityDetails.filter(Boolean);
      logMessage(
        "DEBUG",
        `Retrieved details for ${entities.length}/${activeContextIds.length} entities`
      );
    } catch (fetchErr) {
      logMessage("ERROR", `Failed to fetch entity details`, {
        error: fetchErr.message
      });
      return {
        impactScore: 0.1,
        impactLevel: "unknown",
        impactSummary: `Impact could not be fully assessed due to database error: ${fetchErr.message}`,
        scopeMetrics: {
          directlyModifiedEntities: activeContextIds.length,
          potentiallyImpactedEntities: 0,
          impactedComponents: 0,
          criticalPathsCount: 0
        },
        error: fetchErr.message
      };
    }
    const impactedEntityIds = new Set(activeContextIds);
    const criticalPaths = [];
    const componentImpacts = /* @__PURE__ */ new Map();
    const entityTypeMap = /* @__PURE__ */ new Map();
    entities.forEach((entity) => {
      entityTypeMap.set(entity.entity_id, entity.entity_type);
    });
    try {
      for (const entity of entities) {
        const outgoingRelationships = await getRelationships(
          entity.entity_id,
          "outgoing"
        );
        logMessage(
          "DEBUG",
          `Retrieved ${outgoingRelationships.length} outgoing relationships for entity`,
          {
            entityId: entity.entity_id,
            entityType: entity.entity_type
          }
        );
        for (const rel of outgoingRelationships) {
          if (!impactedEntityIds.has(rel.target_entity_id)) {
            impactedEntityIds.add(rel.target_entity_id);
            if (rel.relationship_type === "calls" || rel.relationship_type === "extends" || rel.relationship_type === "implements") {
              criticalPaths.push({
                source: entity.entity_id,
                target: rel.target_entity_id,
                type: rel.relationship_type,
                criticality: 0.8
                // Default high criticality for these types
              });
            }
          }
        }
        const filePath = entity.file_path || "";
        const component = filePath.split("/").slice(0, 2).join("/");
        if (component) {
          const currentCount = componentImpacts.get(component) || 0;
          componentImpacts.set(component, currentCount + 1);
        }
      }
    } catch (relErr) {
      logMessage("WARN", `Error analyzing relationships`, {
        error: relErr.message,
        milestoneId
      });
    }
    logMessage("DEBUG", `Completed relationship analysis`, {
      impactedEntities: impactedEntityIds.size,
      criticalPaths: criticalPaths.length,
      componentCount: componentImpacts.size
    });
    const directlyModifiedCount = activeContextIds.length;
    const potentiallyImpactedCount = impactedEntityIds.size - directlyModifiedCount;
    const impactedComponentsCount = componentImpacts.size;
    const criticalPathsCount = criticalPaths.length;
    let impactScore;
    let impactLevel;
    try {
      const baseImpactScore = Math.min(
        1,
        directlyModifiedCount * 0.02 + potentiallyImpactedCount * 0.01 + impactedComponentsCount * 0.1 + criticalPathsCount * 0.05
      );
      let categoryMultiplier = 1;
      switch (category) {
        case "major_feature":
          categoryMultiplier = 1.2;
          break;
        case "refactoring":
          categoryMultiplier = 1.5;
          break;
        case "bug_fix":
          categoryMultiplier = 0.7;
          break;
        case "critical_fix":
          categoryMultiplier = 1.3;
          break;
        default:
          categoryMultiplier = 1;
      }
      impactScore = Math.min(1, baseImpactScore * categoryMultiplier);
      if (impactScore < 0.2) {
        impactLevel = "low";
      } else if (impactScore < 0.5) {
        impactLevel = "medium";
      } else if (impactScore < 0.8) {
        impactLevel = "high";
      } else {
        impactLevel = "critical";
      }
      logMessage("INFO", `Calculated impact assessment`, {
        impactScore,
        impactLevel,
        directlyModified: directlyModifiedCount,
        potentiallyImpacted: potentiallyImpactedCount,
        components: impactedComponentsCount
      });
    } catch (calcErr) {
      logMessage("ERROR", `Error calculating impact score`, {
        error: calcErr.message
      });
      impactScore = 0.3;
      impactLevel = "medium";
    }
    let impactSummary;
    try {
      impactSummary = _generateImpactSummary(
        impactLevel,
        directlyModifiedCount,
        potentiallyImpactedCount,
        impactedComponentsCount,
        criticalPathsCount,
        category
      );
    } catch (summaryErr) {
      logMessage("WARN", `Error generating impact summary`, {
        error: summaryErr.message
      });
      impactSummary = `This milestone has a ${impactLevel} impact, affecting ${directlyModifiedCount} entities directly and potentially impacting ${potentiallyImpactedCount} others.`;
    }
    return {
      impactScore,
      impactLevel,
      impactSummary,
      scopeMetrics: {
        directlyModifiedEntities: directlyModifiedCount,
        potentiallyImpactedEntities: potentiallyImpactedCount,
        impactedComponents: impactedComponentsCount,
        criticalPathsCount
      },
      componentBreakdown: Object.fromEntries(componentImpacts),
      criticalPathsTop: criticalPaths.slice(0, 5)
      // Only include top 5 critical paths
    };
  } catch (error) {
    logMessage("ERROR", `Error in impact assessment`, {
      error: error.message,
      stack: error.stack,
      milestoneId,
      category
    });
    return {
      impactScore: 0.1,
      impactLevel: "unknown",
      impactSummary: `Impact assessment encountered an error: ${error.message}`,
      error: error.message,
      scopeMetrics: {
        directlyModifiedEntities: activeContextIds ? activeContextIds.length : 0,
        potentiallyImpactedEntities: 0,
        impactedComponents: 0,
        criticalPathsCount: 0
      }
    };
  }
}
function _generateImpactSummary(impactLevel, directCount, indirectCount, componentCount, criticalPathCount, category) {
  try {
    let summary = `This ${category} milestone has a ${impactLevel} impact, `;
    summary += `directly modifying ${directCount} entities and potentially affecting ${indirectCount} additional entities. `;
    if (componentCount > 0) {
      summary += `Changes span ${componentCount} component${componentCount === 1 ? "" : "s"}. `;
    }
    if (criticalPathCount > 0) {
      summary += `Found ${criticalPathCount} critical dependency path${criticalPathCount === 1 ? "" : "s"} that may require careful testing. `;
    }
    switch (category) {
      case "refactoring":
        summary += "Since this is a refactoring, consider comprehensive regression testing.";
        break;
      case "major_feature":
        summary += "As a major feature, ensure adequate test coverage for new functionality.";
        break;
      case "bug_fix":
        summary += "For this bug fix, focus testing on the specific issue resolution.";
        break;
      case "critical_fix":
        summary += "This critical fix requires careful validation in production-like environments.";
        break;
    }
    return summary;
  } catch (error) {
    logMessage("WARN", `Error generating impact summary text`, {
      error: error.message
    });
    return `This milestone has a ${impactLevel} impact, affecting ${directCount} entities directly.`;
  }
}
var recordMilestoneContext_tool_default = {
  name: "record_milestone_context",
  description: "Records a development milestone and its context, creating a snapshot for reference and learning",
  inputSchema: recordMilestoneContextInputSchema,
  outputSchema: recordMilestoneContextOutputSchema,
  handler: handler4
};

// src/tools/finalizeConversationContext.tool.js
init_db();
import { z as z6 } from "zod";
init_logger();
async function handler5(input, sdkContext) {
  try {
    logMessage("INFO", `finalize_conversation_context tool started`, {
      conversationId: input.conversationId,
      outcome: input.outcome || "completed",
      clearActiveContext: input.clearActiveContext || false
    });
    const {
      conversationId,
      clearActiveContext: clearActiveContext2 = false,
      extractLearnings = true,
      promotePatterns = true,
      synthesizeRelatedTopics = true,
      generateNextSteps = true,
      outcome = "completed"
    } = input;
    if (!conversationId) {
      const error = new Error("Conversation ID is required");
      error.code = "MISSING_CONVERSATION_ID";
      throw error;
    }
    logMessage("DEBUG", `Processing options`, {
      extractLearnings,
      promotePatterns,
      synthesizeRelatedTopics,
      generateNextSteps
    });
    let conversationHistory = [];
    let conversationPurpose = null;
    let conversationTopics = [];
    try {
      conversationHistory = await getConversationHistory(conversationId);
      if (!conversationHistory || conversationHistory.length === 0) {
        const error = new Error(
          `No conversation history found for ID: ${conversationId}`
        );
        error.code = "CONVERSATION_NOT_FOUND";
        throw error;
      }
      logMessage("DEBUG", `Retrieved conversation history`, {
        messageCount: conversationHistory.length
      });
    } catch (historyErr) {
      logMessage("ERROR", `Failed to retrieve conversation history`, {
        error: historyErr.message,
        conversationId
      });
      throw historyErr;
    }
    try {
      conversationPurpose = await getConversationPurpose(conversationId);
      logMessage(
        "DEBUG",
        `Retrieved conversation purpose: ${conversationPurpose || "Unknown"}`
      );
    } catch (purposeErr) {
      logMessage("WARN", `Failed to retrieve conversation purpose`, {
        error: purposeErr.message,
        conversationId
      });
    }
    try {
      conversationTopics = await getConversationTopics(
        conversationId
      );
      logMessage(
        "DEBUG",
        `Retrieved ${conversationTopics.length} conversation topics`
      );
    } catch (topicsErr) {
      logMessage("WARN", `Failed to retrieve conversation topics`, {
        error: topicsErr.message,
        conversationId
      });
      conversationTopics = [];
    }
    let summary = "";
    try {
      summary = await summarizeConversation(
        conversationId
      );
      logMessage("INFO", `Generated conversation summary`, {
        summaryLength: summary.length
      });
    } catch (summaryErr) {
      logMessage("WARN", `Failed to generate conversation summary`, {
        error: summaryErr.message,
        conversationId
      });
      summary = `Conversation ${conversationId} with ${conversationHistory.length} messages`;
    }
    try {
      await recordEvent(
        "conversation_end",
        {
          summary,
          purpose: conversationPurpose,
          topics: conversationTopics.length,
          outcome
        },
        [],
        // No specific entities for conversation end
        conversationId
      );
      logMessage("DEBUG", `Recorded conversation_end event in timeline`);
    } catch (timelineErr) {
      logMessage("WARN", `Failed to record conversation_end event`, {
        error: timelineErr.message,
        conversationId
      });
    }
    let extractedLearnings = null;
    let promotedPatterns = null;
    let relatedConversations = null;
    let nextSteps = null;
    if (extractLearnings) {
      try {
        logMessage("INFO", `Extracting learnings from conversation`);
        extractedLearnings = await _extractConversationLearnings(
          conversationId,
          conversationHistory
        );
        logMessage(
          "INFO",
          `Extracted ${extractedLearnings?.patterns?.length || 0} patterns and ${extractedLearnings?.bugPatterns?.length || 0} bug patterns`
        );
      } catch (learningErr) {
        logMessage("WARN", `Failed to extract learnings`, {
          error: learningErr.message,
          conversationId
        });
        extractedLearnings = {
          patterns: [],
          bugPatterns: [],
          conceptualInsights: [],
          error: learningErr.message
        };
      }
    } else {
      logMessage("DEBUG", `Skipping learning extraction (not requested)`);
    }
    if (promotePatterns) {
      try {
        logMessage("INFO", `Promoting patterns from conversation`);
        promotedPatterns = await _promoteConversationPatterns(
          conversationId,
          outcome
        );
        logMessage("INFO", `Promoted ${promotedPatterns?.count || 0} patterns`);
      } catch (patternErr) {
        logMessage("WARN", `Failed to promote patterns`, {
          error: patternErr.message,
          conversationId
        });
        promotedPatterns = {
          count: 0,
          patterns: [],
          error: patternErr.message
        };
      }
    } else {
      logMessage("DEBUG", `Skipping pattern promotion (not requested)`);
    }
    if (synthesizeRelatedTopics) {
      try {
        logMessage("INFO", `Finding and synthesizing related conversations`);
        relatedConversations = await _findAndSynthesizeRelatedConversations(
          conversationId,
          conversationTopics,
          conversationPurpose
        );
        logMessage(
          "INFO",
          `Found ${relatedConversations?.conversations?.length || 0} related conversations`
        );
      } catch (relatedErr) {
        logMessage("WARN", `Failed to synthesize related conversations`, {
          error: relatedErr.message,
          conversationId
        });
        relatedConversations = {
          conversations: [],
          insights: [],
          error: relatedErr.message
        };
      }
    } else {
      logMessage("DEBUG", `Skipping related topic synthesis (not requested)`);
    }
    if (generateNextSteps) {
      try {
        logMessage("INFO", `Generating next step suggestions`);
        nextSteps = await _generateNextStepSuggestions(
          conversationId,
          conversationPurpose,
          summary,
          extractedLearnings
        );
        logMessage(
          "INFO",
          `Generated ${nextSteps?.suggestions?.length || 0} next step suggestions`
        );
      } catch (nextStepsErr) {
        logMessage("WARN", `Failed to generate next step suggestions`, {
          error: nextStepsErr.message,
          conversationId
        });
        nextSteps = {
          suggestions: [],
          error: nextStepsErr.message
        };
      }
    } else {
      logMessage("DEBUG", `Skipping next step generation (not requested)`);
    }
    if (clearActiveContext2) {
      try {
        await clearActiveContext();
        logMessage("INFO", `Cleared active context`);
      } catch (clearErr) {
        logMessage("WARN", `Failed to clear active context`, {
          error: clearErr.message
        });
      }
    }
    logMessage(
      "INFO",
      `finalize_conversation_context tool completed successfully`
    );
    const responseData = {
      message: `Conversation ${conversationId} finalized successfully with outcome: ${outcome}`,
      status: "success",
      summary,
      purpose: conversationPurpose || "Unknown purpose",
      extractedLearnings,
      promotedPatterns,
      relatedConversations,
      nextSteps
    };
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(responseData)
        }
      ]
    };
  } catch (error) {
    logMessage("ERROR", `Error in finalize_conversation_context tool`, {
      error: error.message,
      stack: error.stack,
      input: {
        conversationId: input.conversationId,
        outcome: input.outcome
      }
    });
    const errorResponse = {
      error: true,
      errorCode: error.code || "FINALIZATION_FAILED",
      errorDetails: error.message,
      summary: "Failed to finalize conversation context",
      purpose: "Unknown due to error",
      extractedLearnings: null,
      promotedPatterns: null,
      relatedConversations: null,
      nextSteps: null
    };
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(errorResponse)
        }
      ]
    };
  }
}
async function _extractConversationLearnings(conversationId, conversationHistory) {
  try {
    logMessage(
      "DEBUG",
      `Extracting learnings from conversation ${conversationId}`,
      {
        messageCount: conversationHistory.length
      }
    );
    let patterns = [];
    let bugPatterns = [];
    let conceptualInsights = [];
    let keyValuePairs = [];
    try {
      patterns = await extractPatternsFromConversation(
        conversationId
      );
      logMessage("DEBUG", `Extracted ${patterns.length} patterns`);
    } catch (patternErr) {
      logMessage("WARN", `Failed to extract patterns`, {
        error: patternErr.message
      });
      patterns = [];
    }
    try {
      bugPatterns = await extractBugPatterns(conversationId);
      logMessage("DEBUG", `Extracted ${bugPatterns.length} bug patterns`);
    } catch (bugErr) {
      logMessage("WARN", `Failed to extract bug patterns`, {
        error: bugErr.message
      });
      bugPatterns = [];
    }
    try {
      keyValuePairs = await extractKeyValuePairs(
        conversationHistory
      );
      logMessage("DEBUG", `Extracted ${keyValuePairs.length} key-value pairs`);
    } catch (kvErr) {
      logMessage("WARN", `Failed to extract key-value pairs`, {
        error: kvErr.message
      });
      keyValuePairs = [];
    }
    try {
      const userMessages = conversationHistory.filter(
        (msg) => msg.role === "user"
      );
      const assistantMessages = conversationHistory.filter(
        (msg) => msg.role === "assistant"
      );
      if (userMessages.length > 0 && assistantMessages.length > 0) {
        conceptualInsights = await _extractConcepts(
          userMessages,
          assistantMessages
        );
        logMessage(
          "DEBUG",
          `Extracted ${conceptualInsights.length} conceptual insights`
        );
      }
    } catch (conceptErr) {
      logMessage("WARN", `Failed to extract conceptual insights`, {
        error: conceptErr.message
      });
      conceptualInsights = [];
    }
    try {
      for (const pattern of patterns) {
        await storePattern({
          patternType: pattern.type,
          patternContent: pattern.content,
          context: pattern.context,
          confidenceScore: pattern.confidence,
          conversationId,
          timestamp: Date.now()
        });
      }
      for (const bug of bugPatterns) {
        await storeBugPattern({
          symptom: bug.symptom,
          cause: bug.cause,
          solution: bug.solution,
          context: bug.context,
          confidenceScore: bug.confidence,
          conversationId,
          timestamp: Date.now()
        });
      }
      for (const kv of keyValuePairs) {
        await storeKeyValuePair({
          key: kv.key,
          value: kv.value,
          context: kv.context,
          confidenceScore: kv.confidence,
          conversationId,
          timestamp: Date.now()
        });
      }
      logMessage("INFO", `Stored extracted learnings in database`);
    } catch (storeErr) {
      logMessage("WARN", `Failed to store some extracted learnings`, {
        error: storeErr.message
      });
    }
    try {
      await recordEvent(
        "learning_extraction",
        {
          patterns: patterns.length,
          bugPatterns: bugPatterns.length,
          keyValuePairs: keyValuePairs.length,
          conceptualInsights: conceptualInsights.length,
          timestamp: Date.now()
        },
        [],
        // No specific entities
        conversationId
      );
      logMessage("DEBUG", `Recorded learning_extraction event in timeline`);
    } catch (timelineErr) {
      logMessage("WARN", `Failed to record learning_extraction event`, {
        error: timelineErr.message
      });
    }
    return {
      patterns,
      bugPatterns,
      keyValuePairs,
      conceptualInsights,
      extractionTime: Date.now()
    };
  } catch (error) {
    logMessage("ERROR", `Error extracting conversation learnings`, {
      error: error.message,
      stack: error.stack,
      conversationId
    });
    throw error;
  }
}
async function _extractConcepts(userMessages, assistantMessages) {
  try {
    logMessage(
      "DEBUG",
      `Extracting concepts from ${userMessages.length} user messages and ${assistantMessages.length} assistant messages`
    );
    const userContent = userMessages.map((msg) => msg.content).join("\n");
    const assistantContent = assistantMessages.map((msg) => msg.content).join("\n");
    const userTokens = tokenize(userContent);
    const assistantTokens = tokenize(assistantContent);
    const userTerms = _getTopTermsByFrequency(userTokens, 20);
    const assistantTerms = _getTopTermsByFrequency(assistantTokens, 20);
    const commonTerms = userTerms.filter(
      (term) => assistantTerms.some((aterm) => aterm.term === term.term)
    );
    const domainInsights = commonTerms.map((term) => {
      const snippets = _findRelevantSnippets(
        [...userMessages, ...assistantMessages],
        term.term
      );
      return {
        concept: term.term,
        frequency: term.frequency,
        importance: term.frequency / userTokens.length,
        // Simple importance heuristic
        relatedTerms: assistantTerms.filter(
          (aterm) => _areTermsRelated(term.term, aterm.term) && aterm.term !== term.term
        ).map((aterm) => aterm.term).slice(0, 5),
        snippets: snippets.slice(0, 3)
        // Limit to 3 snippets
      };
    });
    logMessage("DEBUG", `Extracted ${domainInsights.length} domain insights`);
    return domainInsights;
  } catch (error) {
    logMessage("ERROR", `Error extracting concepts`, {
      error: error.message
    });
    throw error;
  }
}
async function _promoteConversationPatterns(conversationId, outcome) {
  try {
    console.log(
      `[_promoteConversationPatterns] Promoting patterns for conversation ${conversationId}`
    );
    const patterns = await extractPatternsFromConversation(
      conversationId
    );
    if (!patterns || patterns.length === 0) {
      console.log(
        `[_promoteConversationPatterns] No patterns found in conversation ${conversationId}`
      );
      return {
        promoted: 0,
        patterns: []
      };
    }
    console.log(
      `[_promoteConversationPatterns] Found ${patterns.length} patterns to evaluate for promotion`
    );
    const promotedPatterns = {
      promoted: 0,
      patterns: []
    };
    let minConfidence = 0.5;
    if (outcome === "completed")
      minConfidence = 0.6;
    if (outcome === "abandoned")
      minConfidence = 0.7;
    for (const pattern of patterns) {
      try {
        if (pattern.is_global) {
          promotedPatterns.patterns.push({
            patternId: pattern.pattern_id,
            name: pattern.name,
            type: pattern.pattern_type,
            promoted: false,
            confidence: pattern.confidence_score
          });
          continue;
        }
        if (pattern.confidence_score < minConfidence) {
          promotedPatterns.patterns.push({
            patternId: pattern.pattern_id,
            name: pattern.name,
            type: pattern.pattern_type,
            promoted: false,
            confidence: pattern.confidence_score
          });
          continue;
        }
        await promotePatternToGlobal(
          pattern.pattern_id,
          pattern.confidence_score
        );
        const observationType = outcome === "completed" || outcome === "reference_only" ? "confirmation" : "usage";
        await reinforcePattern(
          pattern.pattern_id,
          observationType,
          { conversationId }
        );
        promotedPatterns.promoted++;
        promotedPatterns.patterns.push({
          patternId: pattern.pattern_id,
          name: pattern.name,
          type: pattern.pattern_type,
          promoted: true,
          confidence: pattern.confidence_score
        });
        console.log(
          `[_promoteConversationPatterns] Successfully promoted pattern ${pattern.pattern_id}`
        );
      } catch (error) {
        console.warn(
          `[_promoteConversationPatterns] Error processing pattern ${pattern.pattern_id}:`,
          error
        );
      }
    }
    console.log(
      `[_promoteConversationPatterns] Promoted ${promotedPatterns.promoted} patterns to global repository`
    );
    return promotedPatterns;
  } catch (error) {
    console.error(
      `[_promoteConversationPatterns] Error promoting patterns:`,
      error
    );
    return {
      promoted: 0,
      patterns: [],
      error: error.message
    };
  }
}
async function _findAndSynthesizeRelatedConversations(conversationId, conversationTopics, conversationPurpose) {
  try {
    console.log(
      `[_findAndSynthesizeRelatedConversations] Finding related conversations for ${conversationId}`
    );
    const topicKeywords = /* @__PURE__ */ new Set();
    conversationTopics.forEach((topic) => {
      if (topic.keywords && Array.isArray(topic.keywords)) {
        topic.keywords.forEach((kw) => topicKeywords.add(kw));
      }
    });
    const keywordArray = Array.from(topicKeywords);
    const recentConversationEvents = await getEvents({
      types: ["conversation_end", "conversation_completed"],
      limit: 10,
      excludeConversationId: conversationId
    });
    if (!recentConversationEvents || recentConversationEvents.length === 0) {
      console.log(
        `[_findAndSynthesizeRelatedConversations] No recent conversations found to compare`
      );
      return {
        relatedCount: 0,
        conversations: [],
        synthesizedInsights: []
      };
    }
    const scoredConversations = [];
    for (const event of recentConversationEvents) {
      try {
        if (!event.data || !event.conversation_id)
          continue;
        const eventTopics = await getConversationTopics(
          event.conversation_id
        );
        const eventKeywords = /* @__PURE__ */ new Set();
        eventTopics.forEach((topic) => {
          if (topic.keywords && Array.isArray(topic.keywords)) {
            topic.keywords.forEach((kw) => eventKeywords.add(kw));
          }
        });
        const overlapCount = keywordArray.filter(
          (kw) => eventKeywords.has(kw)
        ).length;
        const totalUniqueKeywords = (/* @__PURE__ */ new Set([...keywordArray, ...eventKeywords])).size;
        const similarityScore = totalUniqueKeywords > 0 ? overlapCount / totalUniqueKeywords : 0;
        const commonTopics = [];
        eventTopics.forEach((eventTopic) => {
          conversationTopics.forEach((currentTopic) => {
            if (eventTopic.topic_name && currentTopic.topic_name && eventTopic.topic_name.toLowerCase() === currentTopic.topic_name.toLowerCase()) {
              commonTopics.push(eventTopic.topic_name);
            }
          });
        });
        if (similarityScore > 0.2 || commonTopics.length > 0) {
          scoredConversations.push({
            conversationId: event.conversation_id,
            summary: event.data.summary || "No summary available",
            timestamp: event.timestamp,
            similarityScore,
            commonTopics
          });
        }
      } catch (error) {
        console.warn(
          `[_findAndSynthesizeRelatedConversations] Error processing event ${event.event_id}:`,
          error
        );
      }
    }
    scoredConversations.sort((a, b) => b.similarityScore - a.similarityScore);
    const relatedConversations = scoredConversations.slice(0, 5);
    console.log(
      `[_findAndSynthesizeRelatedConversations] Found ${relatedConversations.length} related conversations`
    );
    const synthesizedInsights = await _synthesizeInsightsFromRelatedConversations(
      relatedConversations,
      conversationPurpose
    );
    return {
      relatedCount: relatedConversations.length,
      conversations: relatedConversations,
      synthesizedInsights
    };
  } catch (error) {
    console.error(
      `[_findAndSynthesizeRelatedConversations] Error finding related conversations:`,
      error
    );
    return {
      relatedCount: 0,
      conversations: [],
      synthesizedInsights: [],
      error: error.message
    };
  }
}
async function _synthesizeInsightsFromRelatedConversations(relatedConversations, currentPurpose) {
  try {
    if (!relatedConversations || relatedConversations.length === 0) {
      return [];
    }
    const conversationsByTopic = {};
    relatedConversations.forEach((conversation) => {
      if (conversation.commonTopics && conversation.commonTopics.length > 0) {
        conversation.commonTopics.forEach((topic) => {
          if (!conversationsByTopic[topic]) {
            conversationsByTopic[topic] = [];
          }
          conversationsByTopic[topic].push(conversation);
        });
      }
    });
    if (Object.keys(conversationsByTopic).length === 0 && currentPurpose) {
      const syntheticTopic = `Conversations about ${currentPurpose}`;
      conversationsByTopic[syntheticTopic] = relatedConversations;
    }
    const insights = [];
    for (const [topic, conversations] of Object.entries(conversationsByTopic)) {
      if (conversations.length >= 2) {
        const combinedSummaries = conversations.map((c) => c.summary).join(" | ");
        const insight = await summarizeText(
          combinedSummaries,
          {
            targetLength: 150,
            preserveKeyPoints: true
          }
        );
        insights.push({
          topic,
          insight,
          conversationCount: conversations.length,
          sourceSummaries: conversations.map((c) => ({
            conversationId: c.conversationId,
            summary: c.summary
          }))
        });
      }
    }
    return insights;
  } catch (error) {
    console.error(
      `[_synthesizeInsightsFromRelatedConversations] Error synthesizing insights:`,
      error
    );
    return [];
  }
}
async function _generateNextStepSuggestions(conversationId, purpose, summary, extractedLearnings) {
  try {
    console.log(
      `[_generateNextStepSuggestions] Generating next steps for conversation ${conversationId}`
    );
    const result = {
      suggestedNextSteps: [],
      followUpTopics: [],
      referenceMaterials: []
    };
    const tokens = tokenize(summary);
    const keywords = extractKeywords(tokens, 10);
    let nextSteps = [];
    let followUpTopics = [];
    if (purpose) {
      switch (purpose.toLowerCase()) {
        case "debugging":
        case "bug_fixing":
          nextSteps.push({
            action: "Create a test case that verifies the bug fix",
            priority: "high",
            rationale: "Ensure the bug doesn't reoccur in the future"
          });
          nextSteps.push({
            action: "Document the root cause and solution",
            priority: "medium",
            rationale: "Help prevent similar issues in the future"
          });
          break;
        case "feature_planning":
        case "design_discussion":
          nextSteps.push({
            action: "Create tickets/tasks for implementation work",
            priority: "high",
            rationale: "Break down the feature into manageable pieces"
          });
          nextSteps.push({
            action: "Draft initial implementation plan with milestones",
            priority: "medium",
            rationale: "Establish a timeline and checkpoints"
          });
          break;
        case "code_review":
          nextSteps.push({
            action: "Address feedback points and resubmit for review",
            priority: "high",
            rationale: "Incorporate the suggested improvements"
          });
          nextSteps.push({
            action: "Update documentation to reflect changes",
            priority: "medium",
            rationale: "Keep documentation in sync with code"
          });
          break;
        case "onboarding":
        case "knowledge_sharing":
          nextSteps.push({
            action: "Create summary documentation of discussed topics",
            priority: "high",
            rationale: "Solidify knowledge transfer"
          });
          nextSteps.push({
            action: "Schedule follow-up session for additional questions",
            priority: "medium",
            rationale: "Address remaining questions after initial processing"
          });
          break;
        default:
          nextSteps.push({
            action: "Document key decisions from the conversation",
            priority: "medium",
            rationale: "Preserve important context for future reference"
          });
      }
    }
    if (extractedLearnings && extractedLearnings.learnings) {
      const designDecisions = extractedLearnings.learnings.filter(
        (l) => l.type === "design_decision"
      );
      if (designDecisions.length > 0) {
        const highConfidenceDecisions = designDecisions.filter((d) => d.confidence >= 0.7).slice(0, 2);
        highConfidenceDecisions.forEach((decision) => {
          followUpTopics.push({
            topic: `Implementation details for: ${decision.content}`,
            priority: "high",
            rationale: "Turn design decision into concrete implementation"
          });
        });
      }
      const bugPatterns = extractedLearnings.learnings.filter(
        (l) => l.type === "bug_pattern"
      );
      if (bugPatterns.length > 0) {
        const criticalBugs = bugPatterns.filter((b) => b.confidence >= 0.8).slice(0, 2);
        criticalBugs.forEach((bug) => {
          followUpTopics.push({
            topic: `Root cause analysis for: ${bug.content}`,
            priority: "medium",
            rationale: "Prevent similar bugs in the future"
          });
        });
      }
    }
    const referenceResults = await searchByKeywords(
      keywords,
      {
        fileTypes: ["md", "txt", "rst", "pdf", "doc"],
        maxResults: 5,
        searchDocumentation: true
      }
    );
    const referenceMaterials = referenceResults.map((result2) => ({
      title: result2.name || result2.file_path || "Unnamed reference",
      path: result2.file_path,
      type: result2.entity_type || "document",
      relevance: result2.score || 0.5
    }));
    result.suggestedNextSteps = nextSteps;
    result.followUpTopics = followUpTopics;
    result.referenceMaterials = referenceMaterials;
    console.log(
      `[_generateNextStepSuggestions] Generated ${nextSteps.length} next steps and ${followUpTopics.length} follow-up topics`
    );
    return result;
  } catch (error) {
    console.error(
      `[_generateNextStepSuggestions] Error generating next steps:`,
      error
    );
    return {
      suggestedNextSteps: [],
      followUpTopics: [],
      referenceMaterials: [],
      error: error.message
    };
  }
}
var finalizeConversationContext_tool_default = {
  name: "finalize_conversation_context",
  description: "Finalizes a conversation context, extracting learnings, promoting patterns, and generating insights",
  inputSchema: finalizeConversationContextInputSchema,
  outputSchema: finalizeConversationContextOutputSchema,
  handler: handler5
};

// src/tools/index.js
var allTools = [
  initializeConversationContext_tool_default,
  updateConversationContext_tool_default,
  retrieveRelevantContext_tool_default,
  recordMilestoneContext_tool_default,
  finalizeConversationContext_tool_default
];
var tools_default = allTools;

// src/tools/mcpDevContextTools.js
init_logger();
if (typeof global.lastConversationId === "undefined") {
  global.lastConversationId = null;
}
function createToolHandler(handler6, toolName) {
  return async (params, context) => {
    try {
      logMessage("DEBUG", `${toolName} tool handler invoked`, {
        paramsKeys: Object.keys(params)
      });
      let actualParams = params;
      if (params && typeof params === "object" && Object.keys(params).length === 1 && params.signal && Object.keys(params.signal).length === 0) {
        actualParams = {};
        logMessage(
          "WARN",
          `${toolName} received only signal object, using defaults`,
          { params }
        );
      } else if (params && params.signal && Object.keys(params).length > 1) {
        const { signal, ...otherParams } = params;
        actualParams = otherParams;
        logMessage(
          "DEBUG",
          `${toolName} extracted parameters from signal object`,
          {
            extractedParams: Object.keys(actualParams)
          }
        );
      }
      const extractedParams = extractParamsFromInput(actualParams);
      const defaultParams = createDefaultParamsForTool(toolName);
      const mergedParams = { ...defaultParams, ...extractedParams };
      if (mergedParams.conversationId) {
        global.lastConversationId = mergedParams.conversationId;
      }
      const result = await handler6(mergedParams, context);
      return {
        content: [
          {
            type: "text",
            text: typeof result === "string" ? result : JSON.stringify(result)
          }
        ]
      };
    } catch (error) {
      logMessage("ERROR", `Error in ${toolName} tool handler`, {
        error: error.message,
        stack: error.stack
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: true,
              message: error.message,
              details: error.stack
            })
          }
        ]
      };
    }
  };
}
function extractParamsFromInput(input) {
  const extractedParams = {};
  try {
    if (input && typeof input === "object") {
      Object.keys(input).forEach((key) => {
        if (key !== "signal" && key !== "requestId") {
          extractedParams[key] = input[key];
        }
      });
      if (input.random_string) {
        try {
          const parsedJson = JSON.parse(input.random_string);
          Object.assign(extractedParams, parsedJson);
        } catch (e) {
          if (typeof input.random_string === "string" && input.random_string.length > 30 && input.random_string.includes("-")) {
            extractedParams.conversationId = input.random_string;
          }
        }
      }
      if (input.initialQuery) {
        extractedParams.initialQuery = input.initialQuery;
      }
      if (input.contextDepth) {
        extractedParams.contextDepth = input.contextDepth;
      }
      if (input.query) {
        extractedParams.query = input.query;
      }
      if (input.name) {
        extractedParams.name = input.name;
      }
    } else if (typeof input === "string") {
      try {
        const parsedJson = JSON.parse(input);
        Object.assign(extractedParams, parsedJson);
      } catch (e) {
        if (input.length > 30 && input.includes("-")) {
          extractedParams.conversationId = input;
        }
      }
    }
  } catch (e) {
    logMessage("ERROR", `Error extracting params: ${e.message}`);
  }
  return extractedParams;
}
function createDefaultParamsForTool(toolName) {
  switch (toolName) {
    case "initialize_conversation_context":
      return {
        initialQuery: "Starting a new conversation with DevContext",
        includeArchitecture: true,
        includeRecentConversations: true,
        maxCodeContextItems: 5,
        maxRecentChanges: 5,
        contextDepth: "standard"
      };
    case "update_conversation_context":
      return {
        conversationId: global.lastConversationId,
        newMessages: [
          {
            role: "user",
            content: "Working with DevContext tools"
          }
        ],
        preserveContextOnTopicShift: true,
        contextIntegrationLevel: "balanced",
        trackIntentTransitions: true
      };
    case "retrieve_relevant_context":
      return {
        conversationId: global.lastConversationId,
        query: "DevContext tools and functionality",
        constraints: {
          includeConversation: true,
          crossTopicSearch: false
        },
        contextFilters: {
          minRelevanceScore: 0.3
        },
        weightingStrategy: "balanced",
        balanceStrategy: "proportional",
        contextBalance: "auto"
      };
    case "record_milestone_context":
      return {
        conversationId: global.lastConversationId,
        name: "DevContext Tool Milestone",
        description: "Milestone recorded during DevContext tools testing",
        milestoneCategory: "uncategorized",
        assessImpact: true
      };
    case "finalize_conversation_context":
      return {
        conversationId: global.lastConversationId,
        clearActiveContext: false,
        extractLearnings: true,
        promotePatterns: true,
        synthesizeRelatedTopics: true,
        generateNextSteps: true,
        outcome: "completed"
      };
    default:
      return {};
  }
}
function createInitializeContextHandler(handler6) {
  return createToolHandler(handler6, "initialize_conversation_context");
}
function createFinalizeContextHandler(handler6) {
  return createToolHandler(handler6, "finalize_conversation_context");
}

// src/main.js
async function startServer() {
  if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
    logMessage(
      "error",
      "Database credentials not set. TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required."
    );
    process.exit(1);
  }
  try {
    logMessage("info", "Getting database client...");
    const dbClient2 = getDbClient();
    logMessage("info", "Database client created successfully.");
  } catch (error) {
    logMessage("error", `Failed to create database client: ${error.message}`);
    process.exit(1);
  }
  try {
    logMessage("info", "Testing database connection...");
    await testDbConnection();
    logMessage("info", "Database connection successful.");
  } catch (error) {
    logMessage("error", `Database connection failed: ${error.message}`);
    process.exit(1);
  }
  try {
    logMessage("info", "Initializing database schema...");
    await initializeDatabaseSchema();
    logMessage("info", "Database schema initialized successfully.");
  } catch (error) {
    logMessage(
      "error",
      `Failed to initialize database schema: ${error.message}`
    );
    process.exit(1);
  }
  const server = new McpServer({
    name: "cursor10x",
    version: "2.0.0"
  });
  for (const tool of tools_default) {
    let wrappedHandler;
    if (tool.name === "initialize_conversation_context") {
      wrappedHandler = createInitializeContextHandler(tool.handler);
    } else if (tool.name === "finalize_conversation_context") {
      wrappedHandler = createFinalizeContextHandler(tool.handler);
    } else {
      wrappedHandler = createToolHandler(tool.handler, tool.name);
    }
    server.tool(tool.name, tool.inputSchema, wrappedHandler);
    logMessage("info", `Registered tool: ${tool.name}`);
  }
  const transport = new StdioServerTransport();
  logMessage("info", `Starting MCP server with PID ${process.pid}...`);
  try {
    await server.connect(transport);
    logMessage("info", "MCP server stopped.");
  } catch (error) {
    logMessage("error", `MCP server error: ${error.message}`);
    process.exit(1);
  }
}
if (import.meta.url === import.meta.mainUrl || process.env.NODE_ENV !== "test") {
  startServer().catch((error) => {
    logMessage("error", `Unhandled error in startServer: ${error.message}`);
    console.error(error);
    process.exit(1);
  });
}
export {
  startServer
};
//# sourceMappingURL=mcp-server.bundle.js.map
