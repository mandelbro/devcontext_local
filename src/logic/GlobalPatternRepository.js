/**
 * GlobalPatternRepository.js
 *
 * Manages global patterns that are available across all sessions.
 * Provides functionality to store, retrieve, and manage patterns in the global repository.
 */

import { executeQuery } from "../db.js";
import { v4 as uuidv4 } from "uuid";

/**
 * @typedef {Object} PatternDefinition
 * @property {string} pattern_type - Type of the pattern
 * @property {string} [name] - Human-readable name for the pattern
 * @property {string} [description] - Description of what the pattern represents
 * @property {string} representation - Textual or structured representation of the pattern
 * @property {string|Object} [detection_rules] - Rules used to detect this pattern
 * @property {string} [language] - Programming language this pattern applies to (e.g., 'javascript', 'python', or 'any' for language-agnostic patterns)
 */

/**
 * @typedef {Object} Pattern
 * @property {string} pattern_id - Unique identifier for the pattern
 * @property {string} pattern_type - Type of the pattern
 * @property {string} name - Human-readable name for the pattern
 * @property {string} description - Description of what the pattern represents
 * @property {string} representation - Textual or structured representation of the pattern
 * @property {string} detection_rules - JSON string of rules used to detect this pattern
 * @property {string} language - Programming language this pattern applies to (e.g., 'javascript', 'python', or 'any' for language-agnostic patterns)
 * @property {number} frequency - How often this pattern has been observed
 * @property {number} utility_score - How useful this pattern is rated
 * @property {number} confidence_score - Confidence in this pattern's correctness
 * @property {number} reinforcement_count - How many times this pattern has been reinforced
 * @property {boolean} is_global - Whether this pattern is global across sessions
 * @property {string} created_at - When this pattern was created
 * @property {string} updated_at - When this pattern was last updated
 */

/**
 * Stores a pattern in the global pattern repository
 *
 * @param {PatternDefinition} patternDefinition - Definition of the pattern to store
 * @param {number} [confidenceScore=0.5] - Confidence score for this pattern (0-1)
 * @returns {Promise<string>} The ID of the newly stored global pattern
 */
export async function storeGlobalPattern(
  patternDefinition,
  confidenceScore = 0.5
) {
  try {
    // 1. Generate a unique ID for the pattern
    const pattern_id = uuidv4();

    // 2. Extract and prepare pattern data with defaults
    const {
      pattern_type,
      name = `Global_Pattern_${pattern_id.substring(0, 8)}`,
      description = "Globally recognized pattern",
      representation,
      detection_rules = "{}",
      language = "any",
    } = patternDefinition;

    // 3. Ensure representation and detection_rules are in string format for storage
    const representationStr =
      typeof representation === "object"
        ? JSON.stringify(representation)
        : representation;

    const detectionRulesStr =
      typeof detection_rules === "object"
        ? JSON.stringify(detection_rules)
        : detection_rules;

    // 4. Set default scores and counters for a global pattern
    const frequency = 0; // New global patterns start with zero frequency
    const utility_score = 0.5; // Medium utility by default
    const reinforcement_count = 1; // Initial reinforcement
    const is_global = true; // Mark as global pattern
    const created_at = new Date().toISOString();
    const updated_at = created_at;

    // 5. Insert the pattern into the database
    const query = `
      INSERT INTO project_patterns (
        pattern_id, 
        pattern_type, 
        name, 
        description, 
        representation, 
        detection_rules,
        language,
        frequency,
        utility_score,
        confidence_score,
        reinforcement_count,
        is_global,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      pattern_id,
      pattern_type,
      name,
      description,
      representationStr,
      detectionRulesStr,
      language,
      frequency,
      utility_score,
      confidenceScore,
      reinforcement_count,
      is_global,
      created_at,
      updated_at,
    ];

    await executeQuery(query, params);

    console.log(
      `Added new global pattern "${name}" (${pattern_id}) to repository`
    );

    // 6. Return the generated pattern ID
    return pattern_id;
  } catch (error) {
    console.error("Error adding global pattern to repository:", error);
    throw new Error(`Failed to add global pattern: ${error.message}`);
  }
}

/**
 * Retrieves global patterns from the repository with optional filtering
 *
 * @param {Object} filterOptions - Options to filter the global patterns
 * @param {string} [filterOptions.type] - Filter by pattern type
 * @param {number} [filterOptions.minConfidence] - Filter by minimum confidence score
 * @param {number} [filterOptions.limit] - Maximum number of patterns to return
 * @param {string} [filterOptions.language] - Filter by programming language
 * @returns {Promise<Pattern[]>} Array of global patterns matching the filters
 */
export async function retrieveGlobalPatterns(filterOptions = {}) {
  try {
    const { type, minConfidence, limit, language } = filterOptions;

    // Build the query
    let query = "SELECT * FROM project_patterns WHERE is_global = TRUE";
    const params = [];

    // Apply additional filters if provided
    if (type) {
      query += " AND pattern_type = ?";
      params.push(type);
    }

    if (minConfidence !== undefined && !isNaN(minConfidence)) {
      query += " AND confidence_score >= ?";
      params.push(minConfidence);
    }

    // Apply language filter if provided
    if (language) {
      query += " AND (language = ? OR language = ? OR language IS NULL)";
      params.push(language, "any"); // Include language-specific, universal, and legacy NULL patterns
    }

    // Order by confidence score and utility score
    query += " ORDER BY confidence_score DESC, utility_score DESC";

    // Apply limit if provided
    if (limit !== undefined && !isNaN(limit) && limit > 0) {
      query += " LIMIT ?";
      params.push(limit);
    }

    // Execute the query
    const patterns = await executeQuery(query, params);

    // Check if patterns has a rows property and it's an array
    const rows =
      patterns && patterns.rows && Array.isArray(patterns.rows)
        ? patterns.rows
        : Array.isArray(patterns)
        ? patterns
        : [];

    // If no valid results, return empty array
    if (rows.length === 0) {
      console.warn("No valid global patterns found");
      return [];
    }

    // Parse detection_rules JSON for each pattern
    return rows.map((pattern) => ({
      ...pattern,
      detection_rules: JSON.parse(pattern.detection_rules || "{}"),
      is_global: Boolean(pattern.is_global), // Ensure is_global is a boolean
    }));
  } catch (error) {
    console.error("Error retrieving global patterns:", error);
    throw new Error(`Failed to retrieve global patterns: ${error.message}`);
  }
}

/**
 * Promotes an existing pattern to global status
 *
 * @param {string} patternId - ID of the pattern to promote to global
 * @param {number} [newConfidence] - New confidence score to assign (optional)
 * @returns {Promise<boolean>} True if the pattern was successfully promoted, false otherwise
 */
export async function promotePatternToGlobal(patternId, newConfidence) {
  try {
    // Build the update query
    let query = "UPDATE project_patterns SET is_global = TRUE";
    const params = [];

    // Update confidence score if provided
    if (newConfidence !== undefined && !isNaN(newConfidence)) {
      query += ", confidence_score = ?";
      params.push(newConfidence);
    }

    // Update the timestamp
    const updated_at = new Date().toISOString();
    query += ", updated_at = ?";
    params.push(updated_at);

    // Add WHERE clause
    query += " WHERE pattern_id = ?";
    params.push(patternId);

    // Execute the query
    const result = await executeQuery(query, params);

    // Check if a row was affected
    const success = result.affectedRows > 0;

    if (success) {
      console.log(
        `Pattern ${patternId} successfully promoted to global status`
      );

      if (newConfidence !== undefined) {
        console.log(`Updated confidence score to ${newConfidence}`);
      }
    } else {
      console.warn(`No pattern with ID ${patternId} found to promote`);
    }

    return success;
  } catch (error) {
    console.error(`Error promoting pattern ${patternId} to global:`, error);
    throw new Error(`Failed to promote pattern: ${error.message}`);
  }
}

/**
 * Records a pattern observation and updates its metrics
 *
 * @param {string} patternId - ID of the pattern to reinforce
 * @param {'usage'|'confirmation'|'rejection'} observationType - Type of the observation
 * @param {any} [contextData] - Additional context data for the observation
 * @returns {Promise<void>}
 */
export async function reinforcePattern(
  patternId,
  observationType,
  contextData = {}
) {
  try {
    // Create observation ID
    const observation_id = uuidv4();
    const timestamp = new Date().toISOString();

    // Convert contextData to JSON string
    const observation_data = JSON.stringify(contextData || {});

    // Define adjustment values
    const confidenceAdjustments = {
      usage: 0.03, // Small increase for usage
      confirmation: 0.05, // Moderate increase for explicit confirmation
      rejection: -0.08, // Larger decrease for rejection
    };

    const utilityAdjustments = {
      usage: 0.04, // Moderate increase for usage (indicates utility)
      confirmation: 0.03, // Small increase for confirmation
      rejection: -0.02, // Small decrease for rejection
    };

    // Begin transaction
    await executeQuery("BEGIN TRANSACTION");

    try {
      // 1. Insert observation record
      const insertObservationQuery = `
        INSERT INTO pattern_observations (
          observation_id,
          pattern_id,
          observation_type,
          observation_data,
          timestamp
        ) VALUES (?, ?, ?, ?, ?)
      `;

      await executeQuery(insertObservationQuery, [
        observation_id,
        patternId,
        observationType,
        observation_data,
        timestamp,
      ]);

      // 2. Get current pattern data
      const getPatternQuery =
        "SELECT confidence_score, utility_score, reinforcement_count FROM project_patterns WHERE pattern_id = ?";
      const patternResult = await executeQuery(getPatternQuery, [patternId]);

      if (patternResult.length === 0) {
        throw new Error(`Pattern with ID ${patternId} not found`);
      }

      const pattern = patternResult[0];

      // 3. Calculate new scores
      let newConfidenceScore =
        pattern.confidence_score +
        (confidenceAdjustments[observationType] || 0);
      let newUtilityScore =
        pattern.utility_score + (utilityAdjustments[observationType] || 0);

      // Ensure scores stay within bounds
      newConfidenceScore = Math.max(0, Math.min(1, newConfidenceScore));
      newUtilityScore = Math.max(0, Math.min(1, newUtilityScore));

      // 4. Update pattern metrics
      const updatePatternQuery = `
        UPDATE project_patterns SET
          reinforcement_count = reinforcement_count + 1,
          confidence_score = ?,
          utility_score = ?,
          updated_at = ?
      `;

      // Add last_detected_at update if observation is a usage
      const updateLastDetected =
        observationType === "usage" ? ", last_detected_at = ?" : "";
      const updatePatternParams = [
        newConfidenceScore,
        newUtilityScore,
        timestamp,
      ];

      // Add timestamp parameter if updating last_detected_at
      if (observationType === "usage") {
        updatePatternParams.push(timestamp);
      }

      // Complete the query with WHERE clause
      const finalUpdateQuery =
        updatePatternQuery + updateLastDetected + " WHERE pattern_id = ?";
      updatePatternParams.push(patternId);

      await executeQuery(finalUpdateQuery, updatePatternParams);

      // Commit transaction
      await executeQuery("COMMIT");

      console.log(
        `Pattern ${patternId} reinforced with '${observationType}' observation`
      );
    } catch (error) {
      // Rollback transaction in case of error
      await executeQuery("ROLLBACK");
      throw error;
    }
  } catch (error) {
    console.error(`Error reinforcing pattern ${patternId}:`, error);
    throw new Error(`Failed to reinforce pattern: ${error.message}`);
  }
}

/**
 * Calculate similarity between two patterns
 *
 * @param {Pattern} pattern1 - First pattern to compare
 * @param {Pattern} pattern2 - Second pattern to compare
 * @returns {number} Similarity score between 0 and 1
 */
export function calculatePatternSimilarity(pattern1, pattern2) {
  // Initialize similarity scores for different components
  let representationSimilarity = 0;
  let rulesSimilarity = 0;
  let typeSimilarity = 0;
  let languageSimilarity = 1.0; // Default to full match for language

  // 1. Base type similarity on pattern_type match
  typeSimilarity = pattern1.pattern_type === pattern2.pattern_type ? 1.0 : 0.3;

  // 2. Check language similarity
  if (pattern1.language && pattern2.language) {
    // If both patterns have specific languages defined
    if (pattern1.language === "any" || pattern2.language === "any") {
      // If either is language-agnostic, still a good match but slightly penalized
      languageSimilarity = 0.9;
    } else if (pattern1.language !== pattern2.language) {
      // Different specific languages - significant penalty
      languageSimilarity = 0.2; // Significantly different patterns
    }
  } else if (pattern1.language || pattern2.language) {
    // One has a language, the other doesn't (might be a legacy pattern or NULL)
    // This is a reasonable match but less confident
    languageSimilarity = 0.7;
  }

  // 3. Compare representations using Jaccard similarity
  representationSimilarity = calculateJaccardSimilarity(
    extractTokensFromField(pattern1.representation),
    extractTokensFromField(pattern2.representation)
  );

  // 4. Compare detection_rules using Jaccard similarity
  rulesSimilarity = calculateJaccardSimilarity(
    extractTokensFromField(pattern1.detection_rules),
    extractTokensFromField(pattern2.detection_rules)
  );

  // 5. Combine the similarities with weights
  // Representation is the most important, followed by rules, then language and type
  const combinedSimilarity =
    representationSimilarity * 0.5 +
    rulesSimilarity * 0.3 +
    languageSimilarity * 0.15 +
    typeSimilarity * 0.05;

  // Ensure the result is within [0,1]
  return Math.max(0, Math.min(1, combinedSimilarity));
}

/**
 * Extract tokens from a pattern field which could be a JSON string or regular text
 *
 * @param {string} field - The field to extract tokens from
 * @returns {string[]} Array of normalized tokens
 */
function extractTokensFromField(field) {
  if (!field) return [];

  let content = field;

  // If the field is a JSON string, try to parse it to get its content
  if (
    typeof field === "string" &&
    (field.startsWith("{") || field.startsWith("["))
  ) {
    try {
      const parsed = JSON.parse(field);
      // Convert the parsed object back to a string for tokenization
      content = JSON.stringify(parsed, null, 0).toLowerCase();
    } catch (e) {
      // If parsing fails, use the original string
      content = field.toLowerCase();
    }
  } else if (typeof field === "object") {
    // If it's already an object, stringify it
    content = JSON.stringify(field, null, 0).toLowerCase();
  } else {
    // For plain strings, just use as is
    content = String(field).toLowerCase();
  }

  // Simple tokenization: split by non-alphanumeric chars and filter empty tokens
  // In a real implementation, we would use TextTokenizerLogic.tokenize and stem
  return content
    .split(/[^a-z0-9_]+/)
    .filter((token) => token.length > 1)
    .map((token) => token.trim());
}

/**
 * Calculate Jaccard similarity index between two sets of tokens
 *
 * @param {string[]} tokens1 - First set of tokens
 * @param {string[]} tokens2 - Second set of tokens
 * @returns {number} Jaccard similarity index (0-1)
 */
function calculateJaccardSimilarity(tokens1, tokens2) {
  if (!tokens1.length && !tokens2.length) return 1.0; // Both empty means identical
  if (!tokens1.length || !tokens2.length) return 0.0; // One empty means no similarity

  // Create sets from the token arrays to eliminate duplicates
  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);

  // Calculate intersection size
  let intersectionSize = 0;
  for (const token of set1) {
    if (set2.has(token)) {
      intersectionSize++;
    }
  }

  // Calculate union size
  const unionSize = set1.size + set2.size - intersectionSize;

  // Jaccard similarity = size of intersection / size of union
  return intersectionSize / unionSize;
}

/**
 * Consolidates session patterns by promoting or merging them with global patterns
 *
 * @param {Object} options - Options for consolidation
 * @param {number} [options.minReinforcementCount=3] - Minimum reinforcement count for promotion
 * @param {number} [options.minConfidence=0.6] - Minimum confidence score for promotion
 * @param {number} [options.similarityThreshold=0.8] - Threshold for pattern similarity to consider merging
 * @returns {Promise<{promoted: number, merged: number}>} Count of promoted and merged patterns
 */
export async function consolidateSessionPatterns(options = {}) {
  try {
    // Set default options
    const {
      minReinforcementCount = 3,
      minConfidence = 0.6,
      similarityThreshold = 0.8,
    } = options;

    console.log(
      `Starting pattern consolidation process (minReinforcementCount=${minReinforcementCount}, minConfidence=${minConfidence})`
    );

    // Track counts
    let promotedCount = 0;
    let mergedCount = 0;

    // 1. Find non-global patterns that meet the criteria
    const query = `
      SELECT * FROM project_patterns 
      WHERE is_global = FALSE 
      AND reinforcement_count >= ? 
      AND confidence_score >= ?
    `;

    const sessionPatterns = await executeQuery(query, [
      minReinforcementCount,
      minConfidence,
    ]);

    console.log(
      `Found ${sessionPatterns.length} session patterns that qualify for promotion or merging`
    );

    if (sessionPatterns.length === 0) {
      return { promoted: 0, merged: 0 };
    }

    // 2. Get existing global patterns for potential merging
    const globalPatterns = await retrieveGlobalPatterns();

    // 3. Process each qualifying session pattern
    for (const sessionPattern of sessionPatterns) {
      const patternId = sessionPattern.pattern_id;

      // Try to find a similar global pattern for merging
      let shouldPromote = true;
      let similarGlobalPattern = null;

      for (const globalPattern of globalPatterns) {
        const similarity = calculatePatternSimilarity(
          sessionPattern,
          globalPattern
        );

        if (similarity >= similarityThreshold) {
          shouldPromote = false;
          similarGlobalPattern = globalPattern;
          break;
        }
      }

      if (shouldPromote) {
        // Promote the pattern to global status
        console.log(`Promoting session pattern ${patternId} to global status`);
        const promoted = await promotePatternToGlobal(
          patternId,
          sessionPattern.confidence_score
        );

        if (promoted) {
          promotedCount++;
          console.log(`Successfully promoted pattern ${patternId}`);
        }
      } else if (similarGlobalPattern) {
        // Placeholder for merging logic
        console.log(
          `Merge attempt for pattern ${patternId} with ${similarGlobalPattern.pattern_id}`
        );

        // In a real implementation, the merging would:
        // 1. Update the global pattern with some attributes from the session pattern
        // 2. Maybe increase confidence/utility/reinforcement_count of the global pattern
        // 3. Delete the session pattern or mark it as merged

        // For now, just log and count
        mergedCount++;
      }
    }

    console.log(
      `Pattern consolidation complete. Promoted: ${promotedCount}, Merged: ${mergedCount}`
    );

    return {
      promoted: promotedCount,
      merged: mergedCount,
    };
  } catch (error) {
    console.error("Error consolidating session patterns:", error);
    throw new Error(`Failed to consolidate session patterns: ${error.message}`);
  }
}

/**
 * Schedules a periodic background process for pattern consolidation
 *
 * @param {number} [intervalMinutes=60] - The interval in minutes to run the consolidation
 * @returns {number} The interval ID that can be used to clear the interval if needed
 */
export function scheduleConsolidation(intervalMinutes = 60) {
  // Convert intervalMinutes to milliseconds
  const intervalMs = intervalMinutes * 60 * 1000;

  console.log(
    `Scheduling pattern consolidation to run every ${intervalMinutes} minutes`
  );

  // Set up the interval
  const intervalId = setInterval(async () => {
    console.log(
      `Running scheduled pattern consolidation (interval: ${intervalMinutes} minutes)`
    );

    try {
      // Call consolidateSessionPatterns with sensible defaults
      const result = await consolidateSessionPatterns({
        minReinforcementCount: 5,
        minConfidence: 0.7,
      });

      console.log(
        `Pattern consolidation completed: ${result.promoted} patterns promoted, ${result.merged} patterns merged`
      );
    } catch (error) {
      console.error(`Error during scheduled pattern consolidation:`, error);
    }
  }, intervalMs);

  return intervalId;
}

/**
 * Retrieves usage statistics for a specific pattern
 *
 * @param {string} patternId - The ID of the pattern to get statistics for
 * @returns {Promise<{usageCount: number, successRate: number, avgConfidence: number}>} Usage statistics
 */
export async function getPatternUsageStats(patternId) {
  try {
    // Get observation counts from pattern_observations table
    const observationsQuery = `
      SELECT 
        COUNT(*) as total_observations,
        SUM(CASE WHEN observation_type IN ('usage', 'confirmation') THEN 1 ELSE 0 END) as successful_uses,
        SUM(CASE WHEN observation_type = 'rejection' THEN 1 ELSE 0 END) as failed_uses
      FROM pattern_observations
      WHERE pattern_id = ?
    `;

    const observationsResult = await executeQuery(observationsQuery, [
      patternId,
    ]);

    if (!observationsResult || observationsResult.length === 0) {
      return {
        usageCount: 0,
        successRate: 0,
        avgConfidence: 0,
      };
    }

    const stats = observationsResult[0];
    const usageCount = stats.total_observations || 0;

    // Calculate success rate: (successful uses) / (successful uses + failed uses)
    // Avoid division by zero if there are no success/failure observations
    const successPlusFailed =
      (stats.successful_uses || 0) + (stats.failed_uses || 0);
    const successRate =
      successPlusFailed > 0
        ? (stats.successful_uses || 0) / successPlusFailed
        : 0;

    // Get current confidence score from project_patterns table
    const patternQuery = `
      SELECT confidence_score
      FROM project_patterns
      WHERE pattern_id = ?
    `;

    const patternResult = await executeQuery(patternQuery, [patternId]);

    // If pattern not found, return zero confidence
    const avgConfidence =
      patternResult && patternResult.length > 0
        ? patternResult[0].confidence_score
        : 0;

    return {
      usageCount,
      successRate,
      avgConfidence,
    };
  } catch (error) {
    console.error(`Error getting pattern usage stats for ${patternId}:`, error);
    throw new Error(`Failed to get pattern usage statistics: ${error.message}`);
  }
}
