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

  try {
    await server.connect(transport);
    logMessage("info", "MCP server stopped.");
  } catch (error) {
    logMessage("error", `MCP server error: ${error.message}`);
    process.exit(1);
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
    process.exit(1);
  });
}

export { startServer };
