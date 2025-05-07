/**
 * mcpDevContextTools.js
 *
 * Provides wrapper functions for the MCP DevContext tools
 * to ensure proper callback handling and compatibility with MCP SDK.
 */

import { logMessage } from "../utils/logger.js";

// Store conversation ID globally for this session
if (typeof global.lastConversationId === "undefined") {
  global.lastConversationId = null;
}

/**
 * Creates a wrapped handler for DevContext MCP tools that follows the MCP SDK pattern
 *
 * @param {Function} handler - The original tool handler function
 * @param {string} toolName - The name of the tool for logging purposes
 * @returns {Function} A wrapped handler function compatible with MCP SDK
 */
export function createToolHandler(handler, toolName) {
  return async (params, context) => {
    try {
      logMessage("DEBUG", `${toolName} tool handler invoked`, {
        paramsKeys: Object.keys(params),
      });

      // Handle weird parameter structure with signal property
      let actualParams = params;
      if (
        params &&
        typeof params === "object" &&
        Object.keys(params).length === 1 &&
        params.signal &&
        Object.keys(params.signal).length === 0
      ) {
        // If we're just getting a signal object with no real params, use defaults
        actualParams = {};
        logMessage(
          "WARN",
          `${toolName} received only signal object, using defaults`,
          { params }
        );
      } else if (params && params.signal && Object.keys(params).length > 1) {
        // If params contains signal plus other properties, extract just the other properties
        const { signal, ...otherParams } = params;
        actualParams = otherParams;
        logMessage(
          "DEBUG",
          `${toolName} extracted parameters from signal object`,
          {
            extractedParams: Object.keys(actualParams),
          }
        );
      }

      // Extract additional parameters from any special formats
      const extractedParams = extractParamsFromInput(actualParams);

      // Log the extracted parameters for debugging
      logMessage("DEBUG", `${toolName} extracted parameters`, {
        extractedParams: extractedParams,
      });

      // Generate default parameters for this specific tool
      const defaultParams = createDefaultParamsForTool(toolName);

      // Merge extracted parameters with defaults, prioritizing user-provided values
      const mergedParams = { ...defaultParams, ...extractedParams };

      // Log the merged parameters for debugging
      logMessage("DEBUG", `${toolName} merged parameters`, {
        mergedParams: mergedParams,
      });

      // If conversation ID was provided, store it for future use
      if (mergedParams.conversationId) {
        global.lastConversationId = mergedParams.conversationId;
      } else if (global.lastConversationId) {
        // Use the last conversation ID if one wasn't provided
        mergedParams.conversationId = global.lastConversationId;
        logMessage(
          "INFO",
          `Using last conversation ID: ${global.lastConversationId}`
        );
      }

      // Now call the handler with the properly merged parameters
      const result = await handler(mergedParams, context);

      return {
        content: [
          {
            type: "text",
            text: typeof result === "string" ? result : JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      logMessage("ERROR", `Error in ${toolName} tool handler`, {
        error: error.message,
        stack: error.stack,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: true,
              message: error.message,
              details: error.stack,
            }),
          },
        ],
      };
    }
  };
}

/**
 * Extracts parameters from various input formats
 *
 * @param {any} input - The input parameters (could be object, string, etc.)
 * @returns {Object} Extracted parameters
 */
function extractParamsFromInput(input) {
  const extractedParams = {};

  try {
    // Case 1: Input is already an object
    if (input && typeof input === "object") {
      // Copy all properties except signal and requestId
      Object.keys(input).forEach((key) => {
        if (key !== "signal" && key !== "requestId") {
          extractedParams[key] = input[key];
        }
      });

      // Special case: If there's a random_string property, try to parse it
      if (input.random_string) {
        try {
          // Try to parse as JSON
          const parsedJson = JSON.parse(input.random_string);
          Object.assign(extractedParams, parsedJson);
        } catch (e) {
          // If not JSON, use as-is if it looks like a conversationId
          if (
            typeof input.random_string === "string" &&
            input.random_string.length > 30 &&
            input.random_string.includes("-")
          ) {
            extractedParams.conversationId = input.random_string;
          }
        }
      }

      // Handle direct parameters from cursor API or user input
      if (input.conversationId) {
        extractedParams.conversationId = input.conversationId;
      }

      if (input.initialQuery) {
        extractedParams.initialQuery = input.initialQuery;
      }

      if (input.contextDepth) {
        extractedParams.contextDepth = input.contextDepth;
      }

      if (input.query) {
        extractedParams.query = input.query;
      }

      if (input.name) {
        extractedParams.name = input.name;
      }

      // Process message array if present
      if (input.newMessages) {
        extractedParams.newMessages = Array.isArray(input.newMessages)
          ? input.newMessages
          : [input.newMessages];
      }

      // Process code changes if present
      if (input.codeChanges) {
        extractedParams.codeChanges = Array.isArray(input.codeChanges)
          ? input.codeChanges
          : [input.codeChanges];
      }
    }
    // Case 2: Input is a string
    else if (typeof input === "string") {
      try {
        // Try to parse as JSON
        const parsedJson = JSON.parse(input);
        Object.assign(extractedParams, parsedJson);
      } catch (e) {
        // If not JSON, use as conversationId if it looks like one
        if (input.length > 30 && input.includes("-")) {
          extractedParams.conversationId = input;
        }
      }
    }
  } catch (e) {
    logMessage("ERROR", `Error extracting params: ${e.message}`);
  }

  return extractedParams;
}

/**
 * Creates default parameters for each tool type
 *
 * @param {string} toolName - The name of the tool
 * @returns {Object} Default parameters for the tool
 */
function createDefaultParamsForTool(toolName) {
  switch (toolName) {
    case "initialize_conversation_context":
      return {
        initialQuery: "Starting a new conversation with DevContext",
        includeArchitecture: true,
        includeRecentConversations: true,
        maxCodeContextItems: 5,
        maxRecentChanges: 5,
        contextDepth: "standard",
      };
    case "update_conversation_context":
      return {
        conversationId: global.lastConversationId,
        newMessages: [
          {
            role: "user",
            content: "Working with DevContext tools",
          },
        ],
        preserveContextOnTopicShift: true,
        contextIntegrationLevel: "balanced",
        trackIntentTransitions: true,
      };
    case "retrieve_relevant_context":
      return {
        conversationId: global.lastConversationId,
        query: "DevContext tools and functionality",
        constraints: {
          includeConversation: true,
          crossTopicSearch: false,
        },
        contextFilters: {
          minRelevanceScore: 0.3,
        },
        weightingStrategy: "balanced",
        balanceStrategy: "proportional",
        contextBalance: "auto",
      };
    case "record_milestone_context":
      return {
        conversationId: global.lastConversationId,
        name: "DevContext Tool Milestone",
        description: "Milestone recorded during DevContext tools testing",
        milestoneCategory: "uncategorized",
        assessImpact: true,
      };
    case "finalize_conversation_context":
      return {
        conversationId: global.lastConversationId,
        clearActiveContext: false,
        extractLearnings: true,
        promotePatterns: true,
        synthesizeRelatedTopics: true,
        generateNextSteps: true,
        outcome: "completed",
      };
    default:
      return {};
  }
}

/**
 * Creates a specialized wrapped handler for initialize_conversation_context
 *
 * @param {Function} handler - The original handler function
 * @returns {Function} A wrapped handler function
 */
export function createInitializeContextHandler(handler) {
  return createToolHandler(handler, "initialize_conversation_context");
}

/**
 * Creates a specialized wrapped handler for finalize_conversation_context
 *
 * @param {Function} handler - The original handler function
 * @returns {Function} A wrapped handler function
 */
export function createFinalizeContextHandler(handler) {
  return createToolHandler(handler, "finalize_conversation_context");
}
