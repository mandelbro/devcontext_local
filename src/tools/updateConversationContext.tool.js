/**
 * updateConversationContext.tool.js
 *
 * MCP tool implementation for updating an existing conversation context
 * This tool processes new messages and code changes, manages topic shifts,
 * and ensures context continuity throughout the conversation
 */

import { z } from "zod";
import { executeQuery } from "../db.js";
import * as ConversationIntelligence from "../logic/ConversationIntelligence.js";
import * as KnowledgeProcessor from "../logic/KnowledgeProcessor.js";
import * as TimelineManagerLogic from "../logic/TimelineManagerLogic.js";
import * as IntentPredictorLogic from "../logic/IntentPredictorLogic.js";
import * as ActiveContextManager from "../logic/ActiveContextManager.js";
import * as ConversationSegmenter from "../logic/ConversationSegmenter.js";
import * as ConversationPurposeDetector from "../logic/ConversationPurposeDetector.js";
import * as ContextCompressorLogic from "../logic/ContextCompressorLogic.js";
import { logMessage } from "../utils/logger.js";

import {
  updateConversationContextInputSchema,
  updateConversationContextOutputSchema,
} from "../schemas/toolSchemas.js";

/**
 * Handler for update_conversation_context tool
 *
 * @param {object} input - Tool input parameters
 * @param {object} sdkContext - SDK context
 * @returns {Promise<object>} Tool output
 */
async function handler(input, sdkContext) {
  try {
    logMessage("INFO", `update_conversation_context tool started`, {
      conversationId: input.conversationId,
      messageCount: input.newMessages?.length || 0,
      codeChangeCount: input.codeChanges?.length || 0,
    });

    // 1. Extract input parameters with defaults
    const {
      conversationId,
      newMessages = [],
      codeChanges = [],
      preserveContextOnTopicShift = true,
      contextIntegrationLevel = "balanced",
      trackIntentTransitions = true,
      tokenBudget = 4000,
    } = input;

    // Validate conversation ID is provided
    if (!conversationId) {
      const error = new Error("conversationId is required");
      error.code = "MISSING_CONVERSATION_ID";
      throw error;
    }

    logMessage("DEBUG", `Processing update with parameters`, {
      preserveContextOnTopicShift,
      contextIntegrationLevel,
      trackIntentTransitions,
    });

    // 2. Initialize tracking variables for context transitions
    let topicShift = false;
    let intentTransition = false;
    let previousIntent = null;
    let currentIntent = null;
    let contextPreserved = true;
    let currentFocus = null;

    // 3. Get current context state before changes
    try {
      const previousContextState =
        await ActiveContextManager.getActiveContextState();
      logMessage("DEBUG", `Retrieved previous context state`, {
        hasPreviousContext: !!previousContextState,
      });

      if (trackIntentTransitions) {
        previousIntent = await ConversationPurposeDetector.getActivePurpose(
          conversationId
        );
        logMessage("DEBUG", `Retrieved previous intent`, { previousIntent });
      }
    } catch (err) {
      logMessage(
        "WARN",
        `Failed to retrieve previous context state, continuing with defaults`,
        {
          error: err.message,
        }
      );
      // Continue with defaults already initialized
    }

    // 4. Process new messages if any
    if (newMessages.length > 0) {
      logMessage("INFO", `Processing ${newMessages.length} new messages`);
      try {
        const processedMessages = await processNewMessages(
          conversationId,
          newMessages,
          {
            trackIntentTransitions,
          }
        );

        topicShift = processedMessages.topicShift;
        logMessage("DEBUG", `Message processing completed`, {
          topicShift: topicShift,
        });

        if (trackIntentTransitions) {
          intentTransition = processedMessages.intentTransition;
          currentIntent = processedMessages.currentIntent;

          if (intentTransition) {
            logMessage("INFO", `Intent transition detected`, {
              from: previousIntent,
              to: currentIntent,
            });
          }
        }
      } catch (err) {
        logMessage("ERROR", `Failed to process new messages`, {
          error: err.message,
          conversationId,
        });
        // Continue with code changes processing despite message error
      }
    }

    // 5. Process code changes if any
    if (codeChanges.length > 0) {
      logMessage("INFO", `Processing ${codeChanges.length} code changes`);
      try {
        const processedChanges = await processCodeChanges(
          conversationId,
          codeChanges
        );

        // Update tracking variables with results from code changes
        if (processedChanges.focusChanged) {
          logMessage("INFO", `Focus changed due to code changes`, {
            newFocus: processedChanges.newFocus,
          });

          // Code changes can also affect focus and sometimes intent
          if (trackIntentTransitions && !intentTransition) {
            try {
              // Only update if we haven't already detected a transition from messages
              const intentResult = await IntentPredictorLogic.updateIntent({
                conversationId,
                codeChanges,
              });

              if (intentResult.intentChanged) {
                intentTransition = true;
                currentIntent = intentResult.newIntent;
                logMessage("INFO", `Intent changed due to code changes`, {
                  newIntent: currentIntent,
                });
              }
            } catch (intentErr) {
              logMessage("WARN", `Failed to update intent from code changes`, {
                error: intentErr.message,
              });
              // Continue without updating intent
            }
          }
        }
      } catch (err) {
        logMessage("ERROR", `Failed to process code changes`, {
          error: err.message,
          conversationId,
        });
        // Continue with context management despite code change error
      }
    }

    // 6. Manage context continuity based on topic shifts and transitions
    if (topicShift || intentTransition) {
      logMessage(
        "INFO",
        `Topic shift or intent transition detected, managing context continuity`,
        {
          topicShift,
          intentTransition,
          preserveContextOnTopicShift,
        }
      );

      // Determine if and how to preserve context
      if (!preserveContextOnTopicShift) {
        try {
          // Clear previous context if preservation not requested
          await ActiveContextManager.clearActiveContext();
          contextPreserved = false;
          logMessage("INFO", `Cleared previous context due to topic shift`);

          // Initialize fresh context for new topic/intent
          if (currentIntent) {
            try {
              const recentEvents =
                await TimelineManagerLogic.getRecentEventsForConversation(
                  conversationId,
                  10
                );

              const focusResult = await IntentPredictorLogic.predictFocusArea(
                recentEvents,
                codeChanges
              );

              if (focusResult) {
                await ActiveContextManager.setActiveFocus(
                  focusResult.type,
                  focusResult.identifier
                );
                currentFocus = focusResult;
                logMessage("INFO", `Set new focus area based on intent`, {
                  type: focusResult.type,
                  identifier: focusResult.identifier,
                });
              }
            } catch (focusErr) {
              logMessage("WARN", `Failed to set new focus area`, {
                error: focusErr.message,
              });
              // Continue without setting focus
            }
          }
        } catch (clearErr) {
          logMessage("ERROR", `Failed to clear context`, {
            error: clearErr.message,
          });
          // Continue with next steps despite error
        }
      } else {
        try {
          // Integrate previous and new context
          const previousContextState =
            (await ActiveContextManager.getActiveContextState()) || {};

          const integratedContext = await _integrateContexts(
            previousContextState,
            {
              topicShift,
              intentTransition,
              previousIntent,
              currentIntent,
              codeChanges,
            },
            contextIntegrationLevel
          );

          await ActiveContextManager.updateActiveContext(integratedContext);
          contextPreserved = true;
          logMessage("INFO", `Integrated previous and new context`, {
            contextIntegrationLevel,
          });
        } catch (integrateErr) {
          logMessage("ERROR", `Failed to integrate contexts`, {
            error: integrateErr.message,
          });
          // Continue with next steps despite error
        }
      }
    } else {
      logMessage(
        "DEBUG",
        `No topic shift or intent transition detected, preserving context`
      );
    }

    // 7. Get final focus and context state
    if (!currentFocus) {
      try {
        currentFocus = await ActiveContextManager.getActiveFocus();
        logMessage("DEBUG", `Retrieved current focus`, {
          focus: currentFocus
            ? `${currentFocus.type}:${currentFocus.identifier}`
            : "none",
        });
      } catch (focusErr) {
        logMessage("WARN", `Failed to get current focus`, {
          error: focusErr.message,
        });
        // Continue without focus
      }
    }

    // 8. Generate context synthesis
    let contextSynthesis;
    try {
      contextSynthesis = await generateContextSynthesis(
        conversationId,
        currentIntent,
        topicShift || intentTransition
      );
      logMessage("DEBUG", `Generated context synthesis`, {
        synthesisLength: contextSynthesis?.length || 0,
      });
    } catch (synthesisErr) {
      logMessage("WARN", `Failed to generate context synthesis`, {
        error: synthesisErr.message,
      });
      contextSynthesis = null;
    }

    // 9. Update timeline with context update event
    try {
      await TimelineManagerLogic.recordEvent(
        "context_updated",
        {
          newMessagesCount: newMessages.length,
          codeChangesCount: codeChanges.length,
          topicShift,
          intentTransition: intentTransition
            ? {
                from: previousIntent,
                to: currentIntent,
              }
            : null,
          contextPreserved,
          contextIntegrationLevel: contextPreserved
            ? contextIntegrationLevel
            : "none",
        },
        [], // No specific entity IDs
        conversationId
      );
      logMessage("DEBUG", `Recorded context update in timeline`);
    } catch (timelineErr) {
      logMessage("WARN", `Failed to record context update in timeline`, {
        error: timelineErr.message,
      });
      // Non-critical error, continue
    }

    // 10. Return the tool response
    logMessage(
      "INFO",
      `update_conversation_context tool completed successfully`
    );

    const responseData = {
      status: "success",
      message: `Conversation context updated for ${conversationId}`,
      updatedFocus: currentFocus
        ? {
            type: currentFocus.type,
            identifier: currentFocus.identifier,
          }
        : undefined,
      contextContinuity: {
        topicShift,
        intentTransition,
        contextPreserved,
      },
      synthesis: contextSynthesis,
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
    logMessage("ERROR", `Error in update_conversation_context tool`, {
      error: error.message,
      stack: error.stack,
      input: {
        conversationId: input.conversationId,
        messageCount: input.newMessages?.length || 0,
        codeChangeCount: input.codeChanges?.length || 0,
      },
    });

    // Return error response
    const errorResponse = {
      error: true,
      errorCode: error.code || "UPDATE_FAILED",
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
 * Process new messages and detect topic shifts or intent transitions
 *
 * @param {string} conversationId - Conversation ID
 * @param {Array} messages - New messages to process
 * @param {object} options - Processing options
 * @returns {Promise<object>} Processing results
 */
async function processNewMessages(conversationId, messages, options = {}) {
  try {
    logMessage(
      "DEBUG",
      `Processing ${messages.length} messages for conversation ${conversationId}`
    );

    const result = {
      topicShift: false,
      intentTransition: false,
      currentIntent: null,
    };

    // Process each message
    for (const message of messages) {
      try {
        // Extra debugging log to capture input parameters
        console.log("RECORDING MESSAGE - Input params:", {
          content: message.content,
          role: message.role,
          conversationId,
        });

        // Record message in database
        const messageId = await ConversationIntelligence.recordMessage(
          message.content,
          message.role,
          conversationId,
          [], // relatedContextEntityIds
          null // topicSegmentId
        );

        // Extra debugging log to confirm success
        console.log("RECORDING MESSAGE - Success:", {
          messageId,
          role: message.role,
        });

        logMessage("DEBUG", `Recorded message from ${message.role}`);
      } catch (msgErr) {
        // Extra detailed error logging
        console.error("RECORDING MESSAGE - FAILED:", {
          error: msgErr.message,
          stack: msgErr.stack,
          messageRole: message.role,
          messageContent:
            message.content && message.content.substring(0, 50) + "...",
        });

        logMessage(
          "WARN",
          `Failed to record message in conversation intelligence`,
          {
            error: msgErr.message,
            messageRole: message.role,
          }
        );
        // Continue with next message
      }
    }

    // Check for topic shifts using conversation segmenter
    try {
      const segmentationResult = await ConversationSegmenter.detectTopicShift(
        conversationId,
        messages
      );
      result.topicShift = segmentationResult.topicShift;

      if (result.topicShift) {
        logMessage("INFO", `Topic shift detected`, {
          previousTopic: segmentationResult.previousTopic,
          newTopic: segmentationResult.newTopic,
          confidence: segmentationResult.confidence,
        });
      }
    } catch (segmentErr) {
      logMessage("WARN", `Failed to detect topic shift`, {
        error: segmentErr.message,
      });
      // Continue with default value (false)
    }

    // If tracking intent transitions is enabled
    if (options.trackIntentTransitions) {
      try {
        const previousIntent =
          await ConversationPurposeDetector.getActivePurpose(conversationId);

        // Update intent based on new messages
        const intentUpdateResult = await IntentPredictorLogic.updateIntent({
          conversationId,
          messages,
        });

        if (intentUpdateResult.intentChanged) {
          result.intentTransition = true;
          result.currentIntent = intentUpdateResult.newIntent;

          logMessage("INFO", `Intent transition detected`, {
            from: previousIntent,
            to: result.currentIntent,
            confidence: intentUpdateResult.confidence,
          });

          // Update the active purpose in the conversation detector
          await ConversationPurposeDetector.setActivePurpose(
            conversationId,
            result.currentIntent
          );
        } else {
          result.currentIntent = previousIntent;
        }
      } catch (intentErr) {
        logMessage("WARN", `Failed to track intent transition`, {
          error: intentErr.message,
        });
        // Continue with default values
      }
    }

    return result;
  } catch (error) {
    logMessage("ERROR", `Error processing new messages`, {
      error: error.message,
      conversationId,
    });
    throw error; // Re-throw to be caught by the main handler
  }
}

/**
 * Process code changes and update related context
 *
 * @param {string} conversationId - Conversation ID
 * @param {Array} codeChanges - Array of code changes
 * @returns {Promise<object>} Processing results
 */
async function processCodeChanges(conversationId, codeChanges) {
  try {
    logMessage(
      "DEBUG",
      `Processing ${codeChanges.length} code changes for conversation ${conversationId}`
    );

    const result = {
      focusChanged: false,
      newFocus: null,
    };

    // If there are no code changes, return early
    if (!codeChanges.length) {
      return result;
    }

    // Process each code change using the knowledge processor
    for (const change of codeChanges) {
      try {
        await KnowledgeProcessor.processCodeChange(change);
        logMessage("DEBUG", `Processed code change for ${change.path}`);
      } catch (processErr) {
        logMessage("WARN", `Failed to process code change`, {
          error: processErr.message,
          path: change.path,
        });
        // Continue with next change
      }
    }

    // Calculate new focus area based on code changes
    const mostSignificantChange = codeChanges.reduce((prev, current) => {
      // Simple heuristic: more changed lines = more significant
      const prevChangedLines = prev.changedLines?.length || 0;
      const currentChangedLines = current.changedLines?.length || 0;
      return currentChangedLines > prevChangedLines ? current : prev;
    }, codeChanges[0]);

    // Set focus to the most significantly changed file
    try {
      await ActiveContextManager.setActiveFocus(
        "file",
        mostSignificantChange.path
      );
      result.focusChanged = true;
      result.newFocus = {
        type: "file",
        identifier: mostSignificantChange.path,
      };

      logMessage("INFO", `Set focus to most significantly changed file`, {
        path: mostSignificantChange.path,
        changedLines: mostSignificantChange.changedLines?.length || "N/A",
      });
    } catch (focusErr) {
      logMessage("WARN", `Failed to set focus to changed file`, {
        error: focusErr.message,
        path: mostSignificantChange.path,
      });
      // Continue without changing focus
    }

    // Record code changes in timeline
    try {
      await TimelineManagerLogic.recordEvent(
        "code_changes",
        {
          count: codeChanges.length,
          paths: codeChanges.map((c) => c.path),
        },
        [], // No specific entity IDs
        conversationId
      );
      logMessage("DEBUG", `Recorded code changes in timeline`);
    } catch (timelineErr) {
      logMessage("WARN", `Failed to record code changes in timeline`, {
        error: timelineErr.message,
      });
      // Non-critical error, continue
    }

    return result;
  } catch (error) {
    logMessage("ERROR", `Error processing code changes`, {
      error: error.message,
      conversationId,
    });
    throw error; // Re-throw to be caught by the main handler
  }
}

/**
 * Integrates previous and new context states
 *
 * @param {Object} previousContextState - Previous context state
 * @param {Object} changes - Change indicators (topic shift, intent transition, etc.)
 * @param {string} integrationLevel - How aggressively to integrate contexts
 * @returns {Promise<Object>} Integrated context
 */
async function _integrateContexts(
  previousContextState,
  changes,
  integrationLevel
) {
  const {
    topicShift,
    intentTransition,
    previousIntent,
    currentIntent,
    codeChanges,
  } = changes;

  try {
    logMessage("INFO", `Integrating contexts with level: ${integrationLevel}`);

    // Start with a copy of the previous context
    const integratedContext = { ...previousContextState };

    // Determine how much to preserve based on integration level
    switch (integrationLevel) {
      case "minimal":
        // For minimal integration, only keep core focus and clear most context
        if (topicShift) {
          // Clear most context but keep current focus
          const currentFocus = integratedContext.focus;
          integratedContext.recentContextItems = [];
          integratedContext.focus = currentFocus;
        }
        break;

      case "aggressive":
        // For aggressive integration, preserve all context even with transitions
        // Just update the intent/purpose information
        if (intentTransition) {
          integratedContext.currentIntent = currentIntent;
        }
        break;

      case "balanced":
      default:
        // For balanced integration, preserve relevant context
        if (topicShift) {
          // Reduce context items but keep those relevant to current focus
          const currentFocus = integratedContext.focus;

          // Keep items that are still relevant to current focus or code changes
          if (integratedContext.recentContextItems) {
            const changedFilePaths = codeChanges.map(
              (change) => change.filePath
            );

            integratedContext.recentContextItems =
              integratedContext.recentContextItems.filter((item) => {
                // Keep items related to current focus
                if (
                  item.relatedTo &&
                  item.relatedTo.includes(currentFocus?.identifier)
                ) {
                  return true;
                }

                // Keep items related to changed files
                if (
                  item.path &&
                  changedFilePaths.some((path) => item.path.includes(path))
                ) {
                  return true;
                }

                // Keep very recent items
                if (
                  item.timestamp &&
                  Date.now() - item.timestamp < 5 * 60 * 1000
                ) {
                  // 5 minutes
                  return true;
                }

                return false;
              });
          }
        }

        // Always update intent information
        if (intentTransition) {
          integratedContext.currentIntent = currentIntent;

          // If we have code changes, adjust priorities based on new intent
          if (codeChanges.length > 0 && integratedContext.recentContextItems) {
            // Re-prioritize based on new intent
            integratedContext.recentContextItems.forEach((item) => {
              if (item.contentType === "code" && currentIntent) {
                // Adjust priority based on relevance to new intent
                if (
                  currentIntent === "debugging" &&
                  item.path &&
                  item.path.includes("test")
                ) {
                  item.priority = Math.min(item.priority + 0.2, 1.0);
                } else if (
                  currentIntent === "feature_planning" &&
                  item.path &&
                  item.path.includes("docs")
                ) {
                  item.priority = Math.min(item.priority + 0.2, 1.0);
                }
                // Add more intent-specific priority adjustments as needed
              }
            });

            // Sort by adjusted priority
            integratedContext.recentContextItems.sort(
              (a, b) => b.priority - a.priority
            );
          }
        }
        break;
    }

    return integratedContext;
  } catch (error) {
    logMessage("ERROR", `Error integrating contexts`, {
      error: error.message,
    });
    // Fall back to previous context in case of error
    return previousContextState;
  }
}

/**
 * Generates a synthesis of the current context
 *
 * @param {string} conversationId - Conversation ID
 * @param {string} currentIntent - Current conversation intent
 * @param {boolean} contextChanged - Whether context has significantly changed
 * @returns {Promise<Object>} Context synthesis
 */
async function generateContextSynthesis(
  conversationId,
  currentIntent,
  contextChanged
) {
  try {
    logMessage("INFO", `Generating context synthesis`);

    // Get active context information
    const activeContext = await ActiveContextManager.getActiveContextState();
    const activeFocus = await ActiveContextManager.getActiveFocus();

    // Get recent messages for context
    const recentMessages = await ConversationIntelligence.getRecentMessages(
      conversationId,
      5
    );

    // Generate a summary appropriate to the current state
    let summaryText = "Current conversation context";

    if (contextChanged) {
      // More detailed summary for changed context
      if (activeFocus) {
        summaryText = `The conversation is now focused on ${activeFocus.type} "${activeFocus.identifier}"`;

        if (currentIntent) {
          summaryText += ` with the purpose of ${currentIntent.replace(
            /_/g,
            " "
          )}`;
        }
      } else if (currentIntent) {
        summaryText = `The conversation is focused on ${currentIntent.replace(
          /_/g,
          " "
        )}`;
      }

      // Add recent message summary if available
      if (recentMessages.length > 0) {
        const messageContent = recentMessages
          .map((msg) => msg.content)
          .join(" ");
        const messageSummary = await ContextCompressorLogic.summarizeText(
          messageContent,
          { targetLength: 150 }
        );

        summaryText += `. Recent discussion: ${messageSummary}`;
      }
    } else {
      // Simpler summary for continued context
      if (activeFocus) {
        summaryText = `Continuing focus on ${activeFocus.type} "${activeFocus.identifier}"`;

        if (currentIntent) {
          summaryText += ` with ${currentIntent.replace(/_/g, " ")}`;
        }
      } else if (currentIntent) {
        summaryText = `Continuing with ${currentIntent.replace(/_/g, " ")}`;
      }
    }

    // Identify top priorities based on current context
    const topPriorities = [];

    if (activeFocus) {
      topPriorities.push(
        `Focus on ${activeFocus.type}: ${activeFocus.identifier}`
      );
    }

    if (currentIntent) {
      switch (currentIntent) {
        case "debugging":
          topPriorities.push("Identify and fix issues in the code");
          break;
        case "feature_planning":
          topPriorities.push("Design and plan new features");
          break;
        case "code_review":
          topPriorities.push("Review code for quality and correctness");
          break;
        case "learning":
          topPriorities.push("Explain concepts and provide information");
          break;
        case "code_generation":
          topPriorities.push("Generate or modify code");
          break;
        default:
          topPriorities.push("Address user's current needs");
      }
    }

    // Include active context items as priorities if available
    if (activeContext && activeContext.recentContextItems) {
      const priorityItems = activeContext.recentContextItems
        .slice(0, 2)
        .map((item) => {
          if (item.type === "file") {
            return `Maintain context on file: ${item.name || item.path}`;
          } else if (item.type === "entity") {
            return `Keep focus on: ${item.name}`;
          }
          return null;
        })
        .filter(Boolean);

      topPriorities.push(...priorityItems);
    }

    return {
      summary: summaryText,
      topPriorities: topPriorities.length > 0 ? topPriorities : undefined,
    };
  } catch (error) {
    logMessage("ERROR", `Error generating context synthesis`, {
      error: error.message,
    });
    // Return minimal synthesis in case of error
    return {
      summary: "Context updated",
    };
  }
}

// Export the tool definition for server registration
export default {
  name: "update_conversation_context",
  description:
    "Updates an existing conversation context with new messages, code changes, and context management",
  inputSchema: updateConversationContextInputSchema,
  outputSchema: updateConversationContextOutputSchema,
  handler,
};
