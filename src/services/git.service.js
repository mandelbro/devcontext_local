/**
 * Git Monitoring Service
 *
 * This service is responsible for monitoring a Git repository for changes
 * and processing new commits. It uses isomorphic-git for Git operations
 * and persists the last processed commit OID to ensure monitoring can
 * resume correctly after server restarts.
 */

import * as git from "isomorphic-git";
import fs from "fs";
import config from "../config.js";
import logger from "../utils/logger.js";
import {
  getLastProcessedCommitOid,
  setLastProcessedCommitOid,
  addGitCommit,
  addGitCommitFile,
} from "../db/queries.js";
import IndexingService from "./indexing.service.js";

/**
 * Git Monitoring Service
 * Monitors a git repository for changes and processes new commits
 */
export class GitMonitorService {
  /**
   * Creates a new GitMonitorService instance
   * @param {Object} dbClient - The TursoDB client instance
   */
  constructor(dbClient) {
    this.dbClient = dbClient;
    this.fs = fs;
    this.dir = config.PROJECT_PATH;
    this.lastProcessedOid = null;
    this.initialized = false;
    this.isMonitoring = false;
    this.monitorInterval = null;
    this.intervalMs = config.GIT_MONITOR_INTERVAL_MS || 30000; // Default to 30 seconds if not specified

    // Initialize the IndexingService
    this.indexingService = new IndexingService(dbClient);
  }

  /**
   * Initializes the GitMonitorService by retrieving the last processed commit OID
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      logger.info("Initializing GitMonitorService...");

      // Retrieve the last processed commit OID from the database
      this.lastProcessedOid = await getLastProcessedCommitOid(this.dbClient);

      if (this.lastProcessedOid) {
        logger.info(
          `GitMonitorService initialized with last processed commit OID: ${this.lastProcessedOid}`
        );
      } else {
        logger.info(
          "GitMonitorService initialized. No previous commit OID found - will start from current HEAD"
        );

        // Get current HEAD to use as starting point
        try {
          const currentHeadOid = await git.resolveRef({
            fs: this.fs,
            dir: this.dir,
            ref: "HEAD",
          });
          logger.info(`Current HEAD OID: ${currentHeadOid}`);
          this.lastProcessedOid = currentHeadOid;

          // Store this as the last processed OID
          await this.updateLastProcessedOid(currentHeadOid);
        } catch (gitError) {
          logger.error("Error resolving HEAD reference", {
            error: gitError.message,
            stack: gitError.stack,
          });
        }
      }

      this.initialized = true;
      logger.info("GitMonitorService initialization completed");
    } catch (error) {
      logger.error("Error initializing GitMonitorService", {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Starts the monitoring polling loop to periodically check for new commits
   * @returns {Promise<void>}
   */
  async startMonitoring() {
    if (!this.initialized) {
      throw new Error(
        "Git monitor service must be initialized before starting monitoring"
      );
    }

    if (this.isMonitoring) {
      logger.info("Git monitoring is already active");
      return;
    }

    logger.info(
      `Starting Git monitoring with interval of ${this.intervalMs}ms`
    );

    // Do an initial check for new commits
    await this.checkForNewCommits();

    // Set up the polling interval
    this.monitorInterval = setInterval(async () => {
      try {
        await this.checkForNewCommits();
      } catch (error) {
        logger.error("Error during Git monitoring interval", {
          error: error.message,
          stack: error.stack,
        });
      }
    }, this.intervalMs);

    this.isMonitoring = true;
    logger.info("Git monitoring started successfully");
  }

  /**
   * Stops the monitoring polling loop
   */
  stopMonitoring() {
    if (!this.isMonitoring) {
      logger.info("Git monitoring is not active");
      return;
    }

    logger.info("Stopping Git monitoring");

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    this.isMonitoring = false;
    logger.info("Git monitoring stopped successfully");
  }

  /**
   * Checks for new Git commits by comparing the latest commit OID with the last processed OID
   * @returns {Promise<boolean>} True if new commits were found, false otherwise
   */
  async checkForNewCommits() {
    if (!this.initialized) {
      throw new Error(
        "Git monitor service must be initialized before checking for commits"
      );
    }

    try {
      logger.debug("Checking for new Git commits...");

      // Get the current branch name
      const currentBranch = await git.currentBranch({
        fs: this.fs,
        dir: this.dir,
      });

      if (!currentBranch) {
        logger.warn(
          "Could not determine current branch, possibly detached HEAD"
        );
        return false;
      }

      logger.debug(`Current branch: ${currentBranch}`);

      // Get the latest commit OID on the current branch
      const latestOid = await git.resolveRef({
        fs: this.fs,
        dir: this.dir,
        ref: currentBranch,
      });

      logger.debug(`Latest commit OID: ${latestOid}`);
      logger.debug(`Last processed OID: ${this.lastProcessedOid}`);

      // Compare the latest OID with the last processed OID
      if (latestOid !== this.lastProcessedOid) {
        logger.info(
          `New commits detected. Latest OID: ${latestOid}, Last processed OID: ${this.lastProcessedOid}`
        );

        // Extract metadata from new commits
        const newCommits = await this.extractNewCommitsMetadata(latestOid);
        logger.info(`Found ${newCommits.length} new commits`);

        // Store the commits in the database
        await this.storeCommitsInDatabase(newCommits);

        // Collect all unique changed files from the new commits
        const allChangedFiles = this.collectUniqueChangedFiles(newCommits);

        // Trigger the IndexingService to process the changed files
        if (allChangedFiles.length > 0) {
          logger.info(
            `Triggering IndexingService with ${allChangedFiles.length} changed files`
          );
          await this.indexingService.processChanges(allChangedFiles);
        }

        // Update the last processed OID to the latest one
        await this.updateLastProcessedOid(latestOid);

        return true;
      } else {
        logger.debug("No new commits detected");
        return false;
      }
    } catch (error) {
      logger.error("Error checking for new Git commits", {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Collects unique changed files from multiple commits
   * @param {Array<Object>} commits - Array of commit metadata objects
   * @returns {Array<Object>} Array of unique changed file objects
   */
  collectUniqueChangedFiles(commits) {
    try {
      if (!commits || commits.length === 0) {
        return [];
      }

      logger.debug(
        `Collecting unique changed files from ${commits.length} commits`
      );

      // Map to track the latest status of each file path
      const filePathMap = new Map();

      // Process commits in chronological order (oldest first)
      // Since the commits array from extractNewCommitsMetadata is newest first,
      // we need to reverse it to apply changes in the correct order
      const chronologicalCommits = [...commits].reverse();

      for (const commit of chronologicalCommits) {
        if (!commit.changedFiles || commit.changedFiles.length === 0) {
          continue;
        }

        for (const file of commit.changedFiles) {
          // For renamed files, we track both the old and new paths
          if (file.status === "renamed") {
            // If a file was renamed, remove any tracking of the old path
            // and add tracking for the new path
            filePathMap.delete(file.oldFilePath);
            filePathMap.set(file.newFilePath, {
              filePath: file.newFilePath,
              status: "renamed",
              oldFilePath: file.oldFilePath,
            });
          } else {
            // For added, modified, deleted files, just track the current path and status
            filePathMap.set(file.filePath, {
              filePath: file.filePath,
              status: file.status,
            });
          }
        }
      }

      // Convert map values to array
      const uniqueChangedFiles = Array.from(filePathMap.values());

      logger.debug(
        `Collected ${uniqueChangedFiles.length} unique changed files`
      );
      return uniqueChangedFiles;
    } catch (error) {
      logger.error("Error collecting unique changed files", {
        error: error.message,
        stack: error.stack,
      });
      return [];
    }
  }

  /**
   * Extracts metadata from new commits between the last processed OID and the latest OID
   * @param {string} latestOid - The latest commit OID
   * @returns {Promise<Array<Object>>} Array of commit metadata objects
   */
  async extractNewCommitsMetadata(latestOid) {
    try {
      logger.debug("Extracting metadata from new commits...");

      let commits = [];

      if (!this.lastProcessedOid) {
        // If no previous OID exists, just get the current HEAD commit
        logger.info("No previous OID, fetching only the latest commit");
        const commitResult = await git.readCommit({
          fs: this.fs,
          dir: this.dir,
          oid: latestOid,
        });

        commits = [commitResult];
      } else {
        // Get all commits between the last processed OID and the latest OID
        logger.info(
          `Fetching commits between ${this.lastProcessedOid} and ${latestOid}`
        );

        const logCommits = await git.log({
          fs: this.fs,
          dir: this.dir,
          ref: latestOid,
        });

        // Process commits until we reach the last processed OID
        for (const commit of logCommits) {
          if (commit.oid === this.lastProcessedOid) {
            break;
          }
          commits.push(commit);
        }
      }

      // Extract and format commit metadata with changed files
      const commitsMetadata = [];

      for (const commit of commits) {
        const { oid, commit: commitData } = commit;

        // Extract the list of changed files for this commit
        const changedFiles = await this.extractChangedFilesFromCommit(commit);

        commitsMetadata.push({
          hash: oid,
          authorName: commitData.author.name,
          authorEmail: commitData.author.email,
          date: new Date(commitData.author.timestamp * 1000), // Convert to milliseconds
          message: commitData.message,
          changedFiles: changedFiles,
        });
      }

      logger.debug(`Extracted metadata from ${commitsMetadata.length} commits`);
      return commitsMetadata;
    } catch (error) {
      logger.error("Error extracting commit metadata", {
        error: error.message,
        stack: error.stack,
        latestOid,
      });
      throw error;
    }
  }

  /**
   * Extracts the list of changed files by comparing a commit's tree with its parent's tree
   * @param {Object} commit - The commit object from git.log or git.readCommit
   * @returns {Promise<Array<Object>>} Array of changed file objects with path and status
   */
  async extractChangedFilesFromCommit(commit) {
    try {
      const { oid, commit: commitData } = commit;
      logger.debug(`Extracting changed files for commit ${oid}`);

      // Get the commit's tree
      const currentTreeOid = commitData.tree;

      // Check if this commit has parents
      const parentOids = commitData.parent;

      // If this is the initial commit (no parent), all files are 'added'
      if (!parentOids || parentOids.length === 0) {
        logger.debug(`Commit ${oid} is the initial commit (no parent)`);

        // For initial commit, get all files in the tree as 'added'
        const changedFiles = [];

        // Read the tree to get all entries
        const tree = await git.readTree({
          fs: this.fs,
          dir: this.dir,
          oid: currentTreeOid,
        });

        // Walk the tree to get all files
        await git.walk({
          fs: this.fs,
          dir: this.dir,
          trees: [git.TREE({ ref: currentTreeOid })],
          map: async (filepath, [entry]) => {
            const type = await entry.type();

            // Only process blobs (files), not trees (directories)
            if (type === "blob") {
              changedFiles.push({
                filePath: filepath,
                status: "added",
              });
            }
            return null; // Don't need to return anything for the result
          },
        });

        logger.debug(
          `Found ${changedFiles.length} added files in initial commit ${oid}`
        );
        return changedFiles;
      }

      // For merge commits, only consider the first parent for now
      // This is a simplification - a more complete implementation would handle multiple parents
      const parentOid = parentOids[0];

      if (parentOids.length > 1) {
        logger.info(
          `Commit ${oid} is a merge commit. Only comparing with first parent ${parentOid}`
        );
      }

      // Read the parent commit to get its tree
      const parentCommit = await git.readCommit({
        fs: this.fs,
        dir: this.dir,
        oid: parentOid,
      });

      const parentTreeOid = parentCommit.commit.tree;

      // Now use git.walk to compare the two trees
      let changedFiles = [];
      const addedFiles = [];
      const deletedFiles = [];
      const modifiedFiles = [];

      await git.walk({
        fs: this.fs,
        dir: this.dir,
        trees: [
          git.TREE({ ref: parentTreeOid }),
          git.TREE({ ref: currentTreeOid }),
        ],
        map: async (filepath, [parentEntry, currentEntry]) => {
          // File was added (exists in current but not in parent)
          if (!parentEntry && currentEntry) {
            // Store the blob OID for potential rename detection
            const oid = await currentEntry.oid();
            addedFiles.push({
              filePath: filepath,
              status: "added",
              oid: oid,
            });
          }
          // File was deleted (exists in parent but not in current)
          else if (parentEntry && !currentEntry) {
            // Store the blob OID for potential rename detection
            const oid = await parentEntry.oid();
            deletedFiles.push({
              filePath: filepath,
              status: "deleted",
              oid: oid,
            });
          }
          // File exists in both trees, check if it was modified
          else if (parentEntry && currentEntry) {
            // Get the OIDs to compare content
            const parentOid = await parentEntry.oid();
            const currentOid = await currentEntry.oid();

            // If OIDs differ, the file was modified
            if (parentOid !== currentOid) {
              modifiedFiles.push({
                filePath: filepath,
                status: "modified",
              });
            }

            // If OIDs are the same but modes differ, also consider as modified
            // (e.g., permission changes or file type changes)
            const parentMode = await parentEntry.mode();
            const currentMode = await currentEntry.mode();

            if (parentOid === currentOid && parentMode !== currentMode) {
              modifiedFiles.push({
                filePath: filepath,
                status: "modified",
              });
            }
          }

          return null; // We don't need to return anything for the result
        },
      });

      // Apply rename detection heuristic
      changedFiles = await this.detectRenamesInChangedFiles(
        addedFiles,
        deletedFiles,
        modifiedFiles
      );

      logger.debug(
        `Found ${changedFiles.length} changed files in commit ${oid}`
      );
      return changedFiles;
    } catch (error) {
      logger.error(`Error extracting changed files for commit ${commit.oid}`, {
        error: error.message,
        stack: error.stack,
      });
      return []; // Return empty array on error
    }
  }

  /**
   * Detects potential renames by comparing content OIDs of added and deleted files
   * @param {Array<Object>} addedFiles - Files that were added in the commit
   * @param {Array<Object>} deletedFiles - Files that were deleted in the commit
   * @param {Array<Object>} modifiedFiles - Files that were modified in the commit
   * @returns {Promise<Array<Object>>} Array of changed files with rename detection
   */
  async detectRenamesInChangedFiles(addedFiles, deletedFiles, modifiedFiles) {
    try {
      // Start with the modified files (these won't be affected by rename detection)
      const changedFiles = [...modifiedFiles];

      // Track which files have been processed as renames
      const renamedAddedFiles = new Set();
      const renamedDeletedFiles = new Set();

      // Process potential renames by matching OIDs
      for (const deletedFile of deletedFiles) {
        for (const addedFile of addedFiles) {
          // Skip if this added file has already been processed as a rename
          if (renamedAddedFiles.has(addedFile.filePath)) {
            continue;
          }

          // If the OIDs match, it's likely a rename
          if (deletedFile.oid === addedFile.oid) {
            // Add a renamed file entry instead of separate add/delete
            changedFiles.push({
              oldFilePath: deletedFile.filePath,
              newFilePath: addedFile.filePath,
              status: "renamed",
              oid: deletedFile.oid,
            });

            // Mark these files as processed so they don't appear as separate add/delete
            renamedAddedFiles.add(addedFile.filePath);
            renamedDeletedFiles.add(deletedFile.filePath);

            // We found a match for this deleted file, no need to check more
            break;
          }
        }
      }

      // Add remaining added files (those not part of renames)
      for (const addedFile of addedFiles) {
        if (!renamedAddedFiles.has(addedFile.filePath)) {
          changedFiles.push({
            filePath: addedFile.filePath,
            status: "added",
          });
        }
      }

      // Add remaining deleted files (those not part of renames)
      for (const deletedFile of deletedFiles) {
        if (!renamedDeletedFiles.has(deletedFile.filePath)) {
          changedFiles.push({
            filePath: deletedFile.filePath,
            status: "deleted",
          });
        }
      }

      logger.debug(`Processed ${renamedAddedFiles.size} renamed files`);
      return changedFiles;
    } catch (error) {
      logger.error("Error detecting renames in changed files", {
        error: error.message,
        stack: error.stack,
      });
      // In case of error, return the original files without rename detection
      return [...addedFiles, ...deletedFiles, ...modifiedFiles];
    }
  }

  /**
   * Stores commit metadata in the database
   * @param {Array<Object>} commits - Array of commit metadata objects
   * @returns {Promise<void>}
   */
  async storeCommitsInDatabase(commits) {
    try {
      logger.info(`Storing ${commits.length} commits in the database...`);

      for (const commit of commits) {
        try {
          // Store basic commit information
          await addGitCommit(this.dbClient, {
            commit_hash: commit.hash,
            author_name: commit.authorName,
            author_email: commit.authorEmail,
            commit_date: commit.date,
            message: commit.message,
          });
          logger.debug(`Stored commit ${commit.hash} in database`);

          // Store information about changed files
          if (commit.changedFiles && commit.changedFiles.length > 0) {
            logger.debug(
              `Storing ${commit.changedFiles.length} changed files for commit ${commit.hash}`
            );

            for (const file of commit.changedFiles) {
              try {
                if (file.status === "renamed") {
                  // Handle renamed files specially
                  await addGitCommitFile(
                    this.dbClient,
                    commit.hash,
                    file.newFilePath,
                    file.status,
                    file.oldFilePath
                  );
                } else {
                  // Handle added, modified, deleted files
                  await addGitCommitFile(
                    this.dbClient,
                    commit.hash,
                    file.filePath,
                    file.status
                  );
                }
              } catch (fileError) {
                logger.error(
                  `Failed to store file information for commit ${commit.hash}`,
                  {
                    error: fileError.message,
                    stack: fileError.stack,
                    filePath:
                      file.status === "renamed"
                        ? file.newFilePath
                        : file.filePath,
                    status: file.status,
                  }
                );
                // Continue with other files even if one fails
              }
            }
          }

          // Log the list of changed files for this commit
          if (commit.changedFiles && commit.changedFiles.length > 0) {
            // Log normal file changes
            const normalChanges = commit.changedFiles
              .filter((file) => file.status !== "renamed")
              .map((file) => `${file.filePath} (${file.status})`);

            // Log renames with special formatting
            const renameChanges = commit.changedFiles
              .filter((file) => file.status === "renamed")
              .map(
                (file) => `${file.oldFilePath} → ${file.newFilePath} (renamed)`
              );

            const allChanges = [...normalChanges, ...renameChanges].join(", ");

            logger.debug(
              `Files changed in commit ${commit.hash}: ${allChanges}`
            );
          }
        } catch (commitError) {
          logger.error(`Failed to store commit ${commit.hash} in database`, {
            error: commitError.message,
            stack: commitError.stack,
            commit: commit.hash,
          });
          // Continue with other commits even if one fails
        }
      }

      logger.info("Finished storing commits in database");
    } catch (error) {
      logger.error("Error storing commits in database", {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Updates the last processed commit OID in the database
   * @param {string} oid - The commit OID to store
   * @returns {Promise<void>}
   */
  async updateLastProcessedOid(oid) {
    try {
      if (!oid) {
        logger.warn(
          "Attempted to update last processed OID with null/undefined value"
        );
        return;
      }

      await setLastProcessedCommitOid(this.dbClient, oid);
      this.lastProcessedOid = oid;
      logger.info(`Updated last processed commit OID to: ${oid}`);
    } catch (error) {
      logger.error("Error updating last processed commit OID", {
        error: error.message,
        stack: error.stack,
        oid,
      });
      throw error;
    }
  }

  /**
   * Retrieves the current stored last processed commit OID
   * @returns {string|null} The last processed commit OID or null if not available
   */
  getLastProcessedOid() {
    return this.lastProcessedOid;
  }
}

export default GitMonitorService;
