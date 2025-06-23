/**
 * Integration tests for Local SQLite Database Utilities
 * These tests interact with the actual file system
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import * as localDbUtils from '../../src/db/localDbUtils.js';

describe('localDbUtils Integration Tests', () => {
  let testDir;
  let testDbPath;

  beforeEach(async () => {
    // Create a temporary directory for tests
    testDir = path.join(os.tmpdir(), `devcontext-test-${Date.now()}`);
    testDbPath = path.join(testDir, 'test.db');
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('ensureDbFileExists', () => {
    it('should create a new database file', async () => {
      // Ensure file doesn't exist initially
      await expect(fs.access(testDbPath)).rejects.toThrow();

      // Create the file
      const result = await localDbUtils.ensureDbFileExists(testDbPath);
      expect(result).toBe(true);

      // Verify file was created
      const stats = await fs.stat(testDbPath);
      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBe(0); // Should be empty
    });

    it('should handle existing file gracefully', async () => {
      // Create file manually
      await fs.writeFile(testDbPath, 'existing content');

      // Call ensureDbFileExists
      const result = await localDbUtils.ensureDbFileExists(testDbPath);
      expect(result).toBe(true);

      // Verify content wasn't changed
      const content = await fs.readFile(testDbPath, 'utf8');
      expect(content).toBe('existing content');
    });
  });

  describe('validateDbFile', () => {
    it('should validate existing accessible file', async () => {
      // Create a file
      await fs.writeFile(testDbPath, '');

      const result = await localDbUtils.validateDbFile(testDbPath);
      expect(result.isValid).toBe(true);
      expect(result.error).toBeNull();
      expect(result.absolutePath).toBe(path.resolve(testDbPath));
    });

    it('should detect non-existent file', async () => {
      const result = await localDbUtils.validateDbFile(testDbPath);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Database file does not exist');
    });
  });

  describe('getDbFileInfo', () => {
    it('should retrieve accurate file information', async () => {
      // Create a file with content
      const content = 'SQLite format 3\0';
      await fs.writeFile(testDbPath, content);

      const info = await localDbUtils.getDbFileInfo(testDbPath);
      expect(info.path).toBe(path.resolve(testDbPath));
      expect(info.size).toBe(content.length);
      expect(info.sizeInMB).toBe((content.length / (1024 * 1024)).toFixed(2));
      expect(info.isFile).toBe(true);
      expect(info.created).toBeInstanceOf(Date);
      expect(info.modified).toBeInstanceOf(Date);
    });
  });

  describe('createBackup', () => {
    it('should create a backup with timestamp', async () => {
      // Create original file
      const originalContent = 'Original database content';
      await fs.writeFile(testDbPath, originalContent);

      // Create backup
      const backupPath = await localDbUtils.createBackup(testDbPath);

      // Verify backup exists
      const backupStats = await fs.stat(backupPath);
      expect(backupStats.isFile()).toBe(true);

      // Verify backup content matches original
      const backupContent = await fs.readFile(backupPath, 'utf8');
      expect(backupContent).toBe(originalContent);

      // Verify backup filename format (now includes milliseconds)
      const backupFilename = path.basename(backupPath);
      expect(backupFilename).toMatch(/^test_backup_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.db$/);

      // Clean up backup
      await fs.unlink(backupPath);
    });

    it('should handle multiple backups', async () => {
      // Create original file
      await fs.writeFile(testDbPath, 'content');

      // Create multiple backups with slight delay
      const backup1 = await localDbUtils.createBackup(testDbPath);
      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay
      const backup2 = await localDbUtils.createBackup(testDbPath);

      // Verify both backups exist and have different names
      expect(backup1).not.toBe(backup2);
      await expect(fs.access(backup1)).resolves.toBeUndefined();
      await expect(fs.access(backup2)).resolves.toBeUndefined();

      // Clean up
      await fs.unlink(backup1);
      await fs.unlink(backup2);
    });
  });
});
