/**
 * Initialize Conversation Context Handler
 *
 * This handler implements the initialize_conversation_context MCP tool,
 * which creates a new conversation session and optionally logs an initial query.
 */

import logger from "../utils/logger.js";
import { v4 as uuidv4 } from "uuid";
import * as dbQueries from "../db/queries.js";

/**
 * Handler for the initialize_conversation_context MCP tool
 * @param {Object} params - The validated input object (matching InitializeConversationContextInputSchema)
 * @param {Object} mcpContext - Shared resources like dbClient, configService, passed by McpServer
 * @returns {Object} Response object matching InitializeConversationContextOutputSchema
 */
export async function initializeConversationContextHandler(params, mcpContext) {
  try {
    // Log the tool invocation with parameters (DEBUG level)
    logger.debug("initialize_conversation_context tool invoked", {
      params,
      hasInitialQuery: !!params.initialQuery,
      maxContextTokens: params.max_context_tokens,
    });

    // Generate unique conversationId (Task 141)
    const conversationId = uuidv4();
    logger.debug("Generated conversationId for new conversation session", {
      conversationId,
    });

    // Log initialQuery if provided (Task 142)
    if (params.initialQuery && params.initialQuery.trim().length > 0) {
      await dbQueries.logConversationMessage(mcpContext.dbClient, {
        conversation_id: conversationId,
        role: "user",
        content: params.initialQuery,
      });
      logger.info(`Initial query logged for conversationId ${conversationId}.`);
    }

    // Fetch project structure summary (Task 152)
    logger.debug("Fetching project structure summary");
    let projectStructureData = null;
    try {
      projectStructureData =
        await mcpContext.retrievalService.getProjectStructureSummary();
      logger.info(
        "Project structure summary fetched and added to comprehensive context"
      );
    } catch (projectStructureError) {
      logger.error("Error fetching project structure summary", {
        error: projectStructureError.message,
        stack: projectStructureError.stack,
        conversationId,
      });
      // Continue with null projectStructureData - the handler should still succeed
    }

    // Fetch recent conversation topics summary (Task 156)
    logger.debug("Fetching recent conversation topics summary", {
      hasInitialQuery: !!params.initialQuery,
    });
    let recentConversationsData = { topics: [] };
    try {
      const initialQuery = params.initialQuery; // from validated input
      recentConversationsData =
        await mcpContext.retrievalService.getRecentConversationTopicsSummary(
          initialQuery
        );
      logger.info(
        "Recent conversation topics fetched and added to comprehensive context",
        {
          topicsCount: recentConversationsData?.topics?.length || 0,
          hadInitialQuery: !!initialQuery,
        }
      );
    } catch (recentTopicsError) {
      logger.error("Error fetching recent conversation topics", {
        error: recentTopicsError.message,
        stack: recentTopicsError.stack,
        conversationId,
      });
      // Continue with empty topics array - the handler should still succeed
      recentConversationsData = { topics: [] };
    }

    // Fetch architecture context summary (Task 161)
    logger.debug("Fetching architecture context summary");
    let architectureContextData = { keyDocuments: [] };
    try {
      architectureContextData =
        await mcpContext.retrievalService.getArchitectureContextSummary();
      logger.info(
        "Architecture context fetched and added to comprehensive context",
        {
          keyDocumentsCount: architectureContextData?.keyDocuments?.length || 0,
          hasProjectGoalHint: !!architectureContextData?.overallProjectGoalHint,
        }
      );
    } catch (architectureError) {
      logger.error("Error fetching architecture context", {
        error: architectureError.message,
        stack: architectureError.stack,
        conversationId,
      });
      // Continue with empty keyDocuments array - the handler should still succeed
      architectureContextData = { keyDocuments: [] };
    }

    // Fetch FTS snippets for initial query if provided (Task 172)
    let ftsSnippets = [];
    if (params.initialQuery && params.initialQuery.trim().length > 0) {
      logger.debug("Fetching FTS snippets for initial query", {
        initialQuery: params.initialQuery,
        queryLength: params.initialQuery.length,
      });

      try {
        ftsSnippets =
          await mcpContext.retrievalService.getFtsSnippetsForInitialQuery(
            params.initialQuery,
            3 // Limit to 3 snippets as per task requirements
          );

        logger.info(
          "FTS snippets fetched and will be added to comprehensive context",
          {
            snippetsCount: ftsSnippets.length,
            initialQuery: params.initialQuery,
            conversationId,
          }
        );
      } catch (ftsSnippetsError) {
        logger.error("Error fetching FTS snippets for initial query", {
          error: ftsSnippetsError.message,
          stack: ftsSnippetsError.stack,
          initialQuery: params.initialQuery,
          conversationId,
        });
        // Continue with empty snippets array - the handler should still succeed
        ftsSnippets = [];
      }
    } else {
      logger.debug(
        "No initial query provided, skipping FTS snippets retrieval"
      );
    }

    // Construct success response (Task 143)
    const response = {
      conversationId: conversationId, // From Task 141
      initialContextSummary: params.initialQuery
        ? "Initial query processed and logged."
        : "Conversation initialized.",
      comprehensiveContext: {
        projectStructure: projectStructureData, // From Task 152 - can be null if error occurred
        recentConversations: recentConversationsData, // From Task 156 - New addition
        architectureContext: architectureContextData, // From Task 161 - New addition
        initialQueryContextSnippets: ftsSnippets, // From Task 172 - New addition
        // ... other comprehensiveContext fields will be added by later tasks
      },
      processedOk: true,
    };

    // Log successful processing
    logger.info(
      "initialize_conversation_context tool call processed successfully",
      {
        conversationId,
        hasInitialQuery: !!params.initialQuery,
      }
    );

    return response;
  } catch (error) {
    // Implement proper error handling (Task 144)

    // Log the full error object (including stack trace) to stderr using mcpContext.logger.error()
    const errorLogger = mcpContext?.logger || logger;
    errorLogger.error(
      "Internal server error during initialize_conversation_context",
      {
        error: error.message,
        stack: error.stack,
        params,
        tool: "initialize_conversation_context",
      }
    );

    // Construct a structured MCP error response object
    return {
      processedOk: false,
      error: {
        code: -32000, // Generic server error code
        message:
          "Internal server error during initialize_conversation_context.",
        data: {
          details: error.message,
          // Include stack trace in debug mode only (if needed)
          // stack: error.stack
        },
      },
    };
  }
}
