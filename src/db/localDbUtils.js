/**
 * Local SQLite Database Utilities
 *
 * This module provides utility functions for managing local SQLite database files
 * including creation, validation, and backup operations.
 */

import { promises as fs } from 'fs';
import path from 'path';
import logger from '../utils/logger.js';

/**
 * Ensures that the database file and its directory exist
 * @param {string} dbPath - Path to the database file
 * @returns {Promise<boolean>} True if file exists or was created successfully
 */
export const ensureDbFileExists = async (dbPath) => {
  try {
    // Resolve the absolute path
    const absolutePath = path.resolve(dbPath);
    const directory = path.dirname(absolutePath);

    logger.debug(`Ensuring database file exists at: ${absolutePath}`);

    // Create directory if it doesn't exist
    try {
      await fs.mkdir(directory, { recursive: true });
      logger.debug(`Database directory ensured: ${directory}`);
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }

    // Check if file exists
    try {
      await fs.access(absolutePath, fs.constants.F_OK);
      logger.debug(`Database file already exists: ${absolutePath}`);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, create an empty file
        await fs.writeFile(absolutePath, '');
        logger.info(`Created new database file: ${absolutePath}`);
        return true;
      }
      throw error;
    }
  } catch (error) {
    logger.error(`Failed to ensure database file exists: ${dbPath}`, {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

/**
 * Validates that the database file exists and is accessible
 * @param {string} dbPath - Path to the database file
 * @returns {Promise<Object>} Validation result with isValid flag and error details
 */
export const validateDbFile = async (dbPath) => {
  try {
    const absolutePath = path.resolve(dbPath);

    // Check if file exists
    await fs.access(absolutePath, fs.constants.F_OK);

    // Check read/write permissions
    await fs.access(absolutePath, fs.constants.R_OK | fs.constants.W_OK);

    logger.debug(`Database file validated successfully: ${absolutePath}`);

    return {
      isValid: true,
      absolutePath,
      error: null
    };
  } catch (error) {
    const errorDetails = {
      isValid: false,
      absolutePath: path.resolve(dbPath),
      error: error.message
    };

    if (error.code === 'ENOENT') {
      errorDetails.error = 'Database file does not exist';
    } else if (error.code === 'EACCES') {
      errorDetails.error = 'Insufficient permissions to access database file';
    }

    logger.error(`Database file validation failed: ${dbPath}`, errorDetails);

    return errorDetails;
  }
};

/**
 * Gets information about the database file
 * @param {string} dbPath - Path to the database file
 * @returns {Promise<Object>} File information including size and timestamps
 */
export const getDbFileInfo = async (dbPath) => {
  try {
    const absolutePath = path.resolve(dbPath);
    const stats = await fs.stat(absolutePath);

    const fileInfo = {
      path: absolutePath,
      size: stats.size,
      sizeInMB: (stats.size / (1024 * 1024)).toFixed(2),
      created: stats.birthtime,
      modified: stats.mtime,
      isFile: stats.isFile()
    };

    logger.debug(`Retrieved database file info`, fileInfo);

    return fileInfo;
  } catch (error) {
    logger.error(`Failed to get database file info: ${dbPath}`, {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

/**
 * Creates a timestamped backup of the database file
 * @param {string} dbPath - Path to the database file
 * @returns {Promise<string>} Path to the created backup file
 */
export const createBackup = async (dbPath) => {
  try {
    const absolutePath = path.resolve(dbPath);
    const directory = path.dirname(absolutePath);
    const filename = path.basename(absolutePath, path.extname(absolutePath));
    const extension = path.extname(absolutePath);

    // Create timestamp for backup filename with milliseconds to ensure uniqueness
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    const backupFilename = `${filename}_backup_${timestamp}${extension}`;
    const backupPath = path.join(directory, backupFilename);

    // Copy the file
    await fs.copyFile(absolutePath, backupPath);

    logger.info(`Created database backup: ${backupPath}`);

    return backupPath;
  } catch (error) {
    logger.error(`Failed to create database backup: ${dbPath}`, {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

export default {
  ensureDbFileExists,
  validateDbFile,
  getDbFileInfo,
  createBackup
};
