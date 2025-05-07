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
import { v4 as uuidv4 } from "uuid";

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

    // Get the current active purpose if tracking transitions
    let previousIntent = null;
    if (options.trackIntentTransitions) {
      try {
        previousIntent = await ConversationPurposeDetector.getActivePurpose(
          conversationId
        );
        logMessage("DEBUG", "Retrieved previous intent", { previousIntent });
      } catch (error) {
        logMessage("WARN", "Failed to retrieve previous intent", {
          error: error.message,
        });
      }
    }

    // Process each message
    for (const message of messages) {
      try {
        let isTopicShift = false;
        let activeTopicId = null;

        // Only check for topic shifts on user messages
        if (message.role === "user") {
          // Check for topic shift
          logMessage("DEBUG", "Checking for topic shift with user message");
          isTopicShift = await ConversationIntelligence.detectTopicShift(
            message.content,
            conversationId
          );

          if (isTopicShift) {
            logMessage("INFO", `Topic shift detected`, {
              messageContent:
                message.content.substring(0, 50) +
                (message.content.length > 50 ? "..." : ""),
            });
            result.topicShift = true;
          }
        }

        // Record the message first without a topic segment ID
        // We'll update this after creating a new topic if needed
        logMessage("DEBUG", `Recording message from ${message.role}`);
        const recordedMessageId = await ConversationIntelligence.recordMessage(
          message.content,
          message.role,
          conversationId,
          [], // relatedContextEntityIds
          null, // topicSegmentId - will be updated later if needed
          options.trackIntentTransitions && result.currentIntent
            ? result.currentIntent.purposeType
            : null
        );

        logMessage("DEBUG", `Message recorded with ID: ${recordedMessageId}`);

        // Handle topic shift if detected
        if (message.role === "user" && isTopicShift) {
          // First, close any currently active topic segment
          try {
            const activeTopic =
              await ConversationSegmenter.getActiveTopicForConversation(
                conversationId
              );

            if (activeTopic) {
              logMessage("INFO", "Closing active topic segment", {
                topicId: activeTopic.topic_id,
              });

              await ConversationSegmenter.closeTopicSegment(
                activeTopic.topic_id,
                recordedMessageId
              );
            }
          } catch (closeError) {
            logMessage("WARN", "Failed to close active topic segment", {
              error: closeError.message,
            });
          }

          // Generate a topic name
          let topicName = "";
          try {
            topicName = await ConversationSegmenter.generateTopicName([
              recordedMessageId,
            ]);
          } catch (nameError) {
            topicName = `Topic from: ${message.content.substring(0, 30)}...`;
            logMessage(
              "WARN",
              "Failed to generate topic name, using fallback",
              {
                error: nameError.message,
              }
            );
          }

          // Create a new topic segment with the recorded message ID
          try {
            logMessage("INFO", "Creating new topic segment");
            const newTopicId =
              await ConversationSegmenter.createNewTopicSegment(
                conversationId,
                recordedMessageId, // Use the actual message ID
                {
                  name: topicName,
                  description: message.content,
                }
              );

            logMessage("INFO", `Created new topic segment`, {
              topicId: newTopicId,
            });

            // Update the message with the new topic ID
            // This requires a database update since we've already recorded the message
            try {
              const updateQuery = `
                UPDATE conversation_history
                SET topic_segment_id = ?
                WHERE message_id = ?
              `;

              await executeQuery(updateQuery, [newTopicId, recordedMessageId]);
              logMessage("DEBUG", "Updated message with new topic ID", {
                messageId: recordedMessageId,
                topicId: newTopicId,
              });

              // Use this topic ID for tracking
              activeTopicId = newTopicId;
            } catch (updateError) {
              logMessage("ERROR", "Failed to update message with topic ID", {
                error: updateError.message,
              });
            }
          } catch (topicError) {
            logMessage("ERROR", "Failed to create new topic segment", {
              error: topicError.message,
            });
          }
        } else if (message.role === "user" && !isTopicShift) {
          // If no topic shift, associate with current active topic if any
          try {
            const activeTopic =
              await ConversationSegmenter.getActiveTopicForConversation(
                conversationId
              );

            if (activeTopic) {
              const updateQuery = `
                UPDATE conversation_history
                SET topic_segment_id = ?
                WHERE message_id = ?
              `;

              await executeQuery(updateQuery, [
                activeTopic.topic_id,
                recordedMessageId,
              ]);
              logMessage("DEBUG", "Updated message with existing topic ID", {
                messageId: recordedMessageId,
                topicId: activeTopic.topic_id,
              });

              activeTopicId = activeTopic.topic_id;
            }
          } catch (error) {
            logMessage(
              "WARN",
              "Failed to associate message with active topic",
              {
                error: error.message,
              }
            );
          }
        }

        // Detect conversation purpose for each user message
        if (message.role === "user" && options.trackIntentTransitions) {
          try {
            // Get recent conversation history for context
            const recentHistory =
              await ConversationIntelligence.getConversationHistory(
                conversationId,
                10
              );

            // Detect purpose based on message and conversation history
            const purposeResult =
              await ConversationPurposeDetector.detectConversationPurpose(
                message.content,
                recentHistory
              );

            if (purposeResult) {
              const newPurpose = purposeResult.purpose;
              const currentPurpose = previousIntent
                ? previousIntent.purposeType
                : null;

              // Check if purpose has changed
              if (newPurpose !== currentPurpose) {
                logMessage("INFO", "Conversation purpose change detected", {
                  from: currentPurpose,
                  to: newPurpose,
                });

                // Track the purpose transition
                await ConversationPurposeDetector.trackPurposeTransition(
                  conversationId,
                  currentPurpose,
                  newPurpose,
                  recordedMessageId
                );

                // Update result for the handler function
                result.intentTransition = true;
                result.currentIntent = {
                  purposeType: newPurpose,
                  confidence: purposeResult.confidence,
                };

                // Update previous intent for next iteration
                previousIntent = {
                  purposeType: newPurpose,
                  confidence: purposeResult.confidence,
                };
              }
            }
          } catch (purposeError) {
            logMessage("WARN", "Failed to detect conversation purpose", {
              error: purposeError.message,
            });
          }
        }

        // Update intent with the new message
        if (options.trackIntentTransitions) {
          try {
            const intentUpdateResult = await IntentPredictorLogic.updateIntent({
              conversationId,
              messages: [message],
              messageId: recordedMessageId,
            });

            // Check if intent has been updated during processing
            if (intentUpdateResult.intentChanged && !result.intentTransition) {
              result.intentTransition = true;
              result.currentIntent = intentUpdateResult.newIntent;

              logMessage("INFO", "Intent updated based on message content", {
                intent: intentUpdateResult.newIntent,
              });
            }
          } catch (intentError) {
            logMessage("WARN", "Failed to update intent", {
              error: intentError.message,
            });
          }
        }
      } catch (msgError) {
        logMessage("ERROR", `Failed to process message`, {
          error: msgError.message,
          role: message.role,
          content: message.content?.substring(0, 50) + "...",
        });
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
    if (!codeChanges || !codeChanges.length) {
      return result;
    }

    // Process code changes in parallel using Promise.allSettled for better error handling
    // This will never reject, ensuring we always get results even if some changes fail
    const processingPromises = codeChanges.map((change) => {
      // Ensure filePath exists before processing
      if (!change || !change.filePath) {
        logMessage("WARN", "Received invalid code change object, skipping", {
          change: JSON.stringify(change).substring(0, 100) + "...",
        });
        return Promise.resolve({
          success: false,
          filePath: change?.filePath || "unknown",
          error: "Invalid code change: missing filePath",
        });
      }

      return KnowledgeProcessor.processCodeChange(change)
        .then((result) => {
          if (result.success) {
            logMessage("DEBUG", `Processed code change for ${change.filePath}`);
          } else {
            logMessage("WARN", `Failed to process code change`, {
              error: result.error || "Unknown error",
              path: change.filePath,
            });
          }
          return result;
        })
        .catch((processErr) => {
          // Extra safety - should never reach here as processCodeChange now handles errors
          logMessage("WARN", `Unexpected error processing code change`, {
            error: processErr.message,
            path: change.filePath,
          });
          return {
            success: false,
            filePath: change.filePath,
            error: processErr.message,
          };
        });
    });

    // Wait for all code changes to be processed
    const processingResults = await Promise.allSettled(processingPromises);

    // Extract the actual results and handle any rejected promises (should be none)
    const processedResults = processingResults.map((promiseResult) => {
      if (promiseResult.status === "fulfilled") {
        return promiseResult.value;
      } else {
        // This shouldn't happen but handle it anyway
        logMessage("ERROR", "Promise rejected during code change processing", {
          reason: promiseResult.reason?.message || "Unknown error",
        });
        return {
          success: false,
          error: promiseResult.reason?.message || "Unknown error",
        };
      }
    });

    // Log a summary of the results
    const successCount = processedResults.filter((r) => r.success).length;
    const failureCount = processedResults.filter((r) => !r.success).length;

    if (failureCount > 0) {
      logMessage(
        "WARN",
        `${failureCount} of ${codeChanges.length} code changes failed processing`
      );
    } else {
      logMessage(
        "INFO",
        `Successfully processed all ${codeChanges.length} code changes`
      );
    }

    // Calculate new focus area based on code changes
    try {
      if (successCount > 0) {
        const mostSignificantChange = codeChanges.reduce((prev, current) => {
          // Simple heuristic: more changed lines = more significant
          const prevChangedLines = prev.changedLines?.length || 0;
          const currentChangedLines = current.changedLines?.length || 0;
          return currentChangedLines > prevChangedLines ? current : prev;
        }, codeChanges[0]);

        // If we have a significant change, set it as the focus
        if (mostSignificantChange) {
          const newFocus = {
            focus_type: "file",
            identifier: mostSignificantChange.filePath,
            description: `File ${mostSignificantChange.filePath} was modified`,
          };

          try {
            // Update focus area
            await FocusAreaManagerLogic.setFocusArea(newFocus);
            result.focusChanged = true;
            result.newFocus = newFocus;
          } catch (focusError) {
            logMessage("WARN", "Failed to update focus area", {
              error: focusError.message,
            });
            // Continue without updating focus
          }
        }
      }
    } catch (focusError) {
      // Ignore focus calculation errors
      logMessage("WARN", "Error calculating focus area from code changes", {
        error: focusError.message,
      });
    }

    return result;
  } catch (error) {
    logMessage("ERROR", `Failed to process code changes`, {
      error: error.message,
      conversationId,
    });

    // Return a default result instead of throwing
    return {
      focusChanged: false,
      newFocus: null,
      error: error.message,
    };
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
          const intentStr =
            typeof currentIntent === "string"
              ? currentIntent.replace(/_/g, " ")
              : currentIntent;
          summaryText += ` with the purpose of ${intentStr}`;
        }
      } else if (currentIntent) {
        const intentStr =
          typeof currentIntent === "string"
            ? currentIntent.replace(/_/g, " ")
            : currentIntent;
        summaryText = `The conversation is focused on ${intentStr}`;
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
          const intentStr =
            typeof currentIntent === "string"
              ? currentIntent.replace(/_/g, " ")
              : currentIntent;
          summaryText += ` with ${intentStr}`;
        }
      } else if (currentIntent) {
        const intentStr =
          typeof currentIntent === "string"
            ? currentIntent.replace(/_/g, " ")
            : currentIntent;
        summaryText = `Continuing with ${intentStr}`;
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
