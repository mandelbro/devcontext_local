/**
 * Database queries and schema setup
 *
 * This module provides functions for setting up the database schema
 * and executing common queries.
 */

import logger from "../utils/logger.js";
import { v4 as uuidv4 } from "uuid";

/**
 * Sets up the git_commits table if it doesn't exist
 * @param {Object} dbClient - The TursoDB client instance
 * @returns {Promise<void>}
 */
export async function setupGitCommitsTable(dbClient) {
  try {
    logger.info("Setting up git_commits table...");

    // Create git_commits table if it doesn't exist
    await dbClient.execute(`
      CREATE TABLE IF NOT EXISTS git_commits (
        commit_hash TEXT PRIMARY KEY,
        author_name TEXT,
        author_email TEXT,
        commit_date DATETIME NOT NULL,
        message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create index on commit_date
    await dbClient.execute(`
      CREATE INDEX IF NOT EXISTS idx_git_commits_commit_date 
      ON git_commits(commit_date DESC)
    `);

    logger.info("git_commits table setup completed");
  } catch (error) {
    logger.error("Error setting up git_commits table", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Sets up the git_commit_files table if it doesn't exist
 * @param {Object} dbClient - The TursoDB client instance
 * @returns {Promise<void>}
 */
export async function setupGitCommitFilesTable(dbClient) {
  try {
    logger.info("Setting up git_commit_files table...");

    // Create git_commit_files table if it doesn't exist
    await dbClient.execute(`
      CREATE TABLE IF NOT EXISTS git_commit_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        commit_hash TEXT NOT NULL,
        file_path TEXT NOT NULL,
        status TEXT NOT NULL,
        FOREIGN KEY (commit_hash) REFERENCES git_commits(commit_hash) ON DELETE CASCADE
      )
    `);

    // Create index on commit_hash
    await dbClient.execute(`
      CREATE INDEX IF NOT EXISTS idx_git_commit_files_commit_hash 
      ON git_commit_files(commit_hash)
    `);

    // Create index on file_path
    await dbClient.execute(`
      CREATE INDEX IF NOT EXISTS idx_git_commit_files_file_path 
      ON git_commit_files(file_path)
    `);

    logger.info("git_commit_files table setup completed");
  } catch (error) {
    logger.error("Error setting up git_commit_files table", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Sets up the code_entities table and its FTS virtual table if they don't exist
 * @param {Object} dbClient - The TursoDB client instance
 * @returns {Promise<void>}
 */
export async function setupCodeEntitiesTable(dbClient) {
  try {
    logger.info("Setting up code_entities table and FTS...");

    // Create code_entities table if it doesn't exist
    await dbClient.execute(`
      CREATE TABLE IF NOT EXISTS code_entities (
        entity_id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        name TEXT,
        start_line INTEGER NOT NULL,
        start_column INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        end_column INTEGER NOT NULL,
        content_hash TEXT,
        raw_content TEXT,
        summary TEXT,
        language TEXT NOT NULL,
        parent_entity_id TEXT,
        parsing_status TEXT DEFAULT 'pending',
        ai_status TEXT DEFAULT 'pending',
        ai_last_processed_at DATETIME,
        custom_metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (parent_entity_id) REFERENCES code_entities(entity_id) ON DELETE CASCADE
      )
    `);

    // Create indexes for code_entities
    await dbClient.execute(`
      CREATE INDEX IF NOT EXISTS idx_code_entities_file_path 
      ON code_entities(file_path)
    `);

    await dbClient.execute(`
      CREATE INDEX IF NOT EXISTS idx_code_entities_entity_type 
      ON code_entities(entity_type)
    `);

    await dbClient.execute(`
      CREATE INDEX IF NOT EXISTS idx_code_entities_language 
      ON code_entities(language)
    `);

    await dbClient.execute(`
      CREATE INDEX IF NOT EXISTS idx_code_entities_parent_id 
      ON code_entities(parent_entity_id)
    `);

    // Create FTS5 virtual table for code_entities
    await dbClient.execute(`
      CREATE VIRTUAL TABLE IF NOT EXISTS code_entities_fts USING fts5(
        entity_id UNINDEXED,
        name,
        summary_fts,
        content_fts,
        keywords_fts,
        tokenize = 'porter unicode61'
      )
    `);

    // Create trigger for AFTER INSERT on code_entities
    await dbClient.execute(`
      CREATE TRIGGER IF NOT EXISTS code_entities_ai AFTER INSERT ON code_entities BEGIN
        INSERT INTO code_entities_fts (
          rowid,
          entity_id,
          name,
          summary_fts,
          content_fts,
          keywords_fts
        )
        VALUES (
          new.rowid,
          new.entity_id,
          new.name,
          new.summary,
          new.raw_content,
          json_extract(new.custom_metadata, '$.keywords')
        );
      END;
    `);

    // Create trigger for AFTER UPDATE on code_entities
    await dbClient.execute(`
      CREATE TRIGGER IF NOT EXISTS code_entities_au AFTER UPDATE ON code_entities BEGIN
        UPDATE code_entities_fts SET
          entity_id = new.entity_id,
          name = new.name,
          summary_fts = new.summary,
          content_fts = new.raw_content,
          keywords_fts = json_extract(new.custom_metadata, '$.keywords')
        WHERE rowid = old.rowid;
      END;
    `);

    // Create trigger for AFTER DELETE on code_entities
    await dbClient.execute(`
      CREATE TRIGGER IF NOT EXISTS code_entities_ad AFTER DELETE ON code_entities BEGIN
        DELETE FROM code_entities_fts WHERE rowid = old.rowid;
      END;
    `);

    logger.info("code_entities table and FTS setup completed");
  } catch (error) {
    logger.error("Error setting up code_entities table and FTS", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Sets up the project_documents table and its FTS virtual table if they don't exist
 * @param {Object} dbClient - The TursoDB client instance
 * @returns {Promise<void>}
 */
export async function setupProjectDocumentsTable(dbClient) {
  try {
    logger.info("Setting up project_documents table and FTS...");

    // Create project_documents table if it doesn't exist
    await dbClient.execute(`
      CREATE TABLE IF NOT EXISTS project_documents (
        document_id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL UNIQUE,
        file_type TEXT NOT NULL,
        raw_content TEXT,
        content_hash TEXT,
        summary TEXT,
        parsing_status TEXT DEFAULT 'pending',
        ai_status TEXT DEFAULT 'pending',
        ai_last_processed_at DATETIME,
        custom_metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_modified_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for project_documents
    await dbClient.execute(`
      CREATE INDEX IF NOT EXISTS idx_project_documents_file_path 
      ON project_documents(file_path)
    `);

    await dbClient.execute(`
      CREATE INDEX IF NOT EXISTS idx_project_documents_file_type 
      ON project_documents(file_type)
    `);

    await dbClient.execute(`
      CREATE INDEX IF NOT EXISTS idx_project_documents_parsing_status 
      ON project_documents(parsing_status)
    `);

    // Create FTS5 virtual table for project_documents
    await dbClient.execute(`
      CREATE VIRTUAL TABLE IF NOT EXISTS project_documents_fts USING fts5(
        document_id UNINDEXED,
        file_path_fts,
        summary_fts,
        content_fts,
        keywords_fts,
        tokenize = 'porter unicode61'
      )
    `);

    // Create trigger for AFTER INSERT on project_documents
    await dbClient.execute(`
      CREATE TRIGGER IF NOT EXISTS project_documents_ai AFTER INSERT ON project_documents BEGIN
        INSERT INTO project_documents_fts (
          rowid,
          document_id,
          file_path_fts,
          summary_fts,
          content_fts,
          keywords_fts
        )
        VALUES (
          new.rowid,
          new.document_id,
          new.file_path,
          new.summary,
          new.raw_content,
          json_extract(new.custom_metadata, '$.keywords')
        );
      END;
    `);

    // Create trigger for AFTER UPDATE on project_documents
    await dbClient.execute(`
      CREATE TRIGGER IF NOT EXISTS project_documents_au AFTER UPDATE ON project_documents BEGIN
        UPDATE project_documents_fts SET
          document_id = new.document_id,
          file_path_fts = new.file_path,
          summary_fts = new.summary,
          content_fts = new.raw_content,
          keywords_fts = json_extract(new.custom_metadata, '$.keywords')
        WHERE rowid = old.rowid;
      END;
    `);

    // Create trigger for AFTER DELETE on project_documents
    await dbClient.execute(`
      CREATE TRIGGER IF NOT EXISTS project_documents_ad AFTER DELETE ON project_documents BEGIN
        DELETE FROM project_documents_fts WHERE rowid = old.rowid;
      END;
    `);

    logger.info("project_documents table and FTS setup completed");
  } catch (error) {
    logger.error("Error setting up project_documents table and FTS", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Sets up the code_relationships table if it doesn't exist
 * @param {Object} dbClient - The TursoDB client instance
 * @returns {Promise<void>}
 */
export async function setupCodeRelationshipsTable(dbClient) {
  try {
    logger.info("Setting up code_relationships table...");

    // Create code_relationships table if it doesn't exist
    await dbClient.execute(`
      CREATE TABLE IF NOT EXISTS code_relationships (
        relationship_id TEXT PRIMARY KEY,
        source_entity_id TEXT NOT NULL,
        target_entity_id TEXT,
        target_symbol_name TEXT,
        relationship_type TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        custom_metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (source_entity_id) REFERENCES code_entities(entity_id) ON DELETE CASCADE,
        FOREIGN KEY (target_entity_id) REFERENCES code_entities(entity_id) ON DELETE SET NULL
      )
    `);

    // Create index on source_entity_id
    await dbClient.execute(`
      CREATE INDEX IF NOT EXISTS idx_code_relationships_source_entity_id 
      ON code_relationships(source_entity_id)
    `);

    // Create index on target_entity_id
    await dbClient.execute(`
      CREATE INDEX IF NOT EXISTS idx_code_relationships_target_entity_id 
      ON code_relationships(target_entity_id)
    `);

    // Create index on relationship_type
    await dbClient.execute(`
      CREATE INDEX IF NOT EXISTS idx_code_relationships_type 
      ON code_relationships(relationship_type)
    `);

    logger.info("code_relationships table setup completed");
  } catch (error) {
    logger.error("Error setting up code_relationships table", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Sets up the entity_keywords table if it doesn't exist
 * @param {Object} dbClient - The TursoDB client instance
 * @returns {Promise<void>}
 */
export async function setupEntityKeywordsTable(dbClient) {
  try {
    logger.info("Setting up entity_keywords table...");

    // Create entity_keywords table if it doesn't exist
    await dbClient.execute(`
      CREATE TABLE IF NOT EXISTS entity_keywords (
        keyword_id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_id TEXT NOT NULL,
        keyword TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        keyword_type TEXT NOT NULL
      )
    `);

    // Create index on entity_id
    await dbClient.execute(`
      CREATE INDEX IF NOT EXISTS idx_entity_keywords_entity_id 
      ON entity_keywords(entity_id)
    `);

    // Create index on keyword
    await dbClient.execute(`
      CREATE INDEX IF NOT EXISTS idx_entity_keywords_keyword 
      ON entity_keywords(keyword)
    `);

    // Create index on keyword_type
    await dbClient.execute(`
      CREATE INDEX IF NOT EXISTS idx_entity_keywords_type 
      ON entity_keywords(keyword_type)
    `);

    // Create unique index on entity_id and keyword combination
    await dbClient.execute(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_keywords_unique 
      ON entity_keywords(entity_id, keyword)
    `);

    logger.info("entity_keywords table setup completed");
  } catch (error) {
    logger.error("Error setting up entity_keywords table", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Sets up the conversation_history table if it doesn't exist
 * @param {Object} dbClient - The TursoDB client instance
 * @returns {Promise<void>}
 */
export async function setupConversationHistoryTable(dbClient) {
  try {
    logger.info("Setting up conversation_history table...");

    // Create conversation_history table if it doesn't exist
    await dbClient.execute(`
      CREATE TABLE IF NOT EXISTS conversation_history (
        message_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
        related_entity_ids TEXT,
        topic_id TEXT,
        FOREIGN KEY (topic_id) REFERENCES conversation_topics(topic_id) ON DELETE SET NULL
      )
    `);

    // Create index on conversation_id and timestamp
    await dbClient.execute(`
      CREATE INDEX IF NOT EXISTS idx_conversation_history_conversation_timestamp 
      ON conversation_history(conversation_id, timestamp)
    `);

    logger.info("conversation_history table setup completed");
  } catch (error) {
    logger.error("Error setting up conversation_history table", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Sets up the conversation_topics table if it doesn't exist
 * @param {Object} dbClient - The TursoDB client instance
 * @returns {Promise<void>}
 */
export async function setupConversationTopicsTable(dbClient) {
  try {
    logger.info("Setting up conversation_topics table...");

    // Create conversation_topics table if it doesn't exist
    await dbClient.execute(`
      CREATE TABLE IF NOT EXISTS conversation_topics (
        topic_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        summary TEXT,
        keywords TEXT,
        purpose_tag TEXT,
        start_message_id TEXT,
        end_message_id TEXT,
        start_timestamp DATETIME,
        end_timestamp DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (start_message_id) REFERENCES conversation_history(message_id) ON DELETE SET NULL,
        FOREIGN KEY (end_message_id) REFERENCES conversation_history(message_id) ON DELETE SET NULL
      )
    `);

    // Create index on conversation_id
    await dbClient.execute(`
      CREATE INDEX IF NOT EXISTS idx_conversation_topics_conversation_id 
      ON conversation_topics(conversation_id)
    `);

    logger.info("conversation_topics table setup completed");
  } catch (error) {
    logger.error("Error setting up conversation_topics table", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Sets up the background_ai_jobs table if it doesn't exist
 * @param {Object} dbClient - The TursoDB client instance
 * @returns {Promise<void>}
 */
export async function setupBackgroundAiJobsTable(dbClient) {
  try {
    logger.info("Setting up background_ai_jobs table...");

    // Create background_ai_jobs table if it doesn't exist
    await dbClient.execute(`
      CREATE TABLE IF NOT EXISTS background_ai_jobs (
        job_id TEXT PRIMARY KEY,
        target_entity_id TEXT NOT NULL,
        target_entity_type TEXT NOT NULL,
        task_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        payload TEXT,
        attempts INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 3,
        last_attempted_at DATETIME,
        error_message TEXT,
        result_summary TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create index on status for finding jobs by status
    await dbClient.execute(`
      CREATE INDEX IF NOT EXISTS idx_background_ai_jobs_status 
      ON background_ai_jobs(status)
    `);

    // Create index on target_entity_id and target_entity_type
    await dbClient.execute(`
      CREATE INDEX IF NOT EXISTS idx_background_ai_jobs_target 
      ON background_ai_jobs(target_entity_id, target_entity_type)
    `);

    // Create trigger to auto-update updated_at timestamp
    await dbClient.execute(`
      CREATE TRIGGER IF NOT EXISTS trg_background_ai_jobs_updated_at
      AFTER UPDATE ON background_ai_jobs
      FOR EACH ROW
      BEGIN
        UPDATE background_ai_jobs SET updated_at = CURRENT_TIMESTAMP
        WHERE job_id = NEW.job_id;
      END;
    `);

    logger.info("background_ai_jobs table setup completed");
  } catch (error) {
    logger.error("Error setting up background_ai_jobs table", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Sets up the system_metadata table if it doesn't exist
 * This table is used to store system-wide settings and state
 * @param {Object} dbClient - The TursoDB client instance
 * @returns {Promise<void>}
 */
export async function setupSystemMetadataTable(dbClient) {
  try {
    logger.info("Setting up system_metadata table...");

    // Create system_metadata table if it doesn't exist
    await dbClient.execute(`
      CREATE TABLE IF NOT EXISTS system_metadata (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create trigger to auto-update updated_at timestamp
    await dbClient.execute(`
      CREATE TRIGGER IF NOT EXISTS trg_system_metadata_updated_at
      AFTER UPDATE ON system_metadata
      FOR EACH ROW
      BEGIN
        UPDATE system_metadata SET updated_at = CURRENT_TIMESTAMP
        WHERE key = NEW.key;
      END;
    `);

    logger.info("system_metadata table setup completed");
  } catch (error) {
    logger.error("Error setting up system_metadata table", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Gets the last processed commit OID from the system_metadata table
 * @param {Object} dbClient - The TursoDB client instance
 * @returns {Promise<string|null>} The last processed commit OID or null if not found
 */
export async function getLastProcessedCommitOid(dbClient) {
  try {
    logger.debug("Retrieving last processed commit OID from database...");

    const result = await dbClient.execute({
      sql: "SELECT value FROM system_metadata WHERE key = ?",
      args: ["last_processed_git_oid"],
    });

    if (result.rows.length > 0) {
      const oid = result.rows[0].value;
      logger.debug(`Retrieved last processed commit OID: ${oid}`);
      return oid;
    }

    logger.debug("No last processed commit OID found");
    return null;
  } catch (error) {
    logger.error("Error retrieving last processed commit OID", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Sets the last processed commit OID in the system_metadata table
 * @param {Object} dbClient - The TursoDB client instance
 * @param {string} oid - The commit OID to store
 * @returns {Promise<void>}
 */
export async function setLastProcessedCommitOid(dbClient, oid) {
  try {
    logger.debug(`Setting last processed commit OID to: ${oid}`);

    await dbClient.execute({
      sql: "INSERT OR REPLACE INTO system_metadata (key, value) VALUES (?, ?)",
      args: ["last_processed_git_oid", oid],
    });

    logger.debug("Last processed commit OID stored successfully");
  } catch (error) {
    logger.error("Error setting last processed commit OID", {
      error: error.message,
      stack: error.stack,
      oid,
    });
    throw error;
  }
}

/**
 * Adds a Git commit to the git_commits table
 * @param {Object} dbClient - The TursoDB client instance
 * @param {Object} commitData - The commit data
 * @param {string} commitData.commit_hash - The commit hash
 * @param {string} commitData.author_name - The author name
 * @param {string} commitData.author_email - The author email
 * @param {string|Date} commitData.commit_date - The commit date (ISO 8601 string or Date object)
 * @param {string} commitData.message - The commit message
 * @returns {Promise<void>}
 */
export async function addGitCommit(dbClient, commitData) {
  try {
    logger.debug(`Adding Git commit to database: ${commitData.commit_hash}`);

    // Convert Date object to ISO string if needed
    const commitDate =
      commitData.commit_date instanceof Date
        ? commitData.commit_date.toISOString()
        : commitData.commit_date;

    await dbClient.execute({
      sql: `
        INSERT OR IGNORE INTO git_commits (
          commit_hash, 
          author_name, 
          author_email, 
          commit_date, 
          message
        ) VALUES (?, ?, ?, ?, ?)
      `,
      args: [
        commitData.commit_hash,
        commitData.author_name,
        commitData.author_email,
        commitDate,
        commitData.message,
      ],
    });

    logger.debug(`Git commit ${commitData.commit_hash} added successfully`);
  } catch (error) {
    logger.error("Error adding Git commit to database", {
      error: error.message,
      stack: error.stack,
      commitHash: commitData.commit_hash,
    });
    throw error;
  }
}

/**
 * Adds a Git commit file entry to the git_commit_files table
 * @param {Object} dbClient - The TursoDB client instance
 * @param {string} commitHash - The commit hash
 * @param {string} filePath - The file path
 * @param {string} status - The file status (added, modified, deleted, renamed)
 * @param {string} [oldFilePath] - The old file path (for renamed files)
 * @returns {Promise<void>}
 */
export async function addGitCommitFile(
  dbClient,
  commitHash,
  filePath,
  status,
  oldFilePath = null
) {
  try {
    logger.debug(
      `Adding Git commit file to database: ${commitHash} - ${filePath} (${status})`
    );

    await dbClient.execute({
      sql: `
        INSERT INTO git_commit_files (
          commit_hash,
          file_path,
          status
        ) VALUES (?, ?, ?)
      `,
      args: [commitHash, filePath, status],
    });

    // For renamed files, add an additional entry for the old file path
    if (status === "renamed" && oldFilePath) {
      logger.debug(`Adding old path for renamed file: ${oldFilePath}`);

      await dbClient.execute({
        sql: `
          INSERT INTO git_commit_files (
            commit_hash,
            file_path,
            status
          ) VALUES (?, ?, ?)
        `,
        args: [commitHash, oldFilePath, "renamed_from"],
      });
    }

    logger.debug(
      `Git commit file ${commitHash} - ${filePath} added successfully`
    );
  } catch (error) {
    logger.error("Error adding Git commit file to database", {
      error: error.message,
      stack: error.stack,
      commitHash,
      filePath,
      status,
    });
    throw error;
  }
}

/**
 * Adds a new background AI job to the background_ai_jobs table
 * @param {Object} dbClient - The TursoDB client instance
 * @param {Object} jobData - The job data
 * @param {string} jobData.job_id - Unique ID for the job (UUID)
 * @param {string} jobData.target_entity_id - ID of the entity/document to process
 * @param {string} jobData.target_entity_type - Type of the target entity (e.g., 'code_entity', 'project_document')
 * @param {string} jobData.task_type - Type of task to perform (e.g., 'enrich_entity_summary_keywords')
 * @param {string} [jobData.status='pending'] - Initial status for the job
 * @param {string} [jobData.payload] - Optional additional data needed for the job (JSON string)
 * @param {number} [jobData.max_attempts] - Maximum number of attempts (uses default from schema if not provided)
 * @returns {Promise<void>}
 */
export async function addBackgroundAiJob(dbClient, jobData) {
  try {
    logger.debug(
      `Adding background AI job to database: ${jobData.job_id} for ${jobData.target_entity_type} ${jobData.target_entity_id}`
    );

    // Set default status if not provided
    const status = jobData.status || "pending";

    await dbClient.execute({
      sql: `
        INSERT INTO background_ai_jobs (
          job_id,
          target_entity_id,
          target_entity_type,
          task_type,
          status,
          payload,
          max_attempts
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        jobData.job_id,
        jobData.target_entity_id,
        jobData.target_entity_type,
        jobData.task_type,
        status,
        jobData.payload || null,
        jobData.max_attempts || null, // If null, will use the default from schema
      ],
    });

    logger.debug(`Background AI job ${jobData.job_id} added successfully`);
  } catch (error) {
    logger.error("Error adding background AI job to database", {
      error: error.message,
      stack: error.stack,
      jobId: jobData.job_id,
      targetEntityId: jobData.target_entity_id,
    });
    throw error;
  }
}

/**
 * Cancels/deletes background AI jobs for a specific entity
 * @param {Object} dbClient - The TursoDB client instance
 * @param {string} targetEntityId - ID of the entity for which to cancel jobs
 * @returns {Promise<{deletedCount: number}>} The number of jobs deleted
 */
export async function cancelBackgroundAiJobsForEntity(
  dbClient,
  targetEntityId
) {
  try {
    logger.debug(
      `Cancelling background AI jobs for entity ID: ${targetEntityId}`
    );

    // Only delete jobs that are in a cancellable state (pending or retry_ai)
    const result = await dbClient.execute({
      sql: `
        DELETE FROM background_ai_jobs
        WHERE target_entity_id = ?
        AND status IN ('pending', 'retry_ai')
      `,
      args: [targetEntityId],
    });

    const deletedCount = result.rowsAffected;
    logger.info(
      `Cancelled ${deletedCount} background AI jobs for entity ID: ${targetEntityId}`
    );

    return { deletedCount };
  } catch (error) {
    logger.error("Error cancelling background AI jobs for entity", {
      error: error.message,
      stack: error.stack,
      targetEntityId,
    });
    throw error;
  }
}

/**
 * Fetches pending AI jobs from the background_ai_jobs table that are eligible for processing
 * @param {Object} dbClient - The TursoDB client instance
 * @param {number} limit - Maximum number of jobs to fetch
 * @returns {Promise<Array>} Array of job objects, or empty array if none found
 */
export async function fetchPendingAiJobs(dbClient, limit) {
  try {
    logger.debug(`Fetching up to ${limit} pending AI jobs`);

    const result = await dbClient.execute({
      sql: `
        SELECT *
        FROM background_ai_jobs
        WHERE status = 'pending'
        OR (status = 'retry_ai' AND attempts < max_attempts)
        ORDER BY created_at ASC, attempts ASC, last_attempted_at ASC
        LIMIT ?
      `,
      args: [limit],
    });

    logger.debug(`Fetched ${result.rows.length} pending AI jobs`);
    return result.rows;
  } catch (error) {
    logger.error("Error fetching pending AI jobs", {
      error: error.message,
      stack: error.stack,
      limit,
    });
    throw error;
  }
}

/**
 * Updates the status, attempts, last_attempted_at, and error_message of an AI job
 * @param {Object} dbClient - The TursoDB client instance
 * @param {string} jobId - The ID of the job to update
 * @param {string} status - The new job status
 * @param {number} [attemptsIncrement=0] - Amount to increment the attempts counter
 * @param {string|null} [errorMessage=null] - Error message if job failed, or null to clear
 * @returns {Promise<Object>} Result of the update operation
 */
export async function updateAiJobStatusAndAttempts(
  dbClient,
  jobId,
  status,
  attemptsIncrement = 0,
  errorMessage = null
) {
  try {
    logger.debug(`Updating status of AI job ${jobId} to ${status}`);

    const result = await dbClient.execute({
      sql: `
        UPDATE background_ai_jobs
        SET 
          status = ?,
          attempts = attempts + ?,
          last_attempted_at = CURRENT_TIMESTAMP,
          error_message = ?
        WHERE job_id = ?
      `,
      args: [status, attemptsIncrement, errorMessage, jobId],
    });

    if (result.rowsAffected === 0) {
      logger.warn(`No AI job found to update with ID: ${jobId}`);
    } else {
      logger.debug(
        `Updated AI job ${jobId} to status '${status}'${
          attemptsIncrement
            ? `, incremented attempts by ${attemptsIncrement}`
            : ""
        }${errorMessage ? `, with error: ${errorMessage}` : ""}`
      );
    }

    return result;
  } catch (error) {
    logger.error(`Error updating AI job ${jobId}`, {
      error: error.message,
      stack: error.stack,
      jobId,
      status,
      attemptsIncrement,
    });
    throw error;
  }
}

/**
 * Updates the AI processing status for a target entity after job completion
 * @param {Object} dbClient - The TursoDB client instance
 * @param {string} targetEntityId - The ID of the target entity
 * @param {string} targetEntityType - The type of the target entity ('code_entity', 'project_document', etc.)
 * @param {string} newAiStatus - The new AI status to set
 * @param {string|null} [summary=null] - Optional new summary for successful processing
 * @param {string|null} [errorMessage=null] - Optional error message for failed processing
 * @returns {Promise<Object>} Result of the update operation
 */
export async function updateEntityAiStatusForJobTarget(
  dbClient,
  targetEntityId,
  targetEntityType,
  newAiStatus,
  summary = null,
  errorMessage = null
) {
  try {
    logger.debug(
      `Updating AI status for ${targetEntityType} ${targetEntityId} to ${newAiStatus}`
    );

    let result;
    const currentTimestamp = new Date();

    // Dispatch to the appropriate update function based on entity type
    if (targetEntityType === "code_entity") {
      // For code entities, use the existing updateCodeEntityAiStatus function
      result = await updateCodeEntityAiStatus(
        dbClient,
        targetEntityId,
        newAiStatus,
        summary,
        currentTimestamp
      );

      // If there's an error message and the entity was updated successfully,
      // we could additionally update the custom_metadata with the error
      // This would require additional implementation if needed
    } else if (targetEntityType === "project_document") {
      // For project documents, use the existing updateProjectDocumentAiStatus function
      result = await updateProjectDocumentAiStatus(
        dbClient,
        targetEntityId,
        newAiStatus,
        summary,
        currentTimestamp
      );

      // Similar to code entities, handle error message if needed
    } else if (targetEntityType.startsWith("conversation_")) {
      // For conversation topic generation, no direct entity update is required
      // as per the task description (topics are created, not updated)
      logger.debug(`No entity status update required for ${targetEntityType}`);
      return {
        success: true,
        message: "No direct entity update for conversation types",
      };
    } else {
      // Unknown entity type
      logger.error(`Unknown target entity type: ${targetEntityType}`);
      throw new Error(`Unknown target entity type: ${targetEntityType}`);
    }

    logger.debug(
      `Successfully updated AI status for ${targetEntityType} ${targetEntityId} to ${newAiStatus}`
    );

    return result;
  } catch (error) {
    logger.error(
      `Error updating AI status for ${targetEntityType} ${targetEntityId}`,
      {
        error: error.message,
        stack: error.stack,
        targetEntityId,
        targetEntityType,
        newAiStatus,
      }
    );
    throw error;
  }
}

/**
 * Master function to initialize all database tables and schema
 * This function calls all individual table setup functions in sequence
 * @param {Object} dbClient - The TursoDB client instance
 * @returns {Promise<void>}
 */
export async function initializeDatabaseSchema(dbClient) {
  try {
    logger.info("Starting database schema initialization...");

    // Initialize system metadata table
    await setupSystemMetadataTable(dbClient);

    // Initialize Git-related tables
    await setupGitCommitsTable(dbClient);
    await setupGitCommitFilesTable(dbClient);

    // Initialize code and document tables
    await setupCodeEntitiesTable(dbClient);
    await setupProjectDocumentsTable(dbClient);

    // Initialize code relationships
    await setupCodeRelationshipsTable(dbClient);
    await setupEntityKeywordsTable(dbClient);

    // Handle circular dependency between conversation tables
    // First create tables without foreign key constraints
    try {
      await dbClient.execute(`
        CREATE TABLE IF NOT EXISTS conversation_history (
          message_id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
          related_entity_ids TEXT,
          topic_id TEXT
        )
      `);

      await dbClient.execute(`
        CREATE TABLE IF NOT EXISTS conversation_topics (
          topic_id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          summary TEXT,
          keywords TEXT,
          purpose_tag TEXT,
          start_message_id TEXT,
          end_message_id TEXT,
          start_timestamp DATETIME,
          end_timestamp DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Now that both tables exist, call the setup functions to handle indexes and any missing pieces
      await setupConversationTopicsTable(dbClient);
      await setupConversationHistoryTable(dbClient);
    } catch (err) {
      // If tables already exist with constraints, just call the standard setup functions
      await setupConversationHistoryTable(dbClient);
      await setupConversationTopicsTable(dbClient);
    }

    // Initialize background jobs table
    await setupBackgroundAiJobsTable(dbClient);

    logger.info("Database schema initialization completed successfully");
  } catch (error) {
    logger.error("Critical error during database schema initialization", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Adds a new code entity or updates an existing one based on entity_id
 * @param {Object} dbClient - The TursoDB client instance
 * @param {Object} entityData - The entity data to insert or update
 * @param {string} entityData.entity_id - Unique identifier for the entity
 * @param {string} entityData.file_path - Path to the file containing the entity
 * @param {string} entityData.entity_type - Type of entity (function, class, etc.)
 * @param {string} entityData.name - Name of the entity
 * @param {number} entityData.start_line - Starting line of the entity
 * @param {number} entityData.start_column - Starting column of the entity
 * @param {number} entityData.end_line - Ending line of the entity
 * @param {number} entityData.end_column - Ending column of the entity
 * @param {string} entityData.content_hash - Hash of the entity content
 * @param {string} entityData.raw_content - Raw content of the entity
 * @param {string} entityData.summary - Summary of the entity
 * @param {string} entityData.language - Programming language of the entity
 * @param {string} [entityData.parent_entity_id] - ID of the parent entity
 * @param {string} [entityData.parsing_status] - Status of parsing
 * @param {string} [entityData.ai_status] - Status of AI processing
 * @param {string} [entityData.custom_metadata] - JSON string of custom metadata
 * @returns {Promise<Object>} The result of the operation
 */
export async function addOrUpdateCodeEntity(dbClient, entityData) {
  try {
    logger.debug(
      `Adding or updating code entity: ${entityData.entity_id} (${entityData.name})`
    );

    // Ensure we have all required fields
    if (
      !entityData.entity_id ||
      !entityData.file_path ||
      !entityData.entity_type ||
      !entityData.language ||
      entityData.start_line === undefined ||
      entityData.start_column === undefined ||
      entityData.end_line === undefined ||
      entityData.end_column === undefined
    ) {
      throw new Error("Missing required fields for code entity");
    }

    // Set default values for optional fields
    const parsingStatus = entityData.parsing_status || "pending";
    const aiStatus = entityData.ai_status || "pending";

    const result = await dbClient.execute({
      sql: `
        INSERT INTO code_entities (
          entity_id,
          file_path,
          entity_type,
          name,
          start_line,
          start_column,
          end_line,
          end_column,
          content_hash,
          raw_content,
          summary,
          language,
          parent_entity_id,
          parsing_status,
          ai_status,
          custom_metadata,
          created_at,
          last_modified_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (entity_id) DO UPDATE SET
          file_path = excluded.file_path,
          entity_type = excluded.entity_type,
          name = excluded.name,
          start_line = excluded.start_line,
          start_column = excluded.start_column,
          end_line = excluded.end_line,
          end_column = excluded.end_column,
          content_hash = excluded.content_hash,
          raw_content = excluded.raw_content,
          summary = excluded.summary,
          language = excluded.language,
          parent_entity_id = excluded.parent_entity_id,
          parsing_status = excluded.parsing_status,
          ai_status = excluded.ai_status,
          custom_metadata = excluded.custom_metadata,
          last_modified_at = CURRENT_TIMESTAMP
      `,
      args: [
        entityData.entity_id,
        entityData.file_path,
        entityData.entity_type,
        entityData.name || null,
        entityData.start_line,
        entityData.start_column,
        entityData.end_line,
        entityData.end_column,
        entityData.content_hash || null,
        entityData.raw_content || null,
        entityData.summary || null,
        entityData.language,
        entityData.parent_entity_id || null,
        parsingStatus,
        aiStatus,
        entityData.custom_metadata || null,
      ],
    });

    logger.debug(
      `Code entity ${entityData.entity_id} added or updated successfully`
    );
    return result;
  } catch (error) {
    logger.error("Error adding or updating code entity", {
      error: error.message,
      stack: error.stack,
      entityId: entityData.entity_id,
    });
    throw error;
  }
}

/**
 * Gets a code entity by its ID
 * @param {Object} dbClient - The TursoDB client instance
 * @param {string} entityId - The ID of the entity to retrieve
 * @returns {Promise<Object|null>} The code entity or null if not found
 */
export async function getCodeEntityById(dbClient, entityId) {
  try {
    logger.debug(`Retrieving code entity by ID: ${entityId}`);

    const result = await dbClient.execute({
      sql: "SELECT * FROM code_entities WHERE entity_id = ?",
      args: [entityId],
    });

    if (result.rows.length === 0) {
      logger.debug(`No code entity found with ID: ${entityId}`);
      return null;
    }

    logger.debug(`Code entity ${entityId} retrieved successfully`);
    return result.rows[0];
  } catch (error) {
    logger.error("Error retrieving code entity by ID", {
      error: error.message,
      stack: error.stack,
      entityId,
    });
    throw error;
  }
}

/**
 * Deletes all code entities associated with a specific file path
 * @param {Object} dbClient - The TursoDB client instance
 * @param {string} filePath - The file path for which to delete entities
 * @returns {Promise<{deletedCount: number}>} The number of entities deleted
 */
export async function deleteCodeEntitiesByFilePath(dbClient, filePath) {
  try {
    logger.debug(`Deleting code entities for file path: ${filePath}`);

    const result = await dbClient.execute({
      sql: "DELETE FROM code_entities WHERE file_path = ?",
      args: [filePath],
    });

    const deletedCount = result.rowsAffected;
    logger.info(
      `Deleted ${deletedCount} code entities for file path: ${filePath}`
    );

    return { deletedCount };
  } catch (error) {
    logger.error("Error deleting code entities by file path", {
      error: error.message,
      stack: error.stack,
      filePath,
    });
    throw error;
  }
}

/**
 * Updates the AI status, summary, and processing timestamp for a code entity
 * @param {Object} dbClient - The TursoDB client instance
 * @param {string} entityId - The ID of the entity to update
 * @param {string} aiStatus - The new AI status
 * @param {string} [summary] - Optional new summary
 * @param {Date|string} [aiLastProcessedAt] - Optional processing timestamp
 * @returns {Promise<Object>} The result of the operation
 */
export async function updateCodeEntityAiStatus(
  dbClient,
  entityId,
  aiStatus,
  summary = null,
  aiLastProcessedAt = null
) {
  try {
    logger.debug(
      `Updating AI status for code entity ${entityId} to ${aiStatus}`
    );

    // If aiLastProcessedAt is provided but is a Date object, convert to ISO string
    const processedAt =
      aiLastProcessedAt instanceof Date
        ? aiLastProcessedAt.toISOString()
        : aiLastProcessedAt || new Date().toISOString();

    // Build the SQL query dynamically based on which fields are provided
    let sql =
      "UPDATE code_entities SET ai_status = ?, ai_last_processed_at = ?";
    const args = [aiStatus, processedAt];

    // Add summary to update if provided
    if (summary !== null) {
      sql += ", summary = ?";
      args.push(summary);
    }

    // Add the WHERE clause
    sql += ", last_modified_at = CURRENT_TIMESTAMP WHERE entity_id = ?";
    args.push(entityId);

    const result = await dbClient.execute({
      sql,
      args,
    });

    if (result.rowsAffected === 0) {
      logger.warn(`No code entity found to update with ID: ${entityId}`);
    } else {
      logger.debug(
        `AI status updated successfully for code entity ${entityId}`
      );
    }

    return result;
  } catch (error) {
    logger.error("Error updating AI status for code entity", {
      error: error.message,
      stack: error.stack,
      entityId,
      aiStatus,
    });
    throw error;
  }
}

/**
 * Gets all code entities for a specific file path
 * @param {Object} dbClient - The TursoDB client instance
 * @param {string} filePath - The file path to retrieve entities for
 * @returns {Promise<Array<Object>>} The code entities for the file path
 */
export async function getCodeEntitiesByFilePath(dbClient, filePath) {
  try {
    logger.debug(`Retrieving code entities for file path: ${filePath}`);

    const result = await dbClient.execute({
      sql: "SELECT * FROM code_entities WHERE file_path = ? ORDER BY start_line, start_column",
      args: [filePath],
    });

    logger.debug(
      `Retrieved ${result.rows.length} code entities for file path: ${filePath}`
    );
    return result.rows;
  } catch (error) {
    logger.error("Error retrieving code entities by file path", {
      error: error.message,
      stack: error.stack,
      filePath,
    });
    throw error;
  }
}

/**
 * Adds a new code relationship to the code_relationships table
 * @param {Object} dbClient - The TursoDB client instance
 * @param {Object} relationshipData - The relationship data to insert
 * @param {string} relationshipData.relationship_id - Unique identifier for the relationship
 * @param {string} relationshipData.source_entity_id - ID of the source entity
 * @param {string} [relationshipData.target_entity_id] - ID of the target entity (optional for unresolved relationships)
 * @param {string} [relationshipData.target_symbol_name] - Symbol name of the target (useful when target_entity_id is unknown)
 * @param {string} relationshipData.relationship_type - Type of relationship
 * @param {number} [relationshipData.weight] - Weight of the relationship
 * @param {string} [relationshipData.custom_metadata] - JSON string of custom metadata
 * @returns {Promise<Object>} The result of the operation
 */
export async function addCodeRelationship(dbClient, relationshipData) {
  try {
    logger.debug(
      `Adding code relationship: ${relationshipData.relationship_id} (${relationshipData.relationship_type})`
    );

    // Ensure we have all required fields
    if (
      !relationshipData.relationship_id ||
      !relationshipData.source_entity_id ||
      !relationshipData.relationship_type
    ) {
      throw new Error("Missing required fields for code relationship");
    }

    // Set default values for optional fields
    const weight = relationshipData.weight || 1.0;

    const result = await dbClient.execute({
      sql: `
        INSERT INTO code_relationships (
          relationship_id,
          source_entity_id,
          target_entity_id,
          target_symbol_name,
          relationship_type,
          weight,
          custom_metadata,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      args: [
        relationshipData.relationship_id,
        relationshipData.source_entity_id,
        relationshipData.target_entity_id || null,
        relationshipData.target_symbol_name || null,
        relationshipData.relationship_type,
        weight,
        relationshipData.custom_metadata || null,
      ],
    });

    logger.debug(
      `Code relationship ${relationshipData.relationship_id} added successfully`
    );
    return result;
  } catch (error) {
    logger.error("Error adding code relationship", {
      error: error.message,
      stack: error.stack,
      relationshipId: relationshipData.relationship_id,
      sourceEntityId: relationshipData.source_entity_id,
    });
    throw error;
  }
}

/**
 * Deletes code relationships where the given entity is the source
 * @param {Object} dbClient - The TursoDB client instance
 * @param {string} sourceEntityId - ID of the source entity
 * @returns {Promise<{deletedCount: number}>} The number of relationships deleted
 */
export async function deleteCodeRelationshipsBySourceEntityId(
  dbClient,
  sourceEntityId
) {
  try {
    logger.debug(
      `Deleting code relationships for source entity ID: ${sourceEntityId}`
    );

    const result = await dbClient.execute({
      sql: "DELETE FROM code_relationships WHERE source_entity_id = ?",
      args: [sourceEntityId],
    });

    const deletedCount = result.rowsAffected;
    logger.info(
      `Deleted ${deletedCount} code relationships for source entity ID: ${sourceEntityId}`
    );

    return { deletedCount };
  } catch (error) {
    logger.error("Error deleting code relationships by source entity ID", {
      error: error.message,
      stack: error.stack,
      sourceEntityId,
    });
    throw error;
  }
}

/**
 * Deletes code relationships where the given entity is the target
 * @param {Object} dbClient - The TursoDB client instance
 * @param {string} targetEntityId - ID of the target entity
 * @returns {Promise<{deletedCount: number}>} The number of relationships deleted
 */
export async function deleteCodeRelationshipsByTargetEntityId(
  dbClient,
  targetEntityId
) {
  try {
    logger.debug(
      `Deleting code relationships for target entity ID: ${targetEntityId}`
    );

    const result = await dbClient.execute({
      sql: "DELETE FROM code_relationships WHERE target_entity_id = ?",
      args: [targetEntityId],
    });

    const deletedCount = result.rowsAffected;
    logger.info(
      `Deleted ${deletedCount} code relationships for target entity ID: ${targetEntityId}`
    );

    return { deletedCount };
  } catch (error) {
    logger.error("Error deleting code relationships by target entity ID", {
      error: error.message,
      stack: error.stack,
      targetEntityId,
    });
    throw error;
  }
}

/**
 * Deletes all code relationships associated with entities in a specific file path
 * @param {Object} dbClient - The TursoDB client instance
 * @param {string} filePath - The file path to delete relationships for
 * @returns {Promise<{deletedCount: number}>} The number of relationships deleted
 */
export async function deleteCodeRelationshipsByFilePath(dbClient, filePath) {
  try {
    logger.debug(`Deleting code relationships for file path: ${filePath}`);

    const result = await dbClient.execute({
      sql: `
        DELETE FROM code_relationships
        WHERE source_entity_id IN (
          SELECT entity_id FROM code_entities WHERE file_path = ?
        )
        OR target_entity_id IN (
          SELECT entity_id FROM code_entities WHERE file_path = ?
        )
      `,
      args: [filePath, filePath],
    });

    const deletedCount = result.rowsAffected;
    logger.info(
      `Deleted ${deletedCount} code relationships for file path: ${filePath}`
    );

    return { deletedCount };
  } catch (error) {
    logger.error("Error deleting code relationships by file path", {
      error: error.message,
      stack: error.stack,
      filePath,
    });
    throw error;
  }
}

/**
 * Adds or updates a project document in the project_documents table
 * @param {Object} dbClient - The TursoDB client instance
 * @param {Object} docData - The document data to insert or update
 * @param {string} docData.document_id - Unique identifier for the document
 * @param {string} docData.file_path - Path to the document file (unique)
 * @param {string} docData.file_type - Type of document file (e.g., 'markdown', 'text')
 * @param {string} [docData.raw_content] - Raw content of the document
 * @param {string} [docData.content_hash] - Hash of the document content
 * @param {string} [docData.summary] - Summary of the document
 * @param {string} [docData.parsing_status] - Status of parsing (default: 'pending')
 * @param {string} [docData.ai_status] - Status of AI processing (default: 'pending')
 * @param {Date|string} [docData.ai_last_processed_at] - When AI last processed the document
 * @param {string} [docData.custom_metadata] - JSON string of custom metadata
 * @returns {Promise<Object>} The result of the operation
 */
export async function addOrUpdateProjectDocument(dbClient, docData) {
  try {
    logger.debug(
      `Adding or updating project document: ${docData.document_id} (${docData.file_path})`
    );

    // Ensure we have all required fields
    if (!docData.document_id || !docData.file_path || !docData.file_type) {
      throw new Error("Missing required fields for project document");
    }

    // Set default values for optional fields
    const parsingStatus = docData.parsing_status || "pending";
    const aiStatus = docData.ai_status || "pending";

    const result = await dbClient.execute({
      sql: `
        INSERT INTO project_documents (
          document_id,
          file_path,
          file_type,
          raw_content,
          content_hash,
          summary,
          parsing_status,
          ai_status,
          ai_last_processed_at,
          custom_metadata,
          created_at,
          last_modified_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (file_path) DO UPDATE SET
          document_id = excluded.document_id,
          file_type = excluded.file_type,
          raw_content = excluded.raw_content,
          content_hash = excluded.content_hash,
          summary = excluded.summary,
          parsing_status = excluded.parsing_status,
          ai_status = excluded.ai_status,
          ai_last_processed_at = excluded.ai_last_processed_at,
          custom_metadata = excluded.custom_metadata,
          last_modified_at = CURRENT_TIMESTAMP
      `,
      args: [
        docData.document_id,
        docData.file_path,
        docData.file_type,
        docData.raw_content || null,
        docData.content_hash || null,
        docData.summary || null,
        parsingStatus,
        aiStatus,
        docData.ai_last_processed_at || null,
        docData.custom_metadata || null,
      ],
    });

    logger.debug(
      `Project document ${docData.document_id} added or updated successfully`
    );
    return result;
  } catch (error) {
    logger.error("Error adding or updating project document", {
      error: error.message,
      stack: error.stack,
      documentId: docData.document_id,
      filePath: docData.file_path,
    });
    throw error;
  }
}

/**
 * Gets a project document by its file path
 * @param {Object} dbClient - The TursoDB client instance
 * @param {string} filePath - The file path of the document to retrieve
 * @returns {Promise<Object|null>} The project document or null if not found
 */
export async function getProjectDocumentByFilePath(dbClient, filePath) {
  try {
    logger.debug(`Retrieving project document by file path: ${filePath}`);

    const result = await dbClient.execute({
      sql: "SELECT * FROM project_documents WHERE file_path = ?",
      args: [filePath],
    });

    if (result.rows.length === 0) {
      logger.debug(`No project document found with file path: ${filePath}`);
      return null;
    }

    logger.debug(`Project document for ${filePath} retrieved successfully`);
    return result.rows[0];
  } catch (error) {
    logger.error("Error retrieving project document by file path", {
      error: error.message,
      stack: error.stack,
      filePath,
    });
    throw error;
  }
}

/**
 * Gets a project document by its document ID
 * @param {Object} dbClient - The TursoDB client instance
 * @param {string} documentId - The ID of the document to retrieve
 * @returns {Promise<Object|null>} The project document or null if not found
 */
export async function getProjectDocumentById(dbClient, documentId) {
  try {
    logger.debug(`Retrieving project document by ID: ${documentId}`);

    const result = await dbClient.execute({
      sql: "SELECT * FROM project_documents WHERE document_id = ?",
      args: [documentId],
    });

    if (result.rows.length === 0) {
      logger.debug(`No project document found with ID: ${documentId}`);
      return null;
    }

    logger.debug(`Project document ${documentId} retrieved successfully`);
    return result.rows[0];
  } catch (error) {
    logger.error("Error retrieving project document by ID", {
      error: error.message,
      stack: error.stack,
      documentId,
    });
    throw error;
  }
}

/**
 * Deletes a project document by its file path
 * @param {Object} dbClient - The TursoDB client instance
 * @param {string} filePath - The file path of the document to delete
 * @returns {Promise<{deletedCount: number}>} The number of documents deleted
 */
export async function deleteProjectDocumentByFilePath(dbClient, filePath) {
  try {
    logger.debug(`Deleting project document for file path: ${filePath}`);

    const result = await dbClient.execute({
      sql: "DELETE FROM project_documents WHERE file_path = ?",
      args: [filePath],
    });

    const deletedCount = result.rowsAffected;
    logger.info(
      `Deleted ${deletedCount} project document for file path: ${filePath}`
    );

    return { deletedCount };
  } catch (error) {
    logger.error("Error deleting project document by file path", {
      error: error.message,
      stack: error.stack,
      filePath,
    });
    throw error;
  }
}

/**
 * Updates the AI status, summary, and processing timestamp for a project document
 * @param {Object} dbClient - The TursoDB client instance
 * @param {string} documentId - The ID of the document to update
 * @param {string} aiStatus - The new AI status
 * @param {string} [summary] - Optional new summary
 * @param {Date|string} [aiLastProcessedAt] - Optional processing timestamp
 * @returns {Promise<Object>} The result of the operation
 */
export async function updateProjectDocumentAiStatus(
  dbClient,
  documentId,
  aiStatus,
  summary = null,
  aiLastProcessedAt = null
) {
  try {
    logger.debug(
      `Updating AI status for project document ${documentId} to ${aiStatus}`
    );

    // If aiLastProcessedAt is provided but is a Date object, convert to ISO string
    const processedAt =
      aiLastProcessedAt instanceof Date
        ? aiLastProcessedAt.toISOString()
        : aiLastProcessedAt || new Date().toISOString();

    // Build the SQL query dynamically based on which fields are provided
    let sql =
      "UPDATE project_documents SET ai_status = ?, ai_last_processed_at = ?";
    const args = [aiStatus, processedAt];

    // Add summary to update if provided
    if (summary !== null) {
      sql += ", summary = ?";
      args.push(summary);
    }

    // Add the WHERE clause
    sql += ", last_modified_at = CURRENT_TIMESTAMP WHERE document_id = ?";
    args.push(documentId);

    const result = await dbClient.execute({
      sql,
      args,
    });

    if (result.rowsAffected === 0) {
      logger.warn(`No project document found to update with ID: ${documentId}`);
    } else {
      logger.debug(
        `AI status updated successfully for project document ${documentId}`
      );
    }

    return result;
  } catch (error) {
    logger.error("Error updating AI status for project document", {
      error: error.message,
      stack: error.stack,
      documentId,
      aiStatus,
    });
    throw error;
  }
}

/**
 * Logs a conversation message to the conversation_history table
 * @param {Object} dbClient - The TursoDB client instance
 * @param {Object} messageData - Data for the message to log
 * @param {string} messageData.conversation_id - ID of the conversation
 * @param {string} messageData.role - Role of the message sender ('user', 'assistant', 'system')
 * @param {string} messageData.content - Content of the message
 * @param {string[]} [messageData.relatedEntityIds] - Array of entity IDs related to this message
 * @param {Object} [messageData.customMetadata] - Custom metadata for the message
 * @param {string} [messageData.topic_id] - Topic ID this message belongs to
 * @returns {Promise<Object>} Result containing the generated message_id
 */
export async function logConversationMessage(dbClient, messageData) {
  try {
    logger.debug(
      `Logging conversation message for conversation: ${messageData.conversation_id}`
    );

    // Validate required fields
    if (
      !messageData.conversation_id ||
      !messageData.role ||
      messageData.content === undefined
    ) {
      throw new Error("Missing required fields for conversation message");
    }

    // Generate a unique ID for the message
    const message_id = uuidv4();

    // Stringify arrays and objects that need to be stored as JSON
    const relatedEntityIds = messageData.relatedEntityIds
      ? JSON.stringify(messageData.relatedEntityIds)
      : null;

    // Insert the message into the conversation_history table
    const result = await dbClient.execute({
      sql: `
        INSERT INTO conversation_history (
          message_id,
          conversation_id,
          role,
          content,
          related_entity_ids,
          topic_id
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
      args: [
        message_id,
        messageData.conversation_id,
        messageData.role,
        messageData.content,
        relatedEntityIds,
        messageData.topic_id || null,
      ],
    });

    logger.debug(
      `Conversation message ${message_id} logged successfully for conversation: ${messageData.conversation_id}`
    );

    return {
      success: true,
      message_id,
    };
  } catch (error) {
    logger.error("Error logging conversation message", {
      error: error.message,
      stack: error.stack,
      conversationId: messageData.conversation_id,
    });
    throw error;
  }
}

/**
 * Checks if the initial codebase scan has been completed
 * @param {Object} dbClient - The TursoDB client instance
 * @returns {Promise<boolean>} True if initial scan has been completed, false otherwise
 */
export async function hasInitialScanBeenCompleted(dbClient) {
  try {
    logger.debug("Checking if initial codebase scan has been completed...");

    const result = await dbClient.execute({
      sql: "SELECT value FROM system_metadata WHERE key = ?",
      args: ["initial_scan_completed"],
    });

    if (result.rows.length > 0 && result.rows[0].value === "true") {
      logger.debug("Initial codebase scan has been completed");
      return true;
    }

    logger.debug("Initial codebase scan has not been completed");
    return false;
  } catch (error) {
    logger.error("Error checking initial scan completion status", {
      error: error.message,
      stack: error.stack,
    });
    // If there's an error, we default to assuming scan has not been completed
    return false;
  }
}

/**
 * Marks the initial codebase scan as completed
 * @param {Object} dbClient - The TursoDB client instance
 * @returns {Promise<void>}
 */
export async function markInitialScanCompleted(dbClient) {
  try {
    logger.debug("Marking initial codebase scan as completed...");

    await dbClient.execute({
      sql: "INSERT OR REPLACE INTO system_metadata (key, value) VALUES (?, ?)",
      args: ["initial_scan_completed", "true"],
    });

    logger.debug("Initial codebase scan marked as completed");
  } catch (error) {
    logger.error("Error marking initial scan as completed", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Adds or updates keywords for an entity by first deleting existing keywords
 * of the same type, then inserting the new ones.
 *
 * @param {Object} dbClient - The TursoDB client instance
 * @param {string} entityId - The ID of the code_entity or project_document
 * @param {string[]} keywordsArray - Array of keyword strings to add
 * @param {string} keywordType - Type of keywords (e.g., 'ai_explicit')
 * @returns {Promise<Object>} - The result of the operation
 */
export async function addEntityKeywords(
  dbClient,
  entityId,
  keywordsArray,
  keywordType
) {
  try {
    logger.debug(
      `Adding ${keywordsArray.length} keywords for entity ${entityId} with type ${keywordType}`
    );

    // First, delete existing keywords for this entity and type
    const deleteResult = await dbClient.execute(
      `DELETE FROM entity_keywords WHERE entity_id = ? AND keyword_type = ?;`,
      [entityId, keywordType]
    );

    logger.debug(
      `Deleted existing keywords for entity ${entityId} with type ${keywordType}. Rows affected: ${deleteResult.rowsAffected}`
    );

    // If there are no new keywords to add, return early
    if (!keywordsArray || keywordsArray.length === 0) {
      logger.debug(`No new keywords to add for entity ${entityId}`);
      return { success: true, inserted: 0 };
    }

    // Insert each new keyword
    let insertedCount = 0;

    for (const keyword of keywordsArray) {
      // Skip empty keywords
      if (!keyword || keyword.trim() === "") {
        continue;
      }

      const insertResult = await dbClient.execute(
        `INSERT INTO entity_keywords (entity_id, keyword, keyword_type, weight) VALUES (?, ?, ?, ?);`,
        [entityId, keyword.trim(), keywordType, 1.0]
      );

      if (insertResult.rowsAffected > 0) {
        insertedCount++;
      }
    }

    logger.debug(
      `Successfully added ${insertedCount} keywords for entity ${entityId}`
    );

    return {
      success: true,
      inserted: insertedCount,
    };
  } catch (error) {
    logger.error(`Error adding keywords for entity ${entityId}`, {
      error: error.message,
      stack: error.stack,
      entityId,
      keywordType,
      keywordsCount: keywordsArray?.length || 0,
    });

    throw error;
  }
}

/**
 * Retrieves all messages for a given conversationId, ordered by timestamp
 * @param {Object} dbClient - The TursoDB client instance
 * @param {string} conversationId - ID of the conversation to retrieve messages for
 * @returns {Promise<Array>} - Array of message objects or empty array if none found
 */
export async function getFullConversationHistory(dbClient, conversationId) {
  try {
    logger.debug(
      `Retrieving conversation history for conversation: ${conversationId}`
    );

    const result = await dbClient.execute({
      sql: `
        SELECT message_id, role, content, timestamp 
        FROM conversation_history 
        WHERE conversation_id = ? 
        ORDER BY timestamp ASC
      `,
      args: [conversationId],
    });

    logger.debug(
      `Retrieved ${result.rows.length} messages for conversation: ${conversationId}`
    );

    return result.rows || [];
  } catch (error) {
    logger.error("Error retrieving conversation history", {
      error: error.message,
      stack: error.stack,
      conversationId,
    });
    throw error;
  }
}

/**
 * Adds a new topic record to the conversation_topics table
 * @param {Object} dbClient - The TursoDB client instance
 * @param {Object} topicData - The topic data to insert
 * @param {string} topicData.topic_id - UUID for the topic
 * @param {string} topicData.conversation_id - ID of the conversation this topic belongs to
 * @param {string} topicData.summary - Summary text of the topic
 * @param {string} topicData.keywords - JSON string of keywords array
 * @param {string} topicData.purpose_tag - Purpose or category tag for the topic
 * @param {string} [topicData.start_message_id] - ID of the message where this topic starts (optional)
 * @param {string} [topicData.end_message_id] - ID of the message where this topic ends (optional)
 * @param {string} [topicData.start_timestamp] - Timestamp when the topic starts (optional)
 * @param {string} [topicData.end_timestamp] - Timestamp when the topic ends (optional)
 * @returns {Promise<Object>} - The result of the operation
 */
export async function addConversationTopic(dbClient, topicData) {
  try {
    logger.debug(
      `Adding conversation topic ${topicData.topic_id} for conversation ${topicData.conversation_id}`
    );

    // Validate required fields
    if (!topicData.topic_id || !topicData.conversation_id) {
      throw new Error(
        "Missing required fields: topic_id and conversation_id must be provided"
      );
    }

    // Ensure keywords is a JSON string if it's provided as an array
    let keywordsString = topicData.keywords;
    if (Array.isArray(topicData.keywords)) {
      keywordsString = JSON.stringify(topicData.keywords);
    }

    // Execute the parameterized SQL INSERT statement
    const result = await dbClient.execute({
      sql: `
        INSERT INTO conversation_topics (
          topic_id,
          conversation_id,
          summary,
          keywords,
          purpose_tag,
          start_message_id,
          end_message_id,
          start_timestamp,
          end_timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        topicData.topic_id,
        topicData.conversation_id,
        topicData.summary || null,
        keywordsString || null,
        topicData.purpose_tag || null,
        topicData.start_message_id || null,
        topicData.end_message_id || null,
        topicData.start_timestamp || null,
        topicData.end_timestamp || null,
      ],
    });

    logger.debug(
      `Successfully added conversation topic ${topicData.topic_id} for conversation ${topicData.conversation_id}`
    );

    return {
      success: true,
      topic_id: topicData.topic_id,
      rowsAffected: result.rowsAffected,
    };
  } catch (error) {
    logger.error(
      `Error adding conversation topic for conversation ${topicData.conversation_id}`,
      {
        error: error.message,
        stack: error.stack,
        topicId: topicData.topic_id,
        conversationId: topicData.conversation_id,
      }
    );
    throw error;
  }
}

/**
 * Retrieves counts of code entities grouped by language
 * @param {Object} dbClient - The TursoDB client instance
 * @returns {Promise<Array>} - Array of objects with language and count, e.g., [{ language: 'javascript', count: 150 }, ...]
 */
export async function getCodeEntityCountsByLanguage(dbClient) {
  try {
    logger.debug("Retrieving code entity counts grouped by language");

    const result = await dbClient.execute({
      sql: `
        SELECT language, COUNT(*) as count 
        FROM code_entities 
        GROUP BY language
        ORDER BY count DESC, language ASC
      `,
      args: [],
    });

    const counts = result.rows || [];

    logger.debug(`Retrieved code entity counts for ${counts.length} languages`);

    return counts;
  } catch (error) {
    logger.error("Error retrieving code entity counts by language", {
      error: error.message,
      stack: error.stack,
    });

    // Return empty array on error to ensure graceful handling
    return [];
  }
}

/**
 * Retrieves counts of code entities grouped by entity type
 * @param {Object} dbClient - The TursoDB client instance
 * @returns {Promise<Array>} - Array of objects with entity_type and count, e.g., [{ entity_type: 'function_declaration', count: 75 }, ...]
 */
export async function getCodeEntityCountsByType(dbClient) {
  try {
    logger.debug("Retrieving code entity counts grouped by entity type");

    const result = await dbClient.execute({
      sql: `
        SELECT entity_type, COUNT(*) as count 
        FROM code_entities 
        GROUP BY entity_type
        ORDER BY count DESC, entity_type ASC
      `,
      args: [],
    });

    const counts = result.rows || [];

    logger.debug(
      `Retrieved code entity counts for ${counts.length} entity types`
    );

    return counts;
  } catch (error) {
    logger.error("Error retrieving code entity counts by entity type", {
      error: error.message,
      stack: error.stack,
    });

    // Return empty array on error to ensure graceful handling
    return [];
  }
}

/**
 * Retrieves counts of code entities grouped by AI status
 * @param {Object} dbClient - The TursoDB client instance
 * @returns {Promise<Array>} - Array of objects with ai_status and count, e.g., [{ ai_status: 'completed', count: 100 }, { ai_status: 'pending', count: 50 }, ...]
 */
export async function getCodeEntityCountsByAiStatus(dbClient) {
  try {
    logger.debug("Retrieving code entity counts grouped by AI status");

    const result = await dbClient.execute({
      sql: `
        SELECT ai_status, COUNT(*) as count 
        FROM code_entities 
        GROUP BY ai_status
        ORDER BY count DESC, ai_status ASC
      `,
      args: [],
    });

    const counts = result.rows || [];

    logger.debug(
      `Retrieved code entity counts for ${counts.length} AI status values`
    );

    return counts;
  } catch (error) {
    logger.error("Error retrieving code entity counts by AI status", {
      error: error.message,
      stack: error.stack,
    });

    // Return empty array on error to ensure graceful handling
    return [];
  }
}

/**
 * Retrieves counts of project documents grouped by file type
 * @param {Object} dbClient - The TursoDB client instance
 * @returns {Promise<Array>} - Array of objects with file_type and count, e.g., [{ file_type: 'markdown', count: 10 }, ...]
 */
export async function getProjectDocumentCountsByType(dbClient) {
  try {
    logger.debug("Retrieving project document counts grouped by file type");

    const result = await dbClient.execute({
      sql: `
        SELECT file_type, COUNT(*) as count 
        FROM project_documents 
        GROUP BY file_type
        ORDER BY count DESC, file_type ASC
      `,
      args: [],
    });

    const counts = result.rows || [];

    logger.debug(
      `Retrieved project document counts for ${counts.length} file types`
    );

    return counts;
  } catch (error) {
    logger.error("Error retrieving project document counts by file type", {
      error: error.message,
      stack: error.stack,
    });

    // Return empty array on error to ensure graceful handling
    return [];
  }
}

/**
 * Retrieves counts of project documents grouped by AI status
 * @param {Object} dbClient - The TursoDB client instance
 * @returns {Promise<Array>} - Array of objects with ai_status and count, e.g., [{ ai_status: 'completed', count: 8 }, ...]
 */
export async function getProjectDocumentCountsByAiStatus(dbClient) {
  try {
    logger.debug("Retrieving project document counts grouped by AI status");

    const result = await dbClient.execute({
      sql: `
        SELECT ai_status, COUNT(*) as count 
        FROM project_documents 
        GROUP BY ai_status
        ORDER BY count DESC, ai_status ASC
      `,
      args: [],
    });

    const counts = result.rows || [];

    logger.debug(
      `Retrieved project document counts for ${counts.length} AI status values`
    );

    return counts;
  } catch (error) {
    logger.error("Error retrieving project document counts by AI status", {
      error: error.message,
      stack: error.stack,
    });

    // Return empty array on error to ensure graceful handling
    return [];
  }
}

/**
 * Retrieves counts of code relationships grouped by relationship type
 * @param {Object} dbClient - The TursoDB client instance
 * @returns {Promise<Array>} - Array of objects with relationship_type and count, e.g., [{ relationship_type: 'CALLS_FUNCTION', count: 200 }, ...]
 */
export async function getCodeRelationshipCountsByType(dbClient) {
  try {
    logger.debug(
      "Retrieving code relationship counts grouped by relationship type"
    );

    const result = await dbClient.execute({
      sql: `
        SELECT relationship_type, COUNT(*) as count 
        FROM code_relationships 
        GROUP BY relationship_type
        ORDER BY count DESC, relationship_type ASC
      `,
      args: [],
    });

    const counts = result.rows || [];

    logger.debug(
      `Retrieved code relationship counts for ${counts.length} relationship types`
    );

    return counts;
  } catch (error) {
    logger.error("Error retrieving code relationship counts by type", {
      error: error.message,
      stack: error.stack,
    });

    // Return empty array on error to ensure graceful handling
    return [];
  }
}

/**
 * Retrieves recent conversation topics from the conversation_topics table
 * @param {Object} dbClient - The TursoDB client instance
 * @param {number} limit - Number of topics to retrieve (e.g., 3-5)
 * @param {Array} initialQueryTerms - Array of search terms from the agent's initialQuery (optional, for future biasing)
 * @returns {Promise<Array>} - Array of topic objects with topicId, summary, purposeTag, keywords
 */
export async function getRecentConversationTopics(
  dbClient,
  limit,
  initialQueryTerms = []
) {
  try {
    logger.debug("Retrieving recent conversation topics", {
      limit,
      hasInitialQueryTerms: initialQueryTerms.length > 0,
      initialQueryTermsCount: initialQueryTerms.length,
    });

    const result = await dbClient.execute({
      sql: `
        SELECT 
          topic_id, 
          summary, 
          purpose_tag, 
          keywords,
          created_at
        FROM conversation_topics 
        ORDER BY created_at DESC
        LIMIT ?
      `,
      args: [limit],
    });

    const topics = result.rows || [];

    // Transform database rows into expected format
    const formattedTopics = topics.map((row) => ({
      topicId: row.topic_id,
      summary: row.summary || "",
      purposeTag: row.purpose_tag || null,
      keywords: row.keywords || "", // Raw JSON string from DB
    }));

    logger.debug("Retrieved recent conversation topics", {
      topicsCount: formattedTopics.length,
      requestedLimit: limit,
    });

    return formattedTopics;
  } catch (error) {
    logger.error("Error retrieving recent conversation topics", {
      error: error.message,
      stack: error.stack,
      limit,
      initialQueryTermsCount: initialQueryTerms.length,
    });

    // Return empty array on error
    return [];
  }
}

/**
 * Performs Full-Text Search on code_entities_fts table
 * @param {Object} dbClient - The TursoDB client instance
 * @param {string} ftsQueryString - The search query string formatted for FTS5 (e.g., "term1 OR term2", "term1 NEAR term2")
 * @param {number} limit - Maximum number of results to return
 * @returns {Promise<Array>} - Array of search result objects with entity_id, rank, and highlight_snippet
 */
export async function searchCodeEntitiesFts(dbClient, ftsQueryString, limit) {
  try {
    logger.debug("Performing FTS search on code_entities_fts", {
      ftsQueryString,
      limit,
    });

    const result = await dbClient.execute({
      sql: `
        SELECT
          entity_id,
          rank,
          snippet(code_entities_fts, -1, '<b>', '</b>', '...', 30) as highlight_snippet
        FROM code_entities_fts
        WHERE code_entities_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `,
      args: [ftsQueryString, limit],
    });

    const searchResults = result.rows || [];

    // Transform database rows into expected format
    const formattedResults = searchResults.map((row) => ({
      entity_id: row.entity_id,
      rank: row.rank,
      highlight_snippet: row.highlight_snippet || "",
    }));

    logger.debug("FTS search on code_entities_fts completed", {
      resultsCount: formattedResults.length,
      ftsQueryString,
      limit,
    });

    return formattedResults;
  } catch (error) {
    logger.error("Error performing FTS search on code_entities_fts", {
      error: error.message,
      stack: error.stack,
      ftsQueryString,
      limit,
    });

    // Return empty array on error
    return [];
  }
}

/**
 * Performs Full-Text Search on project_documents_fts table
 * @param {Object} dbClient - The TursoDB client instance
 * @param {string} ftsQueryString - The search query string formatted for FTS5 (e.g., "term1 OR term2", "term1 NEAR term2")
 * @param {number} limit - Maximum number of results to return
 * @returns {Promise<Array>} - Array of search result objects with document_id, rank, and highlight_snippet
 */
export async function searchProjectDocumentsFts(
  dbClient,
  ftsQueryString,
  limit
) {
  try {
    logger.debug("Performing FTS search on project_documents_fts", {
      ftsQueryString,
      limit,
    });

    const result = await dbClient.execute({
      sql: `
        SELECT
          document_id,
          rank,
          snippet(project_documents_fts, -1, '<b>', '</b>', '...', 30) as highlight_snippet
        FROM project_documents_fts
        WHERE project_documents_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `,
      args: [ftsQueryString, limit],
    });

    const searchResults = result.rows || [];

    // Transform database rows into expected format
    const formattedResults = searchResults.map((row) => ({
      document_id: row.document_id,
      rank: row.rank,
      highlight_snippet: row.highlight_snippet || "",
    }));

    logger.debug("FTS search on project_documents_fts completed", {
      resultsCount: formattedResults.length,
      ftsQueryString,
      limit,
    });

    return formattedResults;
  } catch (error) {
    logger.error("Error performing FTS search on project_documents_fts", {
      error: error.message,
      stack: error.stack,
      ftsQueryString,
      limit,
    });

    // Return empty array on error
    return [];
  }
}

/**
 * Searches the entity_keywords table for entities matching any of the provided search terms
 * Returns entities ranked by keyword match relevance (match count and total weight)
 * @param {Object} dbClient - The TursoDB client instance
 * @param {string[]} searchTermsArray - Array of processed search term strings
 * @param {number} limit - Maximum number of results to return
 * @returns {Promise<Array>} Array of objects with entity_id and relevance scores
 */
export async function searchEntityKeywords(dbClient, searchTermsArray, limit) {
  try {
    logger.debug("Performing keyword search on entity_keywords table", {
      searchTermsCount: searchTermsArray?.length || 0,
      searchTerms: searchTermsArray,
      limit,
    });

    // Return empty array if no search terms provided
    if (!searchTermsArray || searchTermsArray.length === 0) {
      logger.debug("No search terms provided, returning empty results");
      return [];
    }

    // Filter out empty or invalid search terms
    const validSearchTerms = searchTermsArray.filter(
      (term) => term && typeof term === "string" && term.trim().length > 0
    );

    if (validSearchTerms.length === 0) {
      logger.debug(
        "No valid search terms after filtering, returning empty results"
      );
      return [];
    }

    // Create placeholders for the IN clause
    const placeholders = validSearchTerms.map(() => "?").join(", ");

    // Construct SQL query to search for keywords and rank by relevance
    const sql = `
      SELECT 
        entity_id, 
        SUM(weight) as total_weight, 
        COUNT(*) as match_count
      FROM entity_keywords
      WHERE keyword IN (${placeholders})
      GROUP BY entity_id
      ORDER BY match_count DESC, total_weight DESC
      LIMIT ?
    `;

    // Execute the query
    const result = await dbClient.execute({
      sql: sql,
      args: [...validSearchTerms, limit],
    });

    const searchResults = result.rows || [];

    // Transform database rows into expected format
    const formattedResults = searchResults.map((row) => ({
      entity_id: row.entity_id,
      total_weight: parseFloat(row.total_weight) || 0,
      match_count: parseInt(row.match_count) || 0,
    }));

    logger.debug("Keyword search on entity_keywords completed", {
      resultsCount: formattedResults.length,
      validSearchTermsCount: validSearchTerms.length,
      limit,
    });

    return formattedResults;
  } catch (error) {
    logger.error("Error performing keyword search on entity_keywords", {
      error: error.message,
      stack: error.stack,
      searchTermsArray,
      limit,
    });

    // Return empty array on error to prevent breaking the retrieval flow
    return [];
  }
}

/**
 * Searches conversation history for messages containing specified search terms
 * @param {Object} dbClient - The TursoDB client instance
 * @param {string} conversationId - The current conversation ID to prioritize
 * @param {Array} queryTerms - Array of search terms from the agent's query
 * @param {number} limit - Maximum number of messages to return
 * @returns {Promise<Array>} - Array of message objects with message_id, role, content, timestamp, conversation_id
 */
export async function searchConversationHistoryByTerms(
  dbClient,
  conversationId,
  queryTerms,
  limit
) {
  try {
    logger.debug("Searching conversation history by terms", {
      conversationId,
      queryTerms,
      queryTermsCount: queryTerms.length,
      limit,
    });

    // Return empty array if no search terms provided
    if (!queryTerms || queryTerms.length === 0) {
      logger.debug("No search terms provided, returning empty results");
      return [];
    }

    // Build the WHERE clause dynamically based on number of query terms
    // Each term will be searched using LOWER(content) LIKE LOWER('%term%')
    const whereConditions = queryTerms
      .map(() => "LOWER(content) LIKE ?")
      .join(" OR ");

    // Prepare parameters: conversationId first, then all the LIKE patterns
    const likePatterns = queryTerms.map((term) => `%${term.toLowerCase()}%`);
    const parameters = [conversationId, ...likePatterns, limit];

    const sql = `
      SELECT 
        message_id, 
        role, 
        content, 
        timestamp, 
        conversation_id
      FROM conversation_history 
      WHERE conversation_id = ? AND (${whereConditions})
      ORDER BY timestamp DESC 
      LIMIT ?
    `;

    logger.debug("Executing conversation history search query", {
      sql: sql.replace(/\s+/g, " ").trim(),
      parametersCount: parameters.length,
      conversationId,
      queryTermsCount: queryTerms.length,
    });

    const result = await dbClient.execute({
      sql,
      args: parameters,
    });

    const messages = result.rows || [];

    // Transform database rows into expected format
    const formattedMessages = messages.map((row) => ({
      message_id: row.message_id,
      role: row.role,
      content: row.content || "",
      timestamp: row.timestamp,
      conversation_id: row.conversation_id,
    }));

    logger.debug("Conversation history search completed", {
      messagesFound: formattedMessages.length,
      conversationId,
      queryTermsCount: queryTerms.length,
      limit,
    });

    return formattedMessages;
  } catch (error) {
    logger.error("Error searching conversation history by terms", {
      error: error.message,
      stack: error.stack,
      conversationId,
      queryTerms,
      limit,
    });

    // Return empty array on error to avoid breaking the retrieval flow
    return [];
  }
}

/**
 * Searches conversation topics for topics containing specified search terms in summary or keywords
 * @param {Object} dbClient - The TursoDB client instance
 * @param {Array} queryTerms - Array of search terms from the agent's query
 * @param {number} limit - Maximum number of topics to return
 * @returns {Promise<Array>} - Array of topic objects with topic_id, summary, purpose_tag, keywords
 */
export async function searchConversationTopicsByTerms(
  dbClient,
  queryTerms,
  limit
) {
  try {
    logger.debug("Searching conversation topics by terms", {
      queryTerms,
      queryTermsCount: queryTerms.length,
      limit,
    });

    // Return empty array if no search terms provided
    if (!queryTerms || queryTerms.length === 0) {
      logger.debug("No search terms provided, returning empty results");
      return [];
    }

    // Filter out empty or invalid search terms
    const validQueryTerms = queryTerms.filter(
      (term) => term && typeof term === "string" && term.trim().length > 0
    );

    if (validQueryTerms.length === 0) {
      logger.debug(
        "No valid search terms after filtering, returning empty results"
      );
      return [];
    }

    // Build the WHERE clause dynamically based on number of query terms
    // Each term will be searched in both summary and keywords fields using LIKE
    // For each term: (LOWER(summary) LIKE ? OR LOWER(keywords) LIKE ?)
    const whereConditions = validQueryTerms
      .map(() => "(LOWER(summary) LIKE ? OR LOWER(keywords) LIKE ?)")
      .join(" OR ");

    // Prepare parameters: for each term, we need two patterns (summary and keywords)
    const likePatterns = validQueryTerms.flatMap((term) => [
      `%${term.toLowerCase()}%`, // for summary search
      `%${term.toLowerCase()}%`, // for keywords search
    ]);
    const parameters = [...likePatterns, limit];

    const sql = `
      SELECT 
        topic_id, 
        summary, 
        purpose_tag, 
        keywords
      FROM conversation_topics 
      WHERE ${whereConditions}
      ORDER BY created_at DESC 
      LIMIT ?
    `;

    logger.debug("Executing conversation topics search query", {
      sql: sql.replace(/\s+/g, " ").trim(),
      parametersCount: parameters.length,
      validQueryTermsCount: validQueryTerms.length,
    });

    const result = await dbClient.execute({
      sql,
      args: parameters,
    });

    const topics = result.rows || [];

    // Transform database rows into expected format
    const formattedTopics = topics.map((row) => ({
      topic_id: row.topic_id,
      summary: row.summary || "",
      purpose_tag: row.purpose_tag || null,
      keywords: row.keywords || "", // Raw JSON string from DB
    }));

    logger.debug("Conversation topics search completed", {
      topicsFound: formattedTopics.length,
      validQueryTermsCount: validQueryTerms.length,
      limit,
    });

    return formattedTopics;
  } catch (error) {
    logger.error("Error searching conversation topics by terms", {
      error: error.message,
      stack: error.stack,
      queryTerms,
      limit,
    });

    // Return empty array on error to avoid breaking the retrieval flow
    return [];
  }
}

/**
 * Searches git commits for commits containing specified search terms in message or author name
 * @param {Object} dbClient - The TursoDB client instance
 * @param {Array} queryTerms - Array of search terms from the agent's query
 * @param {number} limit - Maximum number of commits to return
 * @returns {Promise<Array>} - Array of commit objects with commit_hash, author_name, commit_date, message
 */
export async function searchGitCommitsByTerms(dbClient, queryTerms, limit) {
  try {
    logger.debug("Searching git commits by terms", {
      queryTerms,
      queryTermsCount: queryTerms.length,
      limit,
    });

    // Return empty array if no search terms provided
    if (!queryTerms || queryTerms.length === 0) {
      logger.debug("No search terms provided, returning empty results");
      return [];
    }

    // Filter out empty or invalid search terms
    const validQueryTerms = queryTerms.filter(
      (term) => term && typeof term === "string" && term.trim().length > 0
    );

    if (validQueryTerms.length === 0) {
      logger.debug(
        "No valid search terms after filtering, returning empty results"
      );
      return [];
    }

    // Build the WHERE clause dynamically based on number of query terms
    // Each term will be searched in both message and author_name fields using LIKE
    // For each term: (LOWER(message) LIKE ? OR LOWER(author_name) LIKE ?)
    const whereConditions = validQueryTerms
      .map(() => "(LOWER(message) LIKE ? OR LOWER(author_name) LIKE ?)")
      .join(" OR ");

    // Prepare parameters: for each term, we need two patterns (message and author_name)
    const likePatterns = validQueryTerms.flatMap((term) => [
      `%${term.toLowerCase()}%`, // for message search
      `%${term.toLowerCase()}%`, // for author_name search
    ]);
    const parameters = [...likePatterns, limit];

    const sql = `
      SELECT 
        commit_hash, 
        author_name, 
        commit_date, 
        message
      FROM git_commits 
      WHERE ${whereConditions}
      ORDER BY commit_date DESC 
      LIMIT ?
    `;

    logger.debug("Executing git commits search query", {
      sql: sql.replace(/\s+/g, " ").trim(),
      parametersCount: parameters.length,
      validQueryTermsCount: validQueryTerms.length,
    });

    const result = await dbClient.execute({
      sql,
      args: parameters,
    });

    const commits = result.rows || [];

    // Transform database rows into expected format
    const formattedCommits = commits.map((row) => ({
      commit_hash: row.commit_hash,
      author_name: row.author_name || "",
      commit_date: row.commit_date,
      message: row.message || "",
    }));

    logger.debug("Git commits search completed", {
      commitsFound: formattedCommits.length,
      validQueryTermsCount: validQueryTerms.length,
      limit,
    });

    return formattedCommits;
  } catch (error) {
    logger.error("Error searching git commits by terms", {
      error: error.message,
      stack: error.stack,
      queryTerms,
      limit,
    });

    // Return empty array on error to avoid breaking the retrieval flow
    return [];
  }
}

/**
 * Searches git commit files for files containing specified search terms in file paths
 * @param {Object} dbClient - The TursoDB client instance
 * @param {Array} queryTerms - Array of search terms from the agent's query
 * @param {number} limit - Maximum number of file change records to return
 * @returns {Promise<Array>} - Array of file change objects with commit details
 */
export async function searchGitCommitFilesByTerms(dbClient, queryTerms, limit) {
  try {
    logger.debug("Searching git commit files by terms", {
      queryTerms,
      queryTermsCount: queryTerms.length,
      limit,
    });

    // Input validation
    if (!queryTerms || queryTerms.length === 0) {
      logger.debug("No search terms provided, returning empty results");
      return [];
    }

    if (!limit || limit <= 0) {
      logger.warn("Invalid limit provided for git commit files search", {
        limit,
      });
      return [];
    }

    // Filter out empty or invalid search terms
    const validQueryTerms = queryTerms.filter(
      (term) => term && typeof term === "string" && term.trim().length > 0
    );

    if (validQueryTerms.length === 0) {
      logger.debug(
        "No valid search terms after filtering, returning empty results"
      );
      return [];
    }

    // Build the WHERE clause dynamically based on number of query terms
    // Each term will be searched in file_path using LIKE
    // For each term: LOWER(gcf.file_path) LIKE ?
    const whereConditions = validQueryTerms
      .map(() => "LOWER(gcf.file_path) LIKE ?")
      .join(" OR ");

    // Prepare parameters: for each term, we need one pattern for file_path search
    const likePatterns = validQueryTerms.map(
      (term) => `%${term.toLowerCase()}%`
    );
    const parameters = [...likePatterns, limit];

    const sql = `
      SELECT 
        gcf.commit_hash, 
        gcf.file_path, 
        gcf.status,
        gc.message AS commit_message,
        gc.author_name AS commit_author,
        gc.commit_date AS commit_date
      FROM git_commit_files gcf
      JOIN git_commits gc ON gcf.commit_hash = gc.commit_hash
      WHERE ${whereConditions}
      ORDER BY gc.commit_date DESC 
      LIMIT ?
    `;

    logger.debug("Executing git commit files search query", {
      sql: sql.replace(/\s+/g, " ").trim(),
      parametersCount: parameters.length,
      validQueryTermsCount: validQueryTerms.length,
    });

    const result = await dbClient.execute({
      sql,
      args: parameters,
    });

    const fileChanges = result.rows || [];

    // Transform database rows into expected format
    const formattedFileChanges = fileChanges.map((row) => ({
      commit_hash: row.commit_hash,
      file_path: row.file_path,
      status: row.status,
      commit_message: row.commit_message || "",
      commit_author: row.commit_author || "",
      commit_date: row.commit_date,
    }));

    logger.debug("Git commit files search completed", {
      fileChangesFound: formattedFileChanges.length,
      validQueryTermsCount: validQueryTerms.length,
      limit,
    });

    return formattedFileChanges;
  } catch (error) {
    logger.error("Error searching git commit files by terms", {
      error: error.message,
      stack: error.stack,
      queryTerms,
      limit,
    });

    // Return empty array on error to avoid breaking the retrieval flow
    return [];
  }
}

/**
 * Gets relationships for a given entity ID, optionally filtered by relationship types
 * @param {Object} dbClient - The TursoDB client instance
 * @param {string} entityId - The ID of the seed code_entity
 * @param {Array<string>} [relationshipTypes=[]] - Array of relationship types to include (e.g., ['CALLS_FUNCTION', 'EXTENDS_CLASS'])
 * @param {number} [depth=1] - Maximum depth of relationship traversal (V2 focuses on depth=1)
 * @returns {Promise<Array>} Array of raw relationship objects from the database
 */
export async function getRelationshipsForEntity(
  dbClient,
  entityId,
  relationshipTypes = [],
  depth = 1
) {
  try {
    logger.debug("Getting relationships for entity", {
      entityId,
      relationshipTypes,
      relationshipTypesCount: relationshipTypes.length,
      depth,
    });

    // Input validation
    if (
      !entityId ||
      typeof entityId !== "string" ||
      entityId.trim().length === 0
    ) {
      logger.debug("No valid entityId provided, returning empty results");
      return [];
    }

    // Filter out empty or invalid relationship types
    const validRelationshipTypes = relationshipTypes.filter(
      (type) => type && typeof type === "string" && type.trim().length > 0
    );

    // Build the base WHERE clause for finding relationships where entityId is source or target
    let whereClause = "(source_entity_id = ? OR target_entity_id = ?)";
    let parameters = [entityId, entityId];

    // Add relationship type filtering if valid types are provided
    if (validRelationshipTypes.length > 0) {
      const typePlaceholders = validRelationshipTypes.map(() => "?").join(", ");
      whereClause += ` AND relationship_type IN (${typePlaceholders})`;
      parameters.push(...validRelationshipTypes);
    }

    const sql = `
      SELECT 
        relationship_id,
        source_entity_id,
        target_entity_id,
        target_symbol_name,
        relationship_type,
        weight,
        custom_metadata,
        created_at
      FROM code_relationships 
      WHERE ${whereClause}
      ORDER BY relationship_type, weight DESC
    `;

    logger.debug("Executing relationships query", {
      sql: sql.replace(/\s+/g, " ").trim(),
      parametersCount: parameters.length,
      validRelationshipTypesCount: validRelationshipTypes.length,
    });

    const result = await dbClient.execute({
      sql,
      args: parameters,
    });

    const relationships = result.rows || [];

    logger.debug("Relationships query completed", {
      relationshipsFound: relationships.length,
      entityId,
      validRelationshipTypesCount: validRelationshipTypes.length,
      depth,
    });

    return relationships;
  } catch (error) {
    logger.error("Error getting relationships for entity", {
      error: error.message,
      stack: error.stack,
      entityId,
      relationshipTypes,
      depth,
    });

    // Return empty array on error to avoid breaking the retrieval flow
    return [];
  }
}

// Export all schema setup functions
export default {
  setupGitCommitsTable,
  setupGitCommitFilesTable,
  setupCodeEntitiesTable,
  setupProjectDocumentsTable,
  setupCodeRelationshipsTable,
  setupEntityKeywordsTable,
  setupConversationHistoryTable,
  setupConversationTopicsTable,
  setupBackgroundAiJobsTable,
  setupSystemMetadataTable,
  getLastProcessedCommitOid,
  setLastProcessedCommitOid,
  addGitCommit,
  addGitCommitFile,
  addBackgroundAiJob,
  cancelBackgroundAiJobsForEntity,
  initializeDatabaseSchema,
  addOrUpdateCodeEntity,
  getCodeEntityById,
  deleteCodeEntitiesByFilePath,
  updateCodeEntityAiStatus,
  getCodeEntitiesByFilePath,
  addCodeRelationship,
  deleteCodeRelationshipsBySourceEntityId,
  deleteCodeRelationshipsByTargetEntityId,
  deleteCodeRelationshipsByFilePath,
  addOrUpdateProjectDocument,
  getProjectDocumentByFilePath,
  getProjectDocumentById,
  deleteProjectDocumentByFilePath,
  updateProjectDocumentAiStatus,
  logConversationMessage,
  hasInitialScanBeenCompleted,
  markInitialScanCompleted,
  fetchPendingAiJobs,
  updateAiJobStatusAndAttempts,
  updateEntityAiStatusForJobTarget,
  addEntityKeywords,
  getFullConversationHistory,
  addConversationTopic,
  getCodeEntityCountsByLanguage,
  getCodeEntityCountsByType,
  getCodeEntityCountsByAiStatus,
  getProjectDocumentCountsByType,
  getProjectDocumentCountsByAiStatus,
  getCodeRelationshipCountsByType,
  getRecentConversationTopics,
  searchCodeEntitiesFts,
  searchProjectDocumentsFts,
  searchEntityKeywords,
  searchConversationHistoryByTerms,
  searchConversationTopicsByTerms,
  searchGitCommitsByTerms,
  searchGitCommitFilesByTerms,
  getRelationshipsForEntity,
};
