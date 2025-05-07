/**
 * LearningSystems.js
 *
 * Provides functionality for extracting patterns, insights and learnings from conversations.
 */

import * as ConversationIntelligence from "./ConversationIntelligence.js";

/**
 * Extracts patterns from a conversation's history
 *
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<Array>} Array of extracted patterns
 */
export async function extractPatternsFromConversation(conversationId) {
  try {
    console.log(
      `[LearningSystem] Extracting patterns from conversation ${conversationId}`
    );

    // Fetch the conversation history
    const conversationHistory =
      await ConversationIntelligence.getConversationHistory(
        conversationId,
        50, // Limit to the most recent 50 messages
        0 // No offset
      );

    if (!conversationHistory || conversationHistory.length === 0) {
      console.log(
        `[LearningSystem] No messages found in conversation ${conversationId}`
      );
      return [];
    }

    // For now, return an empty array since this is a placeholder implementation
    // In a real implementation, we would have logic to detect code patterns
    return [];
  } catch (error) {
    console.error(
      `[LearningSystem] Error extracting patterns: ${error.message}`
    );
    return [];
  }
}

/**
 * Extracts bug patterns from a conversation's history
 *
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<Array>} Array of extracted bug patterns
 */
export async function extractBugPatternsFromConversation(conversationId) {
  try {
    console.log(
      `[LearningSystem] Extracting bug patterns from conversation ${conversationId}`
    );

    // Fetch the conversation history
    const conversationHistory =
      await ConversationIntelligence.getConversationHistory(
        conversationId,
        50, // Limit to the most recent 50 messages
        0 // No offset
      );

    if (!conversationHistory || conversationHistory.length === 0) {
      console.log(
        `[LearningSystem] No messages found in conversation ${conversationId}`
      );
      return [];
    }

    // Filter to focus on user messages about errors/bugs and assistant responses
    const errorKeywords = [
      "error",
      "bug",
      "issue",
      "problem",
      "crash",
      "fail",
      "exception",
      "TypeError",
      "undefined",
    ];

    // Find messages discussing errors
    const errorDiscussions = [];

    for (let i = 0; i < conversationHistory.length; i++) {
      const message = conversationHistory[i];

      // Check if this is a user message mentioning errors
      if (
        message.role === "user" &&
        errorKeywords.some((keyword) =>
          message.content.toLowerCase().includes(keyword)
        )
      ) {
        // If this has a response, create a pair
        if (
          i + 1 < conversationHistory.length &&
          conversationHistory[i + 1].role === "assistant"
        ) {
          errorDiscussions.push({
            errorMessage: message.content,
            solutionMessage: conversationHistory[i + 1].content,
          });
        }
      }
    }

    // Convert these discussions into bug patterns
    const bugPatterns = errorDiscussions.map((discussion, index) => {
      // Extract the error description from the user message
      const errorDescription = discussion.errorMessage.substring(0, 100);

      // Extract the solution from the assistant message
      const solution = discussion.solutionMessage.substring(0, 150);

      // Generate a reasonable name based on the error
      let name = `Bug Pattern ${index + 1}`;

      // Find specific error types mentioned in the message
      const errorTypeMatches = discussion.errorMessage.match(
        /(TypeError|ReferenceError|SyntaxError|RangeError|Error):/
      );
      if (errorTypeMatches && errorTypeMatches[1]) {
        name = `${errorTypeMatches[1]} Pattern`;
      } else {
        // Or try to extract a key term
        const keyTerms = errorKeywords.filter((term) =>
          discussion.errorMessage.toLowerCase().includes(term)
        );

        if (keyTerms.length > 0) {
          name = `${
            keyTerms[0].charAt(0).toUpperCase() + keyTerms[0].slice(1)
          } Pattern`;
        }
      }

      // Create a complete bug pattern with all required fields
      return {
        name: name,
        description: errorDescription,
        solution: solution || "No specific solution identified",
        detected_at: new Date().toISOString(),
        source_conversation_id: conversationId,
        frequency: 1,
        confidence_score: 0.7,
      };
    });

    console.log(
      `[LearningSystem] Extracted ${bugPatterns.length} bug patterns from conversation ${conversationId}`
    );
    return bugPatterns;
  } catch (error) {
    console.error(
      `[LearningSystem] Error extracting bug patterns: ${error.message}`
    );
    return [];
  }
}

/**
 * Extracts key-value pairs from a conversation's history
 *
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<Array>} Array of extracted key-value pairs
 */
export async function extractKeyValuePairsFromConversation(conversationId) {
  try {
    console.log(
      `[LearningSystem] Extracting key-value pairs from conversation ${conversationId}`
    );

    // Fetch the conversation history
    const conversationHistory =
      await ConversationIntelligence.getConversationHistory(
        conversationId,
        50, // Limit to the most recent 50 messages
        0 // No offset
      );

    if (!conversationHistory || conversationHistory.length === 0) {
      console.log(
        `[LearningSystem] No messages found in conversation ${conversationId}`
      );
      return [];
    }

    // Key-value pairs are typically in formats like:
    // "X is Y", "X = Y", "X: Y", "The X of Y is Z"
    const keyValuePairs = [];

    // Simple pattern matching for key-value pairs
    const keyValuePatterns = [
      /(\w+[\s\w]*)\s+is\s+([\w\s]+)/i, // "X is Y"
      /(\w+[\s\w]*)\s*=\s*([\w\s]+)/i, // "X = Y"
      /(\w+[\s\w]*)\s*:\s*([\w\s]+)/i, // "X: Y"
      /the\s+(\w+[\s\w]*)\s+of\s+(\w+[\s\w]*)\s+is\s+([\w\s]+)/i, // "The X of Y is Z"
    ];

    // Extract key-value pairs from messages
    for (const message of conversationHistory) {
      const content = message.content || "";
      const sentences = content.split(/[.!?]+/);

      for (const sentence of sentences) {
        if (sentence.trim().length === 0) continue;

        // Try each pattern
        for (const pattern of keyValuePatterns) {
          const match = sentence.match(pattern);
          if (match) {
            if (pattern.toString().includes("of")) {
              // For "The X of Y is Z" pattern
              keyValuePairs.push({
                key: `${match[1].trim()} of ${match[2].trim()}`,
                value: match[3].trim(),
                confidence: 0.7,
                source: "conversation",
                source_id: conversationId,
                timestamp: new Date().toISOString(),
              });
            } else {
              // For other patterns
              keyValuePairs.push({
                key: match[1].trim(),
                value: match[2].trim(),
                confidence: 0.8,
                source: "conversation",
                source_id: conversationId,
                timestamp: new Date().toISOString(),
              });
            }
          }
        }
      }
    }

    console.log(
      `[LearningSystem] Extracted ${keyValuePairs.length} key-value pairs from conversation ${conversationId}`
    );
    return keyValuePairs;
  } catch (error) {
    console.error(
      `[LearningSystem] Error extracting key-value pairs: ${error.message}`
    );
    return [];
  }
}

/**
 * Extracts key-value pairs from conversation messages
 *
 * @param {string|Array} conversationIdOrMessages - The conversation ID or array of messages
 * @returns {Promise<Array>} Array of extracted key-value pairs
 */
export async function extractKeyValuePairs(conversationIdOrMessages) {
  try {
    let messages;

    // Check if input is a string (conversationId) or array (messages)
    if (typeof conversationIdOrMessages === "string") {
      console.log(
        `[LearningSystem] Extracting key-value pairs from conversation ${conversationIdOrMessages}`
      );

      // Get the conversation messages
      messages = await ConversationIntelligence.getConversationHistory(
        conversationIdOrMessages,
        50, // Limit to most recent 50 messages
        0 // No offset
      );
    } else if (Array.isArray(conversationIdOrMessages)) {
      messages = conversationIdOrMessages;
    } else {
      console.error(
        `[LearningSystem] Invalid input type for extractKeyValuePairs: ${typeof conversationIdOrMessages}`
      );
      return [];
    }

    // Return early if no messages found
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return [];
    }

    // Key-value pairs are typically in formats like:
    // "X is Y", "X = Y", "X: Y", "The X of Y is Z"
    const keyValuePairs = [];

    // Simple pattern matching for key-value pairs
    const keyValuePatterns = [
      /(\w+[\s\w]*)\s+is\s+([\w\s]+)/i, // "X is Y"
      /(\w+[\s\w]*)\s*=\s*([\w\s]+)/i, // "X = Y"
      /(\w+[\s\w]*)\s*:\s*([\w\s]+)/i, // "X: Y"
      /the\s+(\w+[\s\w]*)\s+of\s+(\w+[\s\w]*)\s+is\s+([\w\s]+)/i, // "The X of Y is Z"
    ];

    // Extract key-value pairs from messages
    for (const message of messages) {
      const content = message.content || "";
      const sentences = content.split(/[.!?]+/);

      for (const sentence of sentences) {
        if (sentence.trim().length === 0) continue;

        // Try each pattern
        for (const pattern of keyValuePatterns) {
          const match = sentence.match(pattern);
          if (match) {
            if (pattern.toString().includes("of")) {
              // For "The X of Y is Z" pattern
              keyValuePairs.push({
                key: `${match[1].trim()} of ${match[2].trim()}`,
                value: match[3].trim(),
                confidence: 0.7,
                source: "conversation",
                source_id:
                  typeof conversationIdOrMessages === "string"
                    ? conversationIdOrMessages
                    : message.conversation_id,
                timestamp: new Date().toISOString(),
              });
            } else {
              // For other patterns
              keyValuePairs.push({
                key: match[1].trim(),
                value: match[2].trim(),
                confidence: 0.8,
                source: "conversation",
                source_id:
                  typeof conversationIdOrMessages === "string"
                    ? conversationIdOrMessages
                    : message.conversation_id,
                timestamp: new Date().toISOString(),
              });
            }
          }
        }
      }
    }

    console.log(
      `[LearningSystem] Extracted ${keyValuePairs.length} key-value pairs`
    );
    return keyValuePairs;
  } catch (error) {
    console.error(
      `[LearningSystem] Error extracting key-value pairs: ${error.message}`
    );
    return [];
  }
}
