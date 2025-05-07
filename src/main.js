"use strict";

/**
 * main.js
 *
 * Main entry point for the MCP server.
 * Initializes the database connection and starts the MCP server.
 */

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
    logMessage("warn", `Failed to schedule background tasks: ${error.message}`);
    // Continue server startup despite scheduling failure
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
    logMessage("info", `Registered tool: ${tool.name}`);
  }

  const transport = new StdioServerTransport();
  logMessage("info", `Starting MCP server with PID ${process.pid}...`);

  // Set up graceful shutdown handler
  setupGracefulShutdown();

  try {
    await server.connect(transport);
    logMessage("info", "MCP server stopped.");
    cleanupTimers();
  } catch (error) {
    logMessage("error", `MCP server error: ${error.message}`);
    cleanupTimers();
    process.exit(1);
  }
}

/**
 * Set up handlers for graceful shutdown
 */
function setupGracefulShutdown() {
  // Handle terminal signals
  process.on("SIGINT", () => {
    logMessage("info", "Received SIGINT signal. Shutting down gracefully...");
    cleanupTimers();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    logMessage("info", "Received SIGTERM signal. Shutting down gracefully...");
    cleanupTimers();
    process.exit(0);
  });
}

/**
 * Clean up all interval timers
 */
function cleanupTimers() {
  if (decayTimer) {
    clearInterval(decayTimer);
    decayTimer = null;
    logMessage("info", "Cleared context decay timer.");
  }
}

// Run the server unless this file is being required as a module
if (
  import.meta.url === import.meta.mainUrl ||
  process.env.NODE_ENV !== "test"
) {
  startServer().catch((error) => {
    logMessage("error", `Unhandled error in startServer: ${error.message}`);
    console.error(error);
    cleanupTimers();
    process.exit(1);
  });
}

export { startServer };
