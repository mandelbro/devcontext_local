/**
 * IntentPredictorLogic.js
 *
 * Provides functions for predicting user intent from queries and conversation history.
 */

import * as TextTokenizerLogic from "./TextTokenizerLogic.js";
import { executeQuery } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import * as TimelineManagerLogic from "./TimelineManagerLogic.js";

/**
 * @typedef {Object} Message
 * @property {string} content - The content of the message
 * @property {string} role - The role of the message sender (user or assistant)
 */

/**
 * @typedef {Object} TimelineEvent
 * @property {string} event_id - Unique identifier for the event
 * @property {string} event_type - Type of event
 * @property {number} timestamp - Timestamp when the event occurred
 * @property {Object} data - Event data parsed from JSON
 * @property {string[]} associated_entity_ids - IDs of entities associated with this event
 * @property {string|null} conversation_id - Optional conversation ID this event belongs to
 * @property {string} created_at - Timestamp when the event was created in the database
 */

/**
 * @typedef {Object} CodeChangeInfo
 * @property {string} path - Path to the file being edited
 * @property {string} [content] - Optional content of the file
 */

/**
 * @typedef {Object} FocusArea
 * @property {string} focus_id - Unique identifier for the focus area
 * @property {string} focus_type - Type of focus area ('file', 'directory', 'task_type')
 * @property {string} identifier - Primary identifier for the focus area (e.g., file path)
 * @property {string} description - Human-readable description of the focus area
 * @property {string} related_entity_ids - JSON string of related entity IDs
 * @property {string} keywords - JSON string of keywords related to this focus area
 * @property {number} last_activated_at - Timestamp when this focus area was last active
 * @property {boolean} is_active - Whether this focus area is currently active
 */

/**
 * @typedef {Object} IntentInfo
 * @property {string} intent - The inferred intent type
 * @property {number} [confidence] - Confidence score for the intent (0-1)
 * @property {string[]} [keywords] - Array of extracted keywords
 * @property {FocusArea} [focusArea] - The currently active focus area, if available
 */

/**
 * @typedef {Object} IntentUpdateResult
 * @property {IntentInfo} [newIntent] - The newly inferred intent, if available
 * @property {boolean} [focusUpdated] - Whether the focus area was updated
 * @property {FocusArea} [currentFocus] - The current focus area after update
 */

/**
 * Infers the user's intent from a query and conversation history
 *
 * @param {string} query - The user's query
 * @param {Message[]} [conversationHistory=[]] - The recent conversation history
 * @returns {Object} Object containing intent and keywords
 * @returns {string} .intent - The inferred intent
 * @returns {string[]} .keywords - Array of extracted keywords
 */
export function inferIntentFromQuery(query, conversationHistory = []) {
  // Define possible intents
  const intents = {
    GENERAL_QUERY: "general_query",
    CODE_SEARCH: "code_search",
    EXPLANATION_REQUEST: "explanation_request",
    DEBUGGING_ASSIST: "debugging_assist",
    REFACTORING_SUGGESTION: "refactoring_suggestion",
    IMPLEMENTATION_REQUEST: "implementation_request",
    DOCUMENTATION_REQUEST: "documentation_request",
  };

  // Initialize scores for each intent
  const intentScores = {
    [intents.GENERAL_QUERY]: 0.1, // Base score
    [intents.CODE_SEARCH]: 0,
    [intents.EXPLANATION_REQUEST]: 0,
    [intents.DEBUGGING_ASSIST]: 0,
    [intents.REFACTORING_SUGGESTION]: 0,
    [intents.IMPLEMENTATION_REQUEST]: 0,
    [intents.DOCUMENTATION_REQUEST]: 0,
  };

  // Normalize the query
  const normalizedQuery = query.toLowerCase();

  // Extract keywords using TextTokenizerLogic
  const tokens = TextTokenizerLogic.tokenize(query);
  const keywords = TextTokenizerLogic.extractKeywords(tokens);

  // Check for question marks (indicates question/explanation request)
  if (normalizedQuery.includes("?")) {
    intentScores[intents.EXPLANATION_REQUEST] += 0.3;
  }

  // Check for code snippets (code blocks, function names, variable declarations)
  const codePatterns = [
    /```[\s\S]*?```/, // Code blocks
    /function\s+\w+\s*\(.*?\)/, // Function declarations
    /const|let|var\s+\w+\s*=/, // Variable declarations
    /class\s+\w+/, // Class declarations
    /import\s+.*?from/, // Import statements
  ];

  for (const pattern of codePatterns) {
    if (pattern.test(query)) {
      intentScores[intents.CODE_SEARCH] += 0.2;
      intentScores[intents.DEBUGGING_ASSIST] += 0.2;
      break;
    }
  }

  // Check for specific keywords
  const keywordPatterns = [
    // Search related
    {
      patterns: ["find", "search", "where is", "locate", "look for"],
      intent: intents.CODE_SEARCH,
      score: 0.6,
    },
    // Explanation related
    {
      patterns: [
        "explain",
        "how does",
        "what is",
        "why",
        "how to",
        "tell me about",
      ],
      intent: intents.EXPLANATION_REQUEST,
      score: 0.6,
    },
    // Debugging related
    {
      patterns: [
        "error",
        "bug",
        "issue",
        "problem",
        "fix",
        "debug",
        "not working",
        "exception",
        "fail",
      ],
      intent: intents.DEBUGGING_ASSIST,
      score: 0.7,
    },
    // Refactoring related
    {
      patterns: [
        "refactor",
        "improve",
        "optimize",
        "clean",
        "better way",
        "restructure",
        "revise",
      ],
      intent: intents.REFACTORING_SUGGESTION,
      score: 0.65,
    },
    // Implementation related
    {
      patterns: [
        "implement",
        "create",
        "make",
        "build",
        "develop",
        "code",
        "add",
        "new feature",
      ],
      intent: intents.IMPLEMENTATION_REQUEST,
      score: 0.6,
    },
    // Documentation related
    {
      patterns: [
        "document",
        "comment",
        "describe",
        "explain code",
        "documentation",
      ],
      intent: intents.DOCUMENTATION_REQUEST,
      score: 0.55,
    },
  ];

  for (const { patterns, intent, score } of keywordPatterns) {
    for (const pattern of patterns) {
      if (normalizedQuery.includes(pattern)) {
        intentScores[intent] += score;
        break; // Only add the score once per pattern group
      }
    }
  }

  // Analyze conversation history for context
  if (conversationHistory && conversationHistory.length > 0) {
    // Get last few messages, focusing on user messages
    const recentMessages = conversationHistory
      .slice(-3) // Last 3 messages
      .filter((msg) => msg.content);

    for (const message of recentMessages) {
      const normalizedContent = message.content.toLowerCase();

      // If previous messages contained errors or debug terms, boost debugging intent
      if (
        /error|bug|issue|problem|fix|debug|not working|exception|fail/.test(
          normalizedContent
        )
      ) {
        intentScores[intents.DEBUGGING_ASSIST] += 0.2;
      }

      // If previous messages discussed code structure, boost refactoring intent
      if (
        /refactor|improve|optimize|clean|better|restructure|architecture/.test(
          normalizedContent
        )
      ) {
        intentScores[intents.REFACTORING_SUGGESTION] += 0.2;
      }

      // If previous messages were about explaining, boost explanation intent
      if (
        /explain|how does|what is|why|how to|understand/.test(normalizedContent)
      ) {
        intentScores[intents.EXPLANATION_REQUEST] += 0.15;
      }
    }
  }

  // Determine the winning intent
  let maxScore = 0;
  let inferredIntent = intents.GENERAL_QUERY; // Default

  for (const [intent, score] of Object.entries(intentScores)) {
    if (score > maxScore) {
      maxScore = score;
      inferredIntent = intent;
    }
  }

  return {
    intent: inferredIntent,
    keywords,
  };
}

/**
 * Predicts the current focus area based on recent activity and code edits
 *
 * @param {TimelineEvent[]} recentActivity - Recent events from the timeline
 * @param {CodeChangeInfo[]} currentCodeEdits - Information about currently edited files
 * @returns {Promise<FocusArea|null>} The predicted focus area or null if no clear focus
 */
export async function predictFocusArea(
  recentActivity = [],
  currentCodeEdits = []
) {
  try {
    // Track file/path frequencies to determine most common focus areas
    const pathFrequency = new Map();
    const entityFrequency = new Map();
    const activityTypes = new Map();
    let keywordsSet = new Set();

    // Process recent activity from timeline events
    for (const event of recentActivity) {
      // Count event types
      activityTypes.set(
        event.event_type,
        (activityTypes.get(event.event_type) || 0) + 1
      );

      // Track file paths from event data
      if (event.data && event.data.path) {
        const path = event.data.path;
        pathFrequency.set(path, (pathFrequency.get(path) || 0) + 1);

        // Add depth to different path segments (directories, etc)
        const segments = path.split("/");
        for (let i = 1; i < segments.length; i++) {
          const dirPath = segments.slice(0, i).join("/");
          if (dirPath) {
            pathFrequency.set(dirPath, (pathFrequency.get(dirPath) || 0) + 0.3);
          }
        }
      }

      // Track related entities
      if (
        event.associated_entity_ids &&
        event.associated_entity_ids.length > 0
      ) {
        for (const entityId of event.associated_entity_ids) {
          entityFrequency.set(
            entityId,
            (entityFrequency.get(entityId) || 0) + 1
          );
        }
      }

      // Extract keywords from event data
      if (event.data && typeof event.data === "object") {
        // Extract keywords from any descriptive fields
        const textFields = [
          event.data.description,
          event.data.message,
          event.data.content,
          event.data.query,
        ].filter(Boolean);

        for (const text of textFields) {
          if (text && typeof text === "string") {
            const tokens = TextTokenizerLogic.tokenize(text);
            const extractedKeywords =
              TextTokenizerLogic.extractKeywords(tokens);
            extractedKeywords.forEach((keyword) => keywordsSet.add(keyword));
          }
        }
      }
    }

    // Process current code edits (these should get more weight as they represent current focus)
    for (const edit of currentCodeEdits) {
      const path = edit.path;
      // Give higher weight to current edits
      pathFrequency.set(path, (pathFrequency.get(path) || 0) + 3);

      // Add depth to different path segments (directories, etc)
      const segments = path.split("/");
      for (let i = 1; i < segments.length; i++) {
        const dirPath = segments.slice(0, i).join("/");
        if (dirPath) {
          pathFrequency.set(dirPath, (pathFrequency.get(dirPath) || 0) + 0.5);
        }
      }

      // Extract keywords from content if available
      if (edit.content) {
        const tokens = TextTokenizerLogic.tokenize(edit.content);
        const extractedKeywords = TextTokenizerLogic.extractKeywords(tokens);
        extractedKeywords.forEach((keyword) => keywordsSet.add(keyword));
      }
    }

    // Find the most frequent paths and entities
    let primaryFocusPath = "";
    let maxFrequency = 0;
    let focusType = "file";

    for (const [path, frequency] of pathFrequency.entries()) {
      if (frequency > maxFrequency) {
        maxFrequency = frequency;
        primaryFocusPath = path;

        // Determine if it's a file or directory
        focusType =
          path.includes(".") && !path.endsWith("/") ? "file" : "directory";
      }
    }

    // If we couldn't determine a clear focus from paths, try to determine from activity types
    if (!primaryFocusPath && activityTypes.size > 0) {
      let primaryActivityType = "";
      maxFrequency = 0;

      for (const [type, frequency] of activityTypes.entries()) {
        if (frequency > maxFrequency) {
          maxFrequency = frequency;
          primaryActivityType = type;
        }
      }

      if (primaryActivityType) {
        primaryFocusPath = `activity:${primaryActivityType}`;
        focusType = "task_type";
      }
    }

    // If we still have no clear focus, return null
    if (!primaryFocusPath) {
      return null;
    }

    // Create a human-readable description
    let description = "";
    if (focusType === "file") {
      description = `Working on file ${primaryFocusPath}`;
    } else if (focusType === "directory") {
      description = `Working in directory ${primaryFocusPath}`;
    } else {
      description = `${primaryFocusPath.replace("activity:", "")} activity`;
    }

    // Collect related entity IDs (most frequent ones)
    const relatedEntityIds = Array.from(entityFrequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([entityId]) => entityId);

    // Collect keywords (convert Set to Array)
    const keywords = Array.from(keywordsSet).slice(0, 20);

    // Create the focus area object
    const focusArea = {
      focus_id: uuidv4(),
      focus_type: focusType,
      identifier: primaryFocusPath,
      description,
      related_entity_ids: JSON.stringify(relatedEntityIds),
      keywords: JSON.stringify(keywords),
      last_activated_at: Date.now(),
      is_active: true,
    };

    // Call updateFocusAreaInDb to persist the focus area
    // Note: This function will be implemented in another task
    try {
      await updateFocusAreaInDb(focusArea);
    } catch (error) {
      // Log the error but don't fail - we still want to return the computed focus area
      console.error("Error updating focus area in database:", error);
    }

    return focusArea;
  } catch (error) {
    console.error("Error predicting focus area:", error);
    return null;
  }
}

/**
 * Updates or creates a focus area in the database
 *
 * @param {FocusArea} focus - The focus area to update or create
 * @returns {Promise<void>}
 */
export async function updateFocusAreaInDb(focus) {
  try {
    // Ensure that related_entity_ids and keywords are JSON strings
    const relatedEntityIds =
      typeof focus.related_entity_ids === "string"
        ? focus.related_entity_ids
        : JSON.stringify(focus.related_entity_ids || []);

    const keywords =
      typeof focus.keywords === "string"
        ? focus.keywords
        : JSON.stringify(focus.keywords || []);

    // Ensure last_activated_at is set to current time if not provided
    const lastActivated = focus.last_activated_at || Date.now();

    // Begin transaction - execute a series of queries that should complete together
    await executeQuery("BEGIN TRANSACTION");

    try {
      // Step 1: Set all existing focus areas to inactive
      await executeQuery(
        "UPDATE focus_areas SET is_active = FALSE WHERE is_active = TRUE"
      );

      // Step 2: Check if the focus area already exists
      const existingFocus = await executeQuery(
        "SELECT focus_id FROM focus_areas WHERE identifier = ?",
        [focus.identifier]
      );

      if (existingFocus && existingFocus.length > 0) {
        // Update existing focus area
        await executeQuery(
          `UPDATE focus_areas SET 
            focus_type = ?,
            description = ?,
            related_entity_ids = ?,
            keywords = ?,
            last_activated_at = ?,
            is_active = TRUE
          WHERE focus_id = ?`,
          [
            focus.focus_type,
            focus.description,
            relatedEntityIds,
            keywords,
            lastActivated,
            existingFocus[0].focus_id,
          ]
        );
      } else {
        // Insert new focus area
        await executeQuery(
          `INSERT INTO focus_areas (
            focus_id,
            focus_type,
            identifier,
            description,
            related_entity_ids,
            keywords,
            last_activated_at,
            is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
          [
            focus.focus_id,
            focus.focus_type,
            focus.identifier,
            focus.description,
            relatedEntityIds,
            keywords,
            lastActivated,
          ]
        );
      }

      // Commit the transaction
      await executeQuery("COMMIT");
    } catch (error) {
      // If any query fails, roll back the transaction
      await executeQuery("ROLLBACK");
      throw error;
    }
  } catch (error) {
    console.error("Error updating focus area in database:", error);
    throw error;
  }
}

/**
 * Retrieves and analyzes the current intent for a conversation
 *
 * @param {string} conversationId - The ID of the conversation to analyze
 * @returns {Promise<IntentInfo|null>} The intent information or null if no clear intent
 */
export async function getIntent(conversationId) {
  try {
    // 1. Retrieve the most recent messages for the given conversationId
    const recentMessages = await executeQuery(
      `SELECT content, role, timestamp 
       FROM conversation_history 
       WHERE conversation_id = ? 
       ORDER BY timestamp DESC 
       LIMIT 5`,
      [conversationId]
    );

    if (!recentMessages || recentMessages.length === 0) {
      return null; // No messages found for this conversation
    }

    // Convert to the Message format expected by inferIntentFromQuery
    const messages = recentMessages.map((msg) => ({
      content: msg.content,
      role: msg.role,
    }));

    // Get the most recent user message
    const lastUserMessage = messages.find((msg) => msg.role === "user");

    if (!lastUserMessage) {
      return null; // No user messages found
    }

    // 2. Analyze the messages using inferIntentFromQuery
    const { intent, keywords } = inferIntentFromQuery(
      lastUserMessage.content,
      messages
    );

    // 3. Get the currently active focus area
    const activeFocusAreas = await executeQuery(
      "SELECT * FROM focus_areas WHERE is_active = TRUE LIMIT 1"
    );

    let focusArea = null;
    if (activeFocusAreas && activeFocusAreas.length > 0) {
      const rawFocusArea = activeFocusAreas[0];

      // Parse JSON fields
      focusArea = {
        ...rawFocusArea,
        related_entity_ids: JSON.parse(rawFocusArea.related_entity_ids || "[]"),
        keywords: JSON.parse(rawFocusArea.keywords || "[]"),
      };
    }

    // 4. Calculate a confidence score based on the clarity of intent
    // This is simplified - a real implementation might use more sophisticated scoring
    let confidence = 0.5; // Default medium confidence

    // Increase confidence if we have both clear intent and matching focus area
    if (intent !== "general_query" && focusArea) {
      confidence = 0.7;

      // Check if any keywords match the focus area keywords
      if (focusArea.keywords && keywords) {
        const matchingKeywords = keywords.filter((k) =>
          focusArea.keywords.includes(k)
        );

        if (matchingKeywords.length > 0) {
          confidence += Math.min(0.3, matchingKeywords.length * 0.05);
        }
      }
    }

    // 5. Combine the information into an IntentInfo object
    const intentInfo = {
      intent,
      confidence,
      keywords,
      focusArea,
    };

    return intentInfo;
  } catch (error) {
    console.error("Error getting intent for conversation:", error);
    return null;
  }
}

/**
 * Updates the intent and focus area based on new activity signals
 *
 * @param {Object} params - Parameters containing activity signals
 * @param {string} params.conversationId - ID of the conversation to update
 * @param {string} [params.newMessage] - New message content, if any
 * @param {boolean} [params.isUser=false] - Whether the new message is from the user
 * @param {string} [params.activeFile] - Currently active file path, if any
 * @param {CodeChangeInfo[]} [params.codeChanges] - Information about code changes
 * @returns {Promise<IntentUpdateResult>} Result indicating intent and focus updates
 */
export async function updateIntent(params) {
  try {
    const {
      conversationId,
      newMessage,
      isUser = false,
      activeFile,
      codeChanges = [],
    } = params;

    let newIntent = null;
    let focusUpdated = false;
    let currentFocus = null;

    // 1. If new message is present and from user, determine textual intent
    if (newMessage && isUser) {
      // Get recent conversation history
      const recentMessages = await executeQuery(
        `SELECT content, role, timestamp 
         FROM conversation_history 
         WHERE conversation_id = ? 
         ORDER BY timestamp DESC 
         LIMIT 5`,
        [conversationId]
      );

      // Convert to Message format and add the new message
      const messages = recentMessages.map((msg) => ({
        content: msg.content,
        role: msg.role,
      }));

      // Add the new message to the history
      messages.unshift({
        content: newMessage,
        role: "user",
      });

      // Infer intent from the new message
      const { intent, keywords } = inferIntentFromQuery(newMessage, messages);

      // Get the current focus area
      const activeFocusAreas = await executeQuery(
        "SELECT * FROM focus_areas WHERE is_active = TRUE LIMIT 1"
      );

      let focusArea = null;
      if (activeFocusAreas && activeFocusAreas.length > 0) {
        const rawFocusArea = activeFocusAreas[0];

        // Parse JSON fields
        focusArea = {
          ...rawFocusArea,
          related_entity_ids: JSON.parse(
            rawFocusArea.related_entity_ids || "[]"
          ),
          keywords: JSON.parse(rawFocusArea.keywords || "[]"),
        };
      }

      // Calculate confidence
      let confidence = 0.5; // Default medium confidence

      if (intent !== "general_query" && focusArea) {
        confidence = 0.7;

        // Check if any keywords match the focus area keywords
        if (focusArea.keywords && keywords) {
          const matchingKeywords = keywords.filter((k) =>
            focusArea.keywords.includes(k)
          );

          if (matchingKeywords.length > 0) {
            confidence += Math.min(0.3, matchingKeywords.length * 0.05);
          }
        }
      }

      // Create IntentInfo object
      newIntent = {
        intent,
        confidence,
        keywords,
        focusArea,
      };
    }

    // 2. Determine if project-level focus has shifted based on code activity
    // First, gather relevant activity information
    const codeActivity = [];

    // Add active file as a code activity if provided
    if (activeFile) {
      codeActivity.push({
        path: activeFile,
      });
    }

    // Add code changes
    if (codeChanges && codeChanges.length > 0) {
      codeActivity.push(...codeChanges);
    }

    // Get recent timeline events
    const recentEvents = await TimelineManagerLogic.getEvents({
      limit: 20,
      types: ["code_change", "file_open", "cursor_move", "navigation"],
    });

    // If we have any code activity or recent events, check for focus shift
    if (codeActivity.length > 0 || recentEvents.length > 0) {
      // Predict focus area based on activity
      const newFocusArea = await predictFocusArea(recentEvents, codeActivity);

      if (newFocusArea) {
        // Focus was updated by predictFocusArea
        focusUpdated = true;
        currentFocus = newFocusArea;
      } else {
        // No focus update, get current focus
        const activeFocusAreas = await executeQuery(
          "SELECT * FROM focus_areas WHERE is_active = TRUE LIMIT 1"
        );

        if (activeFocusAreas && activeFocusAreas.length > 0) {
          const rawFocusArea = activeFocusAreas[0];

          // Parse JSON fields
          currentFocus = {
            ...rawFocusArea,
            related_entity_ids: JSON.parse(
              rawFocusArea.related_entity_ids || "[]"
            ),
            keywords: JSON.parse(rawFocusArea.keywords || "[]"),
          };
        }
      }
    } else {
      // No code activity, just get current focus
      const activeFocusAreas = await executeQuery(
        "SELECT * FROM focus_areas WHERE is_active = TRUE LIMIT 1"
      );

      if (activeFocusAreas && activeFocusAreas.length > 0) {
        const rawFocusArea = activeFocusAreas[0];

        // Parse JSON fields
        currentFocus = {
          ...rawFocusArea,
          related_entity_ids: JSON.parse(
            rawFocusArea.related_entity_ids || "[]"
          ),
          keywords: JSON.parse(rawFocusArea.keywords || "[]"),
        };
      }
    }

    // If we have a new intent but no focus area in it, add the current focus
    if (newIntent && !newIntent.focusArea && currentFocus) {
      newIntent.focusArea = currentFocus;
    }

    // Return the IntentUpdateResult
    return {
      newIntent,
      focusUpdated,
      currentFocus,
    };
  } catch (error) {
    console.error("Error updating intent:", error);
    // Return minimal information in case of error
    return {
      focusUpdated: false,
    };
  }
}
