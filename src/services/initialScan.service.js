/**
 * InitialScanService
 *
 * This service is responsible for orchestrating the initial scan of a codebase
 * to establish a baseline context for DevContext.
 */

import * as git from "isomorphic-git";
import { TREE } from "isomorphic-git";
import { promises as fs } from "fs";
import path from "path";
import indexingService from "./indexing.service.js";
import config from "../config.js";
import logger from "../utils/logger.js";
import dbQueries from "../db/queries.js";

/**
 * Service for performing an initial scan of the codebase
 */
export class InitialScanService {
  /**
   * Initialize the InitialScanService
   */
  constructor() {
    this.logger = logger;
    this.dbQueries = dbQueries;
    this.indexingService = indexingService;
    this.config = config;

    // Define language extension mappings
    this.languageExtensionMap = {
      javascript: [".js", ".jsx", ".mjs", ".cjs"],
      typescript: [".ts", ".tsx"],
      python: [".py", ".pyw"],
      java: [".java"],
      c: [".c", ".h"],
      cpp: [".cpp", ".hpp", ".cc", ".hh", ".cxx", ".hxx"],
      csharp: [".cs"],
      go: [".go"],
      rust: [".rs"],
      ruby: [".rb"],
      php: [".php"],
      swift: [".swift"],
      kotlin: [".kt"],
      scala: [".scala"],
    };

    this.logger.debug("InitialScanService initialized");
  }

  /**
   * Perform an initial scan of the codebase
   * This method orchestrates the process of scanning all files in the project
   * and passing them to the IndexingService for processing
   *
   * @returns {Promise<Object>} Result of the initial scan operation
   */
  async performInitialScan() {
    this.logger.info("Starting initial codebase scan");

    try {
      // Check if scan is needed (might be already done)
      const isFirstRun = await this._isFirstRun();

      if (!isFirstRun) {
        this.logger.info("Initial scan already performed, skipping");
        return { status: "skipped", reason: "already_scanned" };
      }

      // Validate the project path is a git repository
      const repoValidation = await this.config.validateGitRepository();
      if (!repoValidation.isValid) {
        throw new Error("Project path is not a valid git repository");
      }

      // Get the list of all files in the project directory
      const projectPath = this.config.PROJECT_PATH;
      this.logger.info(`Scanning codebase at: ${projectPath}`);

      // Get all files in the repository from Git HEAD
      const allFiles = await this._getGitHeadFiles(projectPath);
      this.logger.info(
        `Found ${allFiles.length} files tracked in Git HEAD to scan`
      );

      // Filter and categorize files
      const categorizedFiles = await this._categorizeFiles(allFiles);

      // Log file categorization results
      this.logger.info("File categorization results:", {
        core_code: categorizedFiles.filter((f) => f.type === "core_code")
          .length,
        markdown: categorizedFiles.filter((f) => f.type === "markdown").length,
        other_text: categorizedFiles.filter((f) => f.type === "other_text")
          .length,
        ignored: allFiles.length - categorizedFiles.length,
        total_relevant: categorizedFiles.length,
      });

      // Process each categorized file individually with the IndexingService
      const processedFiles = await this._processFilesWithIndexingService(
        categorizedFiles
      );

      // Mark initial scan as complete in the database
      await this._markScanComplete();

      this.logger.info("Initial codebase scan completed successfully", {
        files: allFiles.length,
        relevantFiles: categorizedFiles.length,
        processed: processedFiles.processed,
        failed: processedFiles.failed,
      });

      return {
        status: "success",
        filesScanned: allFiles.length,
        relevantFiles: categorizedFiles.length,
        filesProcessed: processedFiles.processed,
        filesFailed: processedFiles.failed,
      };
    } catch (error) {
      this.logger.error("Error during initial codebase scan", {
        error: error.message,
        stack: error.stack,
      });

      return {
        status: "error",
        error: error.message,
      };
    }
  }

  /**
   * Filter and categorize files based on their extensions and configuration
   * @private
   * @param {Array<string>} files - Array of file paths
   * @returns {Promise<Array<Object>>} Array of categorized file objects
   */
  async _categorizeFiles(files) {
    this.logger.debug(
      "Categorizing files based on extensions and configuration"
    );

    // Get configuration values
    const treeSitterLanguages = this.config.TREE_SITTER_LANGUAGES || [];
    const textFileExtensions =
      this.config.TEXT_FILE_EXTENSIONS_FOR_CONTENT_INDEXING || [];
    const ignoredExtensions = this.config.IGNORED_FILE_EXTENSIONS || [];

    // Create a lookup table for file extensions to languages
    const extensionToLanguage = {};
    treeSitterLanguages.forEach((language) => {
      const extensions = this.languageExtensionMap[language] || [];
      extensions.forEach((ext) => {
        extensionToLanguage[ext] = language;
      });
    });

    // Add normalized extensions to ignored list (ensure they all start with a dot)
    const normalizedIgnored = ignoredExtensions.map((ext) =>
      ext.startsWith(".") ? ext : `.${ext}`
    );

    // Add normalized extensions to text files list
    const normalizedTextExtensions = textFileExtensions.map((ext) =>
      ext.startsWith(".") ? ext : `.${ext}`
    );

    // Process each file
    const categorizedFiles = [];
    let ignoredCount = 0;
    let uncategorizedCount = 0;

    for (const filePath of files) {
      const extension = path.extname(filePath).toLowerCase();

      // Skip ignored files
      if (normalizedIgnored.includes(extension)) {
        ignoredCount++;
        continue;
      }

      // Categorize the file
      let fileObj = { filePath };

      // Check if it's a core code file (supported by tree-sitter)
      if (extension in extensionToLanguage) {
        fileObj.type = "core_code";
        fileObj.language = extensionToLanguage[extension];
      }
      // Check if it's a markdown file
      else if ([".md", ".markdown"].includes(extension)) {
        fileObj.type = "markdown";
      }
      // Check if it's a configured text file
      else if (normalizedTextExtensions.includes(extension)) {
        fileObj.type = "other_text";
      }
      // Uncategorized files
      else {
        uncategorizedCount++;
        this.logger.debug(
          `Skipping uncategorized file: ${filePath} (extension: ${extension})`
        );
        continue;
      }

      categorizedFiles.push(fileObj);
    }

    this.logger.debug("File categorization complete", {
      totalFiles: files.length,
      categorizedFiles: categorizedFiles.length,
      ignoredFiles: ignoredCount,
      uncategorizedFiles: uncategorizedCount,
    });

    return categorizedFiles;
  }

  /**
   * Check if this is the first run and scan is needed
   * @private
   * @returns {Promise<boolean>} True if scan is needed, false otherwise
   */
  async _isFirstRun() {
    try {
      // Check if initial scan has been completed
      const client = await this.dbQueries.getDbClient();
      const scanCompleted = await this.dbQueries.hasInitialScanBeenCompleted(
        client
      );

      // If scan has been completed, no need to run again
      if (scanCompleted) {
        this.logger.info("Initial scan has already been completed, skipping");
        return false;
      }

      // Alternatively, we could check if code_entities or project_documents tables are empty
      // This is mentioned in the PRD as another way to determine if a scan is needed
      // For now, we'll rely on the system_metadata marker

      this.logger.info("Initial scan needs to be performed");
      return true;
    } catch (error) {
      this.logger.error("Error checking if initial scan is needed", {
        error: error.message,
        stack: error.stack,
      });

      // If there's an error, assume it's the first run
      return true;
    }
  }

  /**
   * Mark the initial scan as complete in the database
   * @private
   * @returns {Promise<void>}
   */
  async _markScanComplete() {
    try {
      const client = await this.dbQueries.getDbClient();
      await this.dbQueries.markInitialScanCompleted(client);
      this.logger.info("Initial scan marked as complete in the database");
    } catch (error) {
      this.logger.error("Error marking initial scan as complete", {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Get all files tracked in Git HEAD revision
   * @private
   * @param {string} projectPath - Project directory path
   * @returns {Promise<Array<string>>} Array of absolute file paths
   */
  async _getGitHeadFiles(projectPath) {
    try {
      this.logger.info("Retrieving files from Git HEAD revision...");

      const files = [];

      // Use isomorphic-git's walk API to traverse the HEAD tree
      await git.walk({
        fs,
        dir: projectPath,
        trees: [TREE({ ref: "HEAD" })],
        map: async (filepath, [entry]) => {
          if (filepath === "." || !entry) return null; // Skip root and null entries

          try {
            if ((await entry.type()) === "blob") {
              // 'blob' means file, 'tree' means directory
              // Store absolute path
              const fullPath = path.join(projectPath, filepath);
              files.push(fullPath);

              // Log every 100 files to show progress without overwhelming logs
              if (files.length % 100 === 0) {
                this.logger.debug(
                  `Found ${files.length} files so far in Git HEAD...`
                );
              }
            }
          } catch (err) {
            this.logger.warn(`Error processing Git entry at ${filepath}`, {
              error: err.message,
              stack: err.stack,
            });
          }

          return filepath; // Must return something for map
        },
      });

      this.logger.info(
        `Successfully retrieved ${files.length} files from Git HEAD revision`
      );
      return files;
    } catch (error) {
      this.logger.error(`Error retrieving files from Git HEAD`, {
        error: error.message,
        stack: error.stack,
      });

      // If Git operations fail, fall back to filesystem-based retrieval
      this.logger.warn("Falling back to filesystem-based file retrieval");
      return this._getAllFilesFromFilesystem(projectPath);
    }
  }

  /**
   * Get all files in the repository from Git HEAD
   * @private
   * @param {string} projectPath - Project directory path
   * @returns {Promise<Array<string>>} Array of file paths
   */
  async _getAllFiles(projectPath) {
    try {
      // Use the new _getGitHeadFiles method for Git-based file retrieval
      return await this._getGitHeadFiles(projectPath);
    } catch (error) {
      this.logger.error(
        `Failed to get files using Git. Falling back to filesystem scan.`,
        {
          error: error.message,
          stack: error.stack,
        }
      );
      return this._getAllFilesFromFilesystem(projectPath);
    }
  }

  /**
   * Fallback method to get all files in the repository recursively using filesystem
   * @private
   * @param {string} dirPath - Directory path to scan
   * @param {Array<string>} [allFiles=[]] - Accumulator for recursion
   * @returns {Promise<Array<string>>} Array of file paths
   */
  async _getAllFilesFromFilesystem(dirPath, allFiles = []) {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        // Skip .git directory and other ignored paths
        if (entry.name === ".git" || this._shouldIgnorePath(fullPath)) {
          continue;
        }

        if (entry.isDirectory()) {
          // Recursively scan subdirectories
          await this._getAllFilesFromFilesystem(fullPath, allFiles);
        } else {
          // Add file to the list if it meets criteria
          if (this._shouldProcessFile(entry.name)) {
            allFiles.push(fullPath);
          }
        }
      }

      return allFiles;
    } catch (error) {
      this.logger.error(`Error scanning directory ${dirPath}`, {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Check if a file should be processed based on its extension
   * @private
   * @param {string} fileName - File name to check
   * @returns {boolean} True if the file should be processed
   */
  _shouldProcessFile(fileName) {
    const supportedLanguages = this.config.TREE_SITTER_LANGUAGES || [];
    const ignoredExtensions = [".exe", ".dll", ".obj", ".bin", ".lock", ".log"];

    // Check if file has an ignored extension
    if (ignoredExtensions.some((ext) => fileName.toLowerCase().endsWith(ext))) {
      return false;
    }

    // Code files with supported languages should be processed
    // This is a simplified check, actual logic would be in IndexingService.determineFileType
    const extension = path.extname(fileName).toLowerCase();
    if (extension === ".js" && supportedLanguages.includes("javascript"))
      return true;
    if (extension === ".ts" && supportedLanguages.includes("typescript"))
      return true;
    if (extension === ".py" && supportedLanguages.includes("python"))
      return true;

    // Also process text and markdown files
    if ([".txt", ".md", ".markdown"].includes(extension)) return true;

    // For simplicity, include common code file extensions (could be made configurable)
    const commonCodeExtensions = [
      ".jsx",
      ".tsx",
      ".json",
      ".html",
      ".css",
      ".c",
      ".cpp",
      ".h",
      ".java",
      ".rb",
    ];
    if (commonCodeExtensions.includes(extension)) return true;

    return false;
  }

  /**
   * Check if a path should be ignored
   * @private
   * @param {string} fullPath - Path to check
   * @returns {boolean} True if the path should be ignored
   */
  _shouldIgnorePath(fullPath) {
    const ignoreFolders = [
      "node_modules",
      "dist",
      "build",
      ".vscode",
      ".idea",
      ".github",
    ];
    return ignoreFolders.some((folder) => fullPath.includes(`/${folder}/`));
  }

  /**
   * Process each categorized file with the IndexingService
   * @private
   * @param {Array<Object>} categorizedFiles - Array of categorized file objects
   * @returns {Promise<Object>} Processing results with counts
   */
  async _processFilesWithIndexingService(categorizedFiles) {
    this.logger.info(
      `Starting to process ${categorizedFiles.length} files with IndexingService`
    );

    const result = {
      processed: 0,
      failed: 0,
    };

    // Process files in batches of 10 to avoid overwhelming the system
    const BATCH_SIZE = 10;
    const TOTAL_FILES = categorizedFiles.length;

    for (let i = 0; i < categorizedFiles.length; i += BATCH_SIZE) {
      const batch = categorizedFiles.slice(i, i + BATCH_SIZE);

      // Log progress
      this.logger.info(
        `Initial scan: Processing files ${i + 1}-${Math.min(
          i + BATCH_SIZE,
          TOTAL_FILES
        )} of ${TOTAL_FILES}`
      );

      // Process each file in the batch
      for (const file of batch) {
        try {
          // Create the file change object
          const fileChange = {
            filePath: file.filePath,
            status: "added", // All files treated as 'added' in initial scan
            language: file.language, // Pass language if it's known (for code files)
          };

          // Call IndexingService to process this file
          await this.indexingService.processFileChanges([fileChange]);

          result.processed++;

          // Log every 50 files for visibility
          if (result.processed % 50 === 0) {
            this.logger.info(
              `Initial scan: Processed ${
                result.processed
              }/${TOTAL_FILES} files (${Math.round(
                (result.processed / TOTAL_FILES) * 100
              )}%)`
            );
          }
        } catch (error) {
          // Log the error but continue with other files
          this.logger.error(`Error processing file: ${file.filePath}`, {
            error: error.message,
            stack: error.stack,
            fileType: file.type,
            language: file.language,
          });

          result.failed++;
        }
      }
    }

    this.logger.info(
      `Completed processing with IndexingService: ${result.processed} succeeded, ${result.failed} failed`
    );
    return result;
  }
}
