/**
 * Integration tests for database client with connection factory
 * These tests verify the actual integration between client.js and connectionFactory.js
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import initializeDbClient from "../../src/db/client.js";
import config from "../../src/config.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Database Client Integration Tests", () => {
  const testDbPath = path.join(__dirname, "test-client-integration.db");
  let originalDatabaseMode;
  let originalLocalSqlitePath;
  let originalTursoUrl;
  let originalTursoToken;

  beforeEach(async () => {
    // Save original config values
    originalDatabaseMode = process.env.DATABASE_MODE;
    originalLocalSqlitePath = process.env.LOCAL_SQLITE_PATH;
    originalTursoUrl = process.env.TURSO_DATABASE_URL;
    originalTursoToken = process.env.TURSO_AUTH_TOKEN;

    // Clean up test database if it exists
    try {
      await fs.unlink(testDbPath);
    } catch (error) {
      // File doesn't exist, which is fine
    }
  });

  afterEach(async () => {
    // Restore original config values
    if (originalDatabaseMode !== undefined) {
      process.env.DATABASE_MODE = originalDatabaseMode;
    } else {
      delete process.env.DATABASE_MODE;
    }

    if (originalLocalSqlitePath !== undefined) {
      process.env.LOCAL_SQLITE_PATH = originalLocalSqlitePath;
    } else {
      delete process.env.LOCAL_SQLITE_PATH;
    }

    if (originalTursoUrl !== undefined) {
      process.env.TURSO_DATABASE_URL = originalTursoUrl;
    } else {
      delete process.env.TURSO_DATABASE_URL;
    }

    if (originalTursoToken !== undefined) {
      process.env.TURSO_AUTH_TOKEN = originalTursoToken;
    } else {
      delete process.env.TURSO_AUTH_TOKEN;
    }

    // Clean up test database
    try {
      await fs.unlink(testDbPath);
    } catch (error) {
      // File doesn't exist, which is fine
    }
  });

  describe("Local SQLite Mode", () => {
    test("should initialize client in local mode", async () => {
      // Setup: Configure for local mode
      process.env.DATABASE_MODE = "local";
      process.env.LOCAL_SQLITE_PATH = testDbPath;

      // Need to re-import config to pick up new env values
      const { default: freshConfig } = await import("../../src/config.js");

      // Execute
      const client = initializeDbClient();

      // Verify
      expect(client).toBeDefined();
      expect(typeof client.execute).toBe("function");
      expect(typeof client.close).toBe("function");

      // Test that we can execute a query
      const result = await client.execute("SELECT 1 as test");
      expect(result.rows[0].test).toBe(1);

      // Clean up
      await client.close();
    });

    test("should handle missing local path configuration", async () => {
      // Setup: Configure for local mode without path
      process.env.DATABASE_MODE = "local";
      delete process.env.LOCAL_SQLITE_PATH;

      // Need to re-import modules to pick up new env values
      const { default: freshConfig } = await import("../../src/config.js");

      // Execute & Verify
      // The default path should be used
      const client = initializeDbClient();
      expect(client).toBeDefined();

      // Should be able to execute queries with default path
      const result = await client.execute("SELECT 1 as test");
      expect(result.rows[0].test).toBe(1);

      // Clean up
      await client.close();
    });
  });

  describe("Turso Mode", () => {
    test("should fail gracefully when Turso credentials are missing", async () => {
      // Setup: Configure for turso mode without credentials
      process.env.DATABASE_MODE = "turso";
      delete process.env.TURSO_DATABASE_URL;
      delete process.env.TURSO_AUTH_TOKEN;

      // Need to re-import modules to pick up new env values
      const { default: freshConfig } = await import("../../src/config.js");

      // Execute & Verify
      expect(() => initializeDbClient()).toThrow(
        "TURSO_DATABASE_URL is required for 'turso' mode"
      );
    });
  });

  describe("Invalid Mode", () => {
    test("should fail with helpful error for invalid database mode", async () => {
      // Setup: Configure with invalid mode
      process.env.DATABASE_MODE = "invalid";

      // Need to re-import modules to pick up new env values
      const { default: freshConfig } = await import("../../src/config.js");

      // Execute & Verify
      // Note: The config validates and defaults to 'turso' for invalid modes
      // So if Turso credentials aren't set, it will fail asking for them
      expect(() => initializeDbClient()).toThrow();
    });
  });

  describe("Backward Compatibility", () => {
    test("should work with existing code that uses the client", async () => {
      // Setup: Configure for local mode
      process.env.DATABASE_MODE = "local";
      process.env.LOCAL_SQLITE_PATH = testDbPath;

      // Need to re-import config to pick up new env values
      const { default: freshConfig } = await import("../../src/config.js");

      // Execute: Simulate how existing code uses the client
      const client = initializeDbClient();

      // Test typical database operations
      // 1. Create a table
      await client.execute(`
        CREATE TABLE IF NOT EXISTS test_table (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL
        )
      `);

      // 2. Insert data
      await client.execute(
        "INSERT INTO test_table (name) VALUES (?)",
        ["test_name"]
      );

      // 3. Query data
      const result = await client.execute("SELECT * FROM test_table");
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].name).toBe("test_name");

      // 4. Use transactions
      await client.batch([
        { sql: "INSERT INTO test_table (name) VALUES (?)", args: ["name1"] },
        { sql: "INSERT INTO test_table (name) VALUES (?)", args: ["name2"] },
      ]);

      // Verify batch insert
      const allRows = await client.execute("SELECT * FROM test_table");
      expect(allRows.rows).toHaveLength(3);

      // Clean up
      await client.close();
    });
  });
});
