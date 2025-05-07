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
  if (!change || !change.filePath || !change.newContent) {
    console.error("Invalid code change object:", change);
    throw new Error("Invalid code change: missing required fields");
  }

  try {
    console.log(`Processing code change for ${change.filePath}`);

    // Index the updated file
    await ContextIndexerLogic.indexCodeFile(
      change.filePath,
      change.newContent,
      change.languageHint
    );

    // Get the entities associated with this file
    const entities = await getEntitiesFromChangedFiles([change.filePath]);

    return {
      filePath: change.filePath,
      success: true,
      entityCount: entities.length,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error(
      `Error processing code change for ${change.filePath}:`,
      error
    );
    throw new Error(`Failed to process code change: ${error.message}`);
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
  if (!filePaths || filePaths.length === 0) {
    return [];
  }

  try {
    // First query: Get all entities directly matching the file paths
    const placeholders = filePaths.map(() => "?").join(",");
    const query = `SELECT * FROM code_entities WHERE path IN (${placeholders})`;

    const fileEntities = await executeQuery(query, filePaths);

    // Get the IDs of the file entities to query for child entities
    const fileEntityIds = fileEntities
      .filter((entity) => entity.type === "file")
      .map((entity) => entity.id);

    // If we have file entities, query for their children
    if (fileEntityIds.length > 0) {
      const childPlaceholders = fileEntityIds.map(() => "?").join(",");
      const childQuery = `SELECT * FROM code_entities WHERE parent_id IN (${childPlaceholders})`;

      const childEntities = await executeQuery(childQuery, fileEntityIds);

      // Combine file entities and their children, removing duplicates by ID
      const allEntities = [...fileEntities];

      // Add child entities that aren't already in the result set
      const existingIds = new Set(allEntities.map((entity) => entity.id));

      for (const childEntity of childEntities) {
        if (!existingIds.has(childEntity.id)) {
          allEntities.push(childEntity);
          existingIds.add(childEntity.id);
        }
      }

      return allEntities;
    }

    // If no file entities were found, just return what we have
    return fileEntities;
  } catch (error) {
    console.error("Error retrieving entities from changed files:", error);
    throw error;
  }
}
