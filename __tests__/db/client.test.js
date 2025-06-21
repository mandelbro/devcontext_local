/**
 * Tests for the database client module
 * Verifies that client.js properly uses the connection factory
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import initializeDbClient from "../../src/db/client.js";
import * as connectionFactory from "../../src/db/connectionFactory.js";
import logger from "../../src/utils/logger.js";

// Mock the connection factory
vi.mock("../../src/db/connectionFactory.js", () => ({
  createDatabaseClient: vi.fn(),
}));

// Mock the logger
vi.mock("../../src/utils/logger.js", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

describe("Database Client", () => {
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("initializeDbClient", () => {
    test("should successfully initialize database client using factory", () => {
      // Setup: Factory returns mock client
      connectionFactory.createDatabaseClient.mockReturnValue(mockClient);

      // Execute
      const result = initializeDbClient();

      // Verify
      expect(connectionFactory.createDatabaseClient).toHaveBeenCalledTimes(1);
      expect(logger.default.info).toHaveBeenCalledWith("Initializing database client");
      expect(logger.default.info).toHaveBeenCalledWith("Database client initialized successfully");
      expect(result).toBe(mockClient);
    });

    test("should handle factory errors properly", () => {
      // Setup: Factory throws an error
      const testError = new Error("Failed to create database client");
      connectionFactory.createDatabaseClient.mockImplementation(() => {
        throw testError;
      });

      // Execute & Verify
      expect(() => initializeDbClient()).toThrow("Failed to create database client");
      expect(connectionFactory.createDatabaseClient).toHaveBeenCalledTimes(1);
      expect(logger.default.info).toHaveBeenCalledWith("Initializing database client");
      expect(logger.default.error).toHaveBeenCalledWith(
        "Failed to initialize database client",
        { error: testError }
      );
    });

    test("should maintain backward compatibility with existing code", () => {
      // Setup: Factory returns mock client
      connectionFactory.createDatabaseClient.mockReturnValue(mockClient);

      // Execute: Test both named and default exports work
      const clientFromNamedExport = initializeDbClient();

      // Import default export dynamically
      import("../../src/db/client.js").then((module) => {
        const clientFromDefaultExport = module.default();

        // Verify both exports return the same type of result
        expect(typeof clientFromNamedExport).toBe("object");
        expect(typeof clientFromDefaultExport).toBe("object");
        expect(clientFromNamedExport).toHaveProperty("execute");
      });
    });

    test("should not include any database mode specific logic", () => {
      // Setup: Factory returns mock client
      connectionFactory.createDatabaseClient.mockReturnValue(mockClient);

      // Execute
      initializeDbClient();

      // Verify: The client module should not access config directly
      // This ensures all mode-specific logic is in the factory
      expect(connectionFactory.createDatabaseClient).toHaveBeenCalledWith();
      expect(connectionFactory.createDatabaseClient).toHaveBeenCalledTimes(1);

      // The factory should be called without any parameters
      // proving that client.js doesn't make any mode decisions
      expect(connectionFactory.createDatabaseClient.mock.calls[0]).toEqual([]);
    });

    test("should return a client with expected database methods", () => {
      // Setup: Factory returns mock client with all expected methods
      connectionFactory.createDatabaseClient.mockReturnValue(mockClient);

      // Execute
      const client = initializeDbClient();

      // Verify: Client has all expected database methods
      expect(client).toHaveProperty("execute");
      expect(client).toHaveProperty("close");
      expect(client).toHaveProperty("batch");
      expect(client).toHaveProperty("transaction");
      expect(typeof client.execute).toBe("function");
      expect(typeof client.close).toBe("function");
      expect(typeof client.batch).toBe("function");
      expect(typeof client.transaction).toBe("function");
    });

    test("should log appropriate messages during initialization", () => {
      // Setup: Factory returns mock client
      connectionFactory.createDatabaseClient.mockReturnValue(mockClient);

      // Execute
      initializeDbClient();

      // Verify: Proper logging sequence
      expect(logger.default.info.mock.calls).toEqual([
        ["Initializing database client"],
        ["Database client initialized successfully"]
      ]);
      expect(logger.default.error).not.toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    test("should propagate specific factory errors", () => {
      // Test various error scenarios
      const errorScenarios = [
        {
          error: new Error("Invalid DATABASE_MODE: invalid"),
          message: "Invalid DATABASE_MODE: invalid"
        },
        {
          error: new Error("TURSO_DATABASE_URL is required for 'turso' mode"),
          message: "TURSO_DATABASE_URL is required for 'turso' mode"
        },
        {
          error: new Error("LOCAL_SQLITE_PATH is required for 'local' mode"),
          message: "LOCAL_SQLITE_PATH is required for 'local' mode"
        }
      ];

      errorScenarios.forEach(({ error, message }) => {
        // Reset mocks
        vi.clearAllMocks();

        // Setup
        connectionFactory.createDatabaseClient.mockImplementation(() => {
          throw error;
        });

        // Execute & Verify
        expect(() => initializeDbClient()).toThrow(message);
        expect(logger.default.error).toHaveBeenCalledWith(
          "Failed to initialize database client",
          { error }
        );
      });
    });
  });
});
