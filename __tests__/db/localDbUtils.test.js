/**
 * Tests for Local SQLite Database Utilities
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import * as localDbUtils from '../../src/db/localDbUtils.js';

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}));

// Mock fs promises
vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn(),
    access: vi.fn(),
    writeFile: vi.fn(),
    stat: vi.fn(),
    copyFile: vi.fn(),
    constants: {
      F_OK: 0,
      R_OK: 4,
      W_OK: 2
    }
  }
}));

describe('localDbUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ensureDbFileExists', () => {
    it('should create directory and file if they do not exist', async () => {
      const dbPath = './test/db/test.db';
      const absolutePath = path.resolve(dbPath);
      const directory = path.dirname(absolutePath);

      // Mock directory creation
      fs.mkdir.mockResolvedValue();

      // Mock file doesn't exist
      fs.access.mockRejectedValue({ code: 'ENOENT' });

      // Mock file creation
      fs.writeFile.mockResolvedValue();

      const result = await localDbUtils.ensureDbFileExists(dbPath);

      expect(result).toBe(true);
      expect(fs.mkdir).toHaveBeenCalledWith(directory, { recursive: true });
      expect(fs.access).toHaveBeenCalledWith(absolutePath, fs.constants.F_OK);
      expect(fs.writeFile).toHaveBeenCalledWith(absolutePath, '');
    });

    it('should return true if file already exists', async () => {
      const dbPath = './test/db/test.db';
      const absolutePath = path.resolve(dbPath);

      // Mock directory exists
      fs.mkdir.mockRejectedValue({ code: 'EEXIST' });

      // Mock file exists
      fs.access.mockResolvedValue();

      const result = await localDbUtils.ensureDbFileExists(dbPath);

      expect(result).toBe(true);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should throw error on failure', async () => {
      const dbPath = './test/db/test.db';

      // Mock unexpected error
      fs.mkdir.mockRejectedValue(new Error('Permission denied'));

      await expect(localDbUtils.ensureDbFileExists(dbPath)).rejects.toThrow('Permission denied');
    });
  });

  describe('validateDbFile', () => {
    it('should return valid result for accessible file', async () => {
      const dbPath = './test/db/test.db';
      const absolutePath = path.resolve(dbPath);

      // Mock file exists and is accessible
      fs.access.mockResolvedValue();

      const result = await localDbUtils.validateDbFile(dbPath);

      expect(result).toEqual({
        isValid: true,
        absolutePath,
        error: null
      });
      expect(fs.access).toHaveBeenCalledWith(absolutePath, fs.constants.F_OK);
      expect(fs.access).toHaveBeenCalledWith(absolutePath, fs.constants.R_OK | fs.constants.W_OK);
    });

    it('should return error for non-existent file', async () => {
      const dbPath = './test/db/test.db';
      const absolutePath = path.resolve(dbPath);

      // Mock file doesn't exist
      fs.access.mockRejectedValue({ code: 'ENOENT' });

      const result = await localDbUtils.validateDbFile(dbPath);

      expect(result).toEqual({
        isValid: false,
        absolutePath,
        error: 'Database file does not exist'
      });
    });

    it('should return error for inaccessible file', async () => {
      const dbPath = './test/db/test.db';
      const absolutePath = path.resolve(dbPath);

      // Mock file exists but no permissions
      fs.access
        .mockResolvedValueOnce() // File exists
        .mockRejectedValueOnce({ code: 'EACCES' }); // No permissions

      const result = await localDbUtils.validateDbFile(dbPath);

      expect(result).toEqual({
        isValid: false,
        absolutePath,
        error: 'Insufficient permissions to access database file'
      });
    });
  });

  describe('getDbFileInfo', () => {
    it('should return file information', async () => {
      const dbPath = './test/db/test.db';
      const absolutePath = path.resolve(dbPath);
      const mockStats = {
        size: 1048576, // 1MB
        birthtime: new Date('2024-01-01'),
        mtime: new Date('2024-01-02'),
        isFile: () => true
      };

      fs.stat.mockResolvedValue(mockStats);

      const result = await localDbUtils.getDbFileInfo(dbPath);

      expect(result).toEqual({
        path: absolutePath,
        size: 1048576,
        sizeInMB: '1.00',
        created: mockStats.birthtime,
        modified: mockStats.mtime,
        isFile: true
      });
      expect(fs.stat).toHaveBeenCalledWith(absolutePath);
    });

    it('should throw error if file does not exist', async () => {
      const dbPath = './test/db/test.db';

      fs.stat.mockRejectedValue(new Error('ENOENT: no such file or directory'));

      await expect(localDbUtils.getDbFileInfo(dbPath)).rejects.toThrow('ENOENT');
    });
  });

  describe('createBackup', () => {
    it('should create timestamped backup', async () => {
      const dbPath = './test/db/test.db';
      const absolutePath = path.resolve(dbPath);

      // Mock current date
      const mockDate = new Date('2024-01-15T10:30:45.123Z');
      vi.setSystemTime(mockDate);

      fs.copyFile.mockResolvedValue();

      const result = await localDbUtils.createBackup(dbPath);

      // Expected backup filename with timestamp including milliseconds
      const expectedBackupPath = path.join(
        path.dirname(absolutePath),
        'test_backup_2024-01-15T10-30-45-123Z.db'
      );

      expect(result).toBe(expectedBackupPath);
      expect(fs.copyFile).toHaveBeenCalledWith(absolutePath, expectedBackupPath);
    });

    it('should throw error if backup fails', async () => {
      const dbPath = './test/db/test.db';

      fs.copyFile.mockRejectedValue(new Error('Disk full'));

      await expect(localDbUtils.createBackup(dbPath)).rejects.toThrow('Disk full');
    });
  });

  describe('default export', () => {
    it('should export all utility functions', () => {
      expect(localDbUtils.default).toEqual({
        ensureDbFileExists: localDbUtils.ensureDbFileExists,
        validateDbFile: localDbUtils.validateDbFile,
        getDbFileInfo: localDbUtils.getDbFileInfo,
        createBackup: localDbUtils.createBackup
      });
    });
  });
});
