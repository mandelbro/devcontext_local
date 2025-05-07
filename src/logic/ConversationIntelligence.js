/**
 * ConversationIntelligence.js
 *
 * Provides logic for recording and analyzing conversation messages,
 * including semantic markers and sentiment indicators.
 */

import { executeQuery } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import * as TextTokenizerLogic from "./TextTokenizerLogic.js";
import * as ContextIndexerLogic from "./ContextIndexerLogic.js";
import * as ConversationSegmenter from "./ConversationSegmenter.js";
import * as ConversationPurposeDetector from "./ConversationPurposeDetector.js";
import * as ContextCompressorLogic from "./ContextCompressorLogic.js";
import { logMessage } from "../utils/logger.js";

/**
 * Records a message in the conversation history, extracting semantic markers and sentiment indicators.
 *
 * @param {string} messageContent - The content of the message
 * @param {string} role - The role of the sender (e.g., 'user', 'assistant')
 * @param {string} conversationId - The conversation ID
 * @param {string[]} [relatedContextEntityIds=[]] - Array of related context entity IDs
 * @param {string} [topicSegmentId] - Optional topic segment ID
 * @param {string} [userIntent] - Optional user intent for the message
 * @returns {Promise<string>} The ID of the recorded message
 */
export async function recordMessage(
  messageContent,
  role,
  conversationId,
  relatedContextEntityIds = [],
  topicSegmentId,
  userIntent
) {
  try {
    // 1. Generate message_id
    const message_id = uuidv4();
    const timestamp = new Date().toISOString();

    // Print detailed input parameters for debugging
    logMessage("info", "===== RECORD MESSAGE - START =====");
    logMessage("info", "Input parameters:");
    logMessage("info", "- message_id:", message_id);
    logMessage("info", "- conversation_id:", conversationId);
    logMessage("info", "- role:", role);
    logMessage(
      "info",
      "- content:",
      messageContent &&
        messageContent.substring(0, 50) +
          (messageContent.length > 50 ? "..." : "")
    );
    logMessage("info", "- timestamp:", timestamp);
    logMessage("info", "- topic_segment_id:", topicSegmentId || "null");
    logMessage("info", "- user_intent:", userIntent || "null");
    logMessage(
      "info",
      "- related_context_entity_ids:",
      JSON.stringify(relatedContextEntityIds || [])
    );

    // 2. Extract semantic markers (e.g., idioms, emphasis, question, etc.)
    let semantic_markers = [];
    if (role === "user" && TextTokenizerLogic.identifyLanguageSpecificIdioms) {
      // Always provide a language parameter, defaulting to "plaintext" if none is detected
      semantic_markers =
        TextTokenizerLogic.identifyLanguageSpecificIdioms(
          messageContent,
          "plaintext"
        ) || [];
    } else {
      // Fallback: simple keyword spotting for emphasis/questions
      if (messageContent.includes("!")) semantic_markers.push("emphasis");
      if (messageContent.includes("?")) semantic_markers.push("question");
    }

    // 3. Extract sentiment indicators (basic regex for positive/negative keywords)
    const positiveKeywords = [
      "great",
      "good",
      "excellent",
      "awesome",
      "love",
      "like",
      "well done",
      "thanks",
      "thank you",
      "perfect",
      "amazing",
      "fantastic",
      "nice",
      "happy",
      "success",
      "yay",
    ];
    const negativeKeywords = [
      "bad",
      "error",
      "fail",
      "hate",
      "problem",
      "issue",
      "bug",
      "broken",
      "wrong",
      "difficult",
      "hard",
      "annoy",
      "frustrate",
      "sad",
      "unhappy",
      "disappoint",
      "no",
      "not working",
      "doesn't work",
      "crash",
      "stuck",
    ];
    const foundPositive = positiveKeywords.filter((kw) =>
      messageContent.toLowerCase().includes(kw)
    );
    const foundNegative = negativeKeywords.filter((kw) =>
      messageContent.toLowerCase().includes(kw)
    );
    const sentiment_indicators = {
      positive_keywords: foundPositive,
      negative_keywords: foundNegative,
    };

    // Create the message object to be indexed
    const messageObject = {
      message_id,
      conversation_id: conversationId,
      role,
      content: messageContent,
      timestamp,
      relatedContextEntityIds: JSON.stringify(relatedContextEntityIds || []),
      summary: null,
      userIntent: userIntent || null,
      topicSegmentId: topicSegmentId || null,
      semantic_markers: JSON.stringify(semantic_markers),
      sentiment_indicators: JSON.stringify(sentiment_indicators),
    };

    logMessage("info", "Message object to be indexed:", {
      message_id: messageObject.message_id,
      conversation_id: messageObject.conversation_id,
      role: messageObject.role,
      topic_segment_id: messageObject.topicSegmentId,
      user_intent: messageObject.userIntent,
    });

    // 4. Call ContextIndexerLogic.indexConversationMessage
    await ContextIndexerLogic.indexConversationMessage(messageObject);

    logMessage("info", "===== RECORD MESSAGE - COMPLETE =====");
    logMessage("info", "Successfully recorded message with ID:", message_id);

    // 5. Return the message_id
    return message_id;
  } catch (error) {
    logMessage("error", "===== RECORD MESSAGE - ERROR =====");
    logMessage("error", "Failed to record message:", { error: error.message });
    logMessage("error", "Error stack:", { stack: error.stack });
    throw new Error("Failed to record message: " + error.message);
  }
}

/**
 * Detects if a new message represents a topic shift in the conversation.
 *
 * @param {string} newMessageContent - The content of the new message
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<boolean>} True if a topic shift is detected, false otherwise
 */
export async function detectTopicShift(newMessageContent, conversationId) {
  // Fetch recent conversation history (last 5-10 messages)
  const history = await getConversationHistory(conversationId, 10);
  // Build the new message object (assume role is 'user' for this context)
  const newMessage = { content: newMessageContent, role: "user" };
  // Delegate to ConversationSegmenter
  const isShift = await ConversationSegmenter.detectTopicShift(
    newMessage,
    history
  );
  return isShift;
}

/**
 * Gets all topics for a conversation, either as a flat list or hierarchical structure.
 *
 * @param {string} conversationId - The conversation ID
 * @param {boolean} [hierarchical=false] - Whether to return a hierarchical structure
 * @returns {Promise<Topic[] | {rootTopics: Topic[], topicMap: Record<string, Topic>}>}
 */
export async function getConversationTopics(
  conversationId,
  hierarchical = false
) {
  try {
    if (hierarchical) {
      // Use ConversationSegmenter to build hierarchy
      return await ConversationSegmenter.buildTopicHierarchy(conversationId);
    }
    // Flat list: query conversation_topics table
    const query = `
      SELECT * FROM conversation_topics
      WHERE conversation_id = ?
      ORDER BY start_timestamp ASC
    `;
    const result = await executeQuery(query, [conversationId]);

    // Check if result has rows property and it's not empty
    if (!result || !result.rows || result.rows.length === 0) {
      logMessage("info", `No topics found for conversation: ${conversationId}`);
      return [];
    }

    // Create new objects with parsed JSON fields instead of modifying the originals
    return result.rows.map((topic) => {
      const newTopic = { ...topic }; // Create a shallow copy

      try {
        // Parse JSON strings into new properties
        newTopic.primary_entities = topic.primary_entities
          ? JSON.parse(topic.primary_entities)
          : [];
        newTopic.keywords = topic.keywords ? JSON.parse(topic.keywords) : [];
      } catch (err) {
        logMessage(
          "warn",
          `Error parsing JSON fields in topic: ${err.message}`
        );
        newTopic.primary_entities = [];
        newTopic.keywords = [];
      }
      return newTopic;
    });
  } catch (error) {
    logMessage("warn", `Failed to retrieve conversation topics`, {
      error: error.message,
      conversationId,
    });
    // Return empty array on error
    return [];
  }
}

/**
 * Returns messages most relevant to a query, using keyword overlap and optional topic/purpose boosting.
 *
 * @param {string} query - The search query
 * @param {string} conversationId - The conversation ID
 * @param {Object} [options] - Optional filters and limit
 * @param {boolean} [options.purposeFilter] - Boost messages in active purpose
 * @param {boolean} [options.topicFilter] - Boost messages in active topic
 * @param {number} [options.limit] - Max number of results to return
 * @returns {Promise<Message[]>} Array of relevant messages
 */
export async function getRelevantConversationContext(
  query,
  conversationId,
  options = {}
) {
  // 1. Fetch all messages for the conversation (limit to 200 for performance)
  const allMessages = await getConversationHistory(conversationId, 200);
  if (!allMessages || allMessages.length === 0) return [];

  // 2. Tokenize query and extract keywords
  const queryTokens = TextTokenizerLogic.tokenize(query);
  const queryKeywords = new Set(
    TextTokenizerLogic.extractKeywords(queryTokens, 10)
  );

  // 3. Get active topic and purpose if needed
  let activeTopicId = null;
  let activePurpose = null;
  if (options.topicFilter) {
    const activeTopic =
      await ConversationSegmenter.getActiveTopicForConversation(conversationId);
    activeTopicId = activeTopic ? activeTopic.topic_id : null;
  }
  if (options.purposeFilter) {
    activePurpose = await ConversationPurposeDetector.getActivePurpose(
      conversationId
    );
  }

  // 4. Score each message
  const scoredMessages = allMessages.map((msg) => {
    // Tokenize and extract keywords from message content
    const msgTokens = TextTokenizerLogic.tokenize(msg.content || "");
    const msgKeywords = new Set(
      TextTokenizerLogic.extractKeywords(msgTokens, 10)
    );
    // Calculate Jaccard index (overlap / union)
    const intersection = new Set(
      [...queryKeywords].filter((x) => msgKeywords.has(x))
    );
    const union = new Set([...queryKeywords, ...msgKeywords]);
    let relevance = union.size > 0 ? intersection.size / union.size : 0;

    // Boost for topic
    if (
      options.topicFilter &&
      activeTopicId &&
      msg.topic_segment_id === activeTopicId
    ) {
      relevance += 0.2;
    }
    // Boost for purpose (if message timestamp falls within active purpose window)
    if (
      options.purposeFilter &&
      activePurpose &&
      activePurpose.start_timestamp
    ) {
      const msgTime = msg.timestamp || msg.created_at;
      if (
        msgTime >= activePurpose.start_timestamp &&
        (!activePurpose.end_timestamp || msgTime <= activePurpose.end_timestamp)
      ) {
        relevance += 0.15;
      }
    }
    return { ...msg, relevance };
  });

  // 5. Sort by relevance DESC
  scoredMessages.sort((a, b) => b.relevance - a.relevance);

  // 6. Apply limit
  const limit = options.limit || 10;
  const topMessages = scoredMessages.slice(0, limit);

  // 7. Remove temporary relevance field before returning
  return topMessages.map(({ relevance, ...msg }) => msg);
}

/**
 * Infers the type of development task being discussed in a conversation.
 *
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<string|null>} The inferred task type or null if not confident
 */
export async function getTaskTypeFromConversation(conversationId) {
  // 1. Classify the conversation
  const classification = await classifyConversation(conversationId);
  if (!classification || !classification.purpose) return null;

  const { purpose, confidence } = classification;

  // 2. Define mapping from purpose to task type
  const purposeToTaskType = {
    debugging: "bug_fixing",
    feature_planning: "new_feature_development",
    code_review: "code_review",
    learning: "research",
    code_generation: "implementation",
    optimization: "performance_optimization",
    refactoring: "refactoring",
    general_query: "research",
    documentation: "documentation",
    testing: "testing",
  };

  // 3. Heuristic: if confidence is low or purpose is too generic, return null or default
  if (confidence < 0.55 || purpose === "general_query") {
    return null;
  }

  // 4. Map purpose to task type
  const taskType = purposeToTaskType[purpose] || "general_development_task";
  return taskType;
}

/**
 * Provides purpose-specific summaries of different conversation segments.
 *
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<{purpose: string, summary: string}[]>} Array of summaries by purpose
 */
export async function getConversationSummaryByPurpose(conversationId) {
  // 1. Get purpose history
  const purposeHistory = await ConversationPurposeDetector.getPurposeHistory(
    conversationId
  );
  if (!purposeHistory || purposeHistory.length === 0) return [];

  const summaries = [];

  for (const segment of purposeHistory) {
    // 2. Fetch all messages in this purpose segment
    const query = `
      SELECT content FROM conversation_history
      WHERE conversation_id = ?
        AND timestamp >= ?
        ${segment.end_timestamp ? "AND timestamp <= ?" : ""}
      ORDER BY timestamp ASC
    `;
    const params = [conversationId, segment.start_timestamp];
    if (segment.end_timestamp) params.push(segment.end_timestamp);
    const messages = await executeQuery(query, params);
    if (!messages || messages.length === 0) continue;

    // 3. Concatenate message contents
    const concatenated = messages.map((m) => m.content).join(" ");

    // 4. Summarize using ContextCompressorLogic
    const summary = await ContextCompressorLogic.summarizeText(concatenated, {
      targetLength: 150,
      preserveKeyPoints: true,
    });

    summaries.push({
      purpose: segment.purpose_type,
      summary,
    });
  }

  return summaries;
}

/**
 * Generates an overall summary for an entire conversation.
 *
 * @param {string} conversationId - The conversation ID
 * @returns {Promise<string>} The generated summary
 */
export async function summarizeConversation(conversationId) {
  // 1. Fetch all messages for the conversation, ordered by timestamp ASC
  const query = `
    SELECT role, content FROM conversation_history
    WHERE conversation_id = ?
    ORDER BY timestamp ASC
  `;
  const messages = await executeQuery(query, [conversationId]);

  // Check if results has a rows property and it's an array
  if (
    !messages ||
    !messages.rows ||
    !Array.isArray(messages.rows) ||
    messages.rows.length === 0
  ) {
    logMessage(
      "warn",
      `No valid messages found for conversation ${conversationId}`
    );
    return "";
  }

  // 2. Concatenate messages as 'role: content' lines
  const concatenated = messages.rows
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  // 3. Summarize using ContextCompressorLogic
  const summary = await ContextCompressorLogic.summarizeText(concatenated, {
    targetLength: 250,
    preserveKeyPoints: true,
  });

  // 4. Return the summary string
  return summary;
}

/**
 * Initializes a new conversation in the system
 *
 * @param {string} conversationId - The conversation ID
 * @param {string} initialQuery - The initial query that started the conversation
 * @returns {Promise<void>}
 */
export async function initializeConversation(conversationId, initialQuery) {
  try {
    const timestamp = new Date().toISOString();
    let userMessageId = null; // Define outside the if block to make it available in the scope

    // First, record the user's initial query as a 'user' message
    if (initialQuery && initialQuery.trim()) {
      userMessageId = uuidv4();
      const userQuery = `
        INSERT INTO conversation_history (
          message_id,
          conversation_id, 
          role,
          content,
          timestamp,
          related_context_entity_ids,
          summary,
          user_intent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;

      await executeQuery(userQuery, [
        userMessageId,
        conversationId,
        "user", // Store as user role to properly track the user's input
        initialQuery,
        timestamp,
        JSON.stringify([]),
        "Initial user query",
        "start_conversation",
      ]);

      logMessage("info", `User query recorded with ID: ${userMessageId}`);
    }

    // Then create the system message to record conversation initialization
    const systemMessageId = uuidv4();
    const systemQuery = `
      INSERT INTO conversation_history (
        message_id,
        conversation_id, 
        role,
        content,
        timestamp,
        related_context_entity_ids,
        summary,
        user_intent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await executeQuery(systemQuery, [
      systemMessageId,
      conversationId,
      "system",
      initialQuery ? "Conversation started with query" : "Conversation started",
      timestamp,
      JSON.stringify([]),
      "Conversation initialization",
      "start_conversation",
    ]);

    // Initialize conversation purpose based on initial query
    if (initialQuery) {
      await ConversationPurposeDetector.detectInitialPurpose(
        conversationId,
        initialQuery
      );
    }

    // Create initial topic segment using the user message ID if available
    const messageIdForSegment = userMessageId || systemMessageId;

    await ConversationSegmenter.createNewTopicSegment(
      conversationId,
      messageIdForSegment,
      {
        name: "Initial conversation",
        description: initialQuery || "Conversation start",
        primaryEntities: [],
        keywords: [],
      }
    );

    logMessage("info", `Conversation initialized with ID: ${conversationId}`);
  } catch (error) {
    logMessage("error", "Error initializing conversation:", {
      error: error.message,
    });
    throw new Error("Failed to initialize conversation: " + error.message);
  }
}

/**
 * Gets the conversation history for a specific conversation ID
 *
 * @param {string} conversationId - The conversation ID
 * @param {number} [limit=50] - Maximum number of messages to return
 * @param {number} [offset=0] - Offset for pagination
 * @returns {Promise<Array>} Array of message objects
 */
export async function getConversationHistory(
  conversationId,
  limit = 50,
  offset = 0
) {
  try {
    if (!conversationId) {
      throw new Error("Conversation ID is required");
    }

    const query = `
      SELECT 
        message_id,
        conversation_id,
        role,
        content,
        timestamp,
        related_context_entity_ids,
        summary,
        user_intent,
        topic_segment_id,
        semantic_markers,
        sentiment_indicators
      FROM 
        conversation_history
      WHERE 
        conversation_id = ?
      ORDER BY 
        timestamp ASC
      LIMIT ? OFFSET ?
    `;

    const results = await executeQuery(query, [conversationId, limit, offset]);

    // Check if results has a rows property and it's an array
    if (!results || !results.rows || !Array.isArray(results.rows)) {
      logMessage(
        "warn",
        "No valid rows returned from conversation history query"
      );
      return [];
    }

    // Parse JSON fields
    return results.rows.map((message) => {
      try {
        // Map database column names to camelCase property names for API consistency
        const mappedMessage = {
          messageId: message.message_id,
          conversationId: message.conversation_id,
          role: message.role,
          content: message.content,
          timestamp: message.timestamp,
          relatedContextEntityIds: [],
          summary: message.summary,
          userIntent: message.user_intent,
          topicSegmentId: message.topic_segment_id,
          semanticMarkers: [],
          sentimentIndicators: {},
        };

        if (message.related_context_entity_ids) {
          mappedMessage.relatedContextEntityIds = JSON.parse(
            message.related_context_entity_ids
          );
        }

        if (message.semantic_markers) {
          mappedMessage.semanticMarkers = JSON.parse(message.semantic_markers);
        }

        if (message.sentiment_indicators) {
          mappedMessage.sentimentIndicators = JSON.parse(
            message.sentiment_indicators
          );
        }

        return mappedMessage;
      } catch (err) {
        logMessage(
          "error",
          "Error parsing JSON fields in conversation message:"
        );
        logMessage("error", err);
        return {
          messageId: message.message_id,
          conversationId: message.conversation_id,
          role: message.role,
          content: message.content,
          timestamp: message.timestamp,
          relatedContextEntityIds: [],
          summary: message.summary,
          userIntent: message.user_intent,
          topicSegmentId: message.topic_segment_id,
          semanticMarkers: [],
          sentimentIndicators: {},
        };
      }
    });
  } catch (error) {
    logMessage(
      "error",
      `Error getting conversation history for ${conversationId}:`
    );
    logMessage("error", error);
    return [];
  }
}

/**
 * Gets the current purpose of a conversation
 *
 * @param {string} conversationId - The ID of the conversation
 * @returns {Promise<{purposeType: string, confidence: number, startTimestamp: string}>} The conversation purpose information
 */
export async function getConversationPurpose(conversationId) {
  try {
    if (!conversationId) {
      throw new Error("Conversation ID is required");
    }

    // Use the ConversationPurposeDetector to get the active purpose
    const activePurpose = await ConversationPurposeDetector.getActivePurpose(
      conversationId
    );

    if (!activePurpose) {
      // Default response if no purpose is detected
      return {
        purposeType: "general_query",
        confidence: 0.5,
        startTimestamp: new Date().toISOString(),
      };
    }

    return activePurpose;
  } catch (error) {
    logMessage(
      "error",
      `Error getting conversation purpose for ${conversationId}:`
    );
    logMessage("error", error);

    // Default response in case of error
    return {
      purposeType: "general_query",
      confidence: 0.5,
      startTimestamp: new Date().toISOString(),
    };
  }
}

/**
 * Gets the most recent messages for a conversation
 *
 * @param {string} conversationId - The conversation ID
 * @param {number} [count=5] - Number of most recent messages to return
 * @returns {Promise<Array>} Array of the most recent message objects
 */
export async function getRecentMessages(conversationId, count = 5) {
  try {
    if (!conversationId) {
      throw new Error("Conversation ID is required");
    }

    const query = `
      SELECT 
        message_id,
        conversation_id,
        role,
        content,
        timestamp,
        related_context_entity_ids,
        summary,
        user_intent,
        topic_segment_id,
        semantic_markers,
        sentiment_indicators
      FROM 
        conversation_history
      WHERE 
        conversation_id = ?
      ORDER BY 
        timestamp DESC
      LIMIT ?
    `;

    const results = await executeQuery(query, [conversationId, count]);

    // Check if results has a rows property and it's an array
    if (!results || !results.rows || !Array.isArray(results.rows)) {
      logMessage("warn", "No valid rows returned from recent messages query");
      return [];
    }

    // Parse JSON fields using the same mapping as getConversationHistory
    return results.rows.map((message) => {
      try {
        // Map database column names to camelCase property names for API consistency
        const mappedMessage = {
          messageId: message.message_id,
          conversationId: message.conversation_id,
          role: message.role,
          content: message.content,
          timestamp: message.timestamp,
          relatedContextEntityIds: [],
          summary: message.summary,
          userIntent: message.user_intent,
          topicSegmentId: message.topic_segment_id,
          semanticMarkers: [],
          sentimentIndicators: {},
        };

        if (message.related_context_entity_ids) {
          mappedMessage.relatedContextEntityIds = JSON.parse(
            message.related_context_entity_ids
          );
        }

        if (message.semantic_markers) {
          mappedMessage.semanticMarkers = JSON.parse(message.semantic_markers);
        }

        if (message.sentiment_indicators) {
          mappedMessage.sentimentIndicators = JSON.parse(
            message.sentiment_indicators
          );
        }

        return mappedMessage;
      } catch (err) {
        logMessage(
          "error",
          "Error parsing JSON fields in conversation message:"
        );
        logMessage("error", err);
        return {
          messageId: message.message_id,
          conversationId: message.conversation_id,
          role: message.role,
          content: message.content,
          timestamp: message.timestamp,
          relatedContextEntityIds: [],
          summary: message.summary,
          userIntent: message.user_intent,
          topicSegmentId: message.topic_segment_id,
          semanticMarkers: [],
          sentimentIndicators: {},
        };
      }
    });
  } catch (error) {
    logMessage("error", `Error getting recent messages for ${conversationId}:`);
    logMessage("error", error);
    return [];
  }
}
