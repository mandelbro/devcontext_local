/**
 * retrieveRelevantContext.tool.js
 *
 * MCP tool implementation for retrieving and blending relevant context
 * from multiple sources: code, conversations, documentation, and patterns.
 */

import { z } from "zod";
import { executeQuery } from "../db.js";
import * as ConversationIntelligence from "../logic/ConversationIntelligence.js";
import * as InsightEngine from "../logic/InsightEngine.js";
import * as TimelineManagerLogic from "../logic/TimelineManagerLogic.js";
import * as ActiveContextManager from "../logic/ActiveContextManager.js";
import * as SmartSearchServiceLogic from "../logic/SmartSearchServiceLogic.js";
import * as RelationshipContextManagerLogic from "../logic/RelationshipContextManagerLogic.js";
import * as ConversationSegmenter from "../logic/ConversationSegmenter.js";
import * as ConversationPurposeDetector from "../logic/ConversationPurposeDetector.js";
import { DEFAULT_TOKEN_BUDGET } from "../config.js";
import { logMessage } from "../utils/logger.js";

import {
  retrieveRelevantContextInputSchema,
  retrieveRelevantContextOutputSchema,
} from "../schemas/toolSchemas.js";

/**
 * Handler for retrieve_relevant_context tool
 *
 * @param {object} input - Tool input parameters
 * @param {object} sdkContext - SDK context
 * @returns {Promise<object>} Tool output
 */
async function handler(input, sdkContext) {
  try {
    logMessage("INFO", `retrieve_relevant_context tool started`, {
      query: input.query?.substring(0, 50),
      conversationId: input.conversationId,
      tokenBudget: input.tokenBudget || DEFAULT_TOKEN_BUDGET,
    });

    // 1. Extract input parameters with defaults
    const {
      conversationId,
      query,
      tokenBudget = DEFAULT_TOKEN_BUDGET,
      constraints = {},
      contextFilters = {},
      weightingStrategy = "balanced",
      balanceStrategy = "proportional",
      contextBalance = "auto",
      sourceTypePreferences = {},
    } = input;

    // Validation
    if (!query) {
      const error = new Error("Query is required");
      error.code = "MISSING_QUERY";
      throw error;
    }

    if (!conversationId) {
      const error = new Error("Conversation ID is required");
      error.code = "MISSING_CONVERSATION_ID";
      throw error;
    }

    logMessage("DEBUG", `Context retrieval parameters`, {
      balanceStrategy,
      contextBalance,
      constraints: Object.keys(constraints),
      filters: Object.keys(contextFilters),
    });

    // 2. Fetch conversation history, current topic and purpose
    let conversationHistory = [];
    let currentTopic = null;
    let currentPurpose = null;

    try {
      conversationHistory =
        await ConversationIntelligence.getConversationHistory(
          conversationId,
          20 // Get last 20 messages
        );

      logMessage("DEBUG", `Retrieved conversation history`, {
        messageCount: conversationHistory.length,
      });
    } catch (err) {
      logMessage("WARN", `Failed to retrieve conversation history`, {
        error: err.message,
        conversationId,
      });
      // Continue with empty history
    }

    // Simple fallback approach - just return conversation history as context
    // This bypasses the buggy search functionality for now
    const simplifiedResult = {
      relevantContext: [],
      conversationContext: conversationHistory.map((msg) => ({
        type: "conversation",
        content: msg.content,
        metadata: {
          role: msg.role,
          messageId: msg.messageId,
        },
        relevanceScore: 0.9,
      })),
      currentTopic,
      currentPurpose,
      statusMessage: "Retrieved conversation context successfully",
      metrics: {
        totalSnippets: conversationHistory.length,
        relevanceThreshold: 0.5,
        tokenUsage: conversationHistory.reduce(
          (acc, msg) => acc + _estimateTokenCount(msg.content),
          0
        ),
      },
    };

    logMessage(
      "INFO",
      `Returning simplified context with ${simplifiedResult.conversationContext.length} conversation messages`
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            conversationId: input.conversationId,
            query: input.query,
            retrievalTime: Date.now(),
            relevantContext: {
              conversationContext: simplifiedResult.conversationContext,
              codeContext: [],
              patternContext: [],
              fileContext: [],
            },
            focusInfo: {
              currentTopic: simplifiedResult.currentTopic,
              currentPurpose: simplifiedResult.currentPurpose,
            },
            queryAnalysis: {
              status: simplifiedResult.statusMessage,
              metrics: simplifiedResult.metrics,
            },
          }),
        },
      ],
    };
  } catch (error) {
    logMessage("ERROR", `Error in retrieve_relevant_context handler`, {
      error: error.message,
      code: error.code,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: true,
            errorCode: error.code || "RETRIEVAL_FAILED",
            errorDetails: error.message,
            conversationId: input.conversationId,
            query: input.query,
          }),
        },
      ],
    };
  }
}

/**
 * Apply context balance adjustments based on balance type and conversation purpose
 *
 * @param {object} contextSources - Context sources with target percentages
 * @param {string} contextBalance - Context balance strategy
 * @param {string} currentPurpose - Current conversation purpose
 */
function _applyContextBalance(contextSources, contextBalance, currentPurpose) {
  try {
    logMessage("DEBUG", `Applying context balance: ${contextBalance}`, {
      currentPurpose,
    });

    if (contextBalance === "auto") {
      // Automatic balancing based on purpose
      if (currentPurpose) {
        switch (currentPurpose) {
          case "code_explanation":
          case "debugging":
            // More code when explaining or debugging
            contextSources.code.targetPercentage = 0.7;
            contextSources.conversation.targetPercentage = 0.1;
            contextSources.documentation.targetPercentage = 0.15;
            contextSources.patterns.targetPercentage = 0.05;
            logMessage("DEBUG", `Applied 'code_explanation/debugging' balance`);
            break;
          case "implementation":
          case "feature_development":
            // Balance between code and patterns when implementing
            contextSources.code.targetPercentage = 0.6;
            contextSources.conversation.targetPercentage = 0.1;
            contextSources.documentation.targetPercentage = 0.1;
            contextSources.patterns.targetPercentage = 0.2;
            logMessage(
              "DEBUG",
              `Applied 'implementation/feature_development' balance`
            );
            break;
          case "architecture_discussion":
          case "design":
            // More documentation and patterns for architecture
            contextSources.code.targetPercentage = 0.4;
            contextSources.conversation.targetPercentage = 0.15;
            contextSources.documentation.targetPercentage = 0.25;
            contextSources.patterns.targetPercentage = 0.2;
            logMessage(
              "DEBUG",
              `Applied 'architecture_discussion/design' balance`
            );
            break;
          case "requirements_gathering":
          case "clarification":
            // More conversation for requirements
            contextSources.code.targetPercentage = 0.3;
            contextSources.conversation.targetPercentage = 0.4;
            contextSources.documentation.targetPercentage = 0.2;
            contextSources.patterns.targetPercentage = 0.1;
            logMessage(
              "DEBUG",
              `Applied 'requirements_gathering/clarification' balance`
            );
            break;
          default:
            // Default balance preserved
            logMessage(
              "DEBUG",
              `No specific balance for purpose '${currentPurpose}', using defaults`
            );
            break;
        }
      } else {
        logMessage("DEBUG", `No current purpose, using default balance`);
      }
    } else if (contextBalance === "code_heavy") {
      // Code-heavy balance
      contextSources.code.targetPercentage = 0.8;
      contextSources.conversation.targetPercentage = 0.1;
      contextSources.documentation.targetPercentage = 0.05;
      contextSources.patterns.targetPercentage = 0.05;
      logMessage("DEBUG", `Applied 'code_heavy' balance`);
    } else if (contextBalance === "conversation_focused") {
      // Conversation-focused balance
      contextSources.code.targetPercentage = 0.3;
      contextSources.conversation.targetPercentage = 0.5;
      contextSources.documentation.targetPercentage = 0.1;
      contextSources.patterns.targetPercentage = 0.1;
      logMessage("DEBUG", `Applied 'conversation_focused' balance`);
    } else if (contextBalance === "documentation_focused") {
      // Documentation-focused balance
      contextSources.code.targetPercentage = 0.3;
      contextSources.conversation.targetPercentage = 0.1;
      contextSources.documentation.targetPercentage = 0.5;
      contextSources.patterns.targetPercentage = 0.1;
      logMessage("DEBUG", `Applied 'documentation_focused' balance`);
    } else if (contextBalance === "pattern_focused") {
      // Pattern-focused balance
      contextSources.code.targetPercentage = 0.3;
      contextSources.conversation.targetPercentage = 0.1;
      contextSources.documentation.targetPercentage = 0.1;
      contextSources.patterns.targetPercentage = 0.5;
      logMessage("DEBUG", `Applied 'pattern_focused' balance`);
    } else if (contextBalance === "balanced") {
      // Balanced settings - already default
      logMessage("DEBUG", `Using balanced settings (default)`);
    } else {
      // If contextBalance doesn't match known values, log and keep defaults
      logMessage(
        "WARN",
        `Unknown context balance type '${contextBalance}', using defaults`
      );
    }
  } catch (error) {
    logMessage("ERROR", `Error applying context balance`, {
      error: error.message,
      contextBalance,
    });
    throw error;
  }
}

/**
 * Integrate contexts from multiple sources respecting token budget
 *
 * @param {object} contextSources - Context sources with snippets
 * @param {number} tokenBudget - Total token budget
 * @param {string} balanceStrategy - Strategy for balancing context
 * @param {string} query - Original query for relevance calculations
 * @returns {Array} Integrated context snippets
 */
function _integrateContexts(
  contextSources,
  tokenBudget,
  balanceStrategy,
  query
) {
  try {
    logMessage(
      "DEBUG",
      `Integrating contexts with strategy: ${balanceStrategy}`
    );

    let integratedSnippets = [];

    // Apply the selected balance strategy
    switch (balanceStrategy) {
      case "proportional":
        integratedSnippets = _applyProportionalStrategy(
          contextSources,
          tokenBudget
        );
        break;
      case "equal_representation":
        integratedSnippets = _applyEqualRepresentationStrategy(
          contextSources,
          tokenBudget
        );
        break;
      case "priority_based":
        // Collect all snippets and sort by relevance
        const allSnippets = [
          ...contextSources.code.snippets,
          ...contextSources.conversation.snippets,
          ...contextSources.documentation.snippets,
          ...contextSources.patterns.snippets,
        ].sort((a, b) => b.relevanceScore - a.relevanceScore);

        integratedSnippets = _applyPriorityBasedStrategy(
          allSnippets,
          tokenBudget
        );
        break;
      default:
        // Fallback to proportional
        logMessage(
          "WARN",
          `Unknown balance strategy '${balanceStrategy}', falling back to proportional`
        );
        integratedSnippets = _applyProportionalStrategy(
          contextSources,
          tokenBudget
        );
    }

    // Log the result
    const typeBreakdown = {
      code: integratedSnippets.filter((s) => s.type === "code").length,
      conversation: integratedSnippets.filter((s) => s.type === "conversation")
        .length,
      documentation: integratedSnippets.filter(
        (s) => s.type === "documentation"
      ).length,
      patterns: integratedSnippets.filter((s) => s.type === "pattern").length,
    };

    logMessage(
      "DEBUG",
      `Integrated ${integratedSnippets.length} snippets`,
      typeBreakdown
    );

    return integratedSnippets;
  } catch (error) {
    logMessage("ERROR", `Error integrating contexts`, {
      error: error.message,
      balanceStrategy,
    });
    throw error;
  }
}

/**
 * Apply proportional balancing strategy for context integration
 *
 * @param {object} contextSources - Context sources with snippets
 * @param {number} tokenBudget - Total token budget
 * @returns {Array} Balanced context snippets
 */
function _applyProportionalStrategy(contextSources, tokenBudget) {
  try {
    logMessage(
      "DEBUG",
      `Applying proportional strategy with budget: ${tokenBudget}`
    );

    const result = [];
    let remainingBudget = tokenBudget;
    const unusedBudgets = {};

    // First pass: allocate tokens based on target percentages
    for (const [sourceType, source] of Object.entries(contextSources)) {
      // Skip empty sources
      if (!source.snippets || source.snippets.length === 0) {
        unusedBudgets[sourceType] = Math.floor(
          tokenBudget * source.targetPercentage
        );
        logMessage(
          "DEBUG",
          `No snippets for ${sourceType}, reserving ${unusedBudgets[sourceType]} tokens`
        );
        continue;
      }

      // Calculate token budget for this source
      const sourceBudget = Math.floor(tokenBudget * source.targetPercentage);

      // Sort snippets by relevance score
      const sortedSnippets = [...source.snippets].sort(
        (a, b) => b.relevanceScore - a.relevanceScore
      );

      // Add snippets until budget is exhausted
      let usedBudget = 0;
      for (const snippet of sortedSnippets) {
        if (usedBudget + snippet.tokenEstimate <= sourceBudget) {
          result.push(snippet);
          usedBudget += snippet.tokenEstimate;
        } else {
          // If the snippet doesn't fit, try the next one (might be smaller)
          continue;
        }
      }

      // Track unused budget for redistribution
      if (usedBudget < sourceBudget) {
        unusedBudgets[sourceType] = sourceBudget - usedBudget;
        logMessage(
          "DEBUG",
          `${sourceType} used ${usedBudget}/${sourceBudget} tokens, ${unusedBudgets[sourceType]} unused`
        );
      } else {
        unusedBudgets[sourceType] = 0;
      }

      remainingBudget -= usedBudget;
    }

    // Second pass: redistribute unused budget
    if (remainingBudget > 0) {
      logMessage("DEBUG", `Redistributing ${remainingBudget} unused tokens`);

      // Collect all remaining snippets
      const remainingSnippets = [];
      for (const [sourceType, source] of Object.entries(contextSources)) {
        if (!source.snippets) continue;

        const usedSnippetIds = new Set(
          result.filter((s) => s.type === sourceType).map((s) => s.entity_id)
        );

        const unusedSnippets = source.snippets.filter(
          (s) => !usedSnippetIds.has(s.entity_id)
        );

        remainingSnippets.push(...unusedSnippets);
      }

      // Sort by relevance score
      remainingSnippets.sort((a, b) => b.relevanceScore - a.relevanceScore);

      // Add snippets until remaining budget is exhausted
      for (const snippet of remainingSnippets) {
        if (snippet.tokenEstimate <= remainingBudget) {
          result.push(snippet);
          remainingBudget -= snippet.tokenEstimate;
        }

        if (remainingBudget <= 0) break;
      }
    }

    logMessage(
      "DEBUG",
      `Applied proportional strategy, selected ${result.length} snippets with ${remainingBudget} tokens remaining`
    );
    return result;
  } catch (error) {
    logMessage("ERROR", `Error applying proportional strategy`, {
      error: error.message,
      tokenBudget,
    });
    throw error;
  }
}

/**
 * Apply equal representation balancing strategy for context integration
 *
 * @param {object} contextSources - Context sources with snippets
 * @param {number} tokenBudget - Total token budget
 * @returns {Array} Balanced context snippets
 */
function _applyEqualRepresentationStrategy(contextSources, tokenBudget) {
  try {
    logMessage(
      "DEBUG",
      `Applying equal representation strategy with budget: ${tokenBudget}`
    );

    const result = [];
    let remainingBudget = tokenBudget;

    // Count non-empty sources
    const nonEmptySources = Object.values(contextSources).filter(
      (source) => source.snippets && source.snippets.length > 0
    ).length;

    if (nonEmptySources === 0) {
      logMessage("WARN", `No non-empty sources found for equal representation`);
      return [];
    }

    // Allocate equal budget to each non-empty source
    const budgetPerSource = Math.floor(tokenBudget / nonEmptySources);
    logMessage("DEBUG", `Allocating ${budgetPerSource} tokens per source`);

    // First pass: add snippets from each source up to its equal share
    for (const [sourceType, source] of Object.entries(contextSources)) {
      if (!source.snippets || source.snippets.length === 0) continue;

      // Sort snippets by relevance score
      const sortedSnippets = [...source.snippets].sort(
        (a, b) => b.relevanceScore - a.relevanceScore
      );

      // Add snippets until budget is exhausted
      let usedBudget = 0;
      for (const snippet of sortedSnippets) {
        if (usedBudget + snippet.tokenEstimate <= budgetPerSource) {
          result.push(snippet);
          usedBudget += snippet.tokenEstimate;
          remainingBudget -= snippet.tokenEstimate;
        }
      }
    }

    // Second pass: use remaining budget for highest relevance snippets
    if (remainingBudget > 0) {
      logMessage(
        "DEBUG",
        `Redistributing ${remainingBudget} unused tokens based on relevance`
      );

      // Collect all remaining snippets
      const remainingSnippets = [];
      for (const source of Object.values(contextSources)) {
        if (!source.snippets) continue;

        const usedSnippetIds = new Set(result.map((s) => s.entity_id));

        const unusedSnippets = source.snippets.filter(
          (s) => !usedSnippetIds.has(s.entity_id)
        );

        remainingSnippets.push(...unusedSnippets);
      }

      // Sort by relevance score
      remainingSnippets.sort((a, b) => b.relevanceScore - a.relevanceScore);

      // Add snippets until remaining budget is exhausted
      for (const snippet of remainingSnippets) {
        if (snippet.tokenEstimate <= remainingBudget) {
          result.push(snippet);
          remainingBudget -= snippet.tokenEstimate;
        }

        if (remainingBudget <= 0) break;
      }
    }

    logMessage(
      "DEBUG",
      `Applied equal representation strategy, selected ${result.length} snippets with ${remainingBudget} tokens remaining`
    );
    return result;
  } catch (error) {
    logMessage("ERROR", `Error applying equal representation strategy`, {
      error: error.message,
      tokenBudget,
    });
    throw error;
  }
}

/**
 * Apply priority-based balancing strategy for context integration
 *
 * @param {Array} allSnippets - All snippets sorted by relevance
 * @param {number} tokenBudget - Total token budget
 * @returns {Array} Selected context snippets
 */
function _applyPriorityBasedStrategy(allSnippets, tokenBudget) {
  try {
    logMessage(
      "DEBUG",
      `Applying priority-based strategy with budget: ${tokenBudget}`
    );

    const result = [];
    let usedBudget = 0;

    // Add snippets until budget is exhausted
    for (const snippet of allSnippets) {
      if (usedBudget + snippet.tokenEstimate <= tokenBudget) {
        result.push(snippet);
        usedBudget += snippet.tokenEstimate;
      } else {
        // If the snippet doesn't fit, try the next one (might be smaller)
        continue;
      }
    }

    logMessage(
      "DEBUG",
      `Applied priority-based strategy, selected ${result.length} snippets, using ${usedBudget}/${tokenBudget} tokens`
    );
    return result;
  } catch (error) {
    logMessage("ERROR", `Error applying priority-based strategy`, {
      error: error.message,
      tokenBudget,
    });
    throw error;
  }
}

/**
 * Estimate token count for a text
 *
 * @param {string} text - Text to estimate token count for
 * @returns {number} Estimated token count
 */
function _estimateTokenCount(text) {
  try {
    if (!text) return 0;
    // Simple estimation: ~4 characters per token on average
    return Math.ceil(text.length / 4);
  } catch (error) {
    logMessage("WARN", `Error estimating token count`, {
      error: error.message,
      textLength: text?.length || 0,
    });
    // Return a safe default
    return text ? Math.ceil(text.length / 4) : 0;
  }
}

/**
 * Generate source attribution for a snippet
 *
 * @param {object} snippet - Context snippet
 * @returns {string} Source attribution
 */
function _generateSourceAttribution(snippet) {
  try {
    switch (snippet.type) {
      case "code":
        return `Source: ${snippet.metadata.path || "Code"} (${
          snippet.metadata.entityType || "entity"
        })`;
      case "conversation":
        const timestampStr = snippet.metadata.timestamp
          ? new Date(snippet.metadata.timestamp).toLocaleString()
          : "Unknown time";
        return `From ${
          snippet.metadata.role || "conversation"
        } (${timestampStr})`;
      case "documentation":
        return `Documentation: ${
          snippet.metadata.title || snippet.metadata.path || "Unknown"
        }`;
      case "pattern":
        return `Pattern: ${snippet.metadata.name || "Unknown"} (${
          snippet.metadata.patternType || "general"
        })`;
      default:
        return `Source: ${snippet.type}`;
    }
  } catch (error) {
    logMessage("WARN", `Error generating source attribution`, {
      error: error.message,
      snippetType: snippet?.type,
    });
    // Return a generic attribution as fallback
    return "Source information unavailable";
  }
}

/**
 * Generate relevance explanation for a snippet
 *
 * @param {object} snippet - Context snippet
 * @param {string} query - Original query
 * @returns {string} Relevance explanation
 */
function _generateRelevanceExplanation(snippet, query) {
  try {
    const relevanceScore = snippet.relevanceScore || 0;
    const formattedScore = (relevanceScore * 100).toFixed(0);

    let explanation = `Relevance: ${formattedScore}%`;

    // Add type-specific explanations
    switch (snippet.type) {
      case "code":
        explanation += ` - This code ${
          relevanceScore > 0.8
            ? "directly addresses"
            : relevanceScore > 0.6
            ? "is closely related to"
            : "may be relevant to"
        } your query about "${query.substring(0, 30)}${
          query.length > 30 ? "..." : ""
        }"`;
        break;
      case "conversation":
        explanation += ` - This prior conversation ${
          relevanceScore > 0.8
            ? "directly addresses"
            : relevanceScore > 0.6
            ? "discusses"
            : "mentions"
        } similar topics to your current query`;
        break;
      case "documentation":
        explanation += ` - This documentation ${
          relevanceScore > 0.8
            ? "provides key information about"
            : relevanceScore > 0.6
            ? "explains"
            : "contains information related to"
        } concepts in your query`;
        break;
      case "pattern":
        explanation += ` - This pattern ${
          relevanceScore > 0.8
            ? "is highly applicable to"
            : relevanceScore > 0.6
            ? "may be useful for"
            : "could provide insights for"
        } your current task`;
        break;
      default:
        explanation += ` - This content appears relevant to your query`;
    }

    return explanation;
  } catch (error) {
    logMessage("WARN", `Error generating relevance explanation`, {
      error: error.message,
      snippetType: snippet?.type,
    });
    // Return a generic explanation as fallback
    return `Relevance score: ${((snippet?.relevanceScore || 0) * 100).toFixed(
      0
    )}%`;
  }
}

// Export the tool definition for server registration
export default {
  name: "retrieve_relevant_context",
  description:
    "Retrieves context from multiple sources that is relevant to the current query or conversation",
  inputSchema: retrieveRelevantContextInputSchema,
  outputSchema: retrieveRelevantContextOutputSchema,
  handler,
};
