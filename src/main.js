"use strict";

/**
 * main.js
 *
 * Main entry point for the MCP server.
 * Initializes the database connection and starts the MCP server.
 */

// IMPORTANT: Set MCP_MODE before any imports or other code runs
process.env.MCP_MODE = "true";

// ========== INTERCEPT STDOUT/STDERR BEFORE IMPORTS ==========
// Replace these functions before any imports so they can't be used
// by imported modules to log messages that would break JSON parsing

// Store original methods
const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleInfo = console.info;
const originalConsoleDebug = console.debug;

// Function to test if string is valid JSON
function isValidJson(str) {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
}

// More comprehensive check for valid JSON output
function isValidMcpOutput(str) {
  if (typeof str !== "string") return false;

  // Trim whitespace
  const trimmed = str.trim();

  // Must start with { or [ for valid JSON
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return false;
  }

  // Try parsing as JSON
  try {
    JSON.parse(trimmed);
    return true;
  } catch (e) {
    return false;
  }
}

// Completely replace stdout.write - only allow valid JSON through
process.stdout.write = function (chunk, encoding, callback) {
  // In MCP mode, strictly validate all output
  if (process.env.MCP_MODE === "true") {
    if (typeof chunk === "string" && isValidMcpOutput(chunk)) {
      return originalStdoutWrite.apply(process.stdout, arguments);
    }
    // Silently drop invalid output
    if (callback) callback();
    return true;
  } else {
    // In normal mode, allow all output
    return originalStdoutWrite.apply(process.stdout, arguments);
  }
};

// Redirect all stderr to our own handler in MCP mode
process.stderr.write = function (chunk, encoding, callback) {
  // In MCP mode, don't output anything to stderr
  if (process.env.MCP_MODE === "true") {
    // Silently succeed, don't write anything
    if (callback) callback();
    return true;
  } else {
    // In normal mode, use original handler
    return originalStderrWrite.apply(process.stderr, arguments);
  }
};

// Replace all console methods
console.log = function (...args) {
  if (process.env.MCP_MODE === "true") {
    // In MCP mode, only let valid JSON strings through to stdout
    if (
      args.length === 1 &&
      typeof args[0] === "string" &&
      isValidMcpOutput(args[0])
    ) {
      originalStdoutWrite.call(process.stdout, args[0] + "\n");
    }
    // Silently drop all other output
    return;
  } else {
    // In normal mode, use original method
    return originalConsoleLog.apply(console, args);
  }
};

console.error = function (...args) {
  if (process.env.MCP_MODE === "true") {
    // Completely suppress in MCP mode
    return;
  } else {
    return originalConsoleError.apply(console, args);
  }
};

console.warn = function (...args) {
  if (process.env.MCP_MODE === "true") {
    // Completely suppress in MCP mode
    return;
  } else {
    return originalConsoleWarn.apply(console, args);
  }
};

console.info = function (...args) {
  if (process.env.MCP_MODE === "true") {
    // Completely suppress in MCP mode
    return;
  } else {
    return originalConsoleInfo.apply(console, args);
  }
};

console.debug = function (...args) {
  if (process.env.MCP_MODE === "true") {
    // Completely suppress in MCP mode
    return;
  } else {
    return originalConsoleDebug.apply(console, args);
  }
};

// ========== NOW SAFE TO IMPORT MODULES ==========

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TURSO_DATABASE_URL, TURSO_AUTH_TOKEN } from "./config.js";
import {
  testDbConnection,
  initializeDatabaseSchema,
  getDbClient,
} from "./db.js";
import { logMessage } from "./utils/logger.js";
import allTools from "./tools/index.js";
import {
  createToolHandler,
  createInitializeContextHandler,
  createFinalizeContextHandler,
} from "./tools/mcpDevContextTools.js";
import { applyDecayToAll } from "./logic/ContextPrioritizerLogic.js";
import { scheduleConsolidation } from "./logic/GlobalPatternRepository.js";

// Store timers for cleanup during shutdown
let decayTimer = null;

/**
 * Start the MCP server
 * Initializes database and listens for MCP requests
 */
async function startServer() {
  // Determine if we're in MCP mode
  const isMcpMode = process.env.MCP_MODE === "true";

  if (!isMcpMode) {
    // === NORMAL MODE STARTUP ===
    // Check if database credentials are set
    if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
      logMessage(
        "error",
        "Database credentials not set. TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required."
      );
      process.exit(1);
    }

    // Get database client
    try {
      logMessage("info", "Getting database client...");
      const dbClient = getDbClient();
      logMessage("info", "Database client created successfully.");
    } catch (error) {
      logMessage("error", `Failed to create database client: ${error.message}`);
      process.exit(1);
    }

    // Test database connection
    try {
      logMessage("info", "Testing database connection...");
      await testDbConnection();
      logMessage("info", "Database connection successful.");
    } catch (error) {
      logMessage("error", `Database connection failed: ${error.message}`);
      process.exit(1);
    }

    // Initialize database schema
    try {
      logMessage("info", "Initializing database schema...");
      await initializeDatabaseSchema();
      logMessage("info", "Database schema initialized successfully.");
    } catch (error) {
      logMessage(
        "error",
        `Failed to initialize database schema: ${error.message}`
      );
      process.exit(1);
    }

    // Schedule periodic background tasks
    try {
      // Schedule pattern consolidation (e.g., every hour)
      scheduleConsolidation(60);
      logMessage("info", "Scheduled periodic pattern consolidation.");

      // Schedule context decay (e.g., every 24 hours)
      const decayInterval = 24 * 60 * 60 * 1000; // 24 hours
      decayTimer = setInterval(async () => {
        try {
          logMessage("info", "Applying context decay...");
          await applyDecayToAll();
          logMessage("info", "Context decay applied successfully.");
        } catch (err) {
          logMessage("error", "Error applying context decay:", {
            error: err.message,
          });
        }
      }, decayInterval);
      logMessage(
        "info",
        `Scheduled periodic context decay every ${
          decayInterval / (60 * 60 * 1000)
        } hours.`
      );
    } catch (error) {
      logMessage(
        "warn",
        `Failed to schedule background tasks: ${error.message}`
      );
      // Continue server startup despite scheduling failure
    }
  } else {
    // === MCP MODE STARTUP ===
    // In MCP mode, we still need database, but do it silently
    // And most importantly, never allow any logging to reach stdout
    try {
      // Wrap all DB operations in a single try/catch to prevent any errors from escaping
      try {
        // Create DB client silently
        getDbClient();

        // Test connection silently
        await testDbConnection();

        // Init schema silently
        await initializeDatabaseSchema();
      } catch (innerError) {
        // Completely swallow any database errors in MCP mode
        // Never log or throw - this prevents stdout corruption
      }

      // Skip scheduling background tasks in MCP mode
    } catch (outerError) {
      // Double protection - ensure nothing escapes
      // Never log or throw in MCP mode
    }
  }

  // Create and initialize the MCP server
  const server = new McpServer({
    name: "cursor10x",
    version: "2.0.0",
  });

  // Register all tools with appropriate wrappers
  for (const tool of allTools) {
    let wrappedHandler;

    // Use specialized handlers for initialize and finalize context tools
    if (tool.name === "initialize_conversation_context") {
      wrappedHandler = createInitializeContextHandler(tool.handler);
    } else if (tool.name === "finalize_conversation_context") {
      wrappedHandler = createFinalizeContextHandler(tool.handler);
    } else {
      // Use general handler for other tools
      wrappedHandler = createToolHandler(tool.handler, tool.name);
    }

    // Register the tool with the wrapped handler
    server.tool(tool.name, tool.inputSchema, wrappedHandler);
    if (!isMcpMode) {
      logMessage("info", `Registered tool: ${tool.name}`);
    }
  }

  const transport = new StdioServerTransport();
  if (!isMcpMode) {
    logMessage("info", `Starting MCP server with PID ${process.pid}...`);
  }

  // Set up graceful shutdown handler
  setupGracefulShutdown();

  try {
    await server.connect(transport);
    if (!isMcpMode) {
      logMessage("info", "MCP server stopped.");
    }
    cleanupTimers();
  } catch (error) {
    if (!isMcpMode) {
      logMessage("error", `MCP server error: ${error.message}`);
    }
    cleanupTimers();
    process.exit(1);
  }
}

/**
 * Set up handlers for graceful shutdown
 */
function setupGracefulShutdown() {
  // Skip logging in MCP mode
  const isMcpMode = process.env.MCP_MODE === "true";

  // Handle terminal signals
  process.on("SIGINT", () => {
    if (!isMcpMode) {
      logMessage("info", "Received SIGINT signal. Shutting down gracefully...");
    }
    cleanupTimers();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    if (!isMcpMode) {
      logMessage(
        "info",
        "Received SIGTERM signal. Shutting down gracefully..."
      );
    }
    cleanupTimers();
    process.exit(0);
  });
}

/**
 * Clean up all interval timers
 */
function cleanupTimers() {
  const isMcpMode = process.env.MCP_MODE === "true";

  if (decayTimer) {
    clearInterval(decayTimer);
    decayTimer = null;
    if (!isMcpMode) {
      logMessage("info", "Cleared context decay timer.");
    }
  }
}

// Run the server unless this file is being required as a module
if (
  import.meta.url === import.meta.mainUrl ||
  process.env.NODE_ENV !== "test"
) {
  startServer().catch((error) => {
    // Skip logging in MCP mode
    if (process.env.MCP_MODE !== "true") {
      logMessage("error", `Unhandled error in startServer: ${error.message}`);
    }
    // Don't use console.error here since we've replaced it
    process.exit(1);
  });
}

export { startServer };
