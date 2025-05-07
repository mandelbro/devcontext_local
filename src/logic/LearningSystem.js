/**
 * LearningSystem.js
 *
 * Background analysis of the codebase to extract and store reusable patterns.
 */

import { executeQuery } from "../db.js";
import * as SemanticPatternRecognizerLogic from "./SemanticPatternRecognizerLogic.js";
import * as CodeStructureAnalyzerLogic from "./CodeStructureAnalyzerLogic.js";
import * as ConversationIntelligence from "./ConversationIntelligence.js";
import * as GlobalPatternRepository from "./GlobalPatternRepository.js";
import * as TextTokenizerLogic from "./TextTokenizerLogic.js";
import { v4 as uuidv4 } from "uuid";
import { logMessage } from "../utils/logger.js";

/**
 * Performs background analysis of the entire project's codebase for patterns.
 *
 * @returns {Promise<void>}
 */
export async function extractPatternsFromCode() {
  try {
    logMessage("info", "[LearningSystem] Starting code pattern extraction...");
    // 1. Fetch all code entities of interest (functions, classes, methods)
    const query = `
      SELECT * FROM code_entities
      WHERE type IN ('function', 'class', 'method')
      LIMIT 1000
    `;
    const entities = await executeQuery(query, []);
    if (!entities || entities.length === 0) {
      logMessage(
        "info",
        "[LearningSystem] No code entities found for pattern extraction."
      );
      return;
    }
    logMessage(
      "info",
      `[LearningSystem] Analyzing ${entities.length} code entities...`
    );

    // 2. Analyze each entity for patterns
    for (const entity of entities) {
      try {
        // Recognize patterns in the entity
        const patterns = await SemanticPatternRecognizerLogic.recognizePatterns(
          entity
        );
        if (patterns && patterns.length > 0) {
          for (const pattern of patterns) {
            if (pattern.confidence && pattern.confidence >= 0.7) {
              // Store the pattern if not already stored
              await SemanticPatternRecognizerLogic.addPatternToRepository(
                pattern
              );
              logMessage(
                "info",
                `[LearningSystem] Pattern stored: ${pattern.name || pattern.id}`
              );
            }
          }
        }
      } catch (entityErr) {
        logMessage(
          "warn",
          `[LearningSystem] Error analyzing entity ${entity.id}:`,
          { error: entityErr.message }
        );
      }
    }

    // 3. Optionally, find groups of structurally similar entities
    try {
      const groups =
        await CodeStructureAnalyzerLogic.findStructurallySimilarEntities(
          entities
        );
      for (const group of groups) {
        try {
          const groupPattern =
            await SemanticPatternRecognizerLogic.generatePatternFromExamples(
              group
            );
          if (
            groupPattern &&
            groupPattern.confidence &&
            groupPattern.confidence >= 0.7
          ) {
            await SemanticPatternRecognizerLogic.addPatternToRepository(
              groupPattern
            );
            logMessage(
              "info",
              `[LearningSystem] Group pattern stored: ${
                groupPattern.name || groupPattern.id
              }`
            );
          }
        } catch (groupErr) {
          logMessage(
            "warn",
            "[LearningSystem] Error generating pattern from group:",
            { error: groupErr.message }
          );
        }
      }
    } catch (groupingErr) {
      logMessage(
        "warn",
        "[LearningSystem] Error finding structurally similar entity groups:",
        { error: groupingErr.message }
      );
    }

    logMessage("info", "[LearningSystem] Pattern extraction complete.");
  } catch (error) {
    logMessage(
      "error",
      "[LearningSystem] Fatal error during pattern extraction:",
      { error: error.message }
    );
  }
}

/**
 * Analyzes timeline_events and conversation_history to find patterns of tool usage, feature interaction, or problem-solving sequences.
 *
 * @returns {Promise<void>}
 */
export async function identifyUsagePatterns() {
  try {
    logMessage(
      "info",
      "[LearningSystem] Starting usage pattern identification..."
    );
    // 1. Fetch timeline events (limit for performance)
    const timelineQuery = `
      SELECT conversation_id, type, timestamp
      FROM timeline_events
      WHERE type IN ('search_query', 'file_edit', 'milestone_created', 'new_message', 'code_change', 'focus_change')
      ORDER BY conversation_id, timestamp ASC
      LIMIT 5000
    `;
    const events = await executeQuery(timelineQuery, []);
    if (!events || events.length === 0) {
      logMessage(
        "info",
        "[LearningSystem] No timeline events found for usage pattern analysis."
      );
      return;
    }

    // 2. Group events by conversation
    const eventsByConversation = {};
    for (const event of events) {
      if (!eventsByConversation[event.conversation_id]) {
        eventsByConversation[event.conversation_id] = [];
      }
      eventsByConversation[event.conversation_id].push(event);
    }

    // 3. Analyze event type transitions (simple Markov chain/frequency count)
    const transitionCounts = {};
    for (const convId in eventsByConversation) {
      const convEvents = eventsByConversation[convId];
      for (let i = 0; i < convEvents.length - 1; i++) {
        const from = convEvents[i].type;
        const to = convEvents[i + 1].type;
        const key = `${from}=>${to}`;
        transitionCounts[key] = (transitionCounts[key] || 0) + 1;
      }
    }

    // 4. Find most common transitions (usage patterns)
    const sortedTransitions = Object.entries(transitionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10); // Top 10 patterns

    // 5. Store discovered patterns in project_patterns
    for (const [transition, count] of sortedTransitions) {
      const [from, to] = transition.split("=>");
      const pattern = {
        pattern_type: "usage_workflow",
        name: `Common transition: ${from} → ${to}`,
        description: `Frequently observed transition from ${from} to ${to} in user workflow.`,
        representation: JSON.stringify({ sequence: [from, to], count }),
        is_global: true,
        utility_score: count,
        confidence_score: Math.min(1, count / 10),
        created_at: new Date().toISOString(),
        last_used: null,
        use_count: 0,
      };
      // Insert into project_patterns (ignore duplicates for now)
      try {
        await executeQuery(
          `INSERT INTO project_patterns (pattern_type, name, description, representation, is_global, utility_score, confidence_score, created_at, last_used, use_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            pattern.pattern_type,
            pattern.name,
            pattern.description,
            pattern.representation,
            pattern.is_global ? 1 : 0,
            pattern.utility_score,
            pattern.confidence_score,
            pattern.created_at,
            pattern.last_used,
            pattern.use_count,
          ]
        );
        logMessage(
          "info",
          `[LearningSystem] Usage pattern stored: ${pattern.name}`
        );
      } catch (insertErr) {
        // Ignore duplicate errors, log others
        if (!/UNIQUE|duplicate/i.test(insertErr.message)) {
          logMessage("warn", "[LearningSystem] Error storing usage pattern:", {
            error: insertErr.message,
          });
        }
      }
    }

    logMessage(
      "info",
      "[LearningSystem] Usage pattern identification complete."
    );
  } catch (error) {
    logMessage(
      "error",
      "[LearningSystem] Fatal error during usage pattern identification:",
      { error: error.message }
    );
  }
}

/**
 * Analyzes context and activity leading up to and following a recorded milestone.
 *
 * @param {string} milestoneSnapshotId - The ID of the milestone snapshot
 * @returns {Promise<void>}
 */
export async function analyzePatternsAroundMilestone(milestoneSnapshotId) {
  try {
    logMessage(
      "info",
      `[LearningSystem] Analyzing patterns around milestone: ${milestoneSnapshotId}`
    );
    // 1. Retrieve the context_snapshots record
    const snapshotQuery = `SELECT * FROM context_states WHERE milestone_id = ?`;
    const snapshots = await executeQuery(snapshotQuery, [milestoneSnapshotId]);
    if (!snapshots || !snapshots.rows || snapshots.rows.length === 0) {
      logMessage(
        "warn",
        `[LearningSystem] No context snapshot found for milestone ${milestoneSnapshotId}`
      );
      return;
    }

    const snapshot = snapshots.rows[0];
    if (!snapshot) {
      logMessage(
        "warn",
        `[LearningSystem] Empty snapshot data for milestone ${milestoneSnapshotId}`
      );
      return;
    }

    // Safely extract properties with defaults
    const created_at = snapshot.created_at || new Date().toISOString();
    const focus_areas = snapshot.focus_areas || [];
    const conversation_id = snapshot.conversation_id;

    // Check if we have a valid conversation_id
    if (!conversation_id) {
      logMessage(
        "warn",
        `[LearningSystem] No conversation_id in snapshot for milestone ${milestoneSnapshotId}`
      );
      return;
    }

    const milestoneTime = new Date(created_at).getTime();
    const windowBeforeMs = 2 * 60 * 60 * 1000; // 2 hours before
    const windowAfterMs = 1 * 60 * 60 * 1000; // 1 hour after
    const windowStart = new Date(milestoneTime - windowBeforeMs).toISOString();
    const windowEnd = new Date(milestoneTime + windowAfterMs).toISOString();

    // 2. Fetch timeline events in the window
    const eventsQuery = `
      SELECT * FROM timeline_events
      WHERE conversation_id = ?
        AND timestamp >= ?
        AND timestamp <= ?
      ORDER BY timestamp ASC
    `;
    const events = await executeQuery(eventsQuery, [
      conversation_id,
      windowStart,
      windowEnd,
    ]);

    // Only proceed if we have events
    if (!events || !events.rows || events.rows.length === 0) {
      logMessage(
        "info",
        `[LearningSystem] No events found in the time window for milestone ${milestoneSnapshotId}`
      );
      return;
    }

    // Access the rows property correctly
    const eventRows = events.rows || [];

    // 3. Fetch conversation history in the window
    const historyQuery = `
      SELECT * FROM conversation_history
      WHERE conversation_id = ?
        AND timestamp >= ?
        AND timestamp <= ?
      ORDER BY timestamp ASC
    `;
    const messages = await executeQuery(historyQuery, [
      conversation_id,
      windowStart,
      windowEnd,
    ]);

    // Access the rows property correctly
    const messageRows = messages && messages.rows ? messages.rows : [];

    // 4. Analyze for patterns
    // a) Common code entities accessed
    const entityAccessCounts = {};
    for (const event of eventRows) {
      if (event.data) {
        try {
          const data =
            typeof event.data === "string"
              ? JSON.parse(event.data)
              : event.data;
          if (data.activeFile) {
            entityAccessCounts[data.activeFile] =
              (entityAccessCounts[data.activeFile] || 0) + 1;
          }
          if (data.relatedFiles && Array.isArray(data.relatedFiles)) {
            for (const file of data.relatedFiles) {
              entityAccessCounts[file] = (entityAccessCounts[file] || 0) + 1;
            }
          }
        } catch (err) {
          // Ignore parse errors
        }
      }
    }
    // b) Common search queries
    const searchQueries = eventRows
      .filter((e) => e.type === "search_query")
      .map((e) => {
        try {
          const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
          return data && data.query ? data.query : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    // c) Conversation topics/purposes
    // For simplicity, just count topic_segment_id and purpose_type in messages
    const topicCounts = {};
    const purposeCounts = {};
    for (const msg of messageRows) {
      if (msg.topic_segment_id) {
        topicCounts[msg.topic_segment_id] =
          (topicCounts[msg.topic_segment_id] || 0) + 1;
      }
      if (msg.purpose_type) {
        purposeCounts[msg.purpose_type] =
          (purposeCounts[msg.purpose_type] || 0) + 1;
      }
    }

    // 5. Log insights
    logMessage(
      "info",
      `[LearningSystem] Milestone ${milestoneSnapshotId} context analysis:`
    );
    logMessage("info", "  Most accessed code entities:", {
      entities: Object.entries(entityAccessCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
    });
    logMessage("info", "  Most common search queries:", {
      queries: searchQueries.slice(0, 5),
    });
    logMessage("info", "  Most discussed topics:", {
      topics: Object.entries(topicCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3),
    });
    logMessage("info", "  Most discussed purposes:", {
      purposes: Object.entries(purposeCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3),
    });

    // 6. Optionally reinforce patterns in project_patterns (not implemented in detail here)
    // This could update utility_score/confidence_score for patterns related to these entities/topics
    // ...

    logMessage(
      "info",
      `[LearningSystem] Analysis around milestone ${milestoneSnapshotId} complete.`
    );
  } catch (error) {
    logMessage(
      "error",
      `[LearningSystem] Error analyzing patterns around milestone ${milestoneSnapshotId}:`,
      { error: error.message }
    );
  }
}

/**
 * Analyzes a conversation for patterns when the conversation concludes.
 *
 * @param {string} conversationId - The ID of the conversation to analyze
 * @param {string} outcome - The outcome of the conversation (e.g., 'successful_debug', 'feature_planned')
 * @returns {Promise<void>}
 */
export async function analyzeConversationForPatterns(conversationId, outcome) {
  try {
    logMessage(
      "info",
      `[LearningSystem] Analyzing conversation ${conversationId} with outcome: ${outcome}`
    );

    // 1. Fetch the full conversation history
    const conversationHistory =
      await ConversationIntelligence.getConversationHistory(conversationId);
    if (!conversationHistory || conversationHistory.length === 0) {
      logMessage(
        "info",
        `[LearningSystem] No conversation history found for ${conversationId}`
      );
      return;
    }

    logMessage(
      "info",
      `[LearningSystem] Retrieved ${conversationHistory.length} messages for analysis`
    );

    // 2. Extract code entities mentioned in the conversation
    const codeEntityIds = new Set();

    for (const message of conversationHistory) {
      if (
        message.related_context_entity_ids &&
        Array.isArray(message.related_context_entity_ids)
      ) {
        message.related_context_entity_ids.forEach((id) =>
          codeEntityIds.add(id)
        );
      }
    }

    if (codeEntityIds.size === 0) {
      logMessage(
        "info",
        `[LearningSystem] No code entities found in conversation ${conversationId}`
      );
      return;
    }

    logMessage(
      "info",
      `[LearningSystem] Found ${codeEntityIds.size} unique code entities to analyze for patterns`
    );

    // 3. Fetch full details of each code entity
    const codeEntities = [];
    for (const entityId of codeEntityIds) {
      const entityQuery = `SELECT * FROM code_entities WHERE id = ?`;
      const [entity] = await executeQuery(entityQuery, [entityId]);

      if (entity) {
        codeEntities.push(entity);
      }
    }

    logMessage(
      "info",
      `[LearningSystem] Retrieved ${codeEntities.length} code entities for pattern recognition`
    );

    // 4. For each code entity, recognize patterns
    for (const entity of codeEntities) {
      try {
        // Recognize patterns in the entity
        const { patterns, confidence } =
          await SemanticPatternRecognizerLogic.recognizePatterns(entity);

        if (patterns && patterns.length > 0) {
          logMessage(
            "info",
            `[LearningSystem] Found ${patterns.length} patterns in entity ${entity.id}`
          );

          // For each pattern, consider adding to repository if confidence is high
          for (const pattern of patterns) {
            if (pattern.confidence && pattern.confidence >= 0.7) {
              // Add pattern to repository if it's new or interesting
              await SemanticPatternRecognizerLogic.addPatternToRepository(
                pattern
              );
              logMessage(
                "info",
                `[LearningSystem] Added pattern ${
                  pattern.id || pattern.name
                } to repository`
              );
            }
          }
        }
      } catch (error) {
        logMessage(
          "warn",
          `[LearningSystem] Error analyzing entity ${entity.id}:`,
          { error: error.message }
        );
      }
    }

    // 5. If the outcome was successful, reinforce patterns that were likely used
    if (
      outcome &&
      (outcome.includes("success") ||
        outcome === "feature_planned" ||
        outcome === "bug_fixed")
    ) {
      // Get all patterns that were recognized during this conversation
      const patternQuery = `
        SELECT DISTINCT p.pattern_id 
        FROM project_patterns p
        JOIN pattern_observations po ON p.pattern_id = po.pattern_id
        WHERE po.conversation_id = ?
      `;

      const patternIds = await executeQuery(patternQuery, [conversationId]);

      if (patternIds && patternIds.length > 0) {
        logMessage(
          "info",
          `[LearningSystem] Reinforcing ${patternIds.length} patterns based on successful outcome`
        );

        for (const { pattern_id } of patternIds) {
          await GlobalPatternRepository.reinforcePattern(
            pattern_id,
            "confirmation",
            { conversationId }
          );
          logMessage(
            "info",
            `[LearningSystem] Reinforced pattern ${pattern_id} based on successful outcome`
          );
        }
      }
    }

    logMessage(
      "info",
      `[LearningSystem] Completed pattern analysis for conversation ${conversationId}`
    );
  } catch (error) {
    logMessage(
      "error",
      `[LearningSystem] Error analyzing conversation patterns:`,
      { error: error.message }
    );
  }
}

/**
 * Promotes session-specific patterns to global patterns for reuse across multiple sessions.
 *
 * @param {string} sessionId - The ID of the session/conversation
 * @param {Object} [filterOptions] - Optional filtering options
 * @param {number} [filterOptions.minConfidence] - Minimum confidence score for patterns to be promoted
 * @returns {Promise<number>} The number of successfully promoted patterns
 */
export async function promoteSessionPatternsToGlobal(
  sessionId,
  filterOptions = {}
) {
  try {
    logMessage(
      "info",
      `[LearningSystem] Promoting session patterns to global for session ${sessionId}`
    );

    // Build the query with filtering options
    let query = `
      SELECT * FROM project_patterns 
      WHERE is_global = FALSE 
      AND session_origin_id = ?
    `;

    const params = [sessionId];

    // Apply minimum confidence filter if provided
    if (filterOptions.minConfidence !== undefined) {
      query += ` AND confidence_score >= ?`;
      params.push(filterOptions.minConfidence);
    }

    // Execute the query to get qualifying patterns
    const patterns = await executeQuery(query, params);

    if (!patterns || patterns.length === 0) {
      console.log(
        `[LearningSystem] No qualifying session patterns found for promotion in session ${sessionId}`
      );
      return 0;
    }

    console.log(
      `[LearningSystem] Found ${patterns.length} session patterns qualifying for promotion to global`
    );

    // Counter for successfully promoted patterns
    let promotedCount = 0;

    // Promote each qualifying pattern
    for (const pattern of patterns) {
      try {
        await GlobalPatternRepository.promotePatternToGlobal(
          pattern.pattern_id,
          pattern.confidence_score
        );

        promotedCount++;
        console.log(
          `[LearningSystem] Successfully promoted pattern ${pattern.pattern_id} to global`
        );
      } catch (error) {
        console.warn(
          `[LearningSystem] Error promoting pattern ${pattern.pattern_id} to global:`,
          error
        );
        // Continue with the next pattern even if one fails
      }
    }

    console.log(
      `[LearningSystem] Completed pattern promotion. ${promotedCount}/${patterns.length} patterns promoted successfully`
    );
    return promotedCount;
  } catch (error) {
    console.error(
      `[LearningSystem] Error promoting session patterns to global:`,
      error
    );
    return 0;
  }
}

/**
 * Enriches context with applicable global patterns
 *
 * @param {Array} context - An array of CodeEntity or ContextSnippet objects
 * @param {Object} [filterOptions] - Optional filtering options for patterns
 * @param {number} [filterOptions.minConfidence] - Minimum confidence score for patterns to consider
 * @returns {Promise<Array>} The enriched context with matched global patterns
 */
export async function applyGlobalPatternsToContext(
  context,
  filterOptions = {}
) {
  try {
    console.log(`[LearningSystem] Enriching context with global patterns`);

    if (!context || !Array.isArray(context) || context.length === 0) {
      console.log(
        `[LearningSystem] No context items provided for pattern enrichment`
      );
      return context;
    }

    // 1. Retrieve relevant global patterns using GlobalPatternRepository
    const globalPatterns = await GlobalPatternRepository.retrieveGlobalPatterns(
      filterOptions
    );

    if (!globalPatterns || globalPatterns.length === 0) {
      console.log(
        `[LearningSystem] No global patterns found with the specified criteria`
      );
      return context;
    }

    console.log(
      `[LearningSystem] Retrieved ${globalPatterns.length} global patterns for matching`
    );

    // 2. For each item in the context, try to match global patterns
    const enrichedContext = await Promise.all(
      context.map(async (item) => {
        // Create a copy of the item to avoid mutating the original
        const enrichedItem = { ...item, matched_global_patterns: [] };

        // Extract necessary content from item (could be a CodeEntity or ContextSnippet)
        const content =
          item.content || item.raw_content || item.summarizedContent;

        if (!content) {
          return enrichedItem; // Skip if no content available
        }

        // Get the item type (for type-specific pattern matching)
        const itemType = item.type || "unknown";

        // Extract textual features for pattern matching
        const tokenizedContent = TextTokenizerLogic.tokenize(content);
        const keywords = TextTokenizerLogic.extractKeywords(tokenizedContent);

        // Try to extract or use provided structural features
        let structuralFeatures = item.custom_metadata?.structuralFeatures || {};

        // For each global pattern, attempt to match against this item
        const matchPromises = globalPatterns.map(async (pattern) => {
          try {
            // Similar to matchPattern in SemanticPatternRecognizerLogic but simplified
            const { detection_rules } = pattern;
            let textualMatchScore = 0;
            let structuralMatchScore = 0;
            let typeMatchScore = 0;

            // Check if pattern applies to this item type
            if (
              detection_rules.applicable_types &&
              Array.isArray(detection_rules.applicable_types)
            ) {
              typeMatchScore = detection_rules.applicable_types.includes(
                itemType
              )
                ? 1
                : 0;

              // If pattern explicitly doesn't apply to this type and strict matching is enabled, skip
              if (
                typeMatchScore === 0 &&
                detection_rules.strict_type_matching
              ) {
                return { pattern, confidence: 0 };
              }
            } else {
              // If no type restrictions, full score
              typeMatchScore = 1;
            }

            // Perform textual matching with keywords
            if (
              detection_rules.keywords &&
              Array.isArray(detection_rules.keywords)
            ) {
              const keywordMatches = detection_rules.keywords.filter(
                (keyword) =>
                  keywords.some((k) =>
                    typeof k === "string"
                      ? k === keyword
                      : k.keyword === keyword
                  )
              );

              textualMatchScore =
                keywordMatches.length / detection_rules.keywords.length;
            }

            // Check for text patterns
            if (
              detection_rules.text_patterns &&
              Array.isArray(detection_rules.text_patterns)
            ) {
              let patternMatchCount = 0;

              for (const textPattern of detection_rules.text_patterns) {
                if (typeof textPattern === "string") {
                  if (content.includes(textPattern)) {
                    patternMatchCount++;
                  }
                } else if (
                  textPattern instanceof RegExp ||
                  (typeof textPattern === "object" && textPattern.pattern)
                ) {
                  // Handle regex pattern objects
                  const patternObj =
                    textPattern instanceof RegExp
                      ? textPattern
                      : new RegExp(
                          textPattern.pattern,
                          textPattern.flags || ""
                        );

                  if (patternObj.test(content)) {
                    patternMatchCount++;
                  }
                }
              }

              const textPatternScore =
                detection_rules.text_patterns.length > 0
                  ? patternMatchCount / detection_rules.text_patterns.length
                  : 0;

              // Combine with keyword score
              textualMatchScore =
                textualMatchScore > 0
                  ? (textualMatchScore + textPatternScore) / 2
                  : textPatternScore;
            }

            // Perform structural matching if we have structural rules and features
            if (
              detection_rules.structural_rules &&
              Array.isArray(detection_rules.structural_rules) &&
              Object.keys(structuralFeatures).length > 0
            ) {
              let structRuleMatchCount = 0;

              for (const rule of detection_rules.structural_rules) {
                const { feature, condition, value } = rule;

                // Skip invalid rules
                if (!feature || !condition || value === undefined) continue;

                // Get the actual feature value
                const featureValue = structuralFeatures[feature];

                // Skip if feature doesn't exist
                if (featureValue === undefined) continue;

                // Evaluate condition
                let matches = false;

                switch (condition) {
                  case "equals":
                    matches = featureValue === value;
                    break;
                  case "contains":
                    matches = Array.isArray(featureValue)
                      ? featureValue.includes(value)
                      : String(featureValue).includes(String(value));
                    break;
                  case "greater_than":
                    matches = Number(featureValue) > Number(value);
                    break;
                  case "less_than":
                    matches = Number(featureValue) < Number(value);
                    break;
                  case "matches_regex":
                    matches = new RegExp(value).test(String(featureValue));
                    break;
                  default:
                    matches = false;
                }

                if (matches) {
                  structRuleMatchCount++;
                }
              }

              structuralMatchScore =
                detection_rules.structural_rules.length > 0
                  ? structRuleMatchCount /
                    detection_rules.structural_rules.length
                  : 0;
            }

            // Calculate combined confidence
            const weights = detection_rules.weights || {
              textual: 0.6, // Give more weight to textual matching for context items
              structural: 0.3,
              type: 0.1,
            };

            // Calculate weighted average
            const confidence =
              textualMatchScore * weights.textual +
              structuralMatchScore * weights.structural +
              typeMatchScore * weights.type;

            return {
              pattern,
              confidence,
              textualMatchScore,
              structuralMatchScore,
              typeMatchScore,
            };
          } catch (error) {
            console.warn(
              `[LearningSystem] Error matching pattern ${pattern.pattern_id}:`,
              error
            );
            return { pattern, confidence: 0 };
          }
        });

        // Wait for all pattern matching to complete
        const matchResults = await Promise.all(matchPromises);

        // Filter for patterns with significant match confidence and sort by confidence
        const significantMatches = matchResults
          .filter((result) => result.confidence > 0.3) // Only include significant matches
          .sort((a, b) => b.confidence - a.confidence);

        // Add matched patterns to the enriched item
        if (significantMatches.length > 0) {
          enrichedItem.matched_global_patterns = significantMatches.map(
            (match) => ({
              pattern_id: match.pattern.pattern_id,
              pattern_type: match.pattern.pattern_type,
              name: match.pattern.name,
              description: match.pattern.description,
              confidence: match.confidence,
              match_details: {
                textual_score: match.textualMatchScore,
                structural_score: match.structuralMatchScore,
                type_score: match.typeMatchScore,
              },
            })
          );

          console.log(
            `[LearningSystem] Found ${
              enrichedItem.matched_global_patterns.length
            } matching patterns for item ${
              item.id || item.entity_id || "unknown"
            }`
          );
        }

        return enrichedItem;
      })
    );

    console.log(
      `[LearningSystem] Completed context enrichment with global patterns`
    );
    return enrichedContext;
  } catch (error) {
    console.error(
      `[LearningSystem] Error applying global patterns to context:`,
      error
    );
    // In case of error, return the original context to avoid data loss
    return context;
  }
}

/**
 * Records pattern application success or failure for reinforcement learning
 *
 * @param {string} patternId - The ID of the pattern that was applied
 * @param {boolean} successful - Whether the pattern application was successful
 * @param {string} [conversationId] - Optional ID of the conversation where pattern was applied
 * @param {string[]} [contextEntities] - Optional array of entity IDs related to the pattern application
 * @returns {Promise<void>}
 */
export async function registerPatternObservation(
  patternId,
  successful,
  conversationId,
  contextEntities
) {
  try {
    console.log(
      `[LearningSystem] Registering pattern observation for ${patternId} (successful: ${successful})`
    );

    // Determine observation type based on success
    const observationType = successful ? "confirmation" : "rejection";

    // Prepare context data object with any provided context information
    const contextData = {
      conversationId,
      entities: contextEntities,
    };

    // Call GlobalPatternRepository to reinforce the pattern
    await GlobalPatternRepository.reinforcePattern(
      patternId,
      observationType,
      contextData
    );

    console.log(
      `[LearningSystem] Successfully registered ${observationType} observation for pattern ${patternId}`
    );
  } catch (error) {
    console.error(
      `[LearningSystem] Error registering pattern observation:`,
      error
    );
  }
}

/**
 * Extracts patterns from a conversation by analyzing messages and related code entities
 *
 * @param {string} conversationId - The ID of the conversation to analyze
 * @returns {Promise<Array>} Array of patterns found in the conversation
 */
export async function extractPatternsFromConversation(conversationId) {
  try {
    console.log(
      `[LearningSystem] Extracting patterns from conversation ${conversationId}`
    );

    // 1. Fetch the complete conversation history
    const conversationHistory =
      await ConversationIntelligence.getConversationHistory(conversationId);
    if (!conversationHistory || conversationHistory.length === 0) {
      console.log(
        `[LearningSystem] No conversation history found for ${conversationId}`
      );
      return [];
    }

    // 2. Extract unique code entity IDs mentioned in the conversation
    const codeEntityIds = new Set();
    for (const message of conversationHistory) {
      if (
        message.related_context_entity_ids &&
        Array.isArray(message.related_context_entity_ids)
      ) {
        message.related_context_entity_ids.forEach((id) =>
          codeEntityIds.add(id)
        );
      }
    }

    if (codeEntityIds.size === 0) {
      console.log(
        `[LearningSystem] No code entities found in conversation ${conversationId}`
      );
      return [];
    }

    // 3. Fetch details of each entity from the database
    const codeEntities = [];
    for (const entityId of codeEntityIds) {
      const entityQuery = `SELECT * FROM code_entities WHERE id = ?`;
      const entityResults = await executeQuery(entityQuery, [entityId]);

      if (entityResults && entityResults.length > 0) {
        codeEntities.push(entityResults[0]);
      }
    }

    // 4. Use SemanticPatternRecognizerLogic to find patterns in each entity
    const recognizedPatternIds = new Set();

    for (const entity of codeEntities) {
      try {
        const { patterns } =
          await SemanticPatternRecognizerLogic.recognizePatterns(entity);

        if (patterns && patterns.length > 0) {
          patterns.forEach((pattern) => {
            if (pattern.pattern_id) {
              recognizedPatternIds.add(pattern.pattern_id);
            }
          });
        }
      } catch (error) {
        console.warn(
          `[LearningSystem] Error recognizing patterns in entity ${entity.id}:`,
          error
        );
      }
    }

    // 5. Fetch full pattern details from the project_patterns table
    if (recognizedPatternIds.size === 0) {
      console.log(
        `[LearningSystem] No patterns recognized in conversation ${conversationId}`
      );
      return [];
    }

    // Convert Set to array for the IN clause
    const patternIdArray = Array.from(recognizedPatternIds);

    // Build placeholders for the IN clause
    const placeholders = patternIdArray.map(() => "?").join(",");

    const patternsQuery = `
      SELECT * FROM project_patterns 
      WHERE pattern_id IN (${placeholders})
      ORDER BY confidence_score DESC
    `;

    const patterns = await executeQuery(patternsQuery, patternIdArray);

    console.log(
      `[LearningSystem] Found ${patterns.length} patterns in conversation ${conversationId}`
    );

    // Parse detection_rules JSON field and return patterns
    return patterns.map((pattern) => ({
      ...pattern,
      detection_rules: pattern.detection_rules
        ? JSON.parse(pattern.detection_rules)
        : {},
      is_global: Boolean(pattern.is_global),
    }));
  } catch (error) {
    console.error(
      `[LearningSystem] Error extracting patterns from conversation:`,
      error
    );
    return [];
  }
}

/**
 * Extracts bug patterns from conversation messages by analyzing text for error messages and solutions
 *
 * @param {string} conversationId - The ID of the conversation to analyze
 * @returns {Promise<Array>} Array of bug patterns with descriptions and confidence scores
 */
export async function extractBugPatterns(conversationId) {
  try {
    console.log(
      `[LearningSystem] Extracting bug patterns from conversation ${conversationId}`
    );

    // 1. Fetch all messages from the conversation
    const messages = await ConversationIntelligence.getConversationHistory(
      conversationId
    );
    if (!messages || messages.length === 0) {
      return [];
    }

    // 2. Define regex patterns for identifying bug-related content
    const errorPatterns = [
      /error:?\s+([^\n.]+)/i,
      /exception:?\s+([^\n.]+)/i,
      /failed\s+(?:to|with):?\s+([^\n.]+)/i,
      /bug:?\s+([^\n.]+)/i,
      /issue:?\s+([^\n.]+)/i,
      /problem:?\s+([^\n.]+)/i,
    ];

    const fixPatterns = [
      /fix(?:ed|ing)?:?\s+([^\n.]+)/i,
      /solv(?:ed|ing)?:?\s+([^\n.]+)/i,
      /resolv(?:ed|ing)?:?\s+([^\n.]+)/i,
      /solutions?:?\s+([^\n.]+)/i,
      /workaround:?\s+([^\n.]+)/i,
      /(?:the\s+)?(?:root\s+)?cause\s+(?:is|was):?\s+([^\n.]+)/i,
    ];

    // 3. Analyze each message for bug patterns
    const bugDescriptions = [];
    const bugSolutions = [];

    for (const message of messages) {
      const content = message.content;
      if (!content) continue;

      // Look for error/bug descriptions
      for (const pattern of errorPatterns) {
        const matches = content.match(pattern);
        if (matches && matches[1]) {
          bugDescriptions.push({
            description: matches[1].trim(),
            confidence: 0.7,
            messageId: message.message_id,
            type: "error",
          });
        }
      }

      // Look for fix/solution descriptions
      for (const pattern of fixPatterns) {
        const matches = content.match(pattern);
        if (matches && matches[1]) {
          bugSolutions.push({
            description: matches[1].trim(),
            confidence: 0.7,
            messageId: message.message_id,
            type: "solution",
          });
        }
      }

      // Look for code blocks with error messages or stacktraces
      const codeBlockMatches = content.match(/```[\s\S]*?```/g);
      if (codeBlockMatches) {
        for (const codeBlock of codeBlockMatches) {
          // If code block contains error-related keywords
          if (/error|exception|traceback|fail|bug|issue/i.test(codeBlock)) {
            bugDescriptions.push({
              description:
                codeBlock.replace(/```/g, "").trim().substring(0, 100) + "...",
              confidence: 0.8,
              messageId: message.message_id,
              type: "code_error",
            });
          }
        }
      }
    }

    // 4. Match bug descriptions with their solutions when possible
    const bugPatterns = [];

    // For each bug description, try to find a related solution
    for (const bug of bugDescriptions) {
      // Create tokens from the bug description
      const bugTokens = TextTokenizerLogic.tokenize(bug.description);
      const bugKeywords = TextTokenizerLogic.extractKeywords(bugTokens);

      // Find solutions with matching keywords
      let bestSolution = null;
      let bestScore = 0;

      for (const solution of bugSolutions) {
        const solutionTokens = TextTokenizerLogic.tokenize(
          solution.description
        );
        const solutionKeywords =
          TextTokenizerLogic.extractKeywords(solutionTokens);

        // Calculate simple relevance score (keyword overlap)
        let matchScore = 0;
        for (const bugKeyword of bugKeywords) {
          if (solutionKeywords.includes(bugKeyword)) {
            matchScore++;
          }
        }

        if (matchScore > bestScore) {
          bestScore = matchScore;
          bestSolution = solution;
        }
      }

      // Add the bug pattern, with solution if found
      bugPatterns.push({
        description: bug.description,
        confidence: bug.confidence,
        solution: bestSolution ? bestSolution.description : undefined,
        relatedIssues: [], // Would require additional lookup to find related issues
      });
    }

    // Add any solutions without a matched bug as standalone patterns (with lower confidence)
    for (const solution of bugSolutions) {
      // Check if we've already used this solution
      const alreadyUsed = bugPatterns.some(
        (bp) => bp.solution === solution.description
      );
      if (!alreadyUsed) {
        bugPatterns.push({
          description: `Solution: ${solution.description}`,
          confidence: 0.6,
          relatedIssues: [],
        });
      }
    }

    // Remove duplicates by comparing descriptions
    const seenDescriptions = new Set();
    const uniquePatterns = [];

    for (const pattern of bugPatterns) {
      if (!seenDescriptions.has(pattern.description)) {
        seenDescriptions.add(pattern.description);
        uniquePatterns.push(pattern);
      }
    }

    console.log(
      `[LearningSystem] Extracted ${uniquePatterns.length} bug patterns from conversation ${conversationId}`
    );
    return uniquePatterns;
  } catch (error) {
    console.error(`[LearningSystem] Error extracting bug patterns:`, error);
    return [];
  }
}

/**
 * Extracts design decisions from conversation by identifying discussion of choices and tradeoffs
 *
 * @param {string} conversationId - The ID of the conversation to analyze
 * @returns {Promise<Array>} Array of design decisions with descriptions and confidence scores
 */
export async function extractDesignDecisions(conversationId) {
  try {
    console.log(
      `[LearningSystem] Extracting design decisions from conversation ${conversationId}`
    );

    // 1. Fetch all messages from the conversation
    const messages = await ConversationIntelligence.getConversationHistory(
      conversationId
    );
    if (!messages || messages.length === 0) {
      return [];
    }

    // 2. Define patterns for identifying design discussions
    const designPatterns = [
      /(?:I|we)\s+(?:chose|decided|selected|opted|will use|should use)\s+([^.]+)(?:\s+because|for|to)\s+([^.]+)/i,
      /(?:the|a)\s+(?:better|best|optimal|appropriate|right)\s+(?:approach|design|solution|pattern|architecture)\s+(?:is|would be)\s+([^.]+)/i,
      /(?:advantages|benefits|pros)\s+of\s+([^.]+)(?:\s+(?:are|include))\s+([^.]+)/i,
      /(?:disadvantages|drawbacks|cons)\s+of\s+([^.]+)(?:\s+(?:are|include))\s+([^.]+)/i,
      /(?:comparing|between)\s+([^\s.]+)\s+and\s+([^\s.]+),\s+([^.]+)/i,
      /(?:I|we)\s+recommend\s+([^.]+)(?:\s+because|for|to)\s+([^.]+)/i,
    ];

    const alternativePatterns = [
      /(?:alternative|another|other)\s+(?:approach|option|solution)\s+(?:would be|is|could be)\s+([^.]+)/i,
      /(?:instead of|rather than)\s+([^,]+),\s+(?:we could|we should|we might|you could|you should|you might)\s+([^.]+)/i,
      /(?:we|you)\s+(?:could|should|might)\s+(?:also|instead|alternatively)\s+(?:consider|use|try)\s+([^.]+)/i,
    ];

    const rationalePatterns = [
      /(?:because|since|as|given that)\s+([^,.]+)/i,
      /(?:the|a)\s+(?:reason|rationale|justification)\s+(?:is|was|being)\s+([^.]+)/i,
      /(?:this|that)\s+(?:approach|solution|design|pattern|choice|decision)\s+(?:helps|allows|enables|provides|ensures)\s+([^.]+)/i,
    ];

    // 3. Extract design decisions from messages
    const designDecisions = [];

    for (const message of messages) {
      const content = message.content;
      if (!content) continue;

      // Split content into sentences for more precise pattern matching
      const sentences = content.split(/[.!?]\s+/);

      for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];

        // Look for design decision patterns
        for (const pattern of designPatterns) {
          const matches = sentence.match(pattern);
          if (matches && matches.length > 1) {
            // Found a design decision
            const description = matches[1].trim();

            // Look for rationale in the same sentence or following sentences
            let rationale = matches[2] ? matches[2].trim() : "";

            // If no rationale found in the match, check the next sentence
            if (!rationale && i < sentences.length - 1) {
              const nextSentence = sentences[i + 1];
              for (const rationalePattern of rationalePatterns) {
                const rationaleMatch = nextSentence.match(rationalePattern);
                if (rationaleMatch && rationaleMatch[1]) {
                  rationale = rationaleMatch[1].trim();
                  break;
                }
              }
            }

            // Look for alternatives in nearby sentences
            let alternatives = [];

            // Check a window of 3 sentences before and after
            const windowStart = Math.max(0, i - 3);
            const windowEnd = Math.min(sentences.length - 1, i + 3);

            for (let j = windowStart; j <= windowEnd; j++) {
              if (j === i) continue; // Skip the current sentence

              const nearbySentence = sentences[j];
              for (const altPattern of alternativePatterns) {
                const altMatch = nearbySentence.match(altPattern);
                if (altMatch && altMatch.length > 1) {
                  // Found an alternative
                  if (altMatch[2]) {
                    alternatives.push(altMatch[2].trim());
                  } else if (altMatch[1]) {
                    alternatives.push(altMatch[1].trim());
                  }
                }
              }
            }

            // Assign confidence based on completeness of the decision
            let confidence = 0.7; // Base confidence
            if (rationale) confidence += 0.1;
            if (alternatives.length > 0) confidence += 0.1;

            designDecisions.push({
              description,
              confidence,
              rationale: rationale || undefined,
              alternatives: alternatives.length > 0 ? alternatives : undefined,
              messageId: message.message_id,
            });
          }
        }
      }
    }

    // Remove duplicates
    const uniqueDecisions = [];
    const seenDescriptions = new Set();

    for (const decision of designDecisions) {
      if (!seenDescriptions.has(decision.description)) {
        seenDescriptions.add(decision.description);
        uniqueDecisions.push(decision);
      }
    }

    console.log(
      `[LearningSystem] Extracted ${uniqueDecisions.length} design decisions from conversation ${conversationId}`
    );
    return uniqueDecisions;
  } catch (error) {
    console.error(`[LearningSystem] Error extracting design decisions:`, error);
    return [];
  }
}

/**
 * Extracts best practices mentioned in conversation
 *
 * @param {string} conversationId - The ID of the conversation to analyze
 * @returns {Promise<Array>} Array of best practices with descriptions and confidence scores
 */
export async function extractBestPractices(conversationId) {
  try {
    console.log(
      `[LearningSystem] Extracting best practices from conversation ${conversationId}`
    );

    // 1. Fetch all messages from the conversation
    const messages = await ConversationIntelligence.getConversationHistory(
      conversationId
    );
    if (!messages || messages.length === 0) {
      return [];
    }

    // 2. Define patterns for identifying best practices
    const bestPracticePatterns = [
      /(?:best|good)\s+practice[s]?\s+(?:is|are|for|to)\s+([^.]+)/i,
      /(?:recommended|suggested|advisable)\s+(?:approach|practice|method|way)\s+(?:is|would be)\s+([^.]+)/i,
      /(?:should|must|always|never)\s+([^.]+)/i,
      /(?:it['']s|its)\s+(?:better|best|recommended)\s+to\s+([^.]+)/i,
      /(?:convention|standard|norm|guideline|rule)\s+(?:is|dictates|suggests|recommends|states)\s+([^.]+)/i,
      /(?:important|critical|essential|key)\s+to\s+([^.]+)/i,
    ];

    // 3. Extract best practices from messages
    const bestPractices = [];
    let messageIdToPractices = {};

    for (const message of messages) {
      const content = message.content;
      if (!content) continue;

      // Split content into sentences for more precise pattern matching
      const sentences = content.split(/[.!?]\s+/);

      for (const sentence of sentences) {
        for (const pattern of bestPracticePatterns) {
          const matches = sentence.match(pattern);
          if (matches && matches[1]) {
            const description = matches[1].trim();

            // Assign confidence based on the strength of the pattern
            let confidence = 0.6; // Base confidence

            // Adjust confidence based on keywords
            if (/best practice|always|never|must|essential/i.test(sentence)) {
              confidence += 0.2;
            } else if (/should|recommended|better|important/i.test(sentence)) {
              confidence += 0.1;
            }

            // Store practices with their message ID for later reference extraction
            if (!messageIdToPractices[message.message_id]) {
              messageIdToPractices[message.message_id] = [];
            }

            messageIdToPractices[message.message_id].push({
              description,
              confidence,
              messageId: message.message_id,
            });
          }
        }
      }
    }

    // 4. For each message with best practices, look for code references
    for (const messageId in messageIdToPractices) {
      const message = messages.find((m) => m.message_id === messageId);
      if (!message) continue;

      // Look for code blocks in the message
      const codeBlocks = message.content.match(/```[\s\S]*?```/g) || [];
      const codeReferences = codeBlocks.map((block) =>
        block.replace(/```/g, "").trim()
      );

      // Add code references to each practice from this message
      for (const practice of messageIdToPractices[messageId]) {
        if (codeReferences.length > 0) {
          practice.codeReferences = codeReferences;
          // Boost confidence if code examples are provided
          practice.confidence = Math.min(0.9, practice.confidence + 0.1);
        }

        bestPractices.push(practice);
      }
    }

    // 5. Remove duplicates
    const uniquePractices = [];
    const seenDescriptions = new Set();

    for (const practice of bestPractices) {
      if (!seenDescriptions.has(practice.description)) {
        seenDescriptions.add(practice.description);
        uniquePractices.push(practice);
      }
    }

    console.log(
      `[LearningSystem] Extracted ${uniquePractices.length} best practices from conversation ${conversationId}`
    );
    return uniquePractices;
  } catch (error) {
    console.error(`[LearningSystem] Error extracting best practices:`, error);
    return [];
  }
}

/**
 * Extracts general learning points from conversation messages
 *
 * @param {string[]} messageContents - Array of message contents to analyze
 * @returns {Promise<Array>} Array of general learnings with text and confidence scores
 */
export async function extractGeneralLearnings(messageContents) {
  try {
    console.log(
      `[LearningSystem] Extracting general learnings from ${messageContents.length} messages`
    );

    if (
      !messageContents ||
      !Array.isArray(messageContents) ||
      messageContents.length === 0
    ) {
      return [];
    }

    // 1. Define patterns for identifying factual statements and key takeaways
    const learningPatterns = [
      /(?:in\s+(?:conclusion|summary)|to\s+summarize|summing\s+up|overall|in\s+essence),\s+([^.]+)/i,
      /(?:the\s+(?:key|main|important|critical|essential)\s+(?:point|takeaway|learning|insight|fact|thing to remember))\s+(?:is|was|would be)\s+([^.]+)/i,
      /(?:I|we|you)\s+(?:learned|discovered|found out|realized|understand|know)\s+(?:that|how|why)\s+([^.]+)/i,
      /(?:it['']s|its)\s+(?:worth|important|useful|helpful)\s+(?:noting|remembering|understanding|recognizing)\s+(?:that|how|why)\s+([^.]+)/i,
      /(?:fact|truth|reality|principle|rule|concept|discovery|revelation|insight):\s+([^.]+)/i,
    ];

    // Patterns that might indicate conclusion statements
    const conclusionIndicators = [
      /(?:in\s+(?:conclusion|summary)|to\s+summarize|summing\s+up|finally|lastly)/i,
      /(?:key|main|important|critical)\s+(?:point|takeaway|lesson|learning)/i,
      /(?:remember|note|understand|fundamental|essentially)/i,
    ];

    // 2. Extract learnings from each message
    const generalLearnings = [];

    for (let i = 0; i < messageContents.length; i++) {
      const content = messageContents[i];
      if (!content) continue;

      // Split content into sentences
      const sentences = content.split(/[.!?]\s+/);

      // Check each sentence for learning patterns
      for (let j = 0; j < sentences.length; j++) {
        const sentence = sentences[j];
        let learning = null;
        let confidenceScore = 0;

        // Check for explicit learning patterns
        for (const pattern of learningPatterns) {
          const matches = sentence.match(pattern);
          if (matches && matches[1]) {
            learning = matches[1].trim();
            confidenceScore = 0.8; // High confidence for explicit patterns
            break;
          }
        }

        // If no explicit pattern matched, check if this might be a conclusion in the last 25% of the message
        if (!learning && j > sentences.length * 0.75) {
          // Check for conclusion indicators
          for (const indicator of conclusionIndicators) {
            if (indicator.test(sentence)) {
              learning = sentence.trim();
              confidenceScore = 0.7; // Slightly lower confidence
              break;
            }
          }
        }

        // If still no match, check for declarative statements that might be factual
        if (
          !learning &&
          /^(?:the|a|this|these|those)\s+\w+\s+(?:is|are|was|were|has|have|had)\s+/i.test(
            sentence
          )
        ) {
          // Look for strong factual indicators
          if (
            /always|never|every|all|none|must|proven|demonstrated|shown|verified|confirmed/i.test(
              sentence
            )
          ) {
            learning = sentence.trim();
            confidenceScore = 0.6; // Medium confidence
          }
        }

        // Add the learning if found
        if (learning) {
          generalLearnings.push({
            text: learning,
            confidence: confidenceScore,
            messageId: `message_${i}`, // Using index as we don't have actual messageIds
          });
        }
      }
    }

    // 3. Remove duplicates and very short learnings
    const uniqueLearnings = [];
    const seenTexts = new Set();

    for (const learning of generalLearnings) {
      if (learning.text.length < 10) continue; // Skip very short learnings

      if (!seenTexts.has(learning.text)) {
        seenTexts.add(learning.text);
        uniqueLearnings.push(learning);
      }
    }

    console.log(
      `[LearningSystem] Extracted ${uniqueLearnings.length} general learnings from messages`
    );
    return uniqueLearnings;
  } catch (error) {
    console.error(
      `[LearningSystem] Error extracting general learnings:`,
      error
    );
    return [];
  }
}

/**
 * Extracts key-value pairs of knowledge from a collection of messages
 *
 * @param {Array<Object>} messages - Array of message objects
 * @param {string} conversationId - ID of the conversation
 * @returns {Promise<Array<{key: string, value: string, confidence: number}>>} Array of extracted key-value pairs
 */
export async function extractKeyValuePairs(messages, conversationId) {
  try {
    console.log(
      `[LearningSystem] Extracting key-value pairs from conversation ${conversationId}`
    );

    if (!messages || messages.length === 0) {
      console.log(
        "[LearningSystem] No messages provided for key-value extraction"
      );
      return [];
    }

    // Get the text content from messages
    const messageContents = messages
      .map((msg) => msg.content || "")
      .filter((content) => content.trim().length > 0);

    if (messageContents.length === 0) {
      return [];
    }

    // Simple heuristic extraction of key-value pairs
    // Look for patterns like "X: Y", "X - Y", "key is value", etc.
    const extractedPairs = [];

    for (const content of messageContents) {
      // Process common patterns
      // Pattern 1: "Key: Value" or "Key - Value"
      const colonPattern = /^([^:]+):\s*(.+)$/gm;
      let match;

      while ((match = colonPattern.exec(content)) !== null) {
        const key = match[1].trim();
        const value = match[2].trim();

        if (key && value && key.length < 100 && !key.includes("\n")) {
          extractedPairs.push({
            key,
            value,
            confidence: 0.8,
          });
        }
      }

      // Pattern 2: "The X is Y" or "X is Y"
      const isPattern = /(?:The\s+)?([A-Za-z0-9\s_-]+)\s+is\s+([^.]+)/g;

      while ((match = isPattern.exec(content)) !== null) {
        const key = match[1].trim();
        const value = match[2].trim();

        if (key && value && key.length < 50 && !key.includes("\n")) {
          extractedPairs.push({
            key,
            value,
            confidence: 0.6,
          });
        }
      }
    }

    // Deduplicate by key (keep highest confidence)
    const keyMap = new Map();

    for (const pair of extractedPairs) {
      const existingPair = keyMap.get(pair.key.toLowerCase());

      if (!existingPair || existingPair.confidence < pair.confidence) {
        keyMap.set(pair.key.toLowerCase(), pair);
      }
    }

    // Convert back to array
    return Array.from(keyMap.values());
  } catch (error) {
    console.error("[LearningSystem] Error extracting key-value pairs:", error);
    return [];
  }
}

/**
 * Stores a code pattern in the database
 *
 * @param {Object} pattern - The pattern to store
 * @param {string} pattern.name - Name of the pattern
 * @param {string} pattern.description - Description of the pattern
 * @param {string} pattern.representation - String representation of the pattern
 * @param {string} pattern.category - Category of the pattern
 * @param {string} [pattern.language] - Programming language (if applicable)
 * @param {number} [pattern.confidence=0.7] - Confidence score (0-1)
 * @param {string} [pattern.conversationId] - ID of conversation where pattern was discovered
 * @returns {Promise<Object>} The stored pattern
 */
export async function storePattern(pattern) {
  try {
    console.log(`[LearningSystem] Storing pattern: ${pattern.name}`);

    if (
      !pattern ||
      !pattern.name ||
      !pattern.description ||
      !pattern.representation
    ) {
      throw new Error("Invalid pattern: missing required fields");
    }

    const patternId = pattern.id || uuidv4();
    const now = new Date().toISOString();
    const confidence = pattern.confidence || 0.7;

    // Insert into project_patterns table
    const query = `
      INSERT INTO project_patterns 
      (pattern_id, pattern_type, name, description, representation, language, confidence_score, created_at, updated_at, session_origin_id) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pattern_id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        representation = excluded.representation,
        language = excluded.language,
        confidence_score = excluded.confidence_score,
        updated_at = excluded.updated_at
    `;

    await executeQuery(query, [
      patternId,
      pattern.category || "code_pattern",
      pattern.name,
      pattern.description,
      pattern.representation,
      pattern.language || null,
      confidence,
      now,
      now,
      pattern.conversationId || null,
    ]);

    return {
      id: patternId,
      ...pattern,
      created_at: now,
      updated_at: now,
    };
  } catch (error) {
    console.error("[LearningSystem] Error storing pattern:", error);
    throw new Error(`Failed to store pattern: ${error.message}`);
  }
}

/**
 * Stores a bug pattern in the database
 *
 * @param {Object} bugPattern - The bug pattern to store
 * @param {string} bugPattern.name - Name of the bug pattern
 * @param {string} bugPattern.description - Description of the bug pattern
 * @param {string} bugPattern.representation - String representation of the bug pattern
 * @param {string} [bugPattern.solution] - Solution for the bug
 * @param {string} [bugPattern.language] - Programming language (if applicable)
 * @param {number} [bugPattern.confidence=0.7] - Confidence score (0-1)
 * @param {string} [bugPattern.conversationId] - ID of conversation where bug pattern was discovered
 * @returns {Promise<Object>} The stored bug pattern
 */
export async function storeBugPattern(bugPattern) {
  try {
    console.log(`[LearningSystem] Storing bug pattern: ${bugPattern.name}`);

    if (!bugPattern || !bugPattern.name || !bugPattern.description) {
      throw new Error("Invalid bug pattern: missing required fields");
    }

    const patternId = bugPattern.id || uuidv4();
    const now = new Date().toISOString();
    const confidence = bugPattern.confidence || 0.7;

    // Enhance the representation with the solution if available
    let representation = bugPattern.representation;
    if (bugPattern.solution && typeof representation === "object") {
      representation = {
        ...JSON.parse(
          typeof representation === "string"
            ? representation
            : JSON.stringify(representation)
        ),
        solution: bugPattern.solution,
      };
      representation = JSON.stringify(representation);
    } else if (bugPattern.solution && typeof representation === "string") {
      try {
        const parsed = JSON.parse(representation);
        parsed.solution = bugPattern.solution;
        representation = JSON.stringify(parsed);
      } catch (e) {
        // Not valid JSON, keep as is
      }
    }

    // Insert into project_patterns table with bug_pattern type
    const query = `
      INSERT INTO project_patterns 
      (pattern_id, pattern_type, name, description, representation, language, confidence_score, created_at, updated_at, session_origin_id) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pattern_id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        representation = excluded.representation,
        language = excluded.language,
        confidence_score = excluded.confidence_score,
        updated_at = excluded.updated_at
    `;

    await executeQuery(query, [
      patternId,
      "bug_pattern",
      bugPattern.name,
      bugPattern.description,
      representation,
      bugPattern.language || null,
      confidence,
      now,
      now,
      bugPattern.conversationId || null,
    ]);

    return {
      id: patternId,
      ...bugPattern,
      created_at: now,
      updated_at: now,
      pattern_type: "bug_pattern",
    };
  } catch (error) {
    console.error("[LearningSystem] Error storing bug pattern:", error);
    throw new Error(`Failed to store bug pattern: ${error.message}`);
  }
}

/**
 * Stores a key-value pair of knowledge in the database
 *
 * @param {Object} keyValuePair - The key-value pair to store
 * @param {string} keyValuePair.key - The key (concept, term, etc.)
 * @param {string} keyValuePair.value - The value (definition, explanation, etc.)
 * @param {number} [keyValuePair.confidence=0.7] - Confidence score (0-1)
 * @param {string} [keyValuePair.category="general"] - Category of knowledge
 * @param {string} [keyValuePair.conversationId] - ID of conversation where knowledge was discovered
 * @returns {Promise<Object>} The stored key-value pair
 */
export async function storeKeyValuePair(keyValuePair) {
  try {
    console.log(
      `[LearningSystem] Storing knowledge key-value pair: ${keyValuePair.key}`
    );

    if (!keyValuePair || !keyValuePair.key || !keyValuePair.value) {
      throw new Error("Invalid key-value pair: missing required fields");
    }

    const knowledgeId = keyValuePair.id || uuidv4();
    const now = new Date().toISOString();
    const confidence = keyValuePair.confidence || 0.7;
    const category = keyValuePair.category || "general";

    // Insert into knowledge_base table
    const query = `
      INSERT INTO knowledge_items 
      (item_id, item_type, name, content, metadata, confidence_score, created_at, updated_at, conversation_id) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET
        name = excluded.name,
        content = excluded.content,
        metadata = excluded.metadata,
        confidence_score = excluded.confidence_score,
        updated_at = excluded.updated_at
    `;

    // Create metadata
    const metadata = JSON.stringify({
      category,
      source: keyValuePair.conversationId ? "conversation" : "analysis",
      conversationId: keyValuePair.conversationId || null,
    });

    await executeQuery(query, [
      knowledgeId,
      "concept_definition",
      keyValuePair.key,
      keyValuePair.value,
      metadata,
      confidence,
      now,
      now,
      keyValuePair.conversationId || null,
    ]);

    return {
      id: knowledgeId,
      ...keyValuePair,
      created_at: now,
      updated_at: now,
      item_type: "concept_definition",
    };
  } catch (error) {
    console.error("[LearningSystem] Error storing key-value pair:", error);
    throw new Error(`Failed to store key-value pair: ${error.message}`);
  }
}
