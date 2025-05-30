/**
 * Main entry point for the DevContext server
 *
 * This module initializes the server, performs validation checks,
 * connects to the database, and sets up the MCP server.
 */

import { McpServer } from "@modelcontextprotocol/sdk";
import { z } from "zod";
import config from "./config.js";
import logger from "./utils/logger.js";
import { initializeDbClient } from "./db/client.js";
import { initializeDatabaseSchema } from "./db/queries.js";
import {
  pingServerHandler,
  initializeConversationContextHandler,
  retrieveRelevantContextHandler,
} from "./mcp-handlers/index.js";
import {
  InitializeConversationContextInputSchema,
  InitializeConversationContextOutputSchema,
  RetrieveRelevantContextInputSchema,
  RetrieveRelevantContextOutputSchema,
} from "./schemas/mcp.schemas.js";
import GitMonitorService from "./services/git.service.js";
import initialScanService from "./services/initialScan.service.js";
import { BackgroundJobManager } from "./services/job.service.js";
import RetrievalService from "./services/retrieval.service.js";
import CompressionService from "./services/compression.service.js";
import RelationshipManager from "./services/relationship.service.js";

/**
 * Start the server
 */
async function startServer() {
  try {
    // Log server startup
    logger.info("DevContext server starting...");

    // Validate that PROJECT_PATH is a Git repository
    const gitValidation = await config.validateGitRepository();

    if (!gitValidation.isValid) {
      // This is a critical error - log and exit with non-zero status code
      logger.error(
        "Critical error: PROJECT_PATH is not a valid Git repository",
        {
          projectPath: config.PROJECT_PATH,
          error: gitValidation.error?.message || "Unknown error",
        }
      );

      // Exit the process with a non-zero status code
      process.exit(1);
    }

    // If we get here, the Git repository is valid
    logger.info("Git repository validation completed successfully");

    // Initialize database client
    const dbClient = initializeDbClient();

    // Verify database connection with a simple query
    try {
      logger.info("Verifying TursoDB connection...");
      await dbClient.execute("SELECT 1");
      logger.info("TursoDB connection verified successfully");
    } catch (dbError) {
      // This is a critical error - log and exit with non-zero status code
      logger.error("Critical error: Failed to connect to TursoDB", {
        error: dbError.message,
        stack: dbError.stack,
        databaseUrl: config.TURSO_DATABASE_URL ? "(set)" : "(not set)",
        authToken: config.TURSO_AUTH_TOKEN
          ? "(auth token provided)"
          : "(no auth token)",
      });

      // Exit the process with a non-zero status code
      process.exit(1);
    }

    // Initialize database schema
    try {
      logger.info("Initializing database schema...");
      await initializeDatabaseSchema(dbClient);
      logger.info("Database schema initialization completed successfully");
    } catch (schemaError) {
      // This is a critical error - log and exit with non-zero status code
      logger.error("Critical error: Failed to initialize database schema", {
        error: schemaError.message,
        stack: schemaError.stack,
      });

      // Exit the process with a non-zero status code
      process.exit(1);
    }

    // Perform initial codebase scan
    try {
      logger.info("Initiating initial codebase scan...");
      const scanResult = await initialScanService.performInitialScan();
      if (scanResult.status === "success") {
        logger.info("Initial codebase scan completed successfully", {
          filesScanned: scanResult.filesScanned,
          filesProcessed: scanResult.filesProcessed,
        });
      } else if (scanResult.status === "skipped") {
        logger.info("Initial codebase scan skipped", {
          reason: scanResult.reason,
        });
      } else {
        logger.warn("Initial codebase scan completed with status", {
          status: scanResult.status,
          error: scanResult.error,
        });
      }
    } catch (scanError) {
      // Log error but don't exit - allow the system to continue
      logger.error("Error during initial codebase scan", {
        error: scanError.message,
        stack: scanError.stack,
      });
      logger.warn("Continuing server startup despite initial scan failure");
    }

    // Initialize and start Git monitoring service
    try {
      logger.info("Initializing Git monitoring service...");
      const gitMonitorService = new GitMonitorService(dbClient);

      // Initialize the service
      await gitMonitorService.initialize();

      // Start the monitoring process
      await gitMonitorService.startMonitoring();

      logger.info("Git monitoring service started successfully");
    } catch (gitMonitorError) {
      // Log error but don't exit - this is not a critical service
      logger.error("Error initializing Git monitoring service", {
        error: gitMonitorError.message,
        stack: gitMonitorError.stack,
      });
      logger.warn(
        "Continuing server startup despite Git monitoring service failure"
      );
    }

    // Initialize and start Background Job Manager
    try {
      logger.info("Initializing BackgroundJobManager...");
      const backgroundJobManager = new BackgroundJobManager({
        // Note: AIService will be provided later when it's implemented
      });

      // Initialize the background job manager
      await backgroundJobManager.initialize();

      // Start the background job manager polling
      backgroundJobManager.start({
        pollingInterval: config.AI_JOB_POLLING_INTERVAL_MS,
        concurrency: config.AI_JOB_CONCURRENCY,
        batchSize: config.AI_JOB_BATCH_SIZE,
      });

      logger.info("BackgroundJobManager started successfully");
    } catch (backgroundJobError) {
      // Log error but don't exit - this is not a critical service for basic functionality
      logger.error("Error initializing BackgroundJobManager", {
        error: backgroundJobError.message,
        stack: backgroundJobError.stack,
      });
      logger.warn(
        "Continuing server startup despite BackgroundJobManager initialization failure"
      );
    }

    // Initialize MCP server
    try {
      logger.info("Initializing MCP server...");

      // Create the MCP server instance
      const mcpServer = new McpServer({
        name: "DevContext MCP Server",
        version: config.VERSION || "1.0.0",
        logger: logger,
      });

      // Create mcpContext for handlers that need database access
      const mcpContext = {
        dbClient,
        logger,
      };

      // Initialize CompressionService
      const compressionService = new CompressionService({
        logger,
        configService: config,
      });

      // Initialize RelationshipManager
      const relationshipManager = new RelationshipManager({
        dbClient,
        logger,
        configService: config,
      });

      // Initialize RetrievalService with all dependencies
      const retrievalService = new RetrievalService({
        dbClient,
        logger,
        configService: config,
        compressionService,
        relationshipManager,
      });

      // Add services to mcpContext
      mcpContext.retrievalService = retrievalService;
      mcpContext.compressionService = compressionService;
      mcpContext.relationshipManager = relationshipManager;

      // Register the ping_server tool using the correct method
      mcpServer.tool(
        "ping_server",
        {}, // Empty object as we don't need input parameters
        pingServerHandler
      );

      // Register the initialize_conversation_context tool
      mcpServer.tool(
        "initialize_conversation_context",
        InitializeConversationContextInputSchema,
        async (params) => {
          return await initializeConversationContextHandler(params, mcpContext);
        }
      );

      logger.info(
        "initialize_conversation_context tool registered successfully"
      );

      // Register the retrieve_relevant_context tool
      mcpServer.tool(
        "retrieve_relevant_context",
        RetrieveRelevantContextInputSchema,
        async (params) => {
          return await retrieveRelevantContextHandler(params, mcpContext);
        }
      );

      logger.info("retrieve_relevant_context tool registered successfully");

      // Start the MCP server
      await mcpServer.listen();

      logger.info("MCP server initialized and listening for requests");
      logger.info("DevContext server started successfully");
    } catch (mcpError) {
      // This is a critical error - log and exit with non-zero status code
      logger.error("Critical error: Failed to initialize MCP server", {
        error: mcpError.message,
        stack: mcpError.stack,
      });

      // Exit the process with a non-zero status code
      process.exit(1);
    }
  } catch (error) {
    // Handle any unexpected errors during server startup
    logger.error("Unexpected error during server startup", {
      error: error.message,
      stack: error.stack,
    });

    // Exit with a non-zero status code on critical errors
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled promise rejection", {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  process.exit(1);
});

// Start the server
startServer();
