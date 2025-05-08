/**
 * ContextPrioritizerLogic.js
 *
 * Logic for prioritizing and scoring context snippets based on
 * query relevance, focus area alignment, recency, and relationships.
 */

import { nonVectorRelevanceScore } from "./SmartSearchServiceLogic.js";
import { getRelatedEntities } from "./RelationshipContextManagerLogic.js";
import { executeQuery } from "../db.js";
import { CONTEXT_DECAY_RATE } from "../config.js";

/**
 * @typedef {Object} CodeEntity
 * @property {string} entity_id - Unique identifier for the code entity
 * @property {string} file_path - Path to the file containing the entity
 * @property {string} entity_type - Type of code entity (e.g., 'file', 'function', 'class')
 * @property {string} name - Name of the code entity
 * @property {string} [parent_entity_id] - ID of the parent entity (if any)
 * @property {string} [content_hash] - Hash of the entity content
 * @property {string} [raw_content] - Raw content of the entity
 * @property {number} [start_line] - Start line of the entity within the file
 * @property {number} [end_line] - End line of the entity within the file
 * @property {string} [language] - Programming language of the entity
 * @property {Date} [created_at] - Creation timestamp
 * @property {Date} [last_modified_at] - Last modification timestamp
 * @property {Date} [last_accessed_at] - Last access timestamp
 * @property {number} [importance_score] - Predefined importance score
 */

/**
 * @typedef {Object} ContextSnippet
 * @property {CodeEntity} entity - The code entity
 * @property {number} baseRelevance - Base relevance score from initial search
 */

/**
 * @typedef {Object} FocusArea
 * @property {string} focus_id - Unique identifier for the focus area
 * @property {string} focus_type - Type of focus (e.g., 'file', 'function', 'task')
 * @property {string} identifier - Human-readable identifier
 * @property {string} description - Description of the focus area
 * @property {string[]} related_entity_ids - IDs of entities related to this focus
 * @property {string[]} keywords - Keywords associated with this focus area
 */

/**
 * @typedef {Object} RecencyInfo
 * @property {Date} lastAccessedThreshold - Threshold for considering entities as recently accessed
 * @property {Date} [lastModifiedThreshold] - Threshold for considering entities as recently modified
 * @property {number} [recencyBoostFactor] - Factor to boost score for recent entities (default: 1.25)
 */

/**
 * Calculate an importance score for a code entity based on its characteristics.
 * This score is used for prioritizing which entities to include in context.
 *
 * @param {CodeEntity} entity - The code entity to score
 * @returns {Promise<number>} Importance score between 0 and 10
 */
export async function calculateImportanceScore(entity) {
  if (!entity) return 1.0; // Default score if entity is invalid

  try {
    // 1. Base score by entity type
    const typeScores = {
      class: 8.0,
      interface: 7.5,
      function: 7.0,
      method: 6.5,
      file: 6.0,
      variable: 5.0,
      constant: 5.0,
      comment_block: 4.0,
    };

    const entityType = (entity.entity_type || "").toLowerCase();
    let score = typeScores[entityType] || 5.0; // Default to 5.0 if type unknown

    // 2. Adjust based on content size/complexity
    if (entity.raw_content) {
      const contentLength = entity.raw_content.length;
      const lineCount = entity.raw_content.split("\n").length;

      // Small bonus for larger entities (but not too much)
      // Logarithmic scale to prevent extremely large files from dominating
      const sizeBonus = Math.min(2.0, Math.log10(contentLength / 100)) * 0.5;
      score += sizeBonus;

      // Bonus for complexity (rough approximation based on length and patterns)
      if (
        entity.raw_content.includes("if") ||
        entity.raw_content.includes("for") ||
        entity.raw_content.includes("while") ||
        entity.raw_content.includes("switch")
      ) {
        score += 0.5; // Basic complexity bonus
      }
    }

    // 3. Adjust based on references to this entity
    try {
      const referenceQuery = `
        SELECT COUNT(*) as ref_count 
        FROM code_relationships 
        WHERE target_entity_id = ? AND relationship_type = 'references'
      `;

      const references = await executeQuery(referenceQuery, [entity.entity_id]);

      if (references && references.rows && references.rows.length > 0) {
        const refCount = parseInt(references.rows[0].ref_count) || 0;
        // Logarithmic scale to prevent highly referenced entities from completely dominating
        const refBonus = Math.min(1.5, Math.log10(refCount + 1));
        score += refBonus;
      }
    } catch (error) {
      // Silently continue without reference bonus if query fails
      console.warn(
        `Error fetching references for entity ${entity.entity_id}:`,
        error.message
      );
    }

    // 4. Adjust based on recency
    const now = new Date();
    if (entity.last_modified_at) {
      const lastModified = new Date(entity.last_modified_at);
      const daysSinceModified = (now - lastModified) / (1000 * 60 * 60 * 24);

      // Recently modified entities get a bonus that decays over time
      // Full bonus for the first day, decaying to zero after 30 days
      const recencyBonus = Math.max(0, 1.0 - daysSinceModified / 30);
      score += recencyBonus;
    }

    if (entity.last_accessed_at) {
      const lastAccessed = new Date(entity.last_accessed_at);
      const daysSinceAccessed = (now - lastAccessed) / (1000 * 60 * 60 * 24);

      // Recently accessed entities get a smaller bonus
      // Full bonus for the first day, decaying to zero after 14 days
      const accessBonus = Math.max(0, 0.5 - (daysSinceAccessed / 14) * 0.5);
      score += accessBonus;
    }

    // 5. Bonus for top-level entities (not nested)
    if (!entity.parent_entity_id) {
      score += 0.5;
    }

    // 6. Special adjustments for certain entity characteristics

    // Bonus for entities with a name that suggests importance
    const importantNamePatterns = [
      "main",
      "index",
      "core",
      "app",
      "server",
      "controller",
      "service",
    ];
    if (
      entity.name &&
      importantNamePatterns.some((pattern) =>
        entity.name.toLowerCase().includes(pattern)
      )
    ) {
      score += 0.5;
    }

    // Cap the score at 10
    return Math.min(10.0, Math.max(0, score));
  } catch (error) {
    console.error(
      `Error calculating importance score for entity ${entity.entity_id}:`,
      error
    );
    return 1.0; // Default fallback score
  }
}

/**
 * Score a context snippet based on multiple relevance factors
 *
 * @param {ContextSnippet} snippet - The context snippet to score
 * @param {string[]} queryKeywords - Keywords from the current query
 * @param {FocusArea} currentFocus - Current focus area
 * @param {RecencyInfo} recencyData - Information about recency thresholds
 * @returns {number} Final relevance score
 */
export async function scoreContextSnippet(
  snippet,
  queryKeywords,
  currentFocus,
  recencyData
) {
  try {
    // Define weights for different scoring factors
    const weights = {
      baseRelevance: 0.2, // 20% weight for initial relevance
      queryRelevance: 0.25, // 25% weight for query matching
      focusAlignment: 0.25, // 25% weight for focus area alignment (reduced from 30%)
      recency: 0.15, // 15% weight for recency
      entityType: 0.05, // 5% weight for entity type priority
      relationshipProximity: 0.1, // 10% weight for relationship proximity (increased from 5%)
    };

    // 1. Query Relevance
    const queryRelevanceScore = nonVectorRelevanceScore(
      snippet.entity,
      queryKeywords,
      currentFocus.keywords
    );

    // 2. Focus Alignment
    const focusAlignmentScore = calculateFocusAlignmentScore(
      snippet.entity,
      currentFocus
    );

    // 3. Recency
    const recencyScore = calculateRecencyScore(snippet.entity, recencyData);

    // 4. Entity Type Priority
    const entityTypePriorityScore = calculateEntityTypePriorityScore(
      snippet.entity,
      currentFocus.focus_type
    );

    // 5. Relationship Proximity (async)
    const relationshipProximityScore =
      await calculateRelationshipProximityScore(
        snippet.entity,
        currentFocus.related_entity_ids
      );

    // Combine all factors into a weighted score
    const finalScore =
      snippet.baseRelevance * weights.baseRelevance +
      queryRelevanceScore * weights.queryRelevance +
      focusAlignmentScore * weights.focusAlignment +
      recencyScore * weights.recency +
      entityTypePriorityScore * weights.entityType +
      relationshipProximityScore * weights.relationshipProximity;

    // Ensure score is between 0 and 1
    return Math.max(0, Math.min(1, finalScore));
  } catch (error) {
    console.error("Error scoring context snippet:", error);
    // Fall back to base relevance in case of error
    return snippet.baseRelevance;
  }
}

/**
 * Calculate focus alignment score based on the relationship between
 * the entity and the current focus area
 *
 * @param {CodeEntity} entity - The code entity
 * @param {FocusArea} focus - Current focus area
 * @returns {number} Focus alignment score between 0 and 1
 */
function calculateFocusAlignmentScore(entity, focus) {
  // Highest score if the entity is directly in the focus area's related entities
  if (focus.related_entity_ids.includes(entity.entity_id)) {
    return 1.0;
  }

  // Check parent relationship - high score if parent is in focus
  if (
    entity.parent_entity_id &&
    focus.related_entity_ids.includes(entity.parent_entity_id)
  ) {
    return 0.9;
  }

  // Check if the entity is from the same file as the focus
  const focusEntityPaths = focus.related_entity_ids.map((id) => {
    // This is a simplified approach - in practice, you would look up the entity
    // path from the database or another data structure
    return id.split(":")[0]; // Assuming ID format includes file path
  });

  if (
    entity.file_path &&
    focusEntityPaths.some((path) => entity.file_path.startsWith(path))
  ) {
    return 0.7;
  }

  // Check keyword overlap
  if (focus.keywords && focus.keywords.length > 0) {
    const entityText = [entity.name || "", entity.raw_content || ""]
      .join(" ")
      .toLowerCase();

    const matchingKeywords = focus.keywords.filter((keyword) =>
      entityText.includes(keyword.toLowerCase())
    );

    if (matchingKeywords.length > 0) {
      return 0.5 * (matchingKeywords.length / focus.keywords.length);
    }
  }

  // Minimal focus alignment
  return 0.1;
}

/**
 * Calculate recency score based on when the entity was last accessed or modified
 *
 * @param {CodeEntity} entity - The code entity
 * @param {RecencyInfo} recencyData - Information about recency thresholds
 * @returns {number} Recency score between 0 and 1
 */
function calculateRecencyScore(entity, recencyData) {
  const {
    lastAccessedThreshold,
    lastModifiedThreshold,
    recencyBoostFactor = 1.25,
  } = recencyData;
  let recencyScore = 0.5; // Default medium score

  // Check if the entity has been accessed recently
  if (entity.last_accessed_at) {
    const lastAccessed = new Date(entity.last_accessed_at);
    if (lastAccessed >= lastAccessedThreshold) {
      recencyScore = 0.8; // High score for recently accessed entities
    }
  }

  // Check if the entity has been modified recently (this takes precedence)
  if (entity.last_modified_at && lastModifiedThreshold) {
    const lastModified = new Date(entity.last_modified_at);
    if (lastModified >= lastModifiedThreshold) {
      recencyScore = 1.0; // Maximum score for recently modified entities
    }
  }

  // Apply recency decay based on time since last access/modification
  if (entity.last_accessed_at || entity.last_modified_at) {
    const lastTimepoint = entity.last_modified_at || entity.last_accessed_at;
    const lastTime = new Date(lastTimepoint);
    const now = new Date();
    const daysSince = (now - lastTime) / (1000 * 60 * 60 * 24);

    // Exponential decay: score = baseScore * e^(-daysSince/60)
    // This gives a decay to ~37% of original value after 60 days
    const decayFactor = Math.exp(-daysSince / 60);
    recencyScore *= decayFactor;
  }

  return recencyScore;
}

/**
 * Calculate entity type priority score based on entity type and current focus
 *
 * @param {CodeEntity} entity - The code entity
 * @param {string} focusType - Type of the current focus
 * @returns {number} Entity type priority score between 0 and 1
 */
function calculateEntityTypePriorityScore(entity, focusType) {
  // Base priorities for different entity types
  const typePriorities = {
    function: 0.9,
    class: 0.9,
    method: 0.85,
    file: 0.8,
    variable: 0.7,
    comment: 0.5,
    default: 0.6,
  };

  // Get base priority for this entity type
  const entityType = (entity.entity_type || "").toLowerCase();
  let typePriority = typePriorities[entityType] || typePriorities.default;

  // Boost priority if the entity type matches the focus type
  if (entityType === focusType.toLowerCase()) {
    typePriority = Math.min(1.0, typePriority * 1.2);
  }

  // Additional context-based adjustments could be added here
  // For example, if working on a bug fix, error handling code might get a boost

  return typePriority;
}

/**
 * Calculate relationship proximity score based on relationship to focus entities
 *
 * @param {CodeEntity} entity - The code entity
 * @param {string[]} focusEntityIds - IDs of entities in the current focus
 * @returns {number} Relationship proximity score between 0 and 1
 */
async function calculateRelationshipProximityScore(entity, focusEntityIds) {
  // Return default score if no entity ID or no focus entities
  if (!entity.entity_id || !focusEntityIds || focusEntityIds.length === 0) {
    return 0.5; // Default score if there are no focus entities
  }

  try {
    // Import necessary modules
    const { getRelationships, findCodePaths } = await import(
      "./RelationshipContextManagerLogic.js"
    );
    const LRUCache = (await import("../utils/lru-cache.js")).default;

    // Create or get the relationship cache (static cache shared across function calls)
    if (!calculateRelationshipProximityScore.cache) {
      calculateRelationshipProximityScore.cache = new LRUCache(100); // Cache up to 100 relationship lookups
    }
    const cache = calculateRelationshipProximityScore.cache;

    // Check if we have this relationship calculation cached
    const cacheKey = `${entity.entity_id}:${focusEntityIds.join(",")}`;
    const cachedScore = cache.get(cacheKey);
    if (cachedScore !== null) {
      return cachedScore;
    }

    // Define weights for different relationship types
    const relationshipTypeWeights = {
      calls: 1.0, // Direct function calls are very relevant
      extends: 0.9, // Class inheritance is highly relevant
      implements: 0.9, // Interface implementation is highly relevant
      imports: 0.8, // Import relationship is fairly relevant
      references: 0.7, // References relationship is somewhat relevant
      depends_on: 0.7, // Dependencies are somewhat relevant
      contains: 0.6, // Containment is moderately relevant
      references_variable: 0.5, // Variable references are less relevant
      default: 0.5, // Default weight for other types
    };

    // Collect metrics to calculate the final score
    let totalScore = 0;
    let relationshipCount = 0;
    let hasDirectRelationship = false;
    let hasSecondDegreeRelationship = false;

    // Check for direct (1st-degree) relationships
    const firstDegreeRelationships = await getRelationships(
      entity.entity_id,
      "both", // Get both incoming and outgoing relationships
      [] // All relationship types
    );

    if (firstDegreeRelationships.length === 0) {
      // Store in cache and return slightly below default if no relationships exist
      const score = 0.4;
      cache.put(cacheKey, score);
      return score;
    }

    // Process direct relationships with focus entities
    const directRelationshipsWithFocus = firstDegreeRelationships.filter(
      (rel) => {
        const otherEntityId =
          rel.source_entity_id === entity.entity_id
            ? rel.target_entity_id
            : rel.source_entity_id;
        return focusEntityIds.includes(otherEntityId);
      }
    );

    if (directRelationshipsWithFocus.length > 0) {
      hasDirectRelationship = true;

      // Calculate score based on relationship types and weights
      for (const rel of directRelationshipsWithFocus) {
        const relType = rel.relationship_type;
        const weight =
          relationshipTypeWeights[relType] || relationshipTypeWeights.default;

        // Direction matters - outgoing relationships (entity calls/uses focus) are slightly more relevant
        const directionMultiplier =
          rel.source_entity_id === entity.entity_id ? 1.0 : 0.9;

        totalScore += weight * directionMultiplier;
        relationshipCount++;
      }
    }

    // Check for 2nd-degree relationships (only if we don't have strong direct relationships)
    // This is more expensive, so we limit it
    if (
      !hasDirectRelationship ||
      (hasDirectRelationship && directRelationshipsWithFocus.length < 2)
    ) {
      // Get all entities related to our entity (1st degree connections)
      const connectedEntityIds = firstDegreeRelationships.map((rel) =>
        rel.source_entity_id === entity.entity_id
          ? rel.target_entity_id
          : rel.source_entity_id
      );

      // Check if any focus entity is connected to any of our 1st degree connections
      // We're limiting this to 5 entities to avoid expensive queries
      const focusEntitiesToCheck = focusEntityIds.slice(0, 5);
      const secondDegreeConnectionPromises = [];

      // For each focus entity, check if it has connections to any of our 1st degree connections
      for (const focusEntityId of focusEntitiesToCheck) {
        // Skip focus entities that already have direct connections
        if (
          directRelationshipsWithFocus.some(
            (rel) =>
              rel.source_entity_id === focusEntityId ||
              rel.target_entity_id === focusEntityId
          )
        ) {
          continue;
        }

        const promise = getRelationships(focusEntityId, "both", []).then(
          (focusRelationships) => {
            const secondDegreeConnections = focusRelationships.filter((rel) => {
              const otherEntityId =
                rel.source_entity_id === focusEntityId
                  ? rel.target_entity_id
                  : rel.source_entity_id;
              return connectedEntityIds.includes(otherEntityId);
            });

            if (secondDegreeConnections.length > 0) {
              hasSecondDegreeRelationship = true;

              // Second-degree relationships are less valuable, so we apply a discount
              for (const rel of secondDegreeConnections) {
                const relType = rel.relationship_type;
                const weight =
                  relationshipTypeWeights[relType] ||
                  relationshipTypeWeights.default;

                // Second-degree connections are worth less
                totalScore += weight * 0.5;
                relationshipCount++;
              }
            }
          }
        );

        secondDegreeConnectionPromises.push(promise);
      }

      // Wait for all second-degree connection checks to complete
      await Promise.all(secondDegreeConnectionPromises);
    }

    // For exceptional cases, try to find paths between the entity and important focus entities
    // This is expensive, so we only do it for a limited number of focus entities and when we don't have many direct relationships
    if (
      (!hasDirectRelationship && !hasSecondDegreeRelationship) ||
      relationshipCount < 2
    ) {
      // Only consider the first 2 focus entities for this expensive operation
      const importantFocusEntities = focusEntityIds.slice(0, 2);

      for (const focusEntityId of importantFocusEntities) {
        // Try to find paths up to 3 hops away (this can be expensive)
        try {
          // Look for important relationship types
          for (const relType of ["calls", "extends", "implements", "imports"]) {
            const paths = await findCodePaths(
              entity.entity_id,
              focusEntityId,
              relType
            );

            if (paths.length > 0) {
              hasSecondDegreeRelationship = true;

              // For each path, calculate a score based on path length
              for (const path of paths) {
                const pathLength = path.length;
                if (pathLength <= 4) {
                  // Only consider relatively short paths
                  const pathScore =
                    relationshipTypeWeights[relType] * (1 / pathLength);
                  totalScore += pathScore;
                  relationshipCount++;
                }
              }

              // If we found paths, no need to check other relationship types
              break;
            }
          }
        } catch (error) {
          console.error(
            `Error finding code paths for entity ${entity.entity_id}:`,
            error
          );
          // Continue processing other focus entities
        }
      }
    }

    // Calculate final score
    let finalScore;

    if (relationshipCount === 0) {
      // No relationships found, return below default
      finalScore = 0.45;
    } else {
      // Normalize the score
      let normalizedScore = totalScore / relationshipCount;

      // Apply bonuses for direct and indirect relationships
      if (hasDirectRelationship) {
        normalizedScore *= 1.2; // 20% boost for direct relationships
      }
      if (hasSecondDegreeRelationship) {
        normalizedScore *= 1.1; // 10% boost for second-degree relationships
      }

      // Ensure score is between 0 and 1
      finalScore = Math.min(1.0, normalizedScore);
    }

    // Cache the result
    cache.put(cacheKey, finalScore);

    return finalScore;
  } catch (error) {
    console.error("Error calculating relationship proximity:", error);
    return 0.5; // Default score in case of error
  }
}

/**
 * Prioritize context snippets based on relevance to query and current focus
 *
 * @param {ContextSnippet[]} contexts - Array of context snippets to prioritize
 * @param {string[]} queryKeywords - Keywords from the current query
 * @param {FocusArea} currentFocus - Current focus area
 * @param {number} maxResults - Maximum number of results to return
 * @returns {Promise<ContextSnippet[]>} Prioritized context snippets
 */
export async function prioritizeContexts(
  contexts,
  queryKeywords,
  currentFocus,
  maxResults
) {
  // Create recencyData with default thresholds
  const recencyData = {
    lastAccessedThreshold: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
    lastModifiedThreshold: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
    recencyBoostFactor: 1.25,
  };

  // Score each context snippet
  const scoredContexts = [];

  for (const snippet of contexts) {
    try {
      // Score the snippet
      const finalScore = await scoreContextSnippet(
        snippet,
        queryKeywords,
        currentFocus,
        recencyData
      );

      // Add the score to the snippet object
      scoredContexts.push({
        ...snippet,
        finalScore,
      });
    } catch (error) {
      console.error(`Error scoring context snippet: ${error.message}`);
      // Include the snippet with its base relevance as fallback
      scoredContexts.push({
        ...snippet,
        finalScore: snippet.baseRelevance || 0,
      });
    }
  }

  // Sort contexts by finalScore in descending order
  scoredContexts.sort((a, b) => b.finalScore - a.finalScore);

  // Return top maxResults
  return scoredContexts.slice(0, maxResults);
}

/**
 * Apply decay to importance scores of all entities that haven't been
 * accessed recently to reflect diminishing relevance over time
 *
 * @returns {Promise<void>}
 */
export async function applyDecayToAll() {
  try {
    // Define the minimum threshold to prevent scores from becoming too small
    const MIN_IMPORTANCE_THRESHOLD = 0.1;

    // Define the access threshold (entities not accessed in the last 30 days)
    const accessThreshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Construct and execute the SQL query to apply decay
    const query = `
      UPDATE code_entities 
      SET importance_score = importance_score * ? 
      WHERE last_accessed_at < ? 
      AND importance_score > ?
    `;

    const params = [
      CONTEXT_DECAY_RATE,
      accessThreshold.toISOString(),
      MIN_IMPORTANCE_THRESHOLD,
    ];

    // Execute the query
    const result = await executeQuery(query, params);

    console.log(`Applied decay to ${result.changes || 0} entities`);
  } catch (error) {
    console.error("Error applying decay to importance scores:", error);
    throw error;
  }
}
