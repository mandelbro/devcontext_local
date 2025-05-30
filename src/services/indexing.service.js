/**
 * Indexing Service
 *
 * This service is responsible for indexing code files and updating
 * code entities in the database when files change.
 */

import path from "path";
import { promises as fs } from "fs";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import parserService from "./parser.service.js";
import backgroundJobManager from "./job.service.js";
import dbQueries from "../db/queries.js";
import config from "../config.js";
import logger from "../utils/logger.js";

// File type configurations
const CODE_FILE_EXTENSIONS = {
  javascript: [".js", ".jsx", ".mjs"],
  typescript: [".ts", ".tsx"],
  python: [".py"],
};

// Markdown file extensions
const MARKDOWN_FILE_EXTENSIONS = [".md", ".markdown", ".mdown", ".mdwn"];

// Text file extensions for content indexing (documentation, config files, etc.)
const TEXT_FILE_EXTENSIONS = [
  ".txt",
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".ini",
  ".env",
  ".html",
  ".css",
  ".scss",
  ".less",
];

// File extensions to ignore
const IGNORED_FILE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".ico",
  ".svg",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".7z",
  ".rar",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".wmv",
  ".ttf",
  ".woff",
  ".woff2",
  ".eot",
  ".dll",
  ".exe",
  ".so",
  ".dylib",
  ".class",
  ".jar",
  ".war",
  ".ear",
  ".pyc",
  ".pyo",
  ".pyd",
];

/**
 * IndexingService class
 * Responsible for indexing code entities and processing file changes
 */
export class IndexingService {
  /**
   * Creates a new IndexingService instance
   * @param {Object} options - Service dependencies
   * @param {Object} options.dbClient - The database client
   * @param {Object} [options.parserService] - The parser service instance
   * @param {Object} [options.backgroundJobManager] - The background job manager instance
   * @param {Object} [options.dbQueries] - Database queries module
   */
  constructor({
    dbClient,
    parserService: customParserService = parserService,
    backgroundJobManager: customJobManager = backgroundJobManager,
    dbQueries: customDbQueries = dbQueries,
  }) {
    this.dbClient = dbClient;
    this.parserService = customParserService;
    this.jobManager = customJobManager;
    this.dbQueries = customDbQueries;
    this.initialized = false;
    logger.info("IndexingService initialized");
  }

  /**
   * Initialize the IndexingService
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      if (!this.initialized) {
        logger.info("Initializing IndexingService");

        // Initialize parser service if not already initialized
        if (!this.parserService.initialized) {
          await this.parserService.initialize(config.TREE_SITTER_LANGUAGES);
        }

        // Initialize job manager if not already initialized
        if (!this.jobManager.initialized) {
          await this.jobManager.initialize();
        }

        this.initialized = true;
        logger.info("IndexingService initialized successfully");
      }
    } catch (error) {
      logger.error(`Error initializing IndexingService: ${error.message}`, {
        error,
      });
      throw error;
    }
  }

  /**
   * Determine the file type based on extension
   * @param {string} filePath - Path to the file
   * @returns {Object} File type information
   */
  determineFileType(filePath) {
    if (!filePath) return { type: "unknown", language: null };

    const extension = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath).toLowerCase();

    // Check if file should be ignored
    if (IGNORED_FILE_EXTENSIONS.includes(extension)) {
      return { type: "ignored", language: null };
    }

    // Check for Markdown files
    if (MARKDOWN_FILE_EXTENSIONS.includes(extension)) {
      return { type: "markdown", language: null };
    }

    // Check for code files
    for (const [language, extensions] of Object.entries(CODE_FILE_EXTENSIONS)) {
      if (extensions.includes(extension)) {
        return { type: "code", language };
      }
    }

    // Check for text files
    if (TEXT_FILE_EXTENSIONS.includes(extension)) {
      return { type: "text", language: null };
    }

    // Special handling for unknown files
    if (extension === "") {
      // Files without extension could be important config files
      if (["dockerfile", "makefile", "jenkinsfile"].includes(fileName)) {
        return { type: "text", language: null };
      }
    }

    return { type: "unknown", language: null };
  }

  /**
   * Check if a file is a Markdown document (case-insensitive)
   * @param {string} filePath - Path to the file
   * @returns {boolean} True if the file is a Markdown document
   */
  isMarkdownFile(filePath) {
    if (!filePath) return false;

    const extension = path.extname(filePath).toLowerCase();
    return MARKDOWN_FILE_EXTENSIONS.includes(extension);
  }

  /**
   * Process a list of changed files
   * @param {Array<Object>} changedFilesList - List of changed files with their statuses
   * @param {string} changedFilesList[].filePath - Path to the changed file
   * @param {string} changedFilesList[].status - Status of the change ('added' | 'modified' | 'deleted' | 'renamed')
   * @param {string} [changedFilesList[].oldFilePath] - Previous path for renamed files
   * @returns {Promise<Object>} Processing results
   */
  async processFileChanges(changedFilesList) {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      if (!changedFilesList || changedFilesList.length === 0) {
        logger.info("No file changes to process");
        return { processed: 0 };
      }

      logger.info(
        `Starting to process ${changedFilesList.length} file changes`
      );

      // Group files by status
      const grouped = {
        added: [],
        modified: [],
        deleted: [],
        renamed: [],
      };

      // First, categorize files by status and determine their types
      for (const file of changedFilesList) {
        if (!file.filePath) {
          logger.warn("Skipping file change entry with missing filePath");
          continue;
        }

        const { status } = file;

        if (status === "renamed" && !file.oldFilePath) {
          logger.warn(
            `Renamed file ${file.filePath} is missing oldFilePath, treating as added`
          );
          grouped.added.push({
            ...file,
            fileType: this.determineFileType(file.filePath),
          });
          continue;
        }

        if (grouped[status]) {
          grouped[status].push({
            ...file,
            fileType: this.determineFileType(file.filePath),
          });
        } else {
          logger.warn(
            `Unknown file status: ${status} for file ${file.filePath}`
          );
        }
      }

      // Log summary of files to process
      logger.info(
        `Files to process: ${grouped.added.length} added, ${grouped.modified.length} modified, ` +
          `${grouped.deleted.length} deleted, ${grouped.renamed.length} renamed`
      );

      // Process each file according to its status and type
      const processingResults = {
        added: { processed: 0, skipped: 0 },
        modified: { processed: 0, skipped: 0 },
        deleted: { processed: 0, skipped: 0 },
        renamed: { processed: 0, skipped: 0 },
      };

      // Process deleted files
      if (grouped.deleted.length > 0) {
        logger.info(`Processing ${grouped.deleted.length} deleted files`);
        await this.processDeletedFiles(
          grouped.deleted,
          processingResults.deleted
        );
      }

      // Process renamed files
      if (grouped.renamed.length > 0) {
        logger.info(`Processing ${grouped.renamed.length} renamed files`);
        await this.processRenamedFiles(
          grouped.renamed,
          processingResults.renamed
        );
      }

      // Process added files
      if (grouped.added.length > 0) {
        logger.info(`Processing ${grouped.added.length} added files`);
        await this.processAddedOrModifiedFiles(
          grouped.added,
          "added",
          processingResults.added
        );
      }

      // Process modified files
      if (grouped.modified.length > 0) {
        logger.info(`Processing ${grouped.modified.length} modified files`);
        await this.processAddedOrModifiedFiles(
          grouped.modified,
          "modified",
          processingResults.modified
        );
      }

      logger.info(
        `Completed processing ${changedFilesList.length} file changes`
      );

      return {
        processed: changedFilesList.length,
        summary: {
          added: grouped.added.length,
          modified: grouped.modified.length,
          deleted: grouped.deleted.length,
          renamed: grouped.renamed.length,
        },
        results: processingResults,
      };
    } catch (error) {
      logger.error(`Error processing file changes: ${error.message}`, {
        error,
        fileCount: changedFilesList?.length || 0,
      });
      throw error;
    }
  }

  /**
   * Process renamed files - treat as a delete of oldFilePath and an add of filePath
   * @param {Array<Object>} renamedFiles - List of renamed files with their types
   * @param {Object} results - Object to record processing results
   * @returns {Promise<void>}
   */
  async processRenamedFiles(renamedFiles, results) {
    for (const file of renamedFiles) {
      const { filePath, oldFilePath, fileType } = file;

      try {
        // Skip non-code and non-markdown files (currently only processing code files)
        if (fileType.type !== "code" && fileType.type !== "markdown") {
          logger.debug(
            `Skipping renamed non-processable file: ${oldFilePath} -> ${filePath} (${fileType.type})`
          );
          results.skipped++;
          continue;
        }

        if (fileType.type === "markdown") {
          logger.info(
            `Processing renamed Markdown file: ${oldFilePath} -> ${filePath}`
          );

          // Step 1: Process the oldFilePath as 'deleted' - adapted from processDeletedFiles logic
          logger.info(`Processing old path ${oldFilePath} as deleted`);
          let documentId = null;

          try {
            // Get the document ID for the old Markdown file path
            const document = await this.dbQueries.getProjectDocumentByFilePath(
              this.dbClient,
              oldFilePath
            );

            if (document) {
              documentId = document.document_id;
              logger.info(
                `Found document ID ${documentId} for old Markdown file path: ${oldFilePath}`
              );

              // Cancel any background AI jobs for this document
              try {
                const cancelResult =
                  await this.dbQueries.cancelBackgroundAiJobsForEntity(
                    this.dbClient,
                    documentId
                  );
                logger.info(
                  `Cancelled ${cancelResult.deletedCount} background AI jobs for document ID: ${documentId}`
                );
              } catch (jobError) {
                logger.error(
                  `Error cancelling jobs for document ${documentId}: ${jobError.message}`,
                  {
                    error: jobError,
                    documentId,
                    filePath: oldFilePath,
                  }
                );
                // Continue with document deletion despite job cancellation errors
              }

              // Delete the project document entry for the old path
              try {
                const deleteResult =
                  await this.dbQueries.deleteProjectDocumentByFilePath(
                    this.dbClient,
                    oldFilePath
                  );
                logger.info(
                  `Deleted ${deleteResult.deletedCount} project document for old file path: ${oldFilePath}`
                );
              } catch (deleteError) {
                logger.error(
                  `Error deleting project document for old file path ${oldFilePath}: ${deleteError.message}`,
                  {
                    error: deleteError,
                    documentId,
                    filePath: oldFilePath,
                  }
                );
                // This is an error, but we'll continue with processing
              }
            } else {
              logger.info(
                `No document found for old Markdown file path: ${oldFilePath}`
              );
            }
          } catch (documentError) {
            logger.error(
              `Error fetching project document for old file path ${oldFilePath}: ${documentError.message}`,
              {
                error: documentError,
                filePath: oldFilePath,
              }
            );
          }

          // Step 2: Process the new filePath as 'added'
          // Note: Full implementation will be added in Task 064
          logger.info(
            `New file path ${filePath} will be processed as 'added' in Task 064`
          );

          logger.info(
            `Completed processing renamed Markdown file: ${oldFilePath} -> ${filePath}`
          );
          results.processed++;
          continue;
        }

        logger.info(
          `Processing renamed code file: ${oldFilePath} -> ${filePath} (${fileType.language})`
        );

        // Step 1: Process oldFilePath as 'deleted'
        // This is essentially the same logic as in processDeletedFiles

        // First fetch all entity IDs for the old file path before deleting anything
        let entityIds = [];
        try {
          const entities = await this.dbQueries.getCodeEntitiesByFilePath(
            this.dbClient,
            oldFilePath
          );
          entityIds = entities.map((entity) => entity.entity_id);
          logger.info(
            `Found ${entityIds.length} entities to remove for old file path: ${oldFilePath}`
          );
        } catch (error) {
          logger.error(
            `Error fetching entities for old file path ${oldFilePath}: ${error.message}`,
            { error }
          );
          // Continue with deletion anyway - the old file is gone, so entities should be removed
        }

        // Cancel background AI jobs for each entity ID from the old file path
        let cancelledJobsCount = 0;
        if (entityIds.length > 0) {
          logger.info(
            `Cancelling background jobs for ${entityIds.length} entities in old file path: ${oldFilePath}`
          );

          for (const entityId of entityIds) {
            try {
              const result =
                await this.dbQueries.cancelBackgroundAiJobsForEntity(
                  this.dbClient,
                  entityId
                );
              cancelledJobsCount += result.deletedCount || 0;
            } catch (error) {
              logger.error(
                `Error cancelling jobs for entity ${entityId}: ${error.message}`,
                {
                  error,
                  entityId,
                  filePath: oldFilePath,
                }
              );
              // Continue with other entities
            }
          }

          logger.info(
            `Cancelled ${cancelledJobsCount} background jobs for old file path: ${oldFilePath}`
          );
        }

        // Delete code relationships for entities in the old file path
        try {
          const relationshipsResult =
            await this.dbQueries.deleteCodeRelationshipsByFilePath(
              this.dbClient,
              oldFilePath
            );
          logger.info(
            `Deleted ${relationshipsResult.deletedCount} code relationships for old file path: ${oldFilePath}`
          );
        } catch (error) {
          logger.error(
            `Error deleting code relationships for old file path ${oldFilePath}: ${error.message}`,
            {
              error,
              filePath: oldFilePath,
            }
          );
          // Continue with entity deletion - relationships are less critical
        }

        // Delete code entities for the old file path
        try {
          const entitiesResult =
            await this.dbQueries.deleteCodeEntitiesByFilePath(
              this.dbClient,
              oldFilePath
            );
          logger.info(
            `Deleted ${entitiesResult.deletedCount} code entities for old file path: ${oldFilePath}`
          );
        } catch (error) {
          logger.error(
            `Error deleting code entities for old file path ${oldFilePath}: ${error.message}`,
            {
              error,
              filePath: oldFilePath,
            }
          );
          // This is a critical error, but we'll continue with processing the new file path
        }

        // Step 2: Process filePath (new path) as 'added'
        // In the initial implementation, we just log this as we would in processFileChanges
        // This part will be expanded when the 'added' file handling is implemented (Task 053)
        logger.debug(
          `New file path ${filePath} will be processed as 'added' in a subsequent task`
        );

        logger.info(
          `Completed processing renamed file: ${oldFilePath} -> ${filePath}`
        );
        results.processed++;
      } catch (error) {
        logger.error(
          `Error processing renamed file ${oldFilePath} -> ${filePath}: ${error.message}`,
          {
            error,
            oldFilePath,
            filePath,
            fileType,
          }
        );
        results.skipped++;
      }
    }
  }

  /**
   * Process deleted files - remove code entities, relationships, and cancel jobs
   * @param {Array<Object>} deletedFiles - List of deleted files with their types
   * @param {Object} results - Object to record processing results
   * @returns {Promise<void>}
   */
  async processDeletedFiles(deletedFiles, results) {
    for (const file of deletedFiles) {
      const { filePath, fileType } = file;

      try {
        // Check for Markdown files specifically
        if (fileType.type === "markdown") {
          logger.info(`Processing deleted Markdown file: ${filePath}`);

          // Step 1: Get the document ID for the Markdown file
          let documentId = null;
          try {
            const document = await this.dbQueries.getProjectDocumentByFilePath(
              this.dbClient,
              filePath
            );

            if (document) {
              documentId = document.document_id;
              logger.info(
                `Found document ID ${documentId} for Markdown file: ${filePath}`
              );

              // Step 2: Cancel any background AI jobs for this document
              try {
                const cancelResult =
                  await this.dbQueries.cancelBackgroundAiJobsForEntity(
                    this.dbClient,
                    documentId
                  );
                logger.info(
                  `Cancelled ${cancelResult.deletedCount} background AI jobs for document ID: ${documentId}`
                );
              } catch (jobError) {
                logger.error(
                  `Error cancelling jobs for document ${documentId}: ${jobError.message}`,
                  {
                    error: jobError,
                    documentId,
                    filePath,
                  }
                );
                // Continue with document deletion despite job cancellation errors
              }

              // Step 3: Delete the project document entry
              try {
                const deleteResult =
                  await this.dbQueries.deleteProjectDocumentByFilePath(
                    this.dbClient,
                    filePath
                  );
                logger.info(
                  `Deleted ${deleteResult.deletedCount} project document for file: ${filePath}`
                );
              } catch (deleteError) {
                logger.error(
                  `Error deleting project document for file ${filePath}: ${deleteError.message}`,
                  {
                    error: deleteError,
                    documentId,
                    filePath,
                  }
                );
                // This is a critical error, but we'll continue with other files
              }
            } else {
              logger.info(
                `No document found for deleted Markdown file: ${filePath}`
              );
            }
          } catch (documentError) {
            logger.error(
              `Error fetching project document for file ${filePath}: ${documentError.message}`,
              {
                error: documentError,
                filePath,
              }
            );
            // Continue with other files
          }

          logger.info(
            `Completed processing deleted Markdown file: ${filePath}`
          );
          results.processed++;
          continue;
        }

        // Only process code files (files that could have code entities)
        if (fileType.type !== "code") {
          logger.debug(
            `Skipping deleted non-code file: ${filePath} (${fileType.type})`
          );
          results.skipped++;
          continue;
        }

        logger.info(
          `Processing deleted code file: ${filePath} (${fileType.language})`
        );

        // Step 1: First fetch all entity IDs for this file path before deleting anything
        // This allows us to properly cancel jobs for these entities
        let entityIds = [];
        try {
          const entities = await this.dbQueries.getCodeEntitiesByFilePath(
            this.dbClient,
            filePath
          );
          entityIds = entities.map((entity) => entity.entity_id);
          logger.info(
            `Found ${entityIds.length} entities to remove for file: ${filePath}`
          );
        } catch (error) {
          logger.error(
            `Error fetching entities for file ${filePath}: ${error.message}`,
            { error }
          );
          // Continue with deletion anyway - the file is gone, so entities should be removed
        }

        // Step 2: Cancel background AI jobs for each entity ID
        let cancelledJobsCount = 0;
        if (entityIds.length > 0) {
          logger.info(
            `Cancelling background jobs for ${entityIds.length} entities in file: ${filePath}`
          );

          for (const entityId of entityIds) {
            try {
              const result =
                await this.dbQueries.cancelBackgroundAiJobsForEntity(
                  this.dbClient,
                  entityId
                );
              cancelledJobsCount += result.deletedCount || 0;
            } catch (error) {
              logger.error(
                `Error cancelling jobs for entity ${entityId}: ${error.message}`,
                {
                  error,
                  entityId,
                  filePath,
                }
              );
              // Continue with other entities
            }
          }

          logger.info(
            `Cancelled ${cancelledJobsCount} background jobs for file: ${filePath}`
          );
        }

        // Step 3: Delete code relationships for entities in this file path
        try {
          const relationshipsResult =
            await this.dbQueries.deleteCodeRelationshipsByFilePath(
              this.dbClient,
              filePath
            );
          logger.info(
            `Deleted ${relationshipsResult.deletedCount} code relationships for file: ${filePath}`
          );
        } catch (error) {
          logger.error(
            `Error deleting code relationships for file ${filePath}: ${error.message}`,
            {
              error,
              filePath,
            }
          );
          // Continue with entity deletion - relationships are less critical
        }

        // Step 4: Delete code entities for this file path
        try {
          const entitiesResult =
            await this.dbQueries.deleteCodeEntitiesByFilePath(
              this.dbClient,
              filePath
            );
          logger.info(
            `Deleted ${entitiesResult.deletedCount} code entities for file: ${filePath}`
          );
        } catch (error) {
          logger.error(
            `Error deleting code entities for file ${filePath}: ${error.message}`,
            {
              error,
              filePath,
            }
          );
          // This is a critical error, but we'll continue with other files
        }

        logger.info(`Completed processing deleted file: ${filePath}`);
        results.processed++;
      } catch (error) {
        logger.error(
          `Error processing deleted file ${filePath}: ${error.message}`,
          {
            error,
            filePath,
            fileType,
          }
        );
        results.skipped++;
      }
    }
  }

  /**
   * Process added or modified files - read file content and check size
   * @param {Array<Object>} files - List of files with their types
   * @param {string} status - Status of the files ('added' or 'modified')
   * @param {Object} results - Object to record processing results
   * @returns {Promise<void>}
   */
  async processAddedOrModifiedFiles(files, status, results) {
    // Get the maximum file size from config, convert from MB to bytes
    const MAX_TEXT_FILE_SIZE_BYTES =
      (config.MAX_TEXT_FILE_SIZE_MB || 5) * 1024 * 1024;

    for (const file of files) {
      const { filePath, fileType } = file;

      try {
        logger.info(
          `Processing ${status} ${fileType.type} file: ${filePath}${
            fileType.language ? ` (${fileType.language})` : ""
          }`
        );

        // Skip ignored files
        if (fileType.type === "ignored") {
          logger.debug(`Skipping ignored file: ${filePath}`);
          results.skipped++;
          continue;
        }

        try {
          // Read the file content
          const fileContent = await fs.readFile(filePath, "utf-8");

          // Get the size of the content in bytes
          const fileSize = Buffer.byteLength(fileContent, "utf-8");

          // Check if the file exceeds the maximum size
          if (fileSize > MAX_TEXT_FILE_SIZE_BYTES) {
            logger.warn(
              `File ${filePath} exceeds maximum size (${fileSize} bytes > ${MAX_TEXT_FILE_SIZE_BYTES} bytes), skipping full parsing`
            );

            // Store a minimal code entity for files that are too large
            if (fileType.type === "code") {
              try {
                const fileName = path.basename(filePath);
                const entityId = uuidv4();

                const entityData = {
                  entity_id: entityId,
                  file_path: filePath,
                  entity_type: "file", // A generic file type
                  name: fileName,
                  start_line: 1,
                  start_column: 1,
                  end_line: 1,
                  end_column: 1,
                  raw_content: null, // Don't store the content as it's too large
                  language: fileType.language,
                  content_hash: null,
                  parent_entity_id: null,
                  parsing_status: "skipped_too_large",
                  ai_status: "skipped",
                  custom_metadata: JSON.stringify({
                    fileSize: fileSize,
                    maxAllowedSize: MAX_TEXT_FILE_SIZE_BYTES,
                    reason: "File exceeds size limit",
                  }),
                };

                logger.debug(
                  `Storing minimal code entity for oversized file: ${filePath}`
                );
                await this.dbQueries.addOrUpdateCodeEntity(
                  this.dbClient,
                  entityData
                );
                logger.info(
                  `Stored minimal code entity record for oversized file: ${filePath}`
                );
              } catch (dbError) {
                logger.error(
                  `Error storing minimal entity for oversized file ${filePath}: ${dbError.message}`,
                  {
                    error: dbError,
                    filePath,
                    fileType,
                  }
                );
              }
            }
            // For Markdown files, similar handling (will be implemented fully in later tasks)
            else if (fileType.type === "markdown") {
              logger.debug(
                `Identified oversized Markdown file: ${filePath} - will be handled in future implementation`
              );
              try {
                const fileName = path.basename(filePath);

                // Get existing document ID if it exists, or generate a new one
                let document =
                  await this.dbQueries.getProjectDocumentByFilePath(
                    this.dbClient,
                    filePath
                  );

                let documentId = document?.document_id || uuidv4();

                // Create minimal document record for the oversized file
                const docData = {
                  document_id: documentId,
                  file_path: filePath,
                  file_type: "markdown",
                  raw_content: null, // Don't store content as it's too large
                  content_hash: null,
                  parsing_status: "skipped_too_large",
                  ai_status: "skipped",
                  custom_metadata: JSON.stringify({
                    fileSize: fileSize,
                    maxAllowedSize: MAX_TEXT_FILE_SIZE_BYTES,
                    reason: "File exceeds size limit",
                  }),
                };

                logger.debug(
                  `Storing minimal document record for oversized Markdown file: ${filePath}`
                );
                await this.dbQueries.addOrUpdateProjectDocument(
                  this.dbClient,
                  docData
                );
                logger.info(
                  `Stored minimal document record for oversized Markdown file: ${filePath}`
                );
              } catch (dbError) {
                logger.error(
                  `Error storing minimal document for oversized Markdown file ${filePath}: ${dbError.message}`,
                  {
                    error: dbError,
                    filePath,
                    fileType,
                  }
                );
              }
            }
            // For other document files, similar handling
            else if (fileType.type === "text") {
              logger.debug(
                `Will store minimal document record for oversized file: ${filePath}`
              );
              // This will be implemented in a later task
            }

            results.processed++;
            continue; // Skip further processing for this file
          }

          logger.info(
            `File ${filePath} (${fileSize} bytes) is within size limit, proceeding to parsing`
          );

          // If we've reached here, the file content has been read and is within size limits

          // Process Markdown files
          if (fileType.type === "markdown") {
            try {
              logger.info(`Processing ${status} Markdown file: ${filePath}`);

              // Parse the Markdown content
              const parseResult = await this.parserService.parseMarkdownFile(
                filePath,
                fileContent
              );

              // Handle parsing errors
              if (parseResult.errors && parseResult.errors.length > 0) {
                logger.error(
                  `Error parsing Markdown file ${filePath}: ${parseResult.errors[0]}`
                );

                // Get existing document ID if it exists, or generate a new one
                let document =
                  await this.dbQueries.getProjectDocumentByFilePath(
                    this.dbClient,
                    filePath
                  );

                let documentId = document?.document_id || uuidv4();

                // Store a document record with failed status
                const docData = {
                  document_id: documentId,
                  file_path: filePath,
                  file_type: "markdown",
                  raw_content: fileContent, // Still store the content for potential manual review
                  content_hash: null,
                  parsing_status: "failed_read",
                  ai_status: "skipped",
                  custom_metadata: JSON.stringify({
                    errors: parseResult.errors,
                    reason: "Failed to parse markdown",
                  }),
                };

                await this.dbQueries.addOrUpdateProjectDocument(
                  this.dbClient,
                  docData
                );

                logger.info(
                  `Stored document record with parsing errors for Markdown file: ${filePath}`
                );
                results.processed++;
                continue;
              }

              // If parsing was successful and raw content is available
              if (parseResult.rawContent) {
                // Get existing document ID if it exists, or generate a new one
                let document =
                  await this.dbQueries.getProjectDocumentByFilePath(
                    this.dbClient,
                    filePath
                  );

                let documentId = document?.document_id || uuidv4();

                // Calculate content hash
                const contentHash = crypto
                  .createHash("sha256")
                  .update(parseResult.rawContent)
                  .digest("hex");

                // Check if content has changed if it's an existing document
                const contentChanged =
                  !document || document.content_hash !== contentHash;

                // Prepare document data
                const docData = {
                  document_id: documentId,
                  file_path: filePath,
                  file_type: "markdown",
                  raw_content: parseResult.rawContent,
                  content_hash: contentHash,
                  parsing_status: "completed",
                  ai_status: "pending", // Will be processed by AI job
                };

                // Store or update document record
                await this.dbQueries.addOrUpdateProjectDocument(
                  this.dbClient,
                  docData
                );

                logger.info(
                  `Successfully stored/updated document record for Markdown file: ${filePath}`
                );

                // If document is new or content has changed, enqueue an AI job for processing
                if (contentChanged) {
                  logger.info(
                    `Content changed for ${filePath}, enqueueing AI job`
                  );
                  try {
                    await this.jobManager.enqueueJob({
                      task_type: "enrich_entity_summary_keywords",
                      target_entity_id: documentId,
                      target_entity_type: "project_document",
                      payload: {},
                    });

                    logger.info(
                      `Successfully enqueued AI job for document: ${documentId}`
                    );
                  } catch (jobError) {
                    logger.error(
                      `Error enqueueing AI job for document ${documentId}: ${jobError.message}`,
                      {
                        error: jobError,
                        documentId,
                        filePath,
                      }
                    );
                  }
                } else {
                  logger.info(
                    `Content unchanged for ${filePath}, skipping AI job`
                  );
                }
              } else {
                logger.warn(
                  `No raw content available for Markdown file: ${filePath}`
                );
              }

              results.processed++;
              continue;
            } catch (parseError) {
              logger.error(
                `Error during processing of Markdown file ${filePath}: ${parseError.message}`,
                {
                  error: parseError,
                  filePath,
                }
              );
              results.errors++;
              continue;
            }
          }

          // For code files, process with the parser
          if (fileType.type === "code" && fileType.language) {
            // Check if language is supported by Tree-sitter
            const supportedLanguages = config.TREE_SITTER_LANGUAGES || [
              "javascript",
              "typescript",
              "python",
            ];

            if (supportedLanguages.includes(fileType.language)) {
              try {
                logger.info(
                  `Parsing code file ${filePath} with language: ${fileType.language}`
                );

                // Call the parser service
                const parseResult = await this.parserService.parseCodeFile(
                  filePath,
                  fileContent,
                  fileType.language
                );

                // Check for parsing errors
                if (parseResult.errors && parseResult.errors.length > 0) {
                  logger.warn(
                    `Parser reported ${parseResult.errors.length} errors for file ${filePath}`,
                    { errors: parseResult.errors }
                  );

                  // Store a minimal code entity with parsing_status: 'failed_parsing'
                  try {
                    const fileName = path.basename(filePath);
                    const entityId = uuidv4();

                    const entityData = {
                      entity_id: entityId,
                      file_path: filePath,
                      entity_type: "file", // A generic file type
                      name: fileName,
                      start_line: 1,
                      start_column: 1,
                      end_line: 1,
                      end_column: 1,
                      raw_content: null,
                      language: fileType.language,
                      content_hash: null,
                      parent_entity_id: null,
                      parsing_status: "failed_parsing",
                      ai_status: "skipped",
                      custom_metadata: {
                        parsingErrors: parseResult.errors,
                        reason: "Parser reported errors",
                      },
                    };

                    logger.debug(
                      `Storing code entity with failed_parsing status for file: ${filePath}`
                    );
                    await this.dbQueries.addOrUpdateCodeEntity(
                      this.dbClient,
                      entityData
                    );
                    logger.info(
                      `Stored code entity record with failed_parsing status for file: ${filePath}`
                    );
                  } catch (dbError) {
                    logger.error(
                      `Error storing entity with failed_parsing status for file ${filePath}: ${dbError.message}`,
                      {
                        error: dbError,
                        filePath,
                        fileType,
                      }
                    );
                  }
                } else {
                  // Successful parsing
                  logger.info(
                    `Successfully parsed ${filePath}: found ${
                      parseResult.entities?.length || 0
                    } entities and ${
                      parseResult.relationships?.length || 0
                    } relationships`
                  );

                  // Process and store the entities
                  const entityMap = await this.processCodeEntities(
                    parseResult.entities,
                    filePath,
                    fileType.language
                  );

                  // Process and store relationships
                  if (
                    parseResult.relationships &&
                    parseResult.relationships.length > 0
                  ) {
                    await this.processCodeRelationships(
                      parseResult.relationships,
                      filePath,
                      entityMap
                    );
                  } else {
                    logger.debug(
                      `No relationships to process for file: ${filePath}`
                    );
                  }
                }
              } catch (parseError) {
                // Handle parser exceptions
                logger.error(
                  `Error parsing file ${filePath}: ${parseError.message}`,
                  {
                    error: parseError,
                    filePath,
                    language: fileType.language,
                  }
                );

                // Store a minimal code entity with parsing_status: 'failed_parsing'
                try {
                  const fileName = path.basename(filePath);
                  const entityId = uuidv4();

                  const entityData = {
                    entity_id: entityId,
                    file_path: filePath,
                    entity_type: "file", // A generic file type
                    name: fileName,
                    start_line: 1,
                    start_column: 1,
                    end_line: 1,
                    end_column: 1,
                    raw_content: null,
                    language: fileType.language,
                    content_hash: null,
                    parent_entity_id: null,
                    parsing_status: "failed_parsing",
                    ai_status: "skipped",
                    custom_metadata: {
                      error: parseError.message,
                      reason: "Parser exception",
                    },
                  };

                  logger.debug(
                    `Storing code entity with failed_parsing status for file: ${filePath}`
                  );
                  await this.dbQueries.addOrUpdateCodeEntity(
                    this.dbClient,
                    entityData
                  );
                  logger.info(
                    `Stored code entity record with failed_parsing status for file: ${filePath}`
                  );
                } catch (dbError) {
                  logger.error(
                    `Error storing entity with failed_parsing status for file ${filePath}: ${dbError.message}`,
                    {
                      error: dbError,
                      filePath,
                      fileType,
                    }
                  );
                }
              }
            } else {
              // Language not supported by Tree-sitter
              logger.info(
                `Language ${fileType.language} not supported for Tree-sitter parsing, skipping parser for file: ${filePath}`
              );

              // Store as a regular file entity without detailed code structure
              // This will be implemented in a later task
              logger.debug(
                `Will store as basic file entity without Tree-sitter parsing: ${filePath}`
              );
            }
          } else if (fileType.type === "text") {
            // Text files don't need Tree-sitter parsing
            logger.debug(
              `Text file ${filePath} will be processed in a subsequent task`
            );
          }

          results.processed++;
        } catch (readError) {
          // Handle file read errors
          logger.error(`Error reading file ${filePath}: ${readError.message}`, {
            error: readError,
            filePath,
          });

          results.skipped++;
          continue; // Skip further processing for this file
        }
      } catch (error) {
        logger.error(
          `Error processing ${status} file ${filePath}: ${error.message}`,
          {
            error,
            filePath,
            fileType,
            status,
          }
        );
        results.skipped++;
      }
    }
  }

  /**
   * Process code entities extracted from a file
   * @param {Array<Object>} entities - List of code entities extracted by the parser
   * @param {string} filePath - Path to the file the entities were extracted from
   * @param {string} language - Programming language of the file
   * @returns {Promise<Object>} Map of original entity references to their generated UUIDs
   */
  async processCodeEntities(entities, filePath, language) {
    if (!entities || entities.length === 0) {
      logger.debug(`No entities to process for file: ${filePath}`);
      return {};
    }

    logger.info(
      `Processing ${entities.length} code entities for file: ${filePath}`
    );

    // Track successful and failed entity operations
    const results = {
      added: 0,
      updated: 0,
      failed: 0,
      jobsEnqueued: 0,
    };

    // Create a map to store the relationship between original entity references and their UUIDs
    // This will be used to resolve relationships properly
    const entityMap = {};

    for (const entity of entities) {
      try {
        // Generate a unique ID for the entity
        const entityId = uuidv4();
        entity.entity_id = entityId;

        // Store any original reference ID or name that might be used in relationships
        if (entity.ref_id) {
          entityMap[entity.ref_id] = entityId;
        }

        // Also map by entity name and type as a fallback
        const nameTypeKey = `${entity.entity_type}:${entity.name}`;
        entityMap[nameTypeKey] = entityId;

        // Calculate content hash
        const contentHash = crypto
          .createHash("sha256")
          .update(entity.raw_content || "")
          .digest("hex");
        entity.content_hash = contentHash;

        // Prepare the full entity data for DB insertion/update
        const entityData = {
          entity_id: entityId,
          file_path: filePath,
          entity_type: entity.entity_type,
          name: entity.name,
          start_line: entity.start_line,
          start_column: entity.start_column,
          end_line: entity.end_line,
          end_column: entity.end_column,
          raw_content: entity.raw_content,
          language,
          content_hash: contentHash,
          parent_entity_id: entity.parent_entity_id, // If provided by parser
          parsing_status: "completed",
          ai_status: "pending",
          custom_metadata: entity.custom_metadata || {},
        };

        // Add or update the entity in the database
        try {
          const result = await this.dbQueries.addOrUpdateCodeEntity(
            this.dbClient,
            entityData
          );

          if (result.isNew || result.contentChanged) {
            // Entity is new or has changed, enqueue an AI job to process it
            logger.debug(
              `Enqueueing AI job for ${
                result.isNew ? "new" : "updated"
              } entity: ${entityId}`
            );

            try {
              await this.jobManager.enqueueJob({
                task_type: "enrich_entity_summary_keywords",
                target_entity_id: entityId,
                target_entity_type: "code_entity",
                payload: {},
              });

              results.jobsEnqueued++;
            } catch (jobError) {
              logger.error(
                `Error enqueueing AI job for entity ${entityId}: ${jobError.message}`,
                {
                  error: jobError,
                  entityId,
                  filePath,
                }
              );
            }

            if (result.isNew) {
              results.added++;
            } else {
              results.updated++;
            }
          } else {
            logger.debug(
              `Entity ${entityId} already exists and content hasn't changed, skipping AI job`
            );
            results.updated++;
          }
        } catch (dbError) {
          logger.error(
            `Error storing entity for ${filePath}: ${dbError.message}`,
            {
              error: dbError,
              entityId,
              filePath,
              entityType: entity.entity_type,
            }
          );
          results.failed++;
        }
      } catch (error) {
        logger.error(
          `Error processing entity in file ${filePath}: ${error.message}`,
          {
            error,
            filePath,
            entityType: entity.entity_type,
          }
        );
        results.failed++;
      }
    }

    logger.info(
      `Completed processing entities for ${filePath}: ${results.added} added, ${results.updated} updated, ` +
        `${results.failed} failed, ${results.jobsEnqueued} AI jobs enqueued`
    );

    return entityMap;
  }

  /**
   * Process code relationships extracted from a file
   * @param {Array<Object>} relationships - List of code relationships extracted by the parser
   * @param {string} filePath - Path to the file the relationships were extracted from
   * @param {Object} entityMap - Map of entity original references to their UUIDs
   * @returns {Promise<void>}
   */
  async processCodeRelationships(relationships, filePath, entityMap) {
    if (!relationships || relationships.length === 0) {
      logger.debug(`No relationships to process for file: ${filePath}`);
      return;
    }

    logger.info(
      `Processing ${relationships.length} code relationships for file: ${filePath}`
    );

    // Track successful and failed relationship operations
    const results = {
      added: 0,
      failed: 0,
    };

    // First, clean up existing relationships for this file to handle modifications
    try {
      logger.debug(`Cleaning up existing relationships for file: ${filePath}`);
      const deleteResult =
        await this.dbQueries.deleteCodeRelationshipsByFilePath(
          this.dbClient,
          filePath
        );
      logger.info(
        `Deleted ${
          deleteResult.deletedCount || 0
        } existing relationships for file: ${filePath}`
      );
    } catch (deleteError) {
      logger.error(
        `Error deleting existing relationships for file ${filePath}: ${deleteError.message}`,
        { error: deleteError, filePath }
      );
      // Continue with adding new relationships even if cleanup failed
    }

    // Process each relationship
    for (const relationship of relationships) {
      try {
        // Generate a unique ID for the relationship
        const relationshipId = uuidv4();

        // Resolve source entity ID using the entityMap
        let sourceEntityId = null;
        if (
          relationship.source_ref_id &&
          entityMap[relationship.source_ref_id]
        ) {
          sourceEntityId = entityMap[relationship.source_ref_id];
        } else if (
          relationship.source_entity_type &&
          relationship.source_entity_name
        ) {
          const sourceKey = `${relationship.source_entity_type}:${relationship.source_entity_name}`;
          sourceEntityId = entityMap[sourceKey];
        }

        if (!sourceEntityId) {
          logger.warn(
            `Could not resolve source entity ID for relationship in file ${filePath}`,
            { relationship }
          );
          results.failed++;
          continue;
        }

        // Resolve target entity ID if it's in the same file
        let targetEntityId = null;
        if (
          relationship.target_ref_id &&
          entityMap[relationship.target_ref_id]
        ) {
          targetEntityId = entityMap[relationship.target_ref_id];
        } else if (
          relationship.target_entity_type &&
          relationship.target_entity_name
        ) {
          const targetKey = `${relationship.target_entity_type}:${relationship.target_entity_name}`;
          targetEntityId = entityMap[targetKey];
        }

        // If target entity is not found in the map, it might be in another file
        // We'll store the relationship with target_entity_id as null and rely on target_symbol_name

        // Prepare relationship data for DB insertion
        const relationshipData = {
          relationship_id: relationshipId,
          source_entity_id: sourceEntityId,
          target_entity_id: targetEntityId, // May be null for cross-file relationships
          target_symbol_name: relationship.target_symbol_name,
          relationship_type: relationship.relationship_type,
          custom_metadata: relationship.custom_metadata || {},
        };

        // Add the relationship to the database
        try {
          await this.dbQueries.addCodeRelationship(
            this.dbClient,
            relationshipData
          );
          results.added++;
        } catch (dbError) {
          logger.error(
            `Error storing relationship for ${filePath}: ${dbError.message}`,
            {
              error: dbError,
              relationshipId,
              sourceEntityId,
              targetEntityId,
              filePath,
            }
          );
          results.failed++;
        }
      } catch (error) {
        logger.error(
          `Error processing relationship in file ${filePath}: ${error.message}`,
          {
            error,
            filePath,
            relationshipType: relationship.relationship_type,
          }
        );
        results.failed++;
      }
    }

    logger.info(
      `Completed processing relationships for ${filePath}: ${results.added} added, ${results.failed} failed`
    );
  }
}

// Export a singleton instance and the class
export default new IndexingService({ dbClient: null });
