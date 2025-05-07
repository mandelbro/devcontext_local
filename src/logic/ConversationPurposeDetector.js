/**
 * ConversationPurposeDetector.js
 *
 * Provides functionality to detect the purpose or intent of a conversation
 * by analyzing message content and patterns.
 */

import * as TextTokenizerLogic from "./TextTokenizerLogic.js";
import { executeQuery } from "../db.js";
import { v4 as uuidv4 } from "uuid";

/**
 * @typedef {Object} Message
 * @property {string} content - The content of the message
 * @property {string} role - The role of the sender (e.g., 'user', 'assistant')
 * @property {Date} [timestamp] - Optional timestamp of the message
 * @property {string[]} [entity_ids] - Optional array of referenced entity IDs
 */

/**
 * Purpose types with associated keywords and patterns
 */
const PURPOSE_TYPES = {
  debugging: {
    keywords: [
      "error",
      "stacktrace",
      "bug",
      "fix",
      "not working",
      "exception",
      "issue",
      "failed",
      "failing",
      "crash",
      "debug",
      "broken",
      "incorrect",
      "problem",
      "trouble",
      "unexpected",
      "diagnose",
      "investigate",
    ],
    patterns: [
      /TypeError:/i,
      /Error:/i,
      /Exception:/i,
      /failed with/i,
      /doesn't work/i,
      /not working/i,
      /unexpected behavior/i,
    ],
    weight: 1.0,
  },

  feature_planning: {
    keywords: [
      "requirement",
      "design",
      "new feature",
      "implement",
      "proposal",
      "roadmap",
      "spec",
      "specification",
      "plan",
      "architecture",
      "blueprint",
      "feature",
      "enhancement",
      "improvement",
      "add",
      "create",
      "develop",
      "extend",
    ],
    patterns: [
      /could we add/i,
      /we need to implement/i,
      /design for/i,
      /planning to/i,
      /we should build/i,
      /requirement is to/i,
    ],
    weight: 0.9,
  },

  code_review: {
    keywords: [
      "PR",
      "pull request",
      "LGTM",
      "suggestion",
      "change request",
      "review",
      "approve",
      "feedback",
      "comment",
      "revision",
      "looks good",
      "merge",
      "style",
      "convention",
      "readability",
      "clarity",
    ],
    patterns: [
      /pull request #\d+/i,
      /PR #\d+/i,
      /please review/i,
      /looks good to me/i,
      /suggested changes/i,
      /can you review/i,
    ],
    weight: 0.85,
  },

  learning: {
    keywords: [
      "learn",
      "understand",
      "explanation",
      "tutorial",
      "example",
      "how does",
      "what is",
      "meaning",
      "concept",
      "definition",
      "help me understand",
      "documentation",
      "guide",
      "explain",
      "clarify",
      "teach",
    ],
    patterns: [
      /how does (it|this) work/i,
      /what (is|does|are)/i,
      /could you explain/i,
      /I'm trying to understand/i,
      /explain how/i,
    ],
    weight: 0.8,
  },

  code_generation: {
    keywords: [
      "generate",
      "create",
      "build",
      "write",
      "implement",
      "code for",
      "function",
      "class",
      "method",
      "module",
      "script",
      "algorithm",
      "solution",
    ],
    patterns: [
      /can you (write|create|generate)/i,
      /implement a/i,
      /create a function/i,
      /generate code for/i,
      /need code to/i,
    ],
    weight: 0.9,
  },

  optimization: {
    keywords: [
      "optimize",
      "performance",
      "efficiency",
      "slow",
      "faster",
      "speed up",
      "reduce",
      "improve",
      "bottleneck",
      "memory",
      "CPU",
      "utilization",
      "profiling",
      "benchmark",
    ],
    patterns: [
      /too slow/i,
      /needs to be faster/i,
      /performance issue/i,
      /optimize for/i,
      /reduce (memory|time|usage)/i,
    ],
    weight: 0.85,
  },

  refactoring: {
    keywords: [
      "refactor",
      "restructure",
      "rewrite",
      "reorganize",
      "clean up",
      "improve",
      "modernize",
      "update",
      "simplify",
      "decouple",
      "modularity",
      "readability",
    ],
    patterns: [
      /need to refactor/i,
      /code smells/i,
      /technical debt/i,
      /simplify the code/i,
      /make it more maintainable/i,
    ],
    weight: 0.8,
  },

  general_query: {
    keywords: [
      "question",
      "ask",
      "wondering",
      "curious",
      "thoughts",
      "opinion",
      "advice",
      "suggestion",
      "recommend",
      "help",
      "guidance",
    ],
    patterns: [
      /I have a question/i,
      /can you help/i,
      /what do you think/i,
      /do you have any advice/i,
    ],
    weight: 0.7, // Lower weight as this is the default fallback
  },
};

/**
 * Detects the primary purpose of a conversation by analyzing message content
 *
 * @param {Message|Message[]} messages - Message or array of conversation messages to analyze
 * @returns {Promise<{purposeType: string, confidence: number}>} The detected purpose and confidence score
 */
export async function detectConversationPurpose(messages) {
  try {
    if (!messages) {
      return { purposeType: "general_query", confidence: 0.5 };
    }

    // Normalize input to always be an array
    const messageArray = Array.isArray(messages) ? messages : [messages];

    if (messageArray.length === 0) {
      return { purposeType: "general_query", confidence: 0.5 };
    }

    // 1. Concatenate the content of messages, giving priority to user messages
    let concatenatedContent = "";
    // Convert message format if it's from database (with messageId vs id)
    const normalizedMessages = messageArray.map((msg) => ({
      role: msg.role || (msg.messageId ? "user" : "user"), // Default to user if role is missing
      content: msg.content || "",
    }));

    const userMessages = normalizedMessages.filter(
      (msg) => msg.role === "user"
    );

    if (userMessages.length > 0) {
      // If we have user messages, prioritize those
      concatenatedContent = userMessages.map((msg) => msg.content).join(" ");
    } else {
      // Otherwise use all messages
      concatenatedContent = normalizedMessages
        .map((msg) => msg.content)
        .join(" ");
    }

    // 2. Tokenize and extract keywords
    const tokens = TextTokenizerLogic.tokenize(concatenatedContent);
    const extractedKeywords = TextTokenizerLogic.extractKeywords(tokens, 20);

    // 3. Score each purpose type
    const purposeScores = {};

    for (const [purposeType, purposeData] of Object.entries(PURPOSE_TYPES)) {
      let score = 0;

      // Score based on keyword matches
      for (const keyword of purposeData.keywords) {
        if (concatenatedContent.toLowerCase().includes(keyword.toLowerCase())) {
          score += 1;
        }

        // Check for keyword in extracted keywords (stronger signal)
        if (
          extractedKeywords.some(
            (k) =>
              typeof k === "string" && k.toLowerCase() === keyword.toLowerCase()
          )
        ) {
          score += 2;
        }
      }

      // Score based on pattern matches
      for (const pattern of purposeData.patterns) {
        if (pattern.test(concatenatedContent)) {
          score += 3; // Patterns are stronger signals
        }
      }

      // Apply purpose-specific weight
      score *= purposeData.weight;

      // Store the score
      purposeScores[purposeType] = score;
    }

    // 4. Find the purpose with the highest score
    let highestScore = 0;
    let detectedPurpose = "general_query"; // Default

    for (const [purposeType, score] of Object.entries(purposeScores)) {
      if (score > highestScore) {
        highestScore = score;
        detectedPurpose = purposeType;
      }
    }

    // 5. Calculate confidence (normalize score)
    // Find max possible score for the detected purpose type
    const maxPossibleScore =
      PURPOSE_TYPES[detectedPurpose].keywords.length * 3 + // Max keyword match score
      PURPOSE_TYPES[detectedPurpose].patterns.length * 3; // Max pattern match score

    // Normalize the confidence between 0 and 1
    // Add a base confidence of 0.3 so it's never too low
    let confidence =
      0.3 +
      0.7 *
        (highestScore /
          (maxPossibleScore * PURPOSE_TYPES[detectedPurpose].weight));

    // Cap confidence at 1.0
    confidence = Math.min(confidence, 1.0);

    // If the highest score is very low, default to general_query with moderate confidence
    if (highestScore < 3 && detectedPurpose !== "general_query") {
      return { purposeType: "general_query", confidence: 0.6 };
    }

    return { purposeType: detectedPurpose, confidence };
  } catch (error) {
    console.error("Error detecting conversation purpose:", error);
    // Fallback to general query with low confidence
    return { purposeType: "general_query", confidence: 0.5 };
  }
}

/**
 * @typedef {Object} ConversationPurpose
 * @property {string} purpose_id - Unique identifier for the purpose record
 * @property {string} conversation_id - ID of the conversation
 * @property {string} purpose_type - Type of purpose (e.g., 'debugging', 'feature_planning')
 * @property {number} confidence - Confidence score for this purpose (0-1)
 * @property {string} start_timestamp - ISO timestamp when this purpose was detected
 * @property {string|null} end_timestamp - ISO timestamp when this purpose ended, or null if active
 */

/**
 * Gets the currently active purpose for a conversation
 *
 * @param {string} conversationId - ID of the conversation
 * @returns {Promise<ConversationPurpose|null>} The active purpose or null if none
 */
export async function getActivePurpose(conversationId) {
  try {
    // Query for active purpose (where end_timestamp is NULL)
    const query = `
      SELECT * FROM conversation_purposes
      WHERE conversation_id = ?
        AND end_timestamp IS NULL
      ORDER BY start_timestamp DESC
      LIMIT 1
    `;

    const result = await executeQuery(query, [conversationId]);

    // Check if result has a rows property and it's an array
    const rows =
      result && result.rows && Array.isArray(result.rows)
        ? result.rows
        : Array.isArray(result)
        ? result
        : [];

    // If no valid results, return null
    if (rows.length === 0) {
      return null;
    }

    // Return the active purpose (the most recent one if multiple exist)
    return rows[0];
  } catch (error) {
    console.error(
      `Error getting active purpose for conversation ${conversationId}:`,
      error
    );
    throw new Error(`Failed to get active purpose: ${error.message}`);
  }
}

/**
 * Records a transition to a new conversation purpose
 *
 * @param {string} conversationId - ID of the conversation
 * @param {string} previousPurposeType - The previously active purpose type (if any)
 * @param {string} newPurposeType - The new detected purpose type
 * @param {string} [triggerMessageId] - ID of the message that triggered this transition
 * @param {number} [confidence=0.7] - Confidence score for this purpose detection (0-1)
 * @returns {Promise<string>} The ID of the newly created purpose record
 */
export async function trackPurposeTransition(
  conversationId,
  previousPurposeType,
  newPurposeType,
  triggerMessageId,
  confidence = 0.7
) {
  try {
    // 1. Get current active purpose for the conversation
    const activePurpose = await getActivePurpose(conversationId);

    // 2. If there's an active purpose and it's different from the new one, close it
    if (activePurpose && activePurpose.purpose_type !== newPurposeType) {
      const currentTime = new Date().toISOString();

      const updateQuery = `
        UPDATE conversation_purposes
        SET end_timestamp = ?
        WHERE purpose_id = ?
      `;

      await executeQuery(updateQuery, [currentTime, activePurpose.purpose_id]);

      console.log(
        `Closed purpose ${activePurpose.purpose_type} for conversation ${conversationId}`
      );
    } else if (activePurpose && activePurpose.purpose_type === newPurposeType) {
      // If the same purpose is already active, just return its ID
      return activePurpose.purpose_id;
    }

    // 3. Generate a new purpose_id
    const purpose_id = uuidv4();

    // 4. Get current timestamp for start_timestamp
    const start_timestamp = new Date().toISOString();

    // 5. Prepare metadata with trigger message ID if provided
    const metadata = triggerMessageId
      ? JSON.stringify({ trigger_message_id: triggerMessageId })
      : null;

    // 6. Insert the new purpose record
    const insertQuery = `
      INSERT INTO conversation_purposes (
        purpose_id,
        conversation_id,
        purpose_type,
        confidence,
        start_timestamp,
        metadata
      ) VALUES (?, ?, ?, ?, ?, ?)
    `;

    const params = [
      purpose_id,
      conversationId,
      newPurposeType,
      confidence,
      start_timestamp,
      metadata,
    ];

    await executeQuery(insertQuery, params);

    console.log(
      `Created new purpose record: ${newPurposeType} (${purpose_id}) for conversation ${conversationId}`
    );

    // 7. Return the purpose_id
    return purpose_id;
  } catch (error) {
    console.error(
      `Error tracking purpose transition for conversation ${conversationId}:`,
      error
    );
    throw new Error(`Failed to track purpose transition: ${error.message}`);
  }
}

/**
 * Gets the full history of purposes for a conversation
 *
 * @param {string} conversationId - ID of the conversation
 * @returns {Promise<ConversationPurpose[]>} Array of purpose records in chronological order
 */
export async function getPurposeHistory(conversationId) {
  try {
    // Query for all purposes for this conversation, ordered chronologically
    const query = `
      SELECT * FROM conversation_purposes
      WHERE conversation_id = ?
      ORDER BY start_timestamp ASC
    `;

    const result = await executeQuery(query, [conversationId]);

    // Return the array of purpose objects (empty array if none found)
    return result || [];
  } catch (error) {
    console.error(
      `Error getting purpose history for conversation ${conversationId}:`,
      error
    );
    throw new Error(`Failed to get purpose history: ${error.message}`);
  }
}

/**
 * Purpose-specific prompt configurations
 */
const PURPOSE_PROMPTS = {
  debugging: {
    systemPrompt:
      "You are a debugging assistant. Focus on identifying errors and suggesting fixes for code issues. Analyze stack traces, error messages, and code snippets to help resolve problems efficiently.",
    modelBehavior:
      "Ask clarifying questions about error messages and code snippets. Provide step-by-step solutions. Be methodical in your approach. Look for common error patterns and suggest targeted debugging techniques.",
  },

  feature_planning: {
    systemPrompt:
      "You are a feature planning assistant. Help outline requirements, define scope, and create implementation tasks for new features. Consider architecture implications and integration points.",
    modelBehavior:
      "Break down complex features into manageable components. Discuss pros and cons of different design choices. Ask about constraints, requirements, and priorities. Suggest testing strategies and potential edge cases to consider.",
  },

  code_review: {
    systemPrompt:
      "You are a code review assistant. Help identify issues, suggest improvements, and ensure code quality. Focus on readability, performance, security, and maintainability.",
    modelBehavior:
      "Examine code thoroughly for bugs, edge cases, and potential improvements. Suggest more elegant or efficient approaches when appropriate. Reference best practices and design patterns. Be constructive and specific in feedback.",
  },

  learning: {
    systemPrompt:
      "You are a programming tutor. Focus on explaining concepts, providing clear examples, and building understanding. Adapt explanations to different knowledge levels.",
    modelBehavior:
      "Provide concise but thorough explanations. Use analogies and examples to illustrate complex concepts. Check understanding with questions. Encourage experimentation and hands-on learning. Break down complex topics into smaller chunks.",
  },

  code_generation: {
    systemPrompt:
      "You are a code generation assistant. Create high-quality, functional code that meets requirements while following best practices and project conventions.",
    modelBehavior:
      "Ask clarifying questions about requirements. Generate well-structured, well-documented, and tested code. Explain key design decisions. Suggest alternative implementations when appropriate. Follow idiomatic patterns for the language.",
  },

  optimization: {
    systemPrompt:
      "You are a performance optimization assistant. Help identify bottlenecks and suggest improvements to make code more efficient in terms of speed, memory usage, and resource utilization.",
    modelBehavior:
      "Ask for profiling data when available. Suggest specific optimization techniques. Explain tradeoffs between different approaches. Focus on high-impact changes first. Recommend measurement techniques to verify improvements.",
  },

  refactoring: {
    systemPrompt:
      "You are a code refactoring assistant. Help improve code structure, readability, and maintainability without changing functionality. Suggest cleaner, more modular designs.",
    modelBehavior:
      "Analyze code for code smells and improvement opportunities. Suggest refactoring in small, testable steps. Explain the benefits of each change. Follow established design principles and patterns. Consider readability and future maintenance.",
  },

  general_query: {
    systemPrompt:
      "You are a helpful programming assistant. Provide accurate and relevant information to help with coding tasks, questions, and challenges.",
    modelBehavior:
      "Answer questions clearly and concisely. Provide context-relevant code examples when appropriate. Ask clarifying questions if the request is ambiguous. Be factual and admit when you don't know something.",
  },
};

/**
 * Returns optimized prompts based on the detected conversation purpose
 *
 * @param {string} purposeType - The type of conversation purpose
 * @returns {{systemPrompt: string, modelBehavior: string}} Object containing prompts optimized for the purpose
 */
export function getPurposeSpecificPrompts(purposeType) {
  // Look up the purpose type in our predefined prompts
  if (PURPOSE_PROMPTS[purposeType]) {
    return PURPOSE_PROMPTS[purposeType];
  }

  // Default to general_query for unknown purpose types
  return PURPOSE_PROMPTS.general_query;
}

/**
 * Purpose-specific actionable request patterns
 */
const PURPOSE_ACTION_PATTERNS = {
  debugging: {
    keywords: [
      "fix",
      "debug",
      "solve",
      "troubleshoot",
      "resolve",
      "diagnose",
      "analyze",
      "investigate",
      "find the bug",
      "identify the issue",
      "fix this error",
      "help me understand",
      "what's wrong",
      "why is this failing",
    ],
    patterns: [
      /how (do|can|should) I fix/i,
      /what('s| is) causing/i,
      /why (am I|is it) getting/i,
      /can you (help me|assist|fix|debug|solve)/i,
      /suggest a (fix|solution)/i,
    ],
  },

  feature_planning: {
    keywords: [
      "design",
      "plan",
      "create",
      "implement",
      "develop",
      "architect",
      "draft",
      "outline",
      "structure",
      "requirements",
      "specification",
      "roadmap",
    ],
    patterns: [
      /how (do|can|should) I (design|implement|structure)/i,
      /what('s| is) the best way to (design|implement)/i,
      /help me (plan|design|create|outline)/i,
      /can you (draft|create|help with)/i,
      /suggest an? (architecture|approach|design)/i,
    ],
  },

  code_review: {
    keywords: [
      "review",
      "evaluate",
      "assess",
      "improve",
      "feedback",
      "suggestion",
      "better way",
      "optimize",
      "refactor",
      "check",
    ],
    patterns: [
      /can you (review|look at|check)/i,
      /what do you think (of|about)/i,
      /how (can|could|would) (I|this|we) improve/i,
      /is there a (better|cleaner|more efficient) way/i,
      /please (review|evaluate|assess)/i,
    ],
  },

  code_generation: {
    keywords: [
      "generate",
      "write",
      "create",
      "implement",
      "code",
      "script",
      "function",
      "class",
      "method",
      "program",
      "example",
      "show me how",
    ],
    patterns: [
      /can you (write|create|generate|implement|show me)/i,
      /how (do|would) I (write|create|implement)/i,
      /write a (function|class|method|program)/i,
      /generate (code|a script|an example)/i,
      /implement a (solution|feature|function)/i,
    ],
  },

  learning: {
    keywords: [
      "explain",
      "teach",
      "help me understand",
      "clarify",
      "what is",
      "how does",
      "why",
      "concept",
      "tutorial",
      "example",
      "guidance",
    ],
    patterns: [
      /can you (explain|clarify|teach me)/i,
      /what (is|are|does)/i,
      /how does (it|this|that) work/i,
      /why (is|does|do)/i,
      /I don't understand/i,
      /help me understand/i,
    ],
  },

  optimization: {
    keywords: [
      "optimize",
      "improve",
      "speed up",
      "performance",
      "efficiency",
      "faster",
      "memory",
      "resource",
      "bottleneck",
      "profile",
      "benchmark",
    ],
    patterns: [
      /how (can|do) I (optimize|improve|speed up)/i,
      /can you help (optimize|improve)/i,
      /make (it|this) (faster|more efficient)/i,
      /reduce (memory|CPU|resource) usage/i,
      /find the (bottleneck|performance issue)/i,
    ],
  },

  refactoring: {
    keywords: [
      "refactor",
      "restructure",
      "reorganize",
      "clean up",
      "improve readability",
      "simplify",
      "modernize",
      "update",
      "better structure",
      "clean code",
    ],
    patterns: [
      /how (can|do) I (refactor|restructure|improve)/i,
      /can you (help|assist with) refactoring/i,
      /make (it|this) (cleaner|more readable|more maintainable)/i,
      /improve (the structure|readability|maintainability)/i,
      /simplify this (code|implementation|approach)/i,
    ],
  },

  general_query: {
    keywords: [
      "how to",
      "can you",
      "please",
      "show me",
      "find",
      "search",
      "where is",
      "display",
      "tell me",
    ],
    patterns: [
      /can you (help|show|find|tell)/i,
      /how (do|can|would) I/i,
      /please (show|find|tell|help)/i,
      /I need to/i,
      /where (can|do) I/i,
    ],
  },
};

// General actionable request patterns that apply across all purpose types
const GENERAL_ACTION_PATTERNS = {
  keywords: [
    "create",
    "generate",
    "build",
    "write",
    "implement",
    "show",
    "display",
    "list",
    "find",
    "search",
    "analyze",
    "compare",
    "calculate",
    "run",
    "execute",
    "update",
    "modify",
    "change",
    "add",
    "remove",
    "delete",
  ],
  patterns: [
    /can you/i,
    /please/i,
    /I need/i,
    /could you/i,
    /would you/i,
    /show me/i,
    /help me/i,
    /let's/i,
    /how (do|can|should) I/i,
    /what (is|are) the/i,
  ],
  // Common question structures that often indicate actionable requests
  questionPatterns: [
    /\?$/, // Ends with question mark
    /^(what|how|where|when|who|why|can|could|would|should|is|are|do|does)/i, // Starts with question word
  ],
};

/**
 * Determines if a message contains an actionable request based on its content and purpose
 *
 * @param {string} messageContent - The content of the message to analyze
 * @param {string} purposeType - The type of conversation purpose
 * @returns {boolean} True if the message contains an actionable request, false otherwise
 */
export function isActionableRequest(messageContent, purposeType) {
  if (!messageContent || typeof messageContent !== "string") {
    return false;
  }

  // Normalize message content
  const content = messageContent.toLowerCase().trim();

  // Very short messages are less likely to be actionable
  if (content.length < 5) {
    return false;
  }

  // Get purpose-specific patterns
  const purposePatterns =
    PURPOSE_ACTION_PATTERNS[purposeType] ||
    PURPOSE_ACTION_PATTERNS.general_query;

  // Check against purpose-specific keywords
  for (const keyword of purposePatterns.keywords) {
    if (content.includes(keyword.toLowerCase())) {
      return true;
    }
  }

  // Check against purpose-specific patterns
  for (const pattern of purposePatterns.patterns) {
    if (pattern.test(content)) {
      return true;
    }
  }

  // Check against general action keywords
  for (const keyword of GENERAL_ACTION_PATTERNS.keywords) {
    // Look for complete words by using word boundaries
    const regex = new RegExp(`\\b${keyword}\\b`, "i");
    if (regex.test(content)) {
      return true;
    }
  }

  // Check against general action patterns
  for (const pattern of GENERAL_ACTION_PATTERNS.patterns) {
    if (pattern.test(content)) {
      // For general patterns, require a bit more confidence
      // Either the message must be relatively long or it must contain a clear directive
      if (
        content.length > 15 ||
        /^(please|can you|could you|would you|help me)/i.test(content)
      ) {
        return true;
      }
    }
  }

  // Check if it's a question (questions are often actionable)
  for (const pattern of GENERAL_ACTION_PATTERNS.questionPatterns) {
    if (pattern.test(content) && content.length > 10) {
      return true;
    }
  }

  // If none of the patterns matched, it's likely not an actionable request
  return false;
}

/**
 * @typedef {Object} Pattern
 * @property {string} pattern_id - Unique identifier for the pattern
 * @property {string} name - Name of the pattern
 * @property {string} description - Description of the pattern
 * @property {string} pattern_type - Type/category of the pattern
 * @property {string} pattern_data - JSON string containing the pattern data
 * @property {boolean} is_global - Whether this is a global pattern
 * @property {number} utility_score - Score indicating the utility of the pattern
 * @property {number} confidence_score - Score indicating confidence in the pattern
 * @property {string} created_at - Timestamp when the pattern was created
 * @property {string} last_used - Timestamp when the pattern was last used
 * @property {number} use_count - Number of times the pattern has been used
 */

/**
 * Purpose to pattern type mapping and relevant keywords
 */
const PURPOSE_PATTERN_MAPPING = {
  debugging: {
    patternTypes: [
      "debugging_common_error_fix",
      "error_handling",
      "bug_fix",
      "troubleshooting",
      "error_pattern",
    ],
    keywords: [
      "debug",
      "error",
      "exception",
      "fix",
      "bug",
      "issue",
      "resolve",
      "problem",
      "crash",
      "failure",
      "unexpected",
    ],
  },

  feature_planning: {
    patternTypes: [
      "feature_template",
      "design_pattern",
      "architecture",
      "planning",
      "requirements",
    ],
    keywords: [
      "feature",
      "design",
      "plan",
      "architecture",
      "structure",
      "requirement",
      "specification",
      "implementation",
      "organize",
    ],
  },

  code_review: {
    patternTypes: [
      "code_review",
      "quality_check",
      "best_practice",
      "code_standard",
      "linter_rule",
    ],
    keywords: [
      "review",
      "quality",
      "standard",
      "convention",
      "best practice",
      "style",
      "formatting",
      "consistency",
      "readability",
      "maintainability",
    ],
  },

  learning: {
    patternTypes: [
      "tutorial",
      "learning_example",
      "concept_explanation",
      "educational_pattern",
      "learning_path",
    ],
    keywords: [
      "learn",
      "tutorial",
      "example",
      "explanation",
      "concept",
      "guide",
      "understand",
      "teach",
      "educational",
      "introduction",
    ],
  },

  code_generation: {
    patternTypes: [
      "code_template",
      "code_generation",
      "boilerplate",
      "snippet",
      "example_implementation",
    ],
    keywords: [
      "generate",
      "create",
      "template",
      "boilerplate",
      "skeleton",
      "sample",
      "example",
      "implementation",
      "snippet",
      "scaffold",
    ],
  },

  optimization: {
    patternTypes: [
      "performance_optimization",
      "efficiency_pattern",
      "resource_usage",
      "optimization_technique",
      "bottleneck_fix",
    ],
    keywords: [
      "optimize",
      "performance",
      "efficiency",
      "speed",
      "memory",
      "resource",
      "bottleneck",
      "fast",
      "slow",
      "improve",
    ],
  },

  refactoring: {
    patternTypes: [
      "refactoring_pattern",
      "code_cleanup",
      "restructuring",
      "code_improvement",
      "modernization",
    ],
    keywords: [
      "refactor",
      "cleanup",
      "improve",
      "restructure",
      "simplify",
      "readability",
      "maintainability",
      "technical debt",
      "modernize",
    ],
  },

  general_query: {
    patternTypes: [
      "general_pattern",
      "utility",
      "common_solution",
      "frequently_used",
      "general_purpose",
    ],
    keywords: [
      "common",
      "general",
      "utility",
      "helper",
      "frequently",
      "standard",
      "basic",
      "typical",
      "regular",
      "normal",
    ],
  },
};

/**
 * Retrieves patterns relevant to a specific conversation purpose
 *
 * @param {string} purposeType - The type of conversation purpose
 * @returns {Promise<Pattern[]>} Array of patterns relevant to the specified purpose
 */
export async function getPurposeCorrelatedPatterns(purposeType) {
  try {
    // 1. Get the pattern types and keywords relevant to this purpose
    const purposeMapping =
      PURPOSE_PATTERN_MAPPING[purposeType] ||
      PURPOSE_PATTERN_MAPPING.general_query;
    const { patternTypes, keywords } = purposeMapping;

    // 2. Build pattern type condition for SQL
    const patternTypeCondition = patternTypes
      .map(() => "pattern_type = ?")
      .join(" OR ");

    // 3. Build keyword LIKE conditions for description search
    const keywordConditions = keywords
      .map(() => "description LIKE ?")
      .join(" OR ");

    // 4. Combine the conditions with an OR
    const combinedCondition = `(${patternTypeCondition}) OR (${keywordConditions})`;

    // 5. Prepare the complete query with ordering by priority
    const query = `
      SELECT * FROM project_patterns
      WHERE ${combinedCondition}
      ORDER BY 
        is_global DESC,
        utility_score DESC,
        confidence_score DESC,
        use_count DESC
      LIMIT 20
    `;

    // 6. Prepare the parameters array
    const params = [
      ...patternTypes,
      ...keywords.map((keyword) => `%${keyword}%`),
    ];

    // 7. Execute the query
    const patterns = await executeQuery(query, params);

    // 8. Process and return the results
    return patterns || [];
  } catch (error) {
    console.error(
      `Error retrieving purpose correlated patterns for ${purposeType}:`,
      error
    );
    throw new Error(
      `Failed to get purpose correlated patterns: ${error.message}`
    );
  }
}

/**
 * Detects the initial purpose of a conversation based on the first query
 *
 * @param {string} conversationId - The ID of the conversation
 * @param {string} initialQuery - The initial query that started the conversation
 * @returns {Promise<{purposeType: string, confidence: number}>} The detected purpose and confidence
 */
export async function detectInitialPurpose(conversationId, initialQuery) {
  try {
    // Create a mock message from the initial query
    const message = {
      content: initialQuery,
      role: "user",
    };

    // Use the existing detection logic
    const result = await detectConversationPurpose([message]);

    if (!result || !result.purposeType) {
      // Default to general_query if no purpose is detected
      result.purposeType = "general_query";
      result.confidence = 0.5;
    }

    // Try to track this as the first purpose in the purpose history,
    // but don't block initialization if this fails (could be a foreign key constraint)
    try {
      await trackPurposeTransition(
        conversationId,
        result.purposeType,
        result.purposeType,
        null,
        result.confidence
      );

      console.log(
        `Initial purpose for conversation ${conversationId}: ${result.purposeType} (${result.confidence})`
      );
    } catch (trackingError) {
      console.error("Error tracking purpose transition:", trackingError);
      console.log(
        "Continuing with initialization despite purpose tracking error"
      );
    }

    return result;
  } catch (error) {
    console.error("Error detecting initial purpose:", error);

    // Default to general_query in case of error
    return {
      purposeType: "general_query",
      confidence: 0.5,
    };
  }
}

/**
 * Sets the active purpose for a conversation
 *
 * @param {string} conversationId - The ID of the conversation
 * @param {string} purposeType - The type of purpose to set
 * @param {number} confidence - Confidence score for the purpose (0-1)
 * @returns {Promise<void>}
 */
export async function setActivePurpose(
  conversationId,
  purposeType,
  confidence
) {
  try {
    if (!conversationId) {
      throw new Error("Conversation ID is required");
    }

    if (!purposeType) {
      throw new Error("Purpose type is required");
    }

    // Validate confidence score
    confidence = Math.max(0, Math.min(1, confidence));

    // First, close any existing active purpose
    const query1 = `
      UPDATE conversation_purposes
      SET end_timestamp = ?
      WHERE conversation_id = ? AND end_timestamp IS NULL
    `;
    await executeQuery(query1, [new Date().toISOString(), conversationId]);

    // Then create the new purpose record
    const purposeId = uuidv4();
    const startTimestamp = new Date().toISOString();

    const query2 = `
      INSERT INTO conversation_purposes (
        purpose_id,
        conversation_id,
        purpose_type,
        confidence,
        start_timestamp,
        end_timestamp
      ) VALUES (?, ?, ?, ?, ?, NULL)
    `;

    await executeQuery(query2, [
      purposeId,
      conversationId,
      purposeType,
      confidence,
      startTimestamp,
    ]);

    console.log(
      `Set active purpose for conversation ${conversationId} to ${purposeType} (${confidence})`
    );
  } catch (error) {
    console.error("Error setting active purpose:", error);
    throw new Error("Failed to set active purpose: " + error.message);
  }
}
