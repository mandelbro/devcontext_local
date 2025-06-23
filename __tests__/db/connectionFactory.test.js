/**
 * Integration tests for the database connection factory
 * Tests dual-mode database support (Turso cloud and local SQLite)
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { createDatabaseClient, validateConnection } from "../../src/db/connectionFactory.js";
import { createClient } from "@libsql/client";
import config from "../../src/config.js";
import logger from "../../src/utils/logger.js";
import * as fs from "fs";
import path from "path";

// Mock dependencies
vi.mock("@libsql/client", () => ({
  createClient: vi.fn(),
}));

vi.mock("../../src/config.js", () => ({
  default: {
    DATABASE_MODE: "turso",
    TURSO_DATABASE_URL: "libsql://test.turso.io",
    TURSO_AUTH_TOKEN: "test-auth-token",
    LOCAL_SQLITE_PATH: "./test.db",
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock file system operations for local SQLite tests
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  statSync: vi.fn(),
  accessSync: vi.fn(),
  constants: {
    W_OK: 2,
    R_OK: 4,
  },
}));

// Mock path module
vi.mock("path", () => ({
  default: {
    resolve: vi.fn((p) => {
      // Mock path resolution
      if (p === "./test.db") return "/Users/montes/AI/devcontext_local/test.db";
      if (p === ":memory:") return "/Users/montes/AI/devcontext_local/:memory:";
      if (p === "../relative/path/database.db") return "/Users/montes/AI/relative/path/database.db";
      if (p.startsWith("/")) return p; // Already absolute
      return `/Users/montes/AI/devcontext_local/${p}`;
    }),
    isAbsolute: vi.fn((p) => p.startsWith("/")),
  },
}));

describe("Database Connection Factory", () => {
  let mockClient;

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Create a mock database client
    mockClient = {
      execute: vi.fn(),
      close: vi.fn(),
      batch: vi.fn(),
      transaction: vi.fn(),
    };

    // Default mock implementation for createClient
    createClient.mockReturnValue(mockClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createDatabaseClient", () => {
    describe("Turso Mode", () => {
      beforeEach(() => {
        config.DATABASE_MODE = "turso";
        config.TURSO_DATABASE_URL = "libsql://test.turso.io";
        config.TURSO_AUTH_TOKEN = "test-auth-token";
      });

      test("should create Turso client with valid configuration", () => {
        // Execute
        const client = createDatabaseClient();

        // Verify
        expect(createClient).toHaveBeenCalledWith({
          url: "libsql://test.turso.io",
          authToken: "test-auth-token",
        });
        expect(logger.info).toHaveBeenCalledWith("Creating database client in 'turso' mode");
        expect(logger.info).toHaveBeenCalledWith(
          "Turso cloud database client created successfully",
          { url: "libsql://test.turso.io" }
        );
        expect(client).toBe(mockClient);
      });

      test("should create Turso client without auth token and log warning", () => {
        // Setup: Remove auth token
        config.TURSO_AUTH_TOKEN = undefined;

        // Execute
        const client = createDatabaseClient();

        // Verify
        expect(createClient).toHaveBeenCalledWith({
          url: "libsql://test.turso.io",
        });
        expect(logger.warn).toHaveBeenCalledWith(
          "No TURSO_AUTH_TOKEN provided. This may cause authentication issues with Turso cloud.\n" +
          "If you experience connection errors, either:\n" +
          "1. Set TURSO_AUTH_TOKEN in your environment\n" +
          "2. Switch to local mode with DATABASE_MODE=local"
        );
        expect(client).toBe(mockClient);
      });

      test("should throw error when TURSO_DATABASE_URL is missing", () => {
        // Setup: Remove database URL
        config.TURSO_DATABASE_URL = undefined;

        // Execute & Verify
        expect(() => createDatabaseClient()).toThrow(
          "TURSO_DATABASE_URL is required for 'turso' mode but not provided.\n\n" +
          "To fix this, you can either:\n" +
          "1. Set TURSO_DATABASE_URL in your environment variables\n" +
          "2. Switch to local mode by setting DATABASE_MODE=local\n\n" +
          "For local mode, use these environment variables:\n" +
          "  DATABASE_MODE=local\n" +
          "  LOCAL_SQLITE_PATH=./devcontext.db"
        );
        expect(logger.error).toHaveBeenCalledWith(
          "Failed to create database client in 'turso' mode",
          expect.objectContaining({
            error: expect.stringContaining("TURSO_DATABASE_URL is required"),
          })
        );
      });
    });

    describe("Local Mode", () => {
      beforeEach(() => {
        config.DATABASE_MODE = "local";
        config.LOCAL_SQLITE_PATH = "./test.db";
      });

      test("should create local SQLite client with valid configuration", () => {
        // Execute
        const client = createDatabaseClient();

        // Verify
        expect(createClient).toHaveBeenCalledWith({
          url: "file:/Users/montes/AI/devcontext_local/test.db",
        });
        expect(logger.info).toHaveBeenCalledWith("Creating database client in 'local' mode");
        expect(logger.info).toHaveBeenCalledWith(
          "Local SQLite database client created successfully",
          {
            path: "./test.db",
            resolvedPath: "/Users/montes/AI/devcontext_local/test.db",
            url: "file:/Users/montes/AI/devcontext_local/test.db"
          }
        );
        expect(client).toBe(mockClient);
      });

      test("should handle paths already prefixed with file:", () => {
        // Setup: Path already has file: prefix
        config.LOCAL_SQLITE_PATH = "file:./already-prefixed.db";

        // Execute
        const client = createDatabaseClient();

        // Verify
        expect(createClient).toHaveBeenCalledWith({
          url: "file:./already-prefixed.db",
        });
        expect(client).toBe(mockClient);
      });

      test("should throw error when LOCAL_SQLITE_PATH is missing", () => {
        // Setup: Remove local path
        config.LOCAL_SQLITE_PATH = undefined;

        // Execute & Verify
        expect(() => createDatabaseClient()).toThrow(
          "LOCAL_SQLITE_PATH is required for 'local' mode but not provided.\n\n" +
          "Please set LOCAL_SQLITE_PATH in your environment variables.\n" +
          "Example: LOCAL_SQLITE_PATH=./devcontext.db"
        );
        expect(logger.error).toHaveBeenCalledWith(
          "Failed to create database client in 'local' mode",
          expect.objectContaining({
            error: expect.stringContaining("LOCAL_SQLITE_PATH is required"),
          })
        );
      });

      test("should handle absolute paths correctly", () => {
        // Setup: Absolute path
        config.LOCAL_SQLITE_PATH = "/absolute/path/to/database.db";

        // Execute
        const client = createDatabaseClient();

        // Verify
        expect(createClient).toHaveBeenCalledWith({
          url: "file:/absolute/path/to/database.db",
        });
        expect(client).toBe(mockClient);
      });

      test("should handle relative paths correctly", () => {
        // Setup: Relative path
        config.LOCAL_SQLITE_PATH = "../relative/path/database.db";

        // Execute
        const client = createDatabaseClient();

        // Verify
        expect(createClient).toHaveBeenCalledWith({
          url: "file:../relative/path/database.db",
        });
        expect(client).toBe(mockClient);
      });
    });

    describe("Invalid Mode Handling", () => {
      test("should throw error for invalid DATABASE_MODE", () => {
        // Setup: Invalid mode
        config.DATABASE_MODE = "invalid-mode";

        // Execute & Verify
        expect(() => createDatabaseClient()).toThrow(
          "Invalid DATABASE_MODE: invalid-mode. Must be 'turso' or 'local'"
        );
        expect(logger.error).toHaveBeenCalledWith(
          "Failed to create database client in 'invalid-mode' mode",
          expect.objectContaining({
            error: expect.stringContaining("Invalid DATABASE_MODE"),
          })
        );
      });

      test("should handle undefined DATABASE_MODE", () => {
        // Setup: Undefined mode (should default to turso in config)
        config.DATABASE_MODE = undefined;

        // Execute & Verify
        expect(() => createDatabaseClient()).toThrow(
          "Invalid DATABASE_MODE: undefined. Must be 'turso' or 'local'"
        );
      });

      test("should handle empty string DATABASE_MODE", () => {
        // Setup: Empty string mode
        config.DATABASE_MODE = "";

        // Execute & Verify
        expect(() => createDatabaseClient()).toThrow(
          "Invalid DATABASE_MODE: . Must be 'turso' or 'local'"
        );
      });
    });

    describe("Error Propagation", () => {
      test("should propagate errors from createClient in Turso mode", () => {
        // Setup
        config.DATABASE_MODE = "turso";
        config.TURSO_DATABASE_URL = "libsql://test.turso.io";
        const clientError = new Error("Failed to connect to Turso");
        createClient.mockImplementation(() => {
          throw clientError;
        });

        // Execute & Verify
        expect(() => createDatabaseClient()).toThrow("Failed to connect to Turso");
        expect(logger.error).toHaveBeenCalledWith(
          "Failed to create database client in 'turso' mode",
          expect.objectContaining({
            error: "Failed to connect to Turso",
          })
        );
      });

      test("should propagate errors from createClient in local mode", () => {
        // Setup
        config.DATABASE_MODE = "local";
        config.LOCAL_SQLITE_PATH = "./test.db";
        const clientError = new Error("Failed to create local database");
        createClient.mockImplementation(() => {
          throw clientError;
        });

        // Execute & Verify
        expect(() => createDatabaseClient()).toThrow("Failed to create local database");
        expect(logger.error).toHaveBeenCalledWith(
          "Failed to create database client in 'local' mode",
          expect.objectContaining({
            error: "Failed to create local database",
          })
        );
      });
    });
  });

  describe("validateConnection", () => {
    test("should validate connection successfully", async () => {
      // Setup: Mock successful query execution
      mockClient.execute.mockResolvedValue({
        rows: [{ test: 1 }],
        columns: ["test"],
      });

      // Execute
      const result = await validateConnection(mockClient);

      // Verify
      expect(result).toBe(true);
      expect(mockClient.execute).toHaveBeenCalledWith("SELECT 1 as test");
      expect(logger.info).toHaveBeenCalledWith("Database connection validated successfully");
    });

    test("should throw error when query fails", async () => {
      // Setup: Mock query failure
      const queryError = new Error("Connection refused");
      mockClient.execute.mockRejectedValue(queryError);

      // Execute & Verify
      await expect(validateConnection(mockClient)).rejects.toThrow("Connection refused");
      expect(logger.error).toHaveBeenCalledWith(
        "Database connection validation failed",
        expect.objectContaining({
          error: "Connection refused",
        })
      );
    });

    test("should throw error when query returns no rows", async () => {
      // Setup: Mock empty result
      mockClient.execute.mockResolvedValue({
        rows: [],
        columns: ["test"],
      });

      // Execute & Verify
      await expect(validateConnection(mockClient)).rejects.toThrow(
        "Connection validation query returned unexpected result"
      );
    });

    test("should throw error when query returns null result", async () => {
      // Setup: Mock null result
      mockClient.execute.mockResolvedValue(null);

      // Execute & Verify
      await expect(validateConnection(mockClient)).rejects.toThrow(
        "Connection validation query returned unexpected result"
      );
    });

    test("should throw error when query returns undefined rows", async () => {
      // Setup: Mock result without rows
      mockClient.execute.mockResolvedValue({
        columns: ["test"],
      });

      // Execute & Verify
      await expect(validateConnection(mockClient)).rejects.toThrow(
        "Connection validation query returned unexpected result"
      );
    });
  });

  describe("Environment Variable Handling", () => {
    test("should handle environment variables correctly for Turso mode", () => {
      // Setup: Simulate environment variables
      config.DATABASE_MODE = "turso";
      config.TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || "libsql://env-test.turso.io";
      config.TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || "env-auth-token";

      // Execute
      const client = createDatabaseClient();

      // Verify
      expect(createClient).toHaveBeenCalledWith({
        url: config.TURSO_DATABASE_URL,
        authToken: config.TURSO_AUTH_TOKEN,
      });
      expect(client).toBe(mockClient);
    });

    test("should handle environment variables correctly for local mode", () => {
      // Setup: Simulate environment variables
      config.DATABASE_MODE = "local";
      config.LOCAL_SQLITE_PATH = process.env.LOCAL_SQLITE_PATH || "./env-test.db";

      // Execute
      const client = createDatabaseClient();

      // Verify
      expect(createClient).toHaveBeenCalledWith({
        url: `file:${config.LOCAL_SQLITE_PATH}`,
      });
      expect(client).toBe(mockClient);
    });
  });

  describe("Logging", () => {
    test("should log appropriate debug messages in Turso mode", () => {
      // Setup
      config.DATABASE_MODE = "turso";
      config.TURSO_DATABASE_URL = "libsql://test.turso.io";
      config.TURSO_AUTH_TOKEN = "test-token";

      // Execute
      createDatabaseClient();

      // Verify debug logs
      expect(logger.debug).toHaveBeenCalledWith("Creating Turso cloud database client");
      expect(logger.debug).toHaveBeenCalledWith("Including auth token in Turso client configuration");
    });

    test("should log appropriate debug messages in local mode", () => {
      // Setup
      config.DATABASE_MODE = "local";
      config.LOCAL_SQLITE_PATH = "./test.db";

      // Execute
      createDatabaseClient();

      // Verify debug logs
      expect(logger.debug).toHaveBeenCalledWith("Creating local SQLite database client");
    });
  });
});
