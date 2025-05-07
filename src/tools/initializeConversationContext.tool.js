/**
 * initializeConversationContext.tool.js
 *
 * MCP tool implementation for initializing conversation context
 * This tool gathers comprehensive context about the codebase and project for a new conversation
 */

import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { executeQuery } from "../db.js";
import * as ConversationIntelligence from "../logic/ConversationIntelligence.js";
import * as ContextCompressorLogic from "../logic/ContextCompressorLogic.js";
import * as IntentPredictorLogic from "../logic/IntentPredictorLogic.js";
import * as SmartSearchServiceLogic from "../logic/SmartSearchServiceLogic.js";
import * as ActiveContextManager from "../logic/ActiveContextManager.js";
import * as TimelineManagerLogic from "../logic/TimelineManagerLogic.js";
import * as GlobalPatternRepository from "../logic/GlobalPatternRepository.js";
import {
  initializeConversationContextInputSchema,
  initializeConversationContextOutputSchema,
} from "../schemas/toolSchemas.js";
import { logMessage } from "../utils/logger.js";

/**
 * Handler for initialize_conversation_context tool
 *
 * @param {object} input - Tool input parameters
 * @param {object} sdkContext - SDK context
 * @returns {Promise<object>} Tool output
 */
async function handler(input, sdkContext) {
  try {
    logMessage("INFO", `initialize_conversation_context tool started`, {
      initialQuery: input.initialQuery,
    });

    // 1. Generate conversation ID if not provided
    const conversationId = input.conversationId || uuidv4();
    logMessage("DEBUG", `Using conversation ID: ${conversationId}`);

    // 2. Extract input parameters with defaults
    const {
      initialQuery = "",
      focusHint,
      includeArchitecture = true,
      includeRecentConversations = true,
      maxCodeContextItems = 5,
      maxRecentChanges = 5,
      contextDepth = "standard",
      tokenBudget = 4000,
    } = input;

    // 3. Clear any active context and set initial focus if provided
    try {
      await ActiveContextManager.clearActiveContext();
      if (focusHint) {
        await ActiveContextManager.setActiveFocus(
          focusHint.type,
          focusHint.identifier
        );
        logMessage("INFO", `Set initial focus`, {
          type: focusHint.type,
          identifier: focusHint.identifier,
        });
      }
    } catch (err) {
      logMessage(
        "WARN",
        `Failed to set initial focus, continuing with initialization`,
        {
          error: err.message,
          focusHint,
        }
      );
      // Continue with initialization despite focus setting error
    }

    // 4. Record the conversation start in timeline
    try {
      await TimelineManagerLogic.recordEvent(
        "conversation_started",
        {
          initialQuery,
          focusHint,
          contextDepth,
        },
        [], // No associated entity IDs yet
        conversationId
      );
      logMessage("DEBUG", `Recorded conversation start in timeline`, {
        conversationId,
      });
    } catch (err) {
      // Non-critical failure, log but continue
      logMessage("WARN", `Failed to record conversation start in timeline`, {
        error: err.message,
        conversationId,
      });
    }

    // 5. Initialize conversation intelligence tracker
    try {
      logMessage(
        "INFO",
        `Initializing conversation intelligence tracker with user query: "${initialQuery}"`,
        {
          conversationId,
        }
      );

      await ConversationIntelligence.initializeConversation(
        conversationId,
        initialQuery
      );

      // Verify that messages were properly stored
      const recentMessages = await ConversationIntelligence.getRecentMessages(
        conversationId,
        3
      );
      logMessage(
        "INFO",
        `Conversation initialized with ${recentMessages.length} messages`,
        {
          messages: recentMessages.map((m) => ({
            role: m.role,
            content:
              m.content.substring(0, 50) + (m.content.length > 50 ? "..." : ""),
          })),
        }
      );
    } catch (err) {
      logMessage("ERROR", `Failed to initialize conversation intelligence`, {
        error: err.message,
        conversationId,
      });
      throw new Error(
        `Conversation intelligence initialization failed: ${err.message}`
      );
    }

    // 6. Predict initial intent based on query
    let predictedIntent = "";
    if (initialQuery) {
      try {
        const intentResult = await IntentPredictorLogic.inferIntentFromQuery(
          initialQuery
        );
        predictedIntent = intentResult.intent;
        logMessage("INFO", `Predicted initial intent`, {
          intent: predictedIntent,
          confidence: intentResult.confidence || "N/A",
        });
      } catch (err) {
        // Non-critical failure, log but continue with empty intent
        logMessage(
          "WARN",
          `Intent prediction failed, continuing without intent`,
          {
            error: err.message,
            initialQuery,
          }
        );
      }
    }

    // 7. Gather comprehensive context
    logMessage("INFO", `Starting comprehensive context gathering`, {
      conversationId,
      includeArchitecture,
      maxCodeContextItems,
      contextDepth,
    });

    const comprehensiveContext = await gatherComprehensiveContext(
      initialQuery,
      focusHint,
      conversationId,
      {
        includeArchitecture,
        includeRecentConversations,
        maxCodeContextItems,
        maxRecentChanges,
        contextDepth,
        tokenBudget,
      }
    );

    const contextCounts = {
      codeContextItems: comprehensiveContext.codeContext?.length || 0,
      architectureItems: comprehensiveContext.architectureContext?.length || 0,
      recentChanges: comprehensiveContext.recentChanges?.length || 0,
      patterns: comprehensiveContext.globalPatterns?.length || 0,
    };

    logMessage(
      "INFO",
      `Comprehensive context gathered successfully`,
      contextCounts
    );

    // 8. Generate initial context summary
    const initialContextSummary = generateInitialContextSummary(
      comprehensiveContext,
      initialQuery,
      predictedIntent
    );

    logMessage("INFO", `Generated initial context summary`, {
      summaryLength: initialContextSummary?.length || 0,
    });

    // 9. Return the tool response with all gathered context
    const responseData = {
      message: `Conversation context initialized with ID: ${conversationId}`,
      conversationId,
      initialContextSummary,
      predictedIntent,
      comprehensiveContext,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(responseData),
        },
      ],
    };
  } catch (error) {
    // Log detailed error information
    logMessage("ERROR", `Error in initialize_conversation_context tool`, {
      error: error.message,
      stack: error.stack,
      input: {
        initialQuery: input.initialQuery,
        focusHint: input.focusHint,
        contextDepth: input.contextDepth,
      },
    });

    // Return error response
    const errorResponse = {
      error: true,
      errorCode: error.code || "INITIALIZATION_FAILED",
      errorDetails: error.message,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(errorResponse),
        },
      ],
    };
  }
}

/**
 * Gathers comprehensive context about the codebase and project
 *
 * @param {string} initialQuery - Initial user query
 * @param {object} focusHint - Focus hint information
 * @param {string} conversationId - Conversation ID
 * @param {object} options - Context gathering options
 * @returns {Promise<object>} Comprehensive context object
 */
async function gatherComprehensiveContext(
  initialQuery,
  focusHint,
  conversationId,
  options
) {
  const context = {};

  try {
    logMessage("DEBUG", `Starting to gather code context`, {
      initialQuery: initialQuery?.substring(0, 50),
      focusHint,
    });

    // 1. Gather code context based on query and/or focus
    context.codeContext = await gatherCodeContext(
      initialQuery,
      focusHint,
      options
    );

    logMessage("DEBUG", `Gathered code context`, {
      itemCount: context.codeContext?.length || 0,
    });

    // 2. Gather architecture context (READMEs, docs)
    if (options.includeArchitecture) {
      try {
        context.architectureContext = await gatherArchitectureContext(options);
        logMessage("DEBUG", `Gathered architecture context`, {
          itemCount: context.architectureContext?.length || 0,
        });
      } catch (err) {
        logMessage("WARN", `Failed to gather architecture context`, {
          error: err.message,
        });
        context.architectureContext = null;
      }
    } else {
      context.architectureContext = null;
    }

    // 3. Get project structure overview
    try {
      context.projectStructure = await gatherProjectStructure();
      logMessage("DEBUG", `Gathered project structure`, {
        directoryCount: context.projectStructure?.directories?.length || 0,
        fileCount: context.projectStructure?.files?.length || 0,
      });
    } catch (err) {
      logMessage("WARN", `Failed to gather project structure`, {
        error: err.message,
      });
      context.projectStructure = { directories: [], files: [] };
    }

    // 4. Get recent conversations if requested
    if (options.includeRecentConversations) {
      try {
        context.recentConversations = await gatherRecentConversations(options);
        logMessage("DEBUG", `Gathered recent conversations`, {
          count: context.recentConversations?.length || 0,
        });
      } catch (err) {
        logMessage("WARN", `Failed to gather recent conversations`, {
          error: err.message,
        });
        context.recentConversations = [];
      }
    }

    // 5. Get recent changes
    try {
      context.recentChanges = await gatherRecentChanges(
        options.maxRecentChanges
      );
      logMessage("DEBUG", `Gathered recent changes`, {
        count: context.recentChanges?.length || 0,
      });
    } catch (err) {
      logMessage("WARN", `Failed to gather recent changes`, {
        error: err.message,
      });
      context.recentChanges = [];
    }

    // 6. Get active workflows and milestones
    try {
      context.activeWorkflows = await gatherActiveWorkflows();
      logMessage("DEBUG", `Gathered active workflows`, {
        count: context.activeWorkflows?.length || 0,
      });
    } catch (err) {
      logMessage("WARN", `Failed to gather active workflows`, {
        error: err.message,
      });
      context.activeWorkflows = [];
    }

    // 7. Get relevant global patterns
    try {
      context.globalPatterns = await gatherGlobalPatterns(
        initialQuery,
        options
      );
      logMessage("DEBUG", `Gathered global patterns`, {
        count: context.globalPatterns?.length || 0,
      });
    } catch (err) {
      logMessage("WARN", `Failed to gather global patterns`, {
        error: err.message,
      });
      context.globalPatterns = [];
    }

    return context;
  } catch (error) {
    logMessage("ERROR", `Error gathering comprehensive context`, {
      error: error.message,
      conversationId,
    });
    throw error; // Re-throw to be caught by the main handler
  }
}

/**
 * Gathers code context based on query and focus
 *
 * @param {string} query - User query
 * @param {object} focusHint - Focus hint
 * @param {object} options - Options
 * @returns {Promise<Array>} Code context items
 */
async function gatherCodeContext(query, focusHint, options) {
  try {
    // Create search constraints
    const searchConstraints = {
      limit: options.maxCodeContextItems * 2, // Get more than we need for filtering
    };

    // Add focus constraints if provided
    if (focusHint) {
      if (focusHint.type === "file" || focusHint.type === "directory") {
        searchConstraints.filePaths = [focusHint.identifier];
      }
    }

    // Extract keywords if query is provided, otherwise use basic terms
    const searchTerms = query
      ? await extractKeywords(query)
      : ["README", "main", "index", "config"];

    // Perform search
    const searchResults = await SmartSearchServiceLogic.searchByKeywords(
      searchTerms,
      searchConstraints
    );

    // Process and compress search results
    let codeItems = searchResults.map((result) => ({
      entity_id: result.entity.entity_id,
      path: result.entity.file_path,
      type: result.entity.entity_type,
      name: result.entity.name,
      content: result.entity.raw_content,
      relevanceScore: result.relevanceScore,
    }));

    // Limit to max items
    codeItems = codeItems.slice(0, options.maxCodeContextItems);

    // Apply compression based on context depth
    const compressionOptions = {
      detailLevel: options.contextDepth,
      targetTokens: Math.floor(options.tokenBudget * 0.6), // Allocate 60% of token budget to code
    };

    const compressedItems = await ContextCompressorLogic.compressContext(
      codeItems,
      compressionOptions
    );

    return compressedItems;
  } catch (error) {
    console.error(`[gatherCodeContext] Error: ${error.message}`);
    return [];
  }
}

/**
 * Gathers architecture context information
 *
 * @param {object} options - Options
 * @returns {Promise<object>} Architecture context
 */
async function gatherArchitectureContext(options) {
  try {
    // Search for documentation files
    const docSearchResults = await SmartSearchServiceLogic.searchByKeywords(
      ["README", "documentation", "architecture", "overview", "guide", "setup"],
      {
        limit: 5,
        strategy: "keywords",
      }
    );

    if (docSearchResults.length === 0) {
      return null;
    }

    // Extract documentation content
    const docSources = docSearchResults.map((result) => ({
      name: result.entity.name,
      path: result.entity.file_path,
    }));

    // Combine and summarize documentation
    const docContents = docSearchResults
      .map((result) => result.entity.raw_content)
      .join("\n\n");

    // Compress documentation based on context depth
    const compressionOptions = {
      detailLevel: options.contextDepth,
      targetTokens: Math.floor(options.tokenBudget * 0.2), // Allocate 20% of token budget to architecture docs
    };

    // Generate summary
    const summary =
      docContents.length > 1000
        ? docContents.substring(0, 1000) + "..." // Simple truncation for now
        : docContents;

    return {
      summary,
      sources: docSources,
    };
  } catch (error) {
    console.error(`[gatherArchitectureContext] Error: ${error.message}`);
    return null;
  }
}

/**
 * Gathers project structure information
 *
 * @returns {Promise<object>} Project structure
 */
async function gatherProjectStructure() {
  try {
    // Query for directory structure
    const dirQuery = `
      SELECT 
        file_path,
        COUNT(*) as file_count
      FROM 
        code_entities
      WHERE 
        entity_type = 'file'
      GROUP BY 
        SUBSTR(file_path, 1, INSTR(file_path, '/'))
      ORDER BY 
        file_count DESC
      LIMIT 10
    `;

    const directories = await executeQuery(dirQuery);

    // Check if directories has a rows property and it's an array
    const rows =
      directories && directories.rows && Array.isArray(directories.rows)
        ? directories.rows
        : Array.isArray(directories)
        ? directories
        : [];

    // If no valid results, return basic structure
    if (rows.length === 0) {
      return {
        topLevelDirs: [],
        totalFiles: 0,
      };
    }

    return {
      topLevelDirs: rows.map((dir) => ({
        path: dir.file_path.split("/")[0],
        fileCount: dir.file_count,
      })),
      totalFiles: rows.reduce((sum, dir) => sum + dir.file_count, 0),
    };
  } catch (error) {
    console.error(`[gatherProjectStructure] Error: ${error.message}`);
    return null;
  }
}

/**
 * Gathers recent conversations for context
 *
 * @param {object} options - Options
 * @returns {Promise<Array>} Recent conversations
 */
async function gatherRecentConversations(options) {
  try {
    // Get recent conversation events from timeline
    const recentConversationEvents = await TimelineManagerLogic.getEvents({
      types: ["conversation_completed"],
      limit: 3,
    });

    if (recentConversationEvents.length === 0) {
      return [];
    }

    // Format conversation summaries
    return recentConversationEvents.map((event) => ({
      timestamp: event.timestamp,
      summary: event.data.summary || "Conversation completed",
      purpose: event.data.purpose || "Unknown purpose",
    }));
  } catch (error) {
    console.error(`[gatherRecentConversations] Error: ${error.message}`);
    return [];
  }
}

/**
 * Gathers recent changes in the project
 *
 * @param {number} maxChanges - Maximum number of changes to retrieve
 * @returns {Promise<Array>} Recent changes
 */
async function gatherRecentChanges(maxChanges) {
  try {
    // Get recent file change events from timeline
    const recentChangeEvents = await TimelineManagerLogic.getEvents({
      types: ["file_change", "file_create", "code_commit"],
      limit: maxChanges,
    });

    if (recentChangeEvents.length === 0) {
      return [];
    }

    // Format change events
    return recentChangeEvents.map((event) => ({
      timestamp: event.timestamp,
      files: event.data.files || [event.data.filePath || "Unknown file"],
      summary: event.data.message || `${event.event_type} event occurred`,
    }));
  } catch (error) {
    console.error(`[gatherRecentChanges] Error: ${error.message}`);
    return [];
  }
}

/**
 * Gathers active workflows and milestones
 *
 * @returns {Promise<Array>} Active workflows
 */
async function gatherActiveWorkflows() {
  try {
    // Get recent milestone events
    const milestoneEvents = await TimelineManagerLogic.getEvents({
      types: ["milestone"],
      limit: 3,
      includeMilestones: true,
    });

    if (milestoneEvents.length === 0) {
      return [];
    }

    // Format milestones
    return milestoneEvents.map((event) => ({
      name: event.data.name || "Unnamed milestone",
      description: event.data.description || "No description provided",
      timestamp: event.timestamp,
    }));
  } catch (error) {
    console.error(`[gatherActiveWorkflows] Error: ${error.message}`);
    return [];
  }
}

/**
 * Gathers global patterns relevant to the query
 *
 * @param {string} query - User query
 * @param {object} options - Options
 * @returns {Promise<Array>} Global patterns
 */
async function gatherGlobalPatterns(query, options) {
  try {
    // Get global patterns
    const globalPatterns = await GlobalPatternRepository.retrieveGlobalPatterns(
      {
        minConfidence: 0.4,
        limit: 5,
      }
    );

    if (globalPatterns.length === 0) {
      return [];
    }

    // Format patterns
    return globalPatterns.map((pattern) => ({
      name: pattern.name,
      type: pattern.pattern_type,
      description: pattern.description,
      confidence: pattern.confidence_score,
    }));
  } catch (error) {
    console.error(`[gatherGlobalPatterns] Error: ${error.message}`);
    return [];
  }
}

/**
 * Generates a summary of the initial context
 *
 * @param {object} context - Comprehensive context
 * @param {string} query - Initial query
 * @param {string} intent - Predicted intent
 * @returns {string} Context summary
 */
function generateInitialContextSummary(context, query, intent) {
  // Create initial summary
  let summary = "Project context initialized";

  // Add query info if present
  if (query) {
    summary += ` for query: "${query}"`;
  }

  // Add intent if predicted
  if (intent) {
    summary += ` with intent: ${intent}`;
  }

  // Count code context items
  if (context.codeContext && context.codeContext.length > 0) {
    summary += `. Found ${context.codeContext.length} relevant code items`;
  }

  // Add architecture context if present
  if (context.architectureContext) {
    summary += ". Project documentation available";
  }

  // Add recent activity info
  if (context.recentChanges && context.recentChanges.length > 0) {
    summary += `. ${context.recentChanges.length} recent file changes detected`;
  }

  // Add pattern info
  if (context.globalPatterns && context.globalPatterns.length > 0) {
    summary += `. ${context.globalPatterns.length} relevant patterns identified`;
  }

  return summary;
}

/**
 * Extract keywords from text
 *
 * @param {string} text - Text to extract keywords from
 * @returns {Promise<Array>} Keywords
 */
async function extractKeywords(text) {
  // Simple keyword extraction (in production would call TextTokenizerLogic)
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .filter((word) => !["the", "and", "for", "with"].includes(word));
}

// Export the tool definition for server registration
export default {
  name: "initialize_conversation_context",
  description:
    "Initializes a new conversation context with comprehensive codebase information",
  inputSchema: initializeConversationContextInputSchema,
  outputSchema: initializeConversationContextOutputSchema,
  handler,
};
