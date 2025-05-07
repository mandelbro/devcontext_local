/**
 * InsightEngine.js
 *
 * Orchestrates the intelligent retrieval pipeline, combining intent prediction,
 * smart search, entity relationships, context prioritization, and compression
 * to provide the most relevant context for a given query.
 */

import * as IntentPredictorLogic from "./IntentPredictorLogic.js";
import * as SmartSearchServiceLogic from "./SmartSearchServiceLogic.js";
import * as RelationshipContextManagerLogic from "./RelationshipContextManagerLogic.js";
import * as ContextPrioritizerLogic from "./ContextPrioritizerLogic.js";
import * as ContextCompressorLogic from "./ContextCompressorLogic.js";
import * as ActiveContextManager from "./ActiveContextManager.js";

/**
 * @typedef {Object} Message
 * @property {string} messageId - Unique identifier for the message
 * @property {string} conversationId - ID of the conversation this message belongs to
 * @property {string} role - Role of the message sender (e.g., 'user', 'assistant')
 * @property {string} content - Content of the message
 * @property {Date} timestamp - When the message was sent
 * @property {string[]} [relatedContextEntityIds] - IDs of related code entities
 * @property {string} [summary] - Summary of the message content
 * @property {string} [userIntent] - Inferred user intent
 * @property {string} [topicSegmentId] - ID of topic segment this message belongs to
 * @property {string[]} [semanticMarkers] - Semantic markers for enhanced retrieval
 * @property {Object} [sentimentIndicators] - Sentiment analysis results
 */

/**
 * @typedef {Object} FocusArea
 * @property {string} focus_id - Unique identifier for the focus area
 * @property {string} focus_type - Type of focus area ('file', 'directory', 'task_type')
 * @property {string} identifier - Primary identifier for the focus area (e.g., file path)
 * @property {string} description - Human-readable description of the focus area
 * @property {string[]} related_entity_ids - Array of related entity IDs
 * @property {string[]} keywords - Array of keywords related to this focus area
 * @property {number} last_activated_at - Timestamp when this focus area was last active
 * @property {boolean} is_active - Whether this focus area is currently active
 */

/**
 * @typedef {Object} Snippet
 * @property {string} entity_id - ID of the entity
 * @property {string} summarizedContent - Compressed/summarized content
 * @property {number} originalScore - Original relevance score
 * @property {string} type - Type of snippet
 */

/**
 * @typedef {Object} SearchResult
 * @property {Object} entity - The found code entity
 * @property {number} relevanceScore - Relevance score for the search result
 */

/**
 * @typedef {Object} ContextSnippet
 * @property {string} entity_id - ID of the entity
 * @property {string} content - Content of the entity
 * @property {string} type - Type of entity
 * @property {string} path - Path to the entity file
 * @property {string} name - Name of the entity
 * @property {number} baseRelevance - Base relevance score
 * @property {Object} metadata - Additional entity metadata
 */

/**
 * Orchestrates the full retrieval pipeline to get the most relevant snippets for a query
 *
 * @param {string} query - The user's query
 * @param {Message[]} conversationHistory - Array of conversation messages
 * @param {FocusArea|null} currentFocusOverride - Optional override for the current focus area
 * @param {number} tokenBudget - Maximum token budget for returned context
 * @param {Object} [constraints] - Optional constraints for search
 * @returns {Promise<Snippet[]>} Array of relevant context snippets
 */
export async function orchestrateRetrieval(
  query,
  conversationHistory,
  currentFocusOverride,
  tokenBudget,
  constraints = {}
) {
  try {
    console.log(
      `[InsightEngine] Orchestrating retrieval for query: "${query}"`
    );

    // 1. Determine current focus
    const currentFocus =
      currentFocusOverride || (await ActiveContextManager.getActiveFocus());
    console.log(
      `[InsightEngine] Using focus: ${
        currentFocus ? currentFocus.identifier : "None"
      }`
    );

    // 2. Get intent and refined keywords from query and conversation history
    const { intent, keywords } =
      await IntentPredictorLogic.inferIntentFromQuery(
        query,
        conversationHistory.slice(-5) // Use last 5 messages for context
      );

    // Ensure keywords are strings (they might be objects or other types)
    let processedKeywords = [];
    if (Array.isArray(keywords)) {
      processedKeywords = keywords
        .map((kw) => {
          // Check if it's a string already
          if (typeof kw === "string") {
            return kw;
          }
          // If it's an object with a 'token' property
          if (kw && typeof kw === "object" && kw.token) {
            return kw.token;
          }
          // Convert to string if possible
          return String(kw);
        })
        .filter((kw) => kw && kw.length > 0); // Remove empty entries
    }

    // If we ended up with no keywords, extract directly from the query
    if (processedKeywords.length === 0) {
      processedKeywords = query.split(/\s+/).filter((word) => word.length > 2);
    }

    console.log(
      `[InsightEngine] Detected intent: ${intent}, extracted keywords: ${processedKeywords.join(
        ", "
      )}`
    );

    // 3. Call SmartSearchServiceLogic.searchByKeywords with refined keywords
    const searchOptions = {
      ...constraints,
      limit: constraints.limit || 20, // Default to 20 results initially
      strategy: constraints.strategy || "combined", // Default to combined search strategy
    };

    const searchResults = await SmartSearchServiceLogic.searchByKeywords(
      processedKeywords,
      searchOptions
    );

    console.log(
      `[InsightEngine] Initial search returned ${searchResults.length} results`
    );

    // Skip further processing if no results
    if (!searchResults || searchResults.length === 0) {
      return [];
    }

    // 4. For highly relevant candidates, explore related entities
    const relatedEntities = [];

    // Process most relevant candidates (top 5 or 25% of results, whichever is smaller)
    const topResultsCount = Math.min(5, Math.ceil(searchResults.length * 0.25));
    const topResults = searchResults.slice(0, topResultsCount);

    // For each top result, explore relationships
    for (const result of topResults) {
      const entityId = result.entity.entity_id;

      // Use appropriate method based on entity type
      if (
        result.entity.entity_type === "function" ||
        result.entity.entity_type === "method"
      ) {
        try {
          // Get call graph for functions/methods
          const callGraph =
            await RelationshipContextManagerLogic.buildCallGraphSnippet(
              entityId,
              1 // Depth of 1 to avoid too much expansion
            );

          // Extract entities from call graph
          if (callGraph && callGraph.nodes) {
            for (const node of callGraph.nodes) {
              // Skip if it's the same as the source entity
              if (node.id !== entityId) {
                relatedEntities.push({
                  entity_id: node.id,
                  relationship: "call_graph",
                  source_entity_id: entityId,
                });
              }
            }
          }
        } catch (error) {
          console.warn(
            `[InsightEngine] Error building call graph for ${entityId}:`,
            error
          );
        }
      } else {
        try {
          // Get general relationships for other entity types
          const relationships =
            await RelationshipContextManagerLogic.getRelationships(
              entityId,
              ["imports", "uses", "inherits", "implements"],
              2 // Limit to 2 relationships per type
            );

          // Add related entities
          for (const rel of relationships) {
            relatedEntities.push({
              entity_id: rel.target_entity_id,
              relationship: rel.relationship_type,
              source_entity_id: entityId,
            });
          }
        } catch (error) {
          console.warn(
            `[InsightEngine] Error getting relationships for ${entityId}:`,
            error
          );
        }
      }
    }

    console.log(
      `[InsightEngine] Found ${relatedEntities.length} related entities`
    );

    // 5. Fetch full details of related entities and combine with search results
    const relatedEntityResults = [];

    // Create a Set of existing entity IDs to avoid duplicates
    const existingEntityIds = new Set(
      searchResults.map((result) => result.entity.entity_id)
    );

    // Process each related entity
    for (const relatedEntity of relatedEntities) {
      // Skip if we already have this entity
      if (existingEntityIds.has(relatedEntity.entity_id)) {
        continue;
      }

      try {
        // Query for entity details
        const entities = await SmartSearchServiceLogic.searchByEntityIds([
          relatedEntity.entity_id,
        ]);

        if (entities && entities.length > 0) {
          // Add to results list with a slightly lower score
          const sourceResult = searchResults.find(
            (r) => r.entity.entity_id === relatedEntity.source_entity_id
          );

          // Base the relevance on the source entity, but reduce it
          const relevanceScore = sourceResult
            ? Math.max(0.4, sourceResult.relevanceScore * 0.8)
            : 0.4;

          relatedEntityResults.push({
            entity: entities[0],
            relevanceScore,
          });

          // Add to set to avoid duplicates
          existingEntityIds.add(relatedEntity.entity_id);
        }
      } catch (error) {
        console.warn(
          `[InsightEngine] Error fetching details for related entity ${relatedEntity.entity_id}:`,
          error
        );
      }
    }

    // Combine original search results with related entities
    const combinedResults = [...searchResults, ...relatedEntityResults];
    console.log(
      `[InsightEngine] Combined results: ${combinedResults.length} entities`
    );

    // 6. Convert all candidate entities to ContextSnippet format
    const contextSnippets = combinedResults.map((result) => ({
      entity_id: result.entity.entity_id,
      content: result.entity.raw_content || "",
      type: result.entity.entity_type || "unknown",
      path: result.entity.file_path || "",
      name: result.entity.name || "",
      baseRelevance: result.relevanceScore,
      metadata: {
        symbolPath: result.entity.symbol_path,
        parentId: result.entity.parent_entity_id,
        version: result.entity.version,
      },
      entity: result.entity, // Include full entity for prioritization logic
    }));

    // 7. Prioritize the context snippets
    const prioritizedSnippets =
      await ContextPrioritizerLogic.prioritizeContexts(
        contextSnippets,
        processedKeywords,
        currentFocus,
        Math.max(50, contextSnippets.length) // Higher limit to ensure we consider all snippets
      );

    console.log(
      `[InsightEngine] Prioritized ${prioritizedSnippets.length} context snippets`
    );

    // 8. Manage token budget to get final set of snippets
    const processedSnippets = await ContextCompressorLogic.manageTokenBudget(
      prioritizedSnippets.map((snippet) => ({
        ...snippet,
        score: snippet.relevanceScore || snippet.baseRelevance,
      })),
      tokenBudget,
      processedKeywords
    );

    console.log(
      `[InsightEngine] Final result: ${processedSnippets.length} processed snippets within token budget`
    );

    // 9. Map the processed snippets to the expected Snippet format
    const finalSnippets = processedSnippets.map((snippet) => ({
      entity_id: snippet.entity_id,
      summarizedContent: snippet.summarizedContent,
      originalScore: snippet.originalScore || snippet.score,
      type:
        snippet.type ||
        (snippet.entity && snippet.entity.entity_type) ||
        "unknown",
    }));

    return finalSnippets;
  } catch (error) {
    console.error("[InsightEngine] Error orchestrating retrieval:", error);
    return []; // Return empty array on error
  }
}
