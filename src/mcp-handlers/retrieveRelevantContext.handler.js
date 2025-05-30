/**
 * Retrieve Relevant Context Handler
 *
 * This handler implements the retrieve_relevant_context MCP tool,
 * which retrieves relevant context snippets based on a query within a conversation session.
 */

import logger from "../utils/logger.js";

/**
 * Handler for the retrieve_relevant_context MCP tool
 * @param {Object} params - The validated input object (matching RetrieveRelevantContextInputSchema)
 * @param {Object} mcpContext - Shared resources like dbClient, logger, configService, retrievalService
 * @returns {Object} Response object matching RetrieveRelevantContextOutputSchema
 */
export async function retrieveRelevantContextHandler(params, mcpContext) {
  try {
    // Log the tool invocation with parameters (DEBUG level)
    logger.debug("retrieve_relevant_context tool invoked", {
      query: params.query,
      conversationId: params.conversationId,
      tokenBudget: params.tokenBudget,
      hasRetrievalParameters: !!params.retrievalParameters,
      retrievalParameters: params.retrievalParameters,
    });

    // Access RetrievalService from mcpContext
    // The service should be available via mcpContext.retrievalService as established in other handlers
    if (!mcpContext.retrievalService) {
      throw new Error("RetrievalService not available in mcpContext");
    }

    const retrievalService = mcpContext.retrievalService;

    // Call the RetrievalService to get relevant context
    const result = await retrievalService.getRelevantContext(
      params.query,
      params.conversationId,
      params.tokenBudget,
      params.retrievalParameters
    );

    // Construct the response from the service result
    const response = {
      contextSnippets: result.contextSnippets,
      retrievalSummary: result.retrievalSummary,
      processedOk: true,
    };

    // Log successful processing of the tool call (INFO level)
    logger.info("retrieve_relevant_context tool completed successfully", {
      conversationId: params.conversationId,
      snippetsReturned: response.contextSnippets.length,
      processedOk: response.processedOk,
    });

    logger.debug("retrieve_relevant_context tool completed successfully", {
      conversationId: params.conversationId,
      snippetsReturned: response.contextSnippets.length,
    });

    return response;
  } catch (error) {
    // Log the full error object (including stack trace) to stderr using mcpContext.logger.error()
    const errorLogger = mcpContext?.logger || logger;
    errorLogger.error(
      "Internal server error during retrieve_relevant_context",
      {
        error: error.message,
        stack: error.stack,
        params,
        tool: "retrieve_relevant_context",
      }
    );

    // Construct a structured MCP error response object
    return {
      processedOk: false,
      error: {
        code: -32000, // Generic server error code
        message: "Internal server error during retrieve_relevant_context.",
        data: {
          details: error.message,
          // Include stack trace in debug mode only (if needed)
          // stack: error.stack
        },
      },
    };
  }
}
