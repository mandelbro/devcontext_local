/**
 * KnowledgeProcessor.js
 *
 * Processes and analyzes code changes in the codebase.
 * Orchestrates the indexing and knowledge extraction from changed files.
 */

import * as ContextIndexerLogic from "./ContextIndexerLogic.js";
import { executeQuery } from "../db.js";

/**
 * @typedef {Object} CodeEntity
 * @property {string} id - Unique identifier for the code entity
 * @property {string} path - File path of the code entity
 * @property {string} type - Type of code entity ('file', 'function', 'class', etc.)
 * @property {string} name - Name of the code entity
 * @property {string} content - Content of the code entity
 * @property {string} symbol_path - Full symbol path of the entity
 * @property {number} version - Version number of the entity
 * @property {string} parent_id - ID of the parent entity, if any
 * @property {string} created_at - Timestamp when entity was created
 * @property {string} updated_at - Timestamp when entity was last updated
 */

/**
 * Process a single code change
 *
 * @param {Object} change - Object containing file change information
 * @param {string} change.filePath - Path to the changed file
 * @param {string} change.newContent - New content of the file
 * @param {string} [change.languageHint] - Optional language hint for the file
 * @returns {Promise<Object>} Result of processing the code change
 */
export async function processCodeChange(change) {
  const inMcpMode = process.env.MCP_MODE === "true";

  if (!change || !change.filePath || !change.newContent) {
    if (!inMcpMode) console.error("Invalid code change object:", change);
    return {
      filePath: change?.filePath || "unknown",
      success: false,
      error: "Invalid code change: missing required fields",
      timestamp: new Date().toISOString(),
    };
  }

  try {
    if (!inMcpMode)
      console.log(`Processing code change for ${change.filePath}`);

    // Calculate content hash for quick comparison
    let contentHash;
    try {
      const crypto = await import("crypto");
      // Use SHA-256 consistent with ContextIndexerLogic.js
      contentHash = crypto
        .createHash("sha256")
        .update(change.newContent)
        .digest("hex");
    } catch (hashError) {
      // If hash calculation fails, just continue with a default hash
      contentHash = "unknown-hash-" + Date.now();
    }

    // Check if file exists and has the same content hash
    let skipProcessing = false;
    try {
      const existingFileQuery = `
        SELECT entity_id, content_hash 
        FROM code_entities 
        WHERE file_path = ? AND entity_type = 'file'
      `;

      const existingFile = await executeQuery(existingFileQuery, [
        change.filePath,
      ]);

      // If file exists and content hash matches, skip processing
      if (
        existingFile &&
        existingFile.rows &&
        existingFile.rows.length > 0 &&
        existingFile.rows[0].content_hash === contentHash
      ) {
        if (!inMcpMode)
          console.log(
            `File ${change.filePath} is unchanged, skipping indexing`
          );
        skipProcessing = true;
      }
    } catch (dbError) {
      // Just log the error and continue with indexing
      if (!inMcpMode)
        console.warn(
          `DB check error for ${change.filePath}, proceeding with indexing: ${dbError.message}`
        );
    }

    let entities = [];

    // Only do the indexing if we need to (file changed or doesn't exist)
    if (!skipProcessing) {
      try {
        // Index the updated file
        await ContextIndexerLogic.indexCodeFile(
          change.filePath,
          change.newContent,
          change.languageHint
        );
      } catch (indexError) {
        // If indexing fails, log error but continue
        if (!inMcpMode)
          console.error(
            `Error indexing file ${change.filePath}: ${indexError.message}`
          );
        return {
          filePath: change.filePath,
          success: false,
          error: `Indexing failed: ${indexError.message}`,
          timestamp: new Date().toISOString(),
        };
      }
    }

    // Try to get entities even if indexing failed - they might already exist
    try {
      // Get the entities associated with this file
      entities = await getEntitiesFromChangedFiles([change.filePath]);
    } catch (entitiesError) {
      // If getting entities fails, just return an empty array
      if (!inMcpMode)
        console.warn(
          `Error getting entities for ${change.filePath}: ${entitiesError.message}`
        );
      entities = [];
    }

    return {
      filePath: change.filePath,
      success: true,
      entityCount: entities.length,
      unchanged: skipProcessing,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    if (!inMcpMode)
      console.error(
        `Error processing code change for ${change.filePath}:`,
        error
      );

    // Return error info but don't throw
    return {
      filePath: change.filePath,
      success: false,
      error: `Failed to process code change: ${error.message}`,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Process changes to multiple files in the codebase
 *
 * @param {Array<{filePath: string, newContent: string, languageHint: string}>} changedFiles - Array of changed files with their content and language
 * @returns {Promise<void>}
 */
export async function processCodebaseChanges(changedFiles) {
  if (!changedFiles || changedFiles.length === 0) {
    console.log("No files to process");
    return;
  }

  console.log(`Processing ${changedFiles.length} changed files...`);

  try {
    // Process each file in parallel using Promise.all
    // Each file gets its own try/catch to prevent one failure from stopping the entire process
    const processingPromises = changedFiles.map(async (file) => {
      try {
        await ContextIndexerLogic.indexCodeFile(
          file.filePath,
          file.newContent,
          file.languageHint
        );
        return { filePath: file.filePath, success: true };
      } catch (error) {
        console.error(`Error processing file ${file.filePath}:`, error);
        return {
          filePath: file.filePath,
          success: false,
          error: error.message,
        };
      }
    });

    // Wait for all processing to complete
    const results = await Promise.all(processingPromises);

    // Count successes and failures
    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    console.log(
      `Completed processing ${changedFiles.length} files. Success: ${successCount}, Failures: ${failureCount}`
    );

    // If there were any failures, log them in detail
    if (failureCount > 0) {
      const failures = results.filter((r) => !r.success);
      console.error(
        "Failed files:",
        failures.map((f) => f.filePath).join(", ")
      );
    }
  } catch (error) {
    console.error("Error during codebase change processing:", error);
    throw error; // Rethrow to allow caller to handle the error
  }
}

/**
 * Retrieves all code entities related to the provided file paths
 *
 * @param {string[]} filePaths - Array of file paths that have changed
 * @returns {Promise<CodeEntity[]>} Array of code entities related to the changed files
 */
export async function getEntitiesFromChangedFiles(filePaths) {
  const inMcpMode = process.env.MCP_MODE === "true";

  if (!filePaths || filePaths.length === 0) {
    return [];
  }

  try {
    // Process files one at a time to avoid complex query errors
    let allEntities = [];
    let processedPaths = new Set();

    for (const filePath of filePaths) {
      if (processedPaths.has(filePath)) continue;
      processedPaths.add(filePath);

      try {
        // Get entities directly matching this file path
        const fileQuery = `SELECT * FROM code_entities WHERE file_path = ?`;
        const fileEntities = await executeQuery(fileQuery, [filePath]);

        if (!fileEntities || !fileEntities.rows) continue;

        // Add the file entities to our result
        const entities = [...fileEntities.rows];

        // Get file entity IDs to query for children
        const fileEntityIds = entities
          .filter((entity) => entity.entity_type === "file")
          .map((entity) => entity.entity_id);

        // If we have file entities, get their children
        if (fileEntityIds.length > 0) {
          for (const entityId of fileEntityIds) {
            try {
              const childQuery = `
                SELECT * FROM code_entities 
                WHERE parent_entity_id = ?
              `;
              const childEntities = await executeQuery(childQuery, [entityId]);

              if (childEntities && childEntities.rows) {
                // Add child entities if not already present
                for (const child of childEntities.rows) {
                  // Check if entity is already in our results
                  if (!entities.some((e) => e.entity_id === child.entity_id)) {
                    entities.push(child);
                  }
                }
              }
            } catch (childErr) {
              if (!inMcpMode) {
                console.warn(
                  `Error fetching children for entity ${entityId}: ${childErr.message}`
                );
              }
              // Continue with next entityId
            }
          }
        }

        // Add all entities from this file to our result set
        allEntities = [...allEntities, ...entities];
      } catch (fileErr) {
        if (!inMcpMode) {
          console.warn(`Error processing file ${filePath}: ${fileErr.message}`);
        }
        // Continue with next file
      }
    }

    return allEntities;
  } catch (error) {
    if (!inMcpMode) {
      console.error("Error retrieving entities from changed files:", error);
    }
    // Return empty array instead of throwing
    return [];
  }
}
