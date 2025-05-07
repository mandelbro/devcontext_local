/**
 * finalizeConversationContext.tool.js
 *
 * MCP tool implementation for finalizing a conversation context
 * This tool performs learning extraction, pattern promotion, and generates insights
 * when a conversation ends.
 */

import { z } from "zod";
import { executeQuery } from "../db.js";
import * as ConversationIntelligence from "../logic/ConversationIntelligence.js";
import * as TimelineManagerLogic from "../logic/TimelineManagerLogic.js";
import * as ActiveContextManager from "../logic/ActiveContextManager.js";
import * as LearningSystems from "../logic/LearningSystems.js";
import * as GlobalPatternRepository from "../logic/GlobalPatternRepository.js";
import * as SmartSearchServiceLogic from "../logic/SmartSearchServiceLogic.js";
import * as ContextCompressorLogic from "../logic/ContextCompressorLogic.js";
import * as TextTokenizerLogic from "../logic/TextTokenizerLogic.js";
import { logMessage } from "../utils/logger.js";
import { v4 as uuidv4 } from "uuid";

import {
  finalizeConversationContextInputSchema,
  finalizeConversationContextOutputSchema,
} from "../schemas/toolSchemas.js";

/**
 * Handler for finalize_conversation_context tool
 *
 * @param {object} input - Tool input parameters
 * @param {object} sdkContext - SDK context
 * @returns {Promise<object>} Tool output
 */
async function handler(input, sdkContext) {
  try {
    logMessage("INFO", `finalize_conversation_context tool started`, {
      conversationId: input.conversationId,
      outcome: input.outcome || "completed",
      clearActiveContext: input.clearActiveContext || false,
    });

    // 1. Extract input parameters
    const {
      conversationId,
      clearActiveContext = false,
      extractLearnings = true,
      promotePatterns = true,
      synthesizeRelatedTopics = true,
      generateNextSteps = true,
      outcome = "completed",
    } = input;

    // Validate conversation ID
    if (!conversationId) {
      const error = new Error("Conversation ID is required");
      error.code = "MISSING_CONVERSATION_ID";
      throw error;
    }

    logMessage("DEBUG", `Processing options`, {
      extractLearnings,
      promotePatterns,
      synthesizeRelatedTopics,
      generateNextSteps,
    });

    // 2. Fetch conversation history, purpose, and topics
    let conversationHistory = [];
    let conversationPurpose = null;
    let conversationTopics = [];

    try {
      conversationHistory =
        await ConversationIntelligence.getConversationHistory(conversationId);

      if (!conversationHistory || conversationHistory.length === 0) {
        const error = new Error(
          `No conversation history found for ID: ${conversationId}`
        );
        error.code = "CONVERSATION_NOT_FOUND";
        throw error;
      }

      logMessage("DEBUG", `Retrieved conversation history`, {
        messageCount: conversationHistory.length,
      });
    } catch (historyErr) {
      logMessage("ERROR", `Failed to retrieve conversation history`, {
        error: historyErr.message,
        conversationId,
      });
      throw historyErr; // This is critical, rethrow
    }

    // Get conversation purpose
    try {
      conversationPurpose =
        await ConversationIntelligence.getConversationPurpose(conversationId);
      logMessage(
        "DEBUG",
        `Retrieved conversation purpose: ${conversationPurpose || "Unknown"}`
      );
    } catch (purposeErr) {
      logMessage("WARN", `Failed to retrieve conversation purpose`, {
        error: purposeErr.message,
        conversationId,
      });
      // Continue without purpose
    }

    // Get conversation topics
    try {
      conversationTopics = await ConversationIntelligence.getConversationTopics(
        conversationId
      );
      logMessage(
        "DEBUG",
        `Retrieved ${conversationTopics.length} conversation topics`
      );
    } catch (topicsErr) {
      logMessage("WARN", `Failed to retrieve conversation topics`, {
        error: topicsErr.message,
        conversationId,
      });
      // Continue with empty topics
      conversationTopics = [];
    }

    // 3. Generate overall conversation summary
    let summary = "";
    try {
      summary = await ConversationIntelligence.summarizeConversation(
        conversationId
      );
      logMessage("INFO", `Generated conversation summary`, {
        summaryLength: summary.length,
      });
    } catch (summaryErr) {
      logMessage("WARN", `Failed to generate conversation summary`, {
        error: summaryErr.message,
        conversationId,
      });
      // Use a basic summary as fallback
      summary = `Conversation ${conversationId} with ${conversationHistory.length} messages`;
    }

    // 4. Record conversation_end event in the timeline
    try {
      await TimelineManagerLogic.recordEvent(
        "conversation_end",
        {
          summary,
          purpose: conversationPurpose,
          topics: conversationTopics.length,
          outcome,
        },
        [], // No specific entities for conversation end
        conversationId
      );
      logMessage("DEBUG", `Recorded conversation_end event in timeline`);
    } catch (timelineErr) {
      logMessage("WARN", `Failed to record conversation_end event`, {
        error: timelineErr.message,
        conversationId,
      });
      // Continue despite timeline error
    }

    // 5. Initialize result objects
    let extractedLearnings = null;
    let promotedPatterns = null;
    let relatedConversations = null;
    let nextSteps = null;

    // 6. Extract learnings if requested
    if (extractLearnings) {
      try {
        logMessage("INFO", `Extracting learnings from conversation`);
        extractedLearnings = await _extractConversationLearnings(
          conversationId,
          conversationHistory
        );
        logMessage(
          "INFO",
          `Extracted ${
            extractedLearnings?.patterns?.length || 0
          } patterns and ${
            extractedLearnings?.bugPatterns?.length || 0
          } bug patterns`
        );
      } catch (learningErr) {
        logMessage("WARN", `Failed to extract learnings`, {
          error: learningErr.message,
          conversationId,
        });
        // Continue without learnings
        extractedLearnings = {
          patterns: [],
          bugPatterns: [],
          conceptualInsights: [],
          error: learningErr.message,
        };
      }
    } else {
      logMessage("DEBUG", `Skipping learning extraction (not requested)`);
    }

    // 7. Promote patterns if requested
    if (promotePatterns) {
      try {
        logMessage("INFO", `Promoting patterns from conversation`);
        promotedPatterns = await _promoteConversationPatterns(
          conversationId,
          outcome
        );
        logMessage("INFO", `Promoted ${promotedPatterns?.count || 0} patterns`);
      } catch (patternErr) {
        logMessage("WARN", `Failed to promote patterns`, {
          error: patternErr.message,
          conversationId,
        });
        // Continue without pattern promotion
        promotedPatterns = {
          count: 0,
          patterns: [],
          error: patternErr.message,
        };
      }
    } else {
      logMessage("DEBUG", `Skipping pattern promotion (not requested)`);
    }

    // 8. Synthesize related topics if requested
    if (synthesizeRelatedTopics) {
      try {
        logMessage("INFO", `Finding and synthesizing related conversations`);
        relatedConversations = await _findAndSynthesizeRelatedConversations(
          conversationId,
          conversationTopics,
          conversationPurpose
        );
        logMessage(
          "INFO",
          `Found ${
            relatedConversations?.conversations?.length || 0
          } related conversations`
        );
      } catch (relatedErr) {
        logMessage("WARN", `Failed to synthesize related conversations`, {
          error: relatedErr.message,
          conversationId,
        });
        // Continue without related conversations
        relatedConversations = {
          conversations: [],
          insights: [],
          error: relatedErr.message,
        };
      }
    } else {
      logMessage("DEBUG", `Skipping related topic synthesis (not requested)`);
    }

    // 9. Generate next step suggestions if requested
    if (generateNextSteps) {
      try {
        logMessage("INFO", `Generating next step suggestions`);
        nextSteps = await _generateNextStepSuggestions(
          conversationId,
          conversationPurpose,
          summary,
          extractedLearnings
        );
        logMessage(
          "INFO",
          `Generated ${
            nextSteps?.suggestions?.length || 0
          } next step suggestions`
        );
      } catch (nextStepsErr) {
        logMessage("WARN", `Failed to generate next step suggestions`, {
          error: nextStepsErr.message,
          conversationId,
        });
        // Continue without next steps
        nextSteps = {
          suggestions: [],
          error: nextStepsErr.message,
        };
      }
    } else {
      logMessage("DEBUG", `Skipping next step generation (not requested)`);
    }

    // 10. Clear active context if requested
    if (clearActiveContext) {
      try {
        await ActiveContextManager.clearActiveContext();
        logMessage("INFO", `Cleared active context`);
      } catch (clearErr) {
        logMessage("WARN", `Failed to clear active context`, {
          error: clearErr.message,
        });
        // Continue despite error
      }
    }

    // Mark all active conversation purposes as ended
    try {
      const currentTime = new Date().toISOString();
      const updatePurposeQuery = `
        UPDATE conversation_purposes
        SET end_timestamp = ?
        WHERE conversation_id = ? AND end_timestamp IS NULL
      `;
      await executeQuery(updatePurposeQuery, [currentTime, conversationId]);
      logMessage("INFO", `Marked all active conversation purposes as ended`);

      // Check if we have any purpose records at all for this conversation
      const checkPurposeQuery = `
        SELECT COUNT(*) as count FROM conversation_purposes 
        WHERE conversation_id = ?
      `;
      const purposeCount = await executeQuery(checkPurposeQuery, [
        conversationId,
      ]);
      const hasAnyPurpose = purposeCount?.rows?.[0]?.count > 0;

      // If no purpose exists, create a general_query purpose that's already ended
      if (!hasAnyPurpose) {
        const purposeId = uuidv4();
        const startTime = new Date(Date.now() - 60000).toISOString(); // 1 minute ago

        const insertPurposeQuery = `
          INSERT INTO conversation_purposes (
            purpose_id, conversation_id, purpose_type, confidence,
            start_timestamp, end_timestamp, metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `;

        await executeQuery(insertPurposeQuery, [
          purposeId,
          conversationId,
          "general_query",
          0.8,
          startTime,
          currentTime,
          JSON.stringify({ source: "finalization", outcome }),
        ]);

        logMessage(
          "INFO",
          `Created general_query purpose record for finalization`
        );
      }
    } catch (purposeErr) {
      logMessage("WARN", `Failed to finalize conversation purposes`, {
        error: purposeErr.message,
        conversationId,
      });
      // Continue despite purpose update error
    }

    // 11. Return the finalized conversation data
    logMessage(
      "INFO",
      `finalize_conversation_context tool completed successfully`
    );

    const responseData = {
      message: `Conversation ${conversationId} finalized successfully with outcome: ${outcome}`,
      status: "success",
      summary,
      purpose: conversationPurpose || "Unknown purpose",
      extractedLearnings,
      promotedPatterns,
      relatedConversations,
      nextSteps,
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
    logMessage("ERROR", `Error in finalize_conversation_context tool`, {
      error: error.message,
      stack: error.stack,
      input: {
        conversationId: input.conversationId,
        outcome: input.outcome,
      },
    });

    // Return error response
    const errorResponse = {
      error: true,
      errorCode: error.code || "FINALIZATION_FAILED",
      errorDetails: error.message,
      summary: "Failed to finalize conversation context",
      purpose: "Unknown due to error",
      extractedLearnings: null,
      promotedPatterns: null,
      relatedConversations: null,
      nextSteps: null,
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
 * Extracts learnings from a conversation history - patterns, bugs, etc.
 *
 * @param {string} conversationId - Conversation ID
 * @param {boolean} extractPatterns - Whether to extract code patterns
 * @param {boolean} promotePatterns - Whether to promote high-quality patterns to global
 * @returns {Promise<{patternCount: number, bugPatternCount: number}>} Counts of extracted items
 */
async function _extractConversationLearnings(
  conversationId,
  extractPatterns = true,
  promotePatterns = false
) {
  try {
    logMessage("INFO", "Extracting learnings from conversation");

    let patternCount = 0;
    let bugPatternCount = 0;

    // 1. Extract code patterns if requested
    if (extractPatterns) {
      try {
        const extractedPatterns =
          await LearningSystems.extractPatternsFromConversation(conversationId);
        if (extractedPatterns && extractedPatterns.length > 0) {
          patternCount = extractedPatterns.length;

          // Store patterns
          // TODO: Add storage logic here

          // Promote patterns if requested
          if (promotePatterns && extractedPatterns.length > 0) {
            // TODO: Add promotion logic here
          }
        }
      } catch (error) {
        logMessage("WARN", `Failed to extract patterns: ${error.message}`);
      }
    }

    // 2. Extract bug patterns (always do this)
    try {
      const bugPatterns =
        await LearningSystems.extractBugPatternsFromConversation(
          conversationId
        );
      if (bugPatterns && bugPatterns.length > 0) {
        bugPatternCount = bugPatterns.length;

        // Store bug patterns
        // TODO: Add storage logic here
      }
    } catch (error) {
      logMessage("WARN", `Failed to extract bug patterns: ${error.message}`);
    }

    // 3. Extract key-value pairs for potential knowledge base entries
    try {
      const keyValuePairs = await LearningSystems.extractKeyValuePairs(
        conversationId
      );
      if (keyValuePairs && keyValuePairs.length > 0) {
        // Store key-value pairs
        // TODO: Add storage logic here
      }
    } catch (error) {
      logMessage("WARN", `Failed to extract key-value pairs: ${error.message}`);
    }

    logMessage(
      "INFO",
      `Extracted ${patternCount} patterns and ${bugPatternCount} bug patterns`
    );

    return {
      patternCount,
      bugPatternCount,
    };
  } catch (error) {
    logMessage(
      "ERROR",
      `Error extracting conversation learnings: ${error.message}`
    );
    return {
      patternCount: 0,
      bugPatternCount: 0,
    };
  }
}

/**
 * Extract conceptual insights from message content
 *
 * @param {Array} userMessages - User messages from the conversation
 * @param {Array} assistantMessages - Assistant messages from the conversation
 * @returns {Promise<Array>} Extracted conceptual insights
 * @private
 */
async function _extractConcepts(userMessages, assistantMessages) {
  try {
    logMessage(
      "DEBUG",
      `Extracting concepts from ${userMessages.length} user messages and ${assistantMessages.length} assistant messages`
    );

    // Combine message content for processing
    const userContent = userMessages.map((msg) => msg.content).join("\n");
    const assistantContent = assistantMessages
      .map((msg) => msg.content)
      .join("\n");

    // Tokenize content to extract key terms
    const userTokens = TextTokenizerLogic.tokenize(userContent);
    const assistantTokens = TextTokenizerLogic.tokenize(assistantContent);

    // Get top terms by frequency
    const userTerms = _getTopTermsByFrequency(userTokens, 20);
    const assistantTerms = _getTopTermsByFrequency(assistantTokens, 20);

    // Find common terms that appear in both user and assistant messages
    const commonTerms = userTerms.filter((term) =>
      assistantTerms.some((aterm) => aterm.term === term.term)
    );

    // Extract domain-specific insights
    const domainInsights = commonTerms.map((term) => {
      // Find relevant snippets containing this term
      const snippets = _findRelevantSnippets(
        [...userMessages, ...assistantMessages],
        term.term
      );

      return {
        concept: term.term,
        frequency: term.frequency,
        importance: term.frequency / userTokens.length, // Simple importance heuristic
        relatedTerms: assistantTerms
          .filter(
            (aterm) =>
              _areTermsRelated(term.term, aterm.term) &&
              aterm.term !== term.term
          )
          .map((aterm) => aterm.term)
          .slice(0, 5),
        snippets: snippets.slice(0, 3), // Limit to 3 snippets
      };
    });

    logMessage("DEBUG", `Extracted ${domainInsights.length} domain insights`);
    return domainInsights;
  } catch (error) {
    logMessage("ERROR", `Error extracting concepts`, {
      error: error.message,
    });
    throw error;
  }
}

/**
 * Gets the top terms by frequency from a list of tokens
 *
 * @param {Array} tokens - Array of tokens
 * @param {number} limit - Maximum number of terms to return
 * @returns {Array} Array of objects containing term and frequency
 * @private
 */
function _getTopTermsByFrequency(tokens, limit = 20) {
  try {
    if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
      return [];
    }

    // Count term frequencies
    const termCounts = {};
    for (const token of tokens) {
      if (token && typeof token === "string" && token.length > 2) {
        // Skip very short tokens
        const term = token.toLowerCase();
        termCounts[term] = (termCounts[term] || 0) + 1;
      }
    }

    // Convert to array and sort by frequency
    const sortedTerms = Object.entries(termCounts)
      .map(([term, frequency]) => ({ term, frequency }))
      .sort((a, b) => b.frequency - a.frequency);

    // Return top terms
    return sortedTerms.slice(0, limit);
  } catch (error) {
    logMessage("ERROR", `Error getting top terms by frequency`, {
      error: error.message,
    });
    return [];
  }
}

/**
 * Checks if two terms are related
 *
 * @param {string} term1 - First term
 * @param {string} term2 - Second term
 * @returns {boolean} True if the terms are related
 * @private
 */
function _areTermsRelated(term1, term2) {
  // Simple relation check - one term contains the other
  return term1.includes(term2) || term2.includes(term1);
}

/**
 * Finds snippets in messages that contain a specific term
 *
 * @param {Array} messages - Messages to search
 * @param {string} term - Term to search for
 * @returns {Array} Relevant snippets
 * @private
 */
function _findRelevantSnippets(messages, term) {
  try {
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return [];
    }

    const snippets = [];
    const termRegex = new RegExp(`\\b${term}\\b`, "i");

    for (const message of messages) {
      if (!message.content) continue;

      // If term found in message
      if (termRegex.test(message.content)) {
        // Extract a snippet around the term
        const sentences = message.content.split(/[.!?]+/);
        for (const sentence of sentences) {
          if (termRegex.test(sentence)) {
            snippets.push({
              text: sentence.trim(),
              role: message.role,
              messageId: message.message_id || message.messageId,
            });
          }
        }
      }
    }

    return snippets;
  } catch (error) {
    logMessage("WARN", `Error finding relevant snippets`, {
      error: error.message,
    });
    return [];
  }
}

/**
 * Promotes patterns from a conversation to the global pattern repository
 *
 * @param {string} conversationId - The ID of the conversation
 * @param {string} outcome - The outcome of the conversation
 * @returns {Promise<Object>} Promoted patterns data
 * @private
 */
async function _promoteConversationPatterns(conversationId, outcome) {
  try {
    console.log(
      `[_promoteConversationPatterns] Promoting patterns for conversation ${conversationId}`
    );

    // 1. Extract patterns from the conversation
    const patterns = await LearningSystems.extractPatternsFromConversation(
      conversationId
    );

    if (!patterns || patterns.length === 0) {
      console.log(
        `[_promoteConversationPatterns] No patterns found in conversation ${conversationId}`
      );
      return {
        promoted: 0,
        patterns: [],
      };
    }

    console.log(
      `[_promoteConversationPatterns] Found ${patterns.length} patterns to evaluate for promotion`
    );

    // 2. Prepare data for tracking promotion results
    const promotedPatterns = {
      promoted: 0,
      patterns: [],
    };

    // Set minimum confidence threshold based on outcome
    let minConfidence = 0.5; // Default threshold
    if (outcome === "completed") minConfidence = 0.6;
    if (outcome === "abandoned") minConfidence = 0.7; // Higher threshold for abandoned conversations

    // 3. Process each pattern for potential promotion
    for (const pattern of patterns) {
      try {
        // Skip patterns that are already global
        if (pattern.is_global) {
          promotedPatterns.patterns.push({
            patternId: pattern.pattern_id,
            name: pattern.name,
            type: pattern.pattern_type,
            promoted: false,
            confidence: pattern.confidence_score,
          });
          continue;
        }

        // Skip patterns with confidence below threshold
        if (pattern.confidence_score < minConfidence) {
          promotedPatterns.patterns.push({
            patternId: pattern.pattern_id,
            name: pattern.name,
            type: pattern.pattern_type,
            promoted: false,
            confidence: pattern.confidence_score,
          });
          continue;
        }

        // Promote pattern to global repository
        await GlobalPatternRepository.promotePatternToGlobal(
          pattern.pattern_id,
          pattern.confidence_score
        );

        // Reinforce the pattern based on conversation outcome
        const observationType =
          outcome === "completed" || outcome === "reference_only"
            ? "confirmation"
            : "usage";

        await GlobalPatternRepository.reinforcePattern(
          pattern.pattern_id,
          observationType,
          { conversationId }
        );

        // Record successful promotion
        promotedPatterns.promoted++;
        promotedPatterns.patterns.push({
          patternId: pattern.pattern_id,
          name: pattern.name,
          type: pattern.pattern_type,
          promoted: true,
          confidence: pattern.confidence_score,
        });

        console.log(
          `[_promoteConversationPatterns] Successfully promoted pattern ${pattern.pattern_id}`
        );
      } catch (error) {
        console.warn(
          `[_promoteConversationPatterns] Error processing pattern ${pattern.pattern_id}:`,
          error
        );
        // Continue with next pattern
      }
    }

    console.log(
      `[_promoteConversationPatterns] Promoted ${promotedPatterns.promoted} patterns to global repository`
    );
    return promotedPatterns;
  } catch (error) {
    console.error(
      `[_promoteConversationPatterns] Error promoting patterns:`,
      error
    );
    return {
      promoted: 0,
      patterns: [],
      error: error.message,
    };
  }
}

/**
 * Finds and synthesizes insights from related conversations
 *
 * @param {string} conversationId - The ID of the current conversation
 * @param {Array} conversationTopics - Topics from the current conversation
 * @param {string} conversationPurpose - Purpose of the current conversation
 * @returns {Promise<Object>} Related conversations data with synthesized insights
 * @private
 */
async function _findAndSynthesizeRelatedConversations(
  conversationId,
  conversationTopics,
  conversationPurpose
) {
  try {
    console.log(
      `[_findAndSynthesizeRelatedConversations] Finding related conversations for ${conversationId}`
    );

    // 1. Extract keywords from conversation topics
    const topicKeywords = new Set();

    // Ensure conversationTopics is an array before using forEach
    if (conversationTopics && Array.isArray(conversationTopics)) {
      conversationTopics.forEach((topic) => {
        if (topic.keywords && Array.isArray(topic.keywords)) {
          topic.keywords.forEach((kw) => topicKeywords.add(kw));
        }
      });
    } else {
      console.warn(
        `[_findAndSynthesizeRelatedConversations] conversationTopics is not an array:`,
        typeof conversationTopics
      );
    }

    const keywordArray = Array.from(topicKeywords);

    // 2. Get recent conversation events from timeline (excluding current conversation)
    const recentConversationEvents = await TimelineManagerLogic.getEvents({
      types: ["conversation_end", "conversation_completed"],
      limit: 10,
      excludeConversationId: conversationId,
    });

    if (!recentConversationEvents || recentConversationEvents.length === 0) {
      console.log(
        `[_findAndSynthesizeRelatedConversations] No recent conversations found to compare`
      );
      return {
        relatedCount: 0,
        conversations: [],
        synthesizedInsights: [],
      };
    }

    // 3. Score conversations by relevance
    const scoredConversations = [];

    for (const event of recentConversationEvents) {
      try {
        if (!event.data || !event.conversation_id) continue;

        // Get conversation topics for comparison
        const eventTopics =
          await ConversationIntelligence.getConversationTopics(
            event.conversation_id
          );

        // Extract keywords from event topics
        const eventKeywords = new Set();

        // Ensure eventTopics is an array before using forEach
        if (eventTopics && Array.isArray(eventTopics)) {
          eventTopics.forEach((topic) => {
            if (topic.keywords && Array.isArray(topic.keywords)) {
              topic.keywords.forEach((kw) => eventKeywords.add(kw));
            }
          });
        } else {
          console.warn(
            `[_findAndSynthesizeRelatedConversations] eventTopics for ${event.conversation_id} is not an array`
          );
          continue; // Skip this event if topics aren't available
        }

        // Calculate keyword overlap (Jaccard similarity)
        const overlapCount = keywordArray.filter((kw) =>
          eventKeywords.has(kw)
        ).length;
        const totalUniqueKeywords = new Set([...keywordArray, ...eventKeywords])
          .size;

        const similarityScore =
          totalUniqueKeywords > 0 ? overlapCount / totalUniqueKeywords : 0;

        // Find common topics by name
        const commonTopics = [];

        // Make sure both are arrays before finding common topics
        if (
          eventTopics &&
          Array.isArray(eventTopics) &&
          conversationTopics &&
          Array.isArray(conversationTopics)
        ) {
          eventTopics.forEach((eventTopic) => {
            conversationTopics.forEach((currentTopic) => {
              if (
                eventTopic.topic_name &&
                currentTopic.topic_name &&
                eventTopic.topic_name.toLowerCase() ===
                  currentTopic.topic_name.toLowerCase()
              ) {
                commonTopics.push(eventTopic.topic_name);
              }
            });
          });
        }

        // Only consider conversations with some similarity
        if (similarityScore > 0.2 || commonTopics.length > 0) {
          scoredConversations.push({
            conversationId: event.conversation_id,
            summary: event.data.summary || "No summary available",
            timestamp: event.timestamp,
            similarityScore,
            commonTopics,
          });
        }
      } catch (error) {
        console.warn(
          `[_findAndSynthesizeRelatedConversations] Error processing event ${event.event_id}:`,
          error
        );
        // Continue with next event
      }
    }

    // Sort by similarity score descending
    scoredConversations.sort((a, b) => b.similarityScore - a.similarityScore);

    // Limit to top 5 most similar
    const relatedConversations = scoredConversations.slice(0, 5);

    console.log(
      `[_findAndSynthesizeRelatedConversations] Found ${relatedConversations.length} related conversations`
    );

    // 4. Synthesize insights from related conversations
    const synthesizedInsights =
      await _synthesizeInsightsFromRelatedConversations(
        relatedConversations,
        conversationPurpose
      );

    return {
      relatedCount: relatedConversations.length,
      conversations: relatedConversations,
      synthesizedInsights,
    };
  } catch (error) {
    console.error(
      `[_findAndSynthesizeRelatedConversations] Error finding related conversations:`,
      error
    );
    return {
      relatedCount: 0,
      conversations: [],
      synthesizedInsights: [],
      error: error.message,
    };
  }
}

/**
 * Synthesizes insights from related conversations
 *
 * @param {Array} relatedConversations - Array of related conversation data
 * @param {string} currentPurpose - Purpose of the current conversation
 * @returns {Promise<Array>} Array of synthesized insights by topic
 * @private
 */
async function _synthesizeInsightsFromRelatedConversations(
  relatedConversations,
  currentPurpose
) {
  try {
    // If no related conversations, return empty insights
    if (!relatedConversations || relatedConversations.length === 0) {
      return [];
    }

    // Group conversations by common topics
    const conversationsByTopic = {};

    // First, identify common topics across conversations
    relatedConversations.forEach((conversation) => {
      if (conversation.commonTopics && conversation.commonTopics.length > 0) {
        conversation.commonTopics.forEach((topic) => {
          if (!conversationsByTopic[topic]) {
            conversationsByTopic[topic] = [];
          }
          conversationsByTopic[topic].push(conversation);
        });
      }
    });

    // If there are no common topics, create a synthetic topic based on purpose
    if (Object.keys(conversationsByTopic).length === 0 && currentPurpose) {
      const syntheticTopic = `Conversations about ${currentPurpose}`;
      conversationsByTopic[syntheticTopic] = relatedConversations;
    }

    // Generate insights for each topic group
    const insights = [];

    for (const [topic, conversations] of Object.entries(conversationsByTopic)) {
      // Only synthesize if we have enough conversations on this topic
      if (conversations.length >= 2) {
        // Combine summaries for synthesis
        const combinedSummaries = conversations
          .map((c) => c.summary)
          .join(" | ");

        // Generate synthesized insight using ContextCompressorLogic
        const insight = await ContextCompressorLogic.summarizeText(
          combinedSummaries,
          {
            targetLength: 150,
            preserveKeyPoints: true,
          }
        );

        insights.push({
          topic,
          insight,
          conversationCount: conversations.length,
          sourceSummaries: conversations.map((c) => ({
            conversationId: c.conversationId,
            summary: c.summary,
          })),
        });
      }
    }

    return insights;
  } catch (error) {
    console.error(
      `[_synthesizeInsightsFromRelatedConversations] Error synthesizing insights:`,
      error
    );
    return [];
  }
}

/**
 * Generates next step suggestions based on conversation analysis
 *
 * @param {string} conversationId - The ID of the conversation
 * @param {string|Object} purpose - The purpose of the conversation (string or object with purposeType)
 * @param {string} summary - The conversation summary
 * @param {Object} extractedLearnings - The extracted learnings from the conversation
 * @returns {Promise<Object>} Next steps recommendations
 * @private
 */
async function _generateNextStepSuggestions(
  conversationId,
  purpose,
  summary,
  extractedLearnings
) {
  try {
    console.log(
      `[_generateNextStepSuggestions] Generating next steps for conversation ${conversationId}`
    );

    // Initialize results
    const result = {
      suggestedNextSteps: [],
      followUpTopics: [],
      referenceMaterials: [],
    };

    // 1. Extract key terms from summary for searching reference materials
    const tokens = TextTokenizerLogic.tokenize(summary);
    const keywords = TextTokenizerLogic.extractKeywords(tokens, 10);

    // Extract purposeType from purpose object or use purpose directly if it's a string
    let purposeType = "general_query"; // Default purpose type

    if (purpose) {
      if (typeof purpose === "string") {
        purposeType = purpose;
      } else if (typeof purpose === "object" && purpose.purposeType) {
        purposeType = purpose.purposeType;
      } else if (typeof purpose === "object" && purpose.purpose_type) {
        purposeType = purpose.purpose_type;
      }
    }

    console.log(
      `[_generateNextStepSuggestions] Using purpose type: ${purposeType}`
    );

    // Use purpose to determine likely next steps
    let nextSteps = [];
    let followUpTopics = [];

    if (purposeType) {
      // Convert purposeType to lowercase string for safer comparison
      const purposeTypeLower =
        typeof purposeType === "string"
          ? purposeType.toLowerCase()
          : "general_query";

      // Different next steps based on conversation purpose
      switch (purposeTypeLower) {
        case "debugging":
        case "bug_fixing":
          nextSteps.push({
            action: "Create a test case that verifies the bug fix",
            priority: "high",
            rationale: "Ensure the bug doesn't reoccur in the future",
          });
          nextSteps.push({
            action: "Document the root cause and solution",
            priority: "medium",
            rationale: "Help prevent similar issues in the future",
          });
          break;

        case "feature_planning":
        case "design_discussion":
          nextSteps.push({
            action: "Create tickets/tasks for implementation work",
            priority: "high",
            rationale: "Break down the feature into manageable pieces",
          });
          nextSteps.push({
            action: "Draft initial implementation plan with milestones",
            priority: "medium",
            rationale: "Establish a timeline and checkpoints",
          });
          break;

        case "code_review":
          nextSteps.push({
            action: "Address feedback points and resubmit for review",
            priority: "high",
            rationale: "Incorporate the suggested improvements",
          });
          nextSteps.push({
            action: "Update documentation to reflect changes",
            priority: "medium",
            rationale: "Keep documentation in sync with code",
          });
          break;

        case "onboarding":
        case "knowledge_sharing":
          nextSteps.push({
            action: "Create summary documentation of discussed topics",
            priority: "high",
            rationale: "Solidify knowledge transfer",
          });
          nextSteps.push({
            action: "Schedule follow-up session for additional questions",
            priority: "medium",
            rationale: "Address remaining questions after initial processing",
          });
          break;

        default:
          // Generic next steps
          nextSteps.push({
            action: "Document key decisions from the conversation",
            priority: "medium",
            rationale: "Preserve important context for future reference",
          });
      }
    }

    // 2. Add follow-up topics based on extracted learnings
    if (extractedLearnings && extractedLearnings.learnings) {
      // Find design decisions that may need follow-up
      const designDecisions = extractedLearnings.learnings.filter(
        (l) => l.type === "design_decision"
      );

      if (designDecisions.length > 0) {
        const highConfidenceDecisions = designDecisions
          .filter((d) => d.confidence >= 0.7)
          .slice(0, 2);

        highConfidenceDecisions.forEach((decision) => {
          followUpTopics.push({
            topic: `Implementation details for: ${decision.content}`,
            priority: "high",
            rationale: "Turn design decision into concrete implementation",
          });
        });
      }

      // Find bug patterns that may need follow-up
      const bugPatterns = extractedLearnings.learnings.filter(
        (l) => l.type === "bug_pattern"
      );

      if (bugPatterns.length > 0) {
        const criticalBugs = bugPatterns
          .filter((b) => b.confidence >= 0.8)
          .slice(0, 2);

        criticalBugs.forEach((bug) => {
          followUpTopics.push({
            topic: `Root cause analysis for: ${bug.content}`,
            priority: "medium",
            rationale: "Prevent similar bugs in the future",
          });
        });
      }
    }

    // 3. Search for reference materials based on keywords
    try {
      // Only proceed with search if keywords are valid strings
      const validKeywords = Array.isArray(keywords)
        ? keywords.filter((kw) => typeof kw === "string")
        : [];

      if (validKeywords.length > 0) {
        const referenceResults = await SmartSearchServiceLogic.searchByKeywords(
          validKeywords,
          {
            fileTypes: ["md", "txt", "rst", "pdf", "doc"],
            maxResults: 5,
            searchDocumentation: true,
          }
        );

        const referenceMaterials = referenceResults.map((result) => ({
          title: result.name || result.file_path || "Unnamed reference",
          path: result.file_path,
          type: result.entity_type || "document",
          relevance: result.score || 0.5,
        }));

        result.referenceMaterials = referenceMaterials;
      }
    } catch (error) {
      console.error(`Error in searchByKeywords:`, error);
      // Continue with empty reference materials
    }

    // 4. Combine all results
    result.suggestedNextSteps = nextSteps;
    result.followUpTopics = followUpTopics;

    console.log(
      `[_generateNextStepSuggestions] Generated ${nextSteps.length} next steps and ${followUpTopics.length} follow-up topics`
    );

    return result;
  } catch (error) {
    console.error(
      `[_generateNextStepSuggestions] Error generating next steps:`,
      error
    );
    return {
      suggestedNextSteps: [],
      followUpTopics: [],
      referenceMaterials: [],
      error: error.message,
    };
  }
}

// Export the tool definition for server registration
export default {
  name: "finalize_conversation_context",
  description:
    "Finalizes a conversation context, extracting learnings, promoting patterns, and generating insights",
  inputSchema: finalizeConversationContextInputSchema,
  outputSchema: finalizeConversationContextOutputSchema,
  handler,
};
