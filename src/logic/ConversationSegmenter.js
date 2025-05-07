/**
 * ConversationSegmenter.js
 *
 * Provides functionality to detect topic shifts and segment conversations
 * into coherent topics for better context management.
 */

import * as TextTokenizerLogic from "./TextTokenizerLogic.js";
import { executeQuery } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import * as ContextCompressorLogic from "./ContextCompressorLogic.js";

/**
 * @typedef {Object} Message
 * @property {string} content - The content of the message
 * @property {string} role - The role of the sender (e.g., 'user', 'assistant')
 * @property {Date} [timestamp] - Optional timestamp of the message
 * @property {string[]} [entity_ids] - Optional array of referenced entity IDs
 */

// Conversational shift marker phrases
const TOPIC_SHIFT_MARKERS = [
  "anyway",
  "moving on",
  "changing subject",
  "regarding",
  "switching to",
  "on another note",
  "back to",
  "speaking of",
  "about",
  "let's talk about",
  "with respect to",
  "turning to",
  "shifting to",
  "let's discuss",
  "instead",
];

// Question starters that might indicate new topics
const QUESTION_STARTERS = [
  "what",
  "how",
  "why",
  "can",
  "could",
  "would",
  "should",
  "is",
  "are",
  "do",
  "does",
  "did",
  "have",
  "has",
  "will",
];

/**
 * Detects if a new message represents a significant topic shift
 * compared to the conversation history
 *
 * @param {Message} newMessage - The new message to evaluate
 * @param {Message[]} conversationHistory - Previous messages in the conversation
 * @returns {Promise<boolean>} True if a topic shift is detected, false otherwise
 */
export async function detectTopicShift(newMessage, conversationHistory) {
  try {
    if (
      !newMessage?.content ||
      !conversationHistory ||
      conversationHistory.length === 0
    ) {
      return false;
    }

    // Only look at recent history (last 5 messages) for comparison
    const recentHistory = conversationHistory.slice(-5);

    // 1. Keyword novelty detection
    const keywordNoveltyScore = calculateKeywordNovelty(
      newMessage,
      recentHistory
    );

    // 2. Entity reference shift detection
    const entityShiftScore = calculateEntityShift(newMessage, recentHistory);

    // 3. Conversational markers detection
    const hasConversationalMarkers = detectConversationalMarkers(
      newMessage.content
    );

    // 4. Question-answer completion detection
    const questionShiftScore = detectQuestionAnswerShift(
      newMessage,
      recentHistory
    );

    // Combine heuristics with appropriate weights
    const topicShiftScore =
      keywordNoveltyScore * 0.4 +
      entityShiftScore * 0.3 +
      (hasConversationalMarkers ? 0.8 : 0) * 0.2 +
      questionShiftScore * 0.1;

    // Return true if the combined score exceeds a threshold
    return topicShiftScore > 0.45;
  } catch (error) {
    console.error("Error detecting topic shift:", error);
    return false; // Default to no shift on error
  }
}

/**
 * Calculates keyword novelty by comparing tokens in new message with recent history
 *
 * @param {Message} newMessage - The new message
 * @param {Message[]} recentHistory - Recent conversation messages
 * @returns {number} Novelty score between 0 and 1
 */
function calculateKeywordNovelty(newMessage, recentHistory) {
  // Tokenize the new message
  const newTokens = TextTokenizerLogic.tokenize(newMessage.content);

  // Extract significant keywords from the new message
  const newKeywords = TextTokenizerLogic.extractKeywords(newTokens, 10);
  const newKeywordSet = new Set(newKeywords);

  if (newKeywordSet.size === 0) {
    return 0; // No significant keywords to compare
  }

  // Build a set of all keywords from recent history
  const historyKeywordSet = new Set();
  for (const message of recentHistory) {
    const historyTokens = TextTokenizerLogic.tokenize(message.content);
    const historyKeywords = TextTokenizerLogic.extractKeywords(
      historyTokens,
      10
    );
    historyKeywords.forEach((keyword) => historyKeywordSet.add(keyword));
  }

  // Count how many new keywords are novel (not in history)
  let novelKeywordCount = 0;
  for (const keyword of newKeywordSet) {
    if (!historyKeywordSet.has(keyword)) {
      novelKeywordCount++;
    }
  }

  // Calculate novelty ratio: novel keywords / total keywords
  return novelKeywordCount / newKeywordSet.size;
}

/**
 * Calculates entity reference shift by comparing entity IDs mentioned
 * in new message vs. recent history
 *
 * @param {Message} newMessage - The new message
 * @param {Message[]} recentHistory - Recent conversation messages
 * @returns {number} Entity shift score between 0 and 1
 */
function calculateEntityShift(newMessage, recentHistory) {
  // If entity_ids are not available, return 0
  if (
    !newMessage.entity_ids ||
    !Array.isArray(newMessage.entity_ids) ||
    newMessage.entity_ids.length === 0
  ) {
    return 0;
  }

  // Build a set of all entity IDs from recent history
  const historyEntitySet = new Set();
  for (const message of recentHistory) {
    if (message.entity_ids && Array.isArray(message.entity_ids)) {
      message.entity_ids.forEach((id) => historyEntitySet.add(id));
    }
  }

  // If no entities in history, any entity in new message is a shift
  if (historyEntitySet.size === 0) {
    return newMessage.entity_ids.length > 0 ? 1 : 0;
  }

  // Count new entities not present in history
  let newEntityCount = 0;
  for (const entityId of newMessage.entity_ids) {
    if (!historyEntitySet.has(entityId)) {
      newEntityCount++;
    }
  }

  // Calculate entity shift ratio: new entities / total entities
  return newEntityCount / newMessage.entity_ids.length;
}

/**
 * Detects conversational markers indicating topic shifts
 *
 * @param {string} messageContent - The content of the message
 * @returns {boolean} True if shift markers are found
 */
function detectConversationalMarkers(messageContent) {
  if (!messageContent) return false;

  const lowerContent = messageContent.toLowerCase();

  // Check for topic shift marker phrases
  for (const marker of TOPIC_SHIFT_MARKERS) {
    // Look for the marker as a whole word
    const regex = new RegExp(`\\b${marker}\\b`, "i");
    if (regex.test(lowerContent)) {
      return true;
    }
  }

  return false;
}

/**
 * Detects if there's a shift in question patterns, indicating topic change
 *
 * @param {Message} newMessage - The new message
 * @param {Message[]} recentHistory - Recent conversation messages
 * @returns {number} Question shift score between 0 and 1
 */
function detectQuestionAnswerShift(newMessage, recentHistory) {
  // Check if new message is a question
  const isNewMessageQuestion = isQuestion(newMessage.content);

  if (!isNewMessageQuestion) {
    return 0; // Not a question, so no question shift
  }

  // Check recent conversation flow
  let previousQuestionCount = 0;
  let questionAnswerPairCount = 0;

  // Evaluate if we have a sequence of Q&A pairs
  for (let i = 0; i < recentHistory.length - 1; i++) {
    if (
      recentHistory[i].role === "user" &&
      isQuestion(recentHistory[i].content)
    ) {
      previousQuestionCount++;

      // Check if next message is an answer (from assistant)
      if (
        i + 1 < recentHistory.length &&
        recentHistory[i + 1].role === "assistant"
      ) {
        questionAnswerPairCount++;
      }
    }
  }

  // If we've had a series of Q&A exchanges and a new question appears,
  // it's more likely to be a topic shift
  if (previousQuestionCount > 0 && questionAnswerPairCount > 0) {
    // Compare the question type/subject of the new question vs. previous questions
    const lastUserQuestionIndex = findLastIndex(
      recentHistory,
      (msg) => msg.role === "user" && isQuestion(msg.content)
    );

    if (lastUserQuestionIndex >= 0) {
      const lastUserQuestion = recentHistory[lastUserQuestionIndex].content;
      return calculateQuestionDifference(newMessage.content, lastUserQuestion);
    }
  }

  return 0.2; // Default modest score if it's a new question
}

/**
 * Determines if a message is a question
 *
 * @param {string} content - Message content
 * @returns {boolean} True if it appears to be a question
 */
function isQuestion(content) {
  if (!content) return false;

  // Check for question marks
  if (content.includes("?")) {
    return true;
  }

  // Check for question starter words
  const lowerContent = content.toLowerCase().trim();
  for (const starter of QUESTION_STARTERS) {
    if (lowerContent.startsWith(starter + " ")) {
      return true;
    }
  }

  return false;
}

/**
 * Calculates the difference between two questions to detect topic shift
 *
 * @param {string} newQuestion - The new question
 * @param {string} previousQuestion - A previous question from history
 * @returns {number} Difference score between 0 and 1
 */
function calculateQuestionDifference(newQuestion, previousQuestion) {
  const newTokens = TextTokenizerLogic.tokenize(newQuestion);
  const prevTokens = TextTokenizerLogic.tokenize(previousQuestion);

  // Use Jaccard similarity to compare question content
  const newSet = new Set(newTokens);
  const prevSet = new Set(prevTokens);

  // Calculate intersection size
  let intersectionSize = 0;
  for (const token of newSet) {
    if (prevSet.has(token)) {
      intersectionSize++;
    }
  }

  // Calculate union size
  const unionSize = newSet.size + prevSet.size - intersectionSize;

  // Jaccard similarity: intersection size / union size
  const similarity = unionSize > 0 ? intersectionSize / unionSize : 0;

  // Return difference (1 - similarity)
  return 1 - similarity;
}

/**
 * Custom implementation of findLastIndex for compatibility
 *
 * @param {Array} array - The array to search
 * @param {Function} predicate - The predicate function
 * @returns {number} The last matching index or -1 if not found
 */
function findLastIndex(array, predicate) {
  for (let i = array.length - 1; i >= 0; i--) {
    if (predicate(array[i])) {
      return i;
    }
  }
  return -1;
}

/**
 * Creates a new topic segment in the conversation
 *
 * @param {string} conversationId - ID of the conversation
 * @param {string} startMessageId - ID of the message where the topic starts
 * @param {Object} topicInfo - Information about the topic
 * @param {string} [topicInfo.name] - Optional name for the topic
 * @param {string} [topicInfo.description] - Optional description of the topic
 * @param {string[]} [topicInfo.primaryEntities] - Optional list of primary entity IDs for this topic
 * @param {string[]} [topicInfo.keywords] - Optional list of keywords characterizing this topic
 * @returns {Promise<string>} The ID of the newly created topic segment
 */
export async function createNewTopicSegment(
  conversationId,
  startMessageId,
  topicInfo = {}
) {
  try {
    // 1. Generate UUID for the topic
    const topic_id = uuidv4();

    // 2. Determine topic name
    let topic_name = topicInfo.name;
    if (!topic_name) {
      // If no name provided, use a timestamp-based placeholder
      // In a real implementation, we'd call generateTopicName() here
      topic_name = `New Topic ${new Date().toISOString()}`;

      // Alternatively, try to extract from the start message content
      try {
        const messageQuery =
          "SELECT content FROM conversation_history WHERE message_id = ?";
        const messageResult = await executeQuery(messageQuery, [
          startMessageId,
        ]);

        if (messageResult && messageResult.length > 0) {
          const content = messageResult[0].content;
          // Use first few words (up to 5) as a generic name
          const words = content.split(/\s+/).slice(0, 5).join(" ");
          if (words.length > 3) {
            topic_name = `Topic: ${words}${
              words.length < content.length ? "..." : ""
            }`;
          }
        }
      } catch (error) {
        console.warn(
          "Could not fetch message content for topic naming:",
          error
        );
        // Fall back to the timestamp-based name already set
      }
    }

    // 3. Prepare entities and keywords as JSON strings
    const primary_entities = topicInfo.primaryEntities
      ? JSON.stringify(topicInfo.primaryEntities)
      : "[]";

    const keywords = topicInfo.keywords
      ? JSON.stringify(topicInfo.keywords)
      : "[]";

    // 4. Get current timestamp for start_timestamp
    const start_timestamp = new Date().toISOString();

    // 5. Insert the new topic into the database
    // Try to disable foreign key constraints temporarily
    await executeQuery("PRAGMA foreign_keys = OFF;");

    const insertQuery = `
      INSERT INTO conversation_topics (
        topic_id,
        conversation_id,
        topic_name,
        description,
        start_message_id,
        start_timestamp,
        primary_entities,
        keywords
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      topic_id,
      conversationId,
      topic_name,
      topicInfo.description || "",
      startMessageId,
      start_timestamp,
      primary_entities,
      keywords,
    ];

    await executeQuery(insertQuery, params);

    // Re-enable foreign key constraints
    await executeQuery("PRAGMA foreign_keys = ON;");

    console.log(`Created new topic segment: ${topic_name} (${topic_id})`);

    // 6. Return the topic_id
    return topic_id;
  } catch (error) {
    console.error("Error creating new topic segment:", error);
    throw new Error(`Failed to create new topic segment: ${error.message}`);
  }
}

/**
 * Closes a topic segment by setting its end message and timestamp
 *
 * @param {string} topicId - ID of the topic segment to close
 * @param {string} endMessageId - ID of the message where the topic ends
 * @returns {Promise<void>}
 */
export async function closeTopicSegment(topicId, endMessageId) {
  try {
    // 1. Get current timestamp for end_timestamp
    const end_timestamp = new Date().toISOString();

    // 2. Try to get message timestamp if available
    let messageTimestamp = end_timestamp;
    try {
      const messageQuery =
        "SELECT timestamp FROM conversation_history WHERE message_id = ?";
      const messageResult = await executeQuery(messageQuery, [endMessageId]);

      if (
        messageResult &&
        messageResult.length > 0 &&
        messageResult[0].timestamp
      ) {
        messageTimestamp = messageResult[0].timestamp;
      }
    } catch (error) {
      console.warn(
        "Could not fetch message timestamp, using current timestamp:",
        error
      );
      // Continue with the current timestamp that we've already set
    }

    // 3. Update the topic record in the database
    const updateQuery = `
      UPDATE conversation_topics
      SET end_message_id = ?,
          end_timestamp = ?
      WHERE topic_id = ?
    `;

    const params = [endMessageId, messageTimestamp, topicId];

    await executeQuery(updateQuery, params);

    console.log(
      `Closed topic segment: ${topicId} with end message: ${endMessageId}`
    );

    // 4. Generate topic summary (Note: Implementation not provided yet)
    // This would be a good place to call a function like:
    // await summarizeTopicSegment(topicId);
  } catch (error) {
    console.error(`Error closing topic segment ${topicId}:`, error);
    throw new Error(`Failed to close topic segment: ${error.message}`);
  }
}

/**
 * @typedef {Object} Topic
 * @property {string} topic_id - Unique identifier for the topic
 * @property {string} conversation_id - ID of the conversation this topic belongs to
 * @property {string} topic_name - Name of the topic
 * @property {string} description - Description of the topic
 * @property {string} start_message_id - ID of the message where the topic starts
 * @property {string} start_timestamp - Timestamp when the topic started
 * @property {string|null} end_message_id - ID of the message where the topic ends (null if active)
 * @property {string|null} end_timestamp - Timestamp when the topic ended (null if active)
 * @property {string[]} primary_entities - List of primary entity IDs for this topic
 * @property {string[]} keywords - List of keywords characterizing this topic
 */

/**
 * Gets the active (most recent, non-ended) topic segment for a conversation
 *
 * @param {string} conversationId - Conversation ID
 * @returns {Promise<object|null>} The active topic segment or null
 */
export async function getActiveTopicForConversation(conversationId) {
  try {
    // Get the active topic
    const query = `
      SELECT * FROM conversation_topics
      WHERE conversation_id = ?
        AND end_message_id IS NULL
      ORDER BY start_timestamp DESC
      LIMIT 1
    `;

    const result = await executeQuery(query, [conversationId]);

    if (!result.rows || result.rows.length === 0) {
      return null;
    }

    // Convert the JSON fields back to objects
    const topic = result.rows[0];

    try {
      // Create a new object for parsed fields to avoid modifying read-only properties
      const parsedTopic = { ...topic };

      // Parse JSON fields if they exist and are strings
      if (topic.keywords && typeof topic.keywords === "string") {
        parsedTopic.keywords = JSON.parse(topic.keywords);
      }

      if (
        topic.related_entities &&
        typeof topic.related_entities === "string"
      ) {
        parsedTopic.related_entities = JSON.parse(topic.related_entities);
      }

      if (
        topic.primary_entities &&
        typeof topic.primary_entities === "string"
      ) {
        parsedTopic.primary_entities = JSON.parse(topic.primary_entities);
      }

      return parsedTopic;
    } catch (parseError) {
      console.error(
        `Error parsing JSON fields for topic ${topic.topic_id}:`,
        parseError
      );
      // Return the original topic without attempting to parse JSON fields
      return topic;
    }
  } catch (error) {
    console.error(
      `Error getting active topic for conversation ${conversationId}:`,
      error
    );
    throw error;
  }
}

/**
 * Generates a summary for a topic segment and updates the topic record
 *
 * @param {string} topicId - ID of the topic to summarize
 * @returns {Promise<string>} The generated summary
 */
export async function summarizeTopicSegment(topicId) {
  try {
    // 1. Get all messages belonging to this topic
    const messages = await getTopicSegmentMessages(topicId);

    if (!messages || messages.length === 0) {
      const noMessagesWarning = "No messages found for topic summarization";
      console.warn(noMessagesWarning);
      return noMessagesWarning;
    }

    // 2. Concatenate the content of these messages
    const concatenatedContent = messages
      .map((msg) => {
        // Format each message with role information
        return `${msg.role}: ${msg.content}`;
      })
      .join("\n\n");

    // 3. Use ContextCompressorLogic to generate a summary
    const summary = await ContextCompressorLogic.summarizeText(
      concatenatedContent,
      {
        targetLength: 150, // Target 150 characters for the summary
        preserveKeyPoints: true,
      }
    );

    // 4. Update the topic record with the summary
    const updateQuery = `
      UPDATE conversation_topics
      SET summary = ?
      WHERE topic_id = ?
    `;

    await executeQuery(updateQuery, [summary, topicId]);

    console.log(
      `Topic ${topicId} summary generated and stored: ${summary.substring(
        0,
        50
      )}...`
    );

    // 5. Return the generated summary
    return summary;
  } catch (error) {
    console.error(`Error summarizing topic segment ${topicId}:`, error);
    throw new Error(`Failed to summarize topic segment: ${error.message}`);
  }
}

/**
 * Gets all messages belonging to a topic segment
 *
 * @param {string} topicId - ID of the topic
 * @returns {Promise<Array<Message>>} Array of messages with parsed JSON fields
 */
export async function getTopicSegmentMessages(topicId) {
  try {
    // Query conversation_history table directly using topic_segment_id
    const messagesQuery = `
      SELECT * FROM conversation_history 
      WHERE topic_segment_id = ? 
      ORDER BY timestamp ASC
    `;

    const messages = await executeQuery(messagesQuery, [topicId]);

    if (!messages || messages.length === 0) {
      return [];
    }

    // Parse JSON fields for each message
    return messages.map((message) => {
      try {
        // Parse related_context_entity_ids JSON field
        if (message.related_context_entity_ids) {
          message.related_context_entity_ids = JSON.parse(
            message.related_context_entity_ids
          );
        } else {
          message.related_context_entity_ids = [];
        }

        // Parse semantic_markers JSON field
        if (message.semantic_markers) {
          message.semantic_markers = JSON.parse(message.semantic_markers);
        } else {
          message.semantic_markers = [];
        }

        // Parse sentiment_indicators JSON field
        if (message.sentiment_indicators) {
          message.sentiment_indicators = JSON.parse(
            message.sentiment_indicators
          );
        } else {
          message.sentiment_indicators = {};
        }

        return message;
      } catch (jsonError) {
        console.warn(
          `Error parsing JSON fields for message ${message.message_id}:`,
          jsonError
        );
        // Return message with default empty values for JSON fields
        return {
          ...message,
          related_context_entity_ids: message.related_context_entity_ids || [],
          semantic_markers: message.semantic_markers || [],
          sentiment_indicators: message.sentiment_indicators || {},
        };
      }
    });
  } catch (error) {
    console.error(`Error getting messages for topic ${topicId}:`, error);
    throw new Error(`Failed to get topic messages: ${error.message}`);
  }
}

/**
 * Generates a concise, descriptive topic name from a set of messages
 *
 * @param {string[]} messageIds - Array of message IDs to generate a topic name from
 * @returns {Promise<string>} A concise topic name
 */
export async function generateTopicName(messageIds) {
  try {
    if (!messageIds || messageIds.length === 0) {
      return "Untitled Topic";
    }

    // 1. Fetch the content of messages
    const placeholders = messageIds.map(() => "?").join(",");
    const messagesQuery = `
      SELECT content, related_context_entity_ids
      FROM conversation_history 
      WHERE message_id IN (${placeholders})
      ORDER BY timestamp ASC
    `;

    const messages = await executeQuery(messagesQuery, messageIds);

    if (!messages || messages.length === 0) {
      return "Untitled Topic";
    }

    // 2. Concatenate message contents
    const concatenatedContent = messages.map((msg) => msg.content).join(" ");

    // 3. Tokenize the content
    const tokens = TextTokenizerLogic.tokenize(concatenatedContent);

    // 4. Extract keywords from the content
    const keywords = TextTokenizerLogic.extractKeywords(tokens, 3);

    // 5. Check for entity references in the messages
    const entityReferences = new Set();
    for (const message of messages) {
      if (message.related_context_entity_ids) {
        let entityIds;
        try {
          entityIds =
            typeof message.related_context_entity_ids === "string"
              ? JSON.parse(message.related_context_entity_ids)
              : message.related_context_entity_ids;

          if (Array.isArray(entityIds) && entityIds.length > 0) {
            // Get entity names for up to 2 entities
            const entityIds = entityIds.slice(0, 2);
            const entityQuery = `
              SELECT name FROM code_entities WHERE id IN (${entityIds
                .map(() => "?")
                .join(",")})
            `;

            const entities = await executeQuery(entityQuery, entityIds);
            if (entities && entities.length > 0) {
              entities.forEach((entity) => entityReferences.add(entity.name));
            }
          }
        } catch (err) {
          console.warn("Error parsing entity IDs", err);
        }
      }
    }

    // 6. Formulate a topic name
    let topicName;

    // If we have entity references, prioritize those
    if (entityReferences.size > 0) {
      const entityNames = Array.from(entityReferences).slice(0, 2);
      topicName = `Discussion about ${entityNames.join(" and ")}`;
    }
    // Otherwise use the keywords
    else if (keywords.length > 0) {
      topicName = `Topic: ${keywords.join(", ")}`;
    }
    // Fallback to using the first message
    else {
      // Get first few significant words from the initial message
      const firstMsg = messages[0].content;
      const firstFewWords = firstMsg.split(/\s+/).slice(0, 5).join(" ");
      topicName = `Topic: ${firstFewWords}${
        firstMsg.length > firstFewWords.length ? "..." : ""
      }`;
    }

    // 7. Ensure topic name is not too long
    if (topicName.length > 50) {
      topicName = topicName.substring(0, 47) + "...";
    }

    return topicName;
  } catch (error) {
    console.error(`Error generating topic name:`, error);
    return "Untitled Topic";
  }
}

/**
 * Builds a hierarchical representation of topics in a conversation
 *
 * @param {string} conversationId - ID of the conversation
 * @returns {Promise<{rootTopics: Topic[], topicMap: Record<string, Topic>}>} Hierarchical topic structure
 */
export async function buildTopicHierarchy(conversationId) {
  try {
    // 1. Fetch all topics for the conversation, ordered by start_timestamp
    const query = `
      SELECT * FROM conversation_topics
      WHERE conversation_id = ?
      ORDER BY start_timestamp ASC
    `;

    const topics = await executeQuery(query, [conversationId]);

    if (!topics || topics.length === 0) {
      return { rootTopics: [], topicMap: {} };
    }

    // 2. Create the topic map and parse JSON fields
    const topicMap = {};

    for (const topic of topics) {
      // Parse JSON fields
      try {
        // Parse primary_entities JSON string to array
        topic.primary_entities = topic.primary_entities
          ? JSON.parse(topic.primary_entities)
          : [];

        // Parse keywords JSON string to array
        topic.keywords = topic.keywords ? JSON.parse(topic.keywords) : [];

        // Add children array to each topic
        topic.children = [];

        // Add to topic map
        topicMap[topic.topic_id] = topic;
      } catch (jsonError) {
        console.warn(
          `Error parsing JSON fields for topic ${topic.topic_id}:`,
          jsonError
        );
        // Provide default empty arrays if JSON parsing fails
        topic.primary_entities = [];
        topic.keywords = [];
        topic.children = [];

        // Still add to map even with parse error
        topicMap[topic.topic_id] = topic;
      }
    }

    // 3. Build the hierarchy by connecting parents and children
    const rootTopics = [];

    for (const topic of topics) {
      if (topic.parent_topic_id && topicMap[topic.parent_topic_id]) {
        // Add this topic as a child of its parent
        topicMap[topic.parent_topic_id].children.push(topic);
      } else {
        // This is a root topic (no parent or parent not in the map)
        rootTopics.push(topic);
      }
    }

    return { rootTopics, topicMap };
  } catch (error) {
    console.error(
      `Error building topic hierarchy for conversation ${conversationId}:`,
      error
    );
    throw new Error(`Failed to build topic hierarchy: ${error.message}`);
  }
}

/**
 * Gets all topics for a specific conversation
 *
 * @param {string} conversationId - ID of the conversation
 * @param {boolean} [activeOnly=false] - If true, only return active (not closed) topics
 * @returns {Promise<Array<Topic>>} Array of topic objects
 */
export async function getTopicsForConversation(
  conversationId,
  activeOnly = false
) {
  try {
    // Build the query with optional filter for active topics
    let query = `
      SELECT * FROM conversation_topics
      WHERE conversation_id = ?
    `;

    if (activeOnly) {
      query += ` AND end_message_id IS NULL`;
    }

    query += ` ORDER BY start_timestamp ASC`;

    const result = await executeQuery(query, [conversationId]);

    // If no topics found, return empty array
    if (
      !result ||
      !result.rows ||
      !Array.isArray(result.rows) ||
      result.rows.length === 0
    ) {
      return [];
    }

    // Parse JSON fields for each topic
    return result.rows.map((topic) => {
      try {
        // Parse JSON string fields
        return {
          ...topic,
          primary_entities: topic.primary_entities
            ? JSON.parse(topic.primary_entities)
            : [],
          keywords: topic.keywords ? JSON.parse(topic.keywords) : [],
        };
      } catch (jsonError) {
        console.warn(
          `Error parsing JSON fields for topic ${topic.topic_id}:`,
          jsonError
        );
        // Return topic with default empty arrays for JSON fields
        return {
          ...topic,
          primary_entities: [],
          keywords: [],
        };
      }
    });
  } catch (error) {
    console.error(
      `Error getting topics for conversation ${conversationId}:`,
      error
    );
    throw new Error(`Failed to get conversation topics: ${error.message}`);
  }
}
