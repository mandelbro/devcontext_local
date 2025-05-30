/**
 * RelationshipManager Service
 *
 * Service for managing and querying code relationships from the database.
 * Handles relationship-based context expansion for code entities.
 */

import * as dbQueries from "../db/queries.js";
import { RANKING_FACTOR_WEIGHTS } from "../config.js";

/**
 * RelationshipManager class for handling code relationship operations
 */
class RelationshipManager {
  /**
   * Constructor for RelationshipManager
   * @param {Object} dependencies - Service dependencies
   * @param {Object} dependencies.dbClient - Database client instance
   * @param {Object} dependencies.logger - Logger instance
   * @param {Object} dependencies.configService - Configuration service instance (optional)
   */
  constructor({ dbClient, logger, configService }) {
    this.dbClient = dbClient;
    this.logger = logger;
    this.configService = configService;

    // Log successful initialization
    this.logger.debug("RelationshipManager initialized successfully", {
      hasDbClient: !!this.dbClient,
      hasLogger: !!this.logger,
      hasConfigService: !!this.configService,
    });
  }

  /**
   * Gets related entities for a given code entity
   * Supports relationship-based context expansion for the retrieve_relevant_context functionality.
   *
   * @param {string} entityId - The ID of the seed code_entity
   * @param {Array<string>} relationshipTypes - Array of relationship types to explore (optional)
   * @param {number} depth - Maximum depth of traversal (optional, V2 focuses on 1)
   * @param {Array<string>} currentQueryTerms - Original query terms for optional relevance hinting (optional)
   * @param {number} seedEntityScore - Optional score of the seed entity to derive related entity scores from
   * @returns {Promise<Array>} Array of related entity snippet objects
   */
  async getRelatedEntities(
    entityId,
    relationshipTypes = [],
    depth = 1,
    currentQueryTerms = [],
    seedEntityScore = null
  ) {
    // Log the initiation of fetching related entities (Task 240 format)
    this.logger.debug(
      `getRelatedEntities called for seedId: ${entityId}, types: [${relationshipTypes.join(
        ", "
      )}], depth: ${depth}`,
      {
        entityId: entityId,
        relationshipTypes: relationshipTypes,
        depth: depth,
        currentQueryTerms: currentQueryTerms,
        seedEntityScore: seedEntityScore,
      }
    );

    // Initialize empty array for storing related entity snippets
    const relatedEntitiesSnippets = [];

    try {
      // Fetch raw relationships from the database
      const rawRelationships = await dbQueries.getRelationshipsForEntity(
        this.dbClient,
        entityId,
        relationshipTypes,
        depth
      );

      // Check if no relationships were found
      if (!rawRelationships || rawRelationships.length === 0) {
        this.logger.debug("No relationships found for entity", {
          seedEntityId: entityId,
          relationshipTypes: relationshipTypes,
        });
        return relatedEntitiesSnippets; // Return empty array
      }

      // Log the number of raw relationships found (Task 240 format)
      this.logger.debug(
        `Found ${rawRelationships.length} raw relationships for seedId: ${entityId}`,
        {
          seedEntityId: entityId,
          relationshipsFound: rawRelationships.length,
          relationshipTypes: relationshipTypes,
        }
      );

      // Process raw relationships to identify unique related entity IDs (Task 229)
      const uniqueRelatedEntityIds = new Set();

      for (const relationship of rawRelationships) {
        // If seed entity is the source, collect the target entity ID
        if (
          relationship.source_entity_id === entityId &&
          relationship.target_entity_id
        ) {
          uniqueRelatedEntityIds.add(relationship.target_entity_id);
        }
        // If seed entity is the target, collect the source entity ID
        else if (
          relationship.target_entity_id === entityId &&
          relationship.source_entity_id
        ) {
          uniqueRelatedEntityIds.add(relationship.source_entity_id);
        }
      }

      // Log the number of unique related entity IDs found (Task 240 format)
      this.logger.debug(
        `Identified ${uniqueRelatedEntityIds.size} unique related entity IDs for seedId: ${entityId}`,
        {
          seedEntityId: entityId,
          uniqueRelatedEntityIdsCount: uniqueRelatedEntityIds.size,
          rawRelationshipsProcessed: rawRelationships.length,
        }
      );

      // If no unique related entity IDs were found, return empty array
      if (uniqueRelatedEntityIds.size === 0) {
        this.logger.debug("No unique related entity IDs found", {
          seedEntityId: entityId,
        });
        return relatedEntitiesSnippets;
      }

      // Fetch full code_entity records for unique related entities (Task 230)
      const fetchedRelatedEntitiesMap = new Map();
      let successfullyFetchedCount = 0;

      for (const relatedId of uniqueRelatedEntityIds) {
        try {
          const entityRecord = await dbQueries.getCodeEntityById(
            this.dbClient,
            relatedId
          );

          if (entityRecord) {
            fetchedRelatedEntitiesMap.set(relatedId, entityRecord);
            successfullyFetchedCount++;
          } else {
            // Task 240: WARN for related entity ID not found in code_entities
            this.logger.warn(
              `Related entity ${relatedId} not found in code_entities, skipping for relationship expansion.`,
              {
                seedEntityId: entityId,
                missingRelatedId: relatedId,
              }
            );
          }
        } catch (error) {
          // Task 240: WARN for related entity fetch errors
          this.logger.warn(
            `Error fetching related entity ${relatedId}, skipping for relationship expansion.`,
            {
              seedEntityId: entityId,
              missingRelatedId: relatedId,
              error: error.message,
            }
          );
        }
      }

      // Log the number of full related entity records successfully fetched (Task 240 format)
      this.logger.debug(
        `Fetched ${successfullyFetchedCount} full records for related entities of seedId: ${entityId}`,
        {
          seedEntityId: entityId,
          totalUniqueRelatedIds: uniqueRelatedEntityIds.size,
          successfullyFetched: successfullyFetchedCount,
          fetchedEntitiesMapSize: fetchedRelatedEntitiesMap.size,
        }
      );

      // If no entity records were successfully fetched, return empty array
      if (fetchedRelatedEntitiesMap.size === 0) {
        this.logger.debug(
          "No related entity records were successfully fetched",
          {
            seedEntityId: entityId,
          }
        );
        return relatedEntitiesSnippets;
      }

      // Construct candidate snippets for related entities (Task 231)
      const processedEntityIds = new Set(); // Track processed entities to avoid duplicates

      for (const relationship of rawRelationships) {
        let relatedEntityId = null;
        let relationshipDirection = null;

        // Determine the related entity ID and relationship direction
        if (
          relationship.source_entity_id === entityId &&
          relationship.target_entity_id
        ) {
          relatedEntityId = relationship.target_entity_id;
          relationshipDirection = "outgoing"; // seed calls/owns/etc. related
        } else if (
          relationship.target_entity_id === entityId &&
          relationship.source_entity_id
        ) {
          relatedEntityId = relationship.source_entity_id;
          relationshipDirection = "incoming"; // related calls/owns/etc. seed
        }

        // Skip if we couldn't determine a related entity or direction
        if (!relatedEntityId || !relationshipDirection) {
          continue;
        }

        // Skip if this related entity wasn't successfully fetched
        if (!fetchedRelatedEntitiesMap.has(relatedEntityId)) {
          continue;
        }

        // Skip if we already processed this entity to avoid duplicates
        if (processedEntityIds.has(relatedEntityId)) {
          continue;
        }

        // Get the fetched entity record
        const relatedEntityRecord =
          fetchedRelatedEntitiesMap.get(relatedEntityId);

        // Determine content snippet (prioritize AI summary if aiStatus === 'completed', else raw_content snippet)
        let contentSnippet = "";
        if (
          relatedEntityRecord.ai_status === "completed" &&
          relatedEntityRecord.summary &&
          relatedEntityRecord.summary.trim()
        ) {
          contentSnippet = relatedEntityRecord.summary.trim();
        } else if (
          relatedEntityRecord.raw_content &&
          relatedEntityRecord.raw_content.trim()
        ) {
          const rawContent = relatedEntityRecord.raw_content.trim();
          const maxLength = 300;
          if (rawContent.length <= maxLength) {
            contentSnippet = rawContent;
          } else {
            contentSnippet = rawContent.substring(0, maxLength) + "...";
          }
        } else {
          contentSnippet = "No content available for this related entity.";
        }

        // Construct the relationshipContext object
        const relationshipContext = {
          relatedToSeedEntityId: entityId, // The original entity we expanded from
          relationshipType: relationship.relationship_type,
          direction: relationshipDirection, // 'outgoing' or 'incoming'
        };

        // Add custom_metadata if it exists
        if (relationship.custom_metadata) {
          relationshipContext.customMetadata = relationship.custom_metadata;
        }

        // Calculate initial score for the related snippet (Task 232)
        let initialScore = 0;

        // Start with a base score derived from the seed entity's score
        if (seedEntityScore !== null && typeof seedEntityScore === "number") {
          // Use 0.7 as the base fraction of the seed's score
          initialScore = seedEntityScore * 0.7;
        } else {
          // Default base score for related items when seed score is not available
          initialScore = 0.5;
        }

        // Apply relationship type weight multiplier
        const relationshipTypeWeight =
          RANKING_FACTOR_WEIGHTS.relationshipType[
            relationship.relationship_type
          ] || 1.0;
        initialScore = initialScore * relationshipTypeWeight;

        // Apply query term relevance boost if currentQueryTerms are provided
        if (currentQueryTerms && currentQueryTerms.length > 0) {
          let queryRelevanceBoost = 0;
          const searchableText = [
            relatedEntityRecord.name || "",
            contentSnippet || "",
            relatedEntityRecord.file_path || "",
          ]
            .join(" ")
            .toLowerCase();

          // Check how many query terms appear in the entity's searchable text
          let matchingTerms = 0;
          for (const term of currentQueryTerms) {
            if (term && typeof term === "string" && term.trim()) {
              const normalizedTerm = term.toLowerCase().trim();
              if (searchableText.includes(normalizedTerm)) {
                matchingTerms++;
              }
            }
          }

          // Apply a modest boost based on query term matches
          if (matchingTerms > 0) {
            const matchRatio = matchingTerms / currentQueryTerms.length;
            queryRelevanceBoost = Math.min(matchRatio * 0.2, 0.2); // Cap boost at 0.2
            initialScore = initialScore + queryRelevanceBoost;

            this.logger.debug(
              "Applied query relevance boost to related entity",
              {
                seedEntityId: entityId,
                relatedEntityId: relatedEntityId,
                matchingTerms: matchingTerms,
                totalQueryTerms: currentQueryTerms.length,
                queryRelevanceBoost: queryRelevanceBoost,
              }
            );
          }
        }

        // Ensure score doesn't go below 0 or above 1
        initialScore = Math.max(0, Math.min(1, initialScore));

        // Create a CandidateSnippet object conforming to structure from Task 207
        const candidateSnippet = {
          id: relatedEntityRecord.entity_id,
          sourceType: "code_entity_related",
          contentSnippet: contentSnippet,
          initialScore: initialScore, // Now calculated based on Task 232 requirements
          filePath: relatedEntityRecord.file_path,
          entityName: relatedEntityRecord.name,
          entityType: relatedEntityRecord.entity_type,
          language: relatedEntityRecord.language,
          aiStatus: relatedEntityRecord.ai_status,
          timestamp:
            relatedEntityRecord.last_modified_at ||
            relatedEntityRecord.created_at,
          metadata: {
            // Additional relevant metadata from relatedEntityRecord
            startLine: relatedEntityRecord.start_line,
            startColumn: relatedEntityRecord.start_column,
            endLine: relatedEntityRecord.end_line,
            endColumn: relatedEntityRecord.end_column,
            contentHash: relatedEntityRecord.content_hash,
            parentEntityId: relatedEntityRecord.parent_entity_id,
            parsingStatus: relatedEntityRecord.parsing_status,
          },
          relationshipContext: relationshipContext,
        };

        // Add this to the relatedEntitiesSnippets array
        relatedEntitiesSnippets.push(candidateSnippet);
        processedEntityIds.add(relatedEntityId);

        this.logger.debug("Constructed candidate snippet for related entity", {
          seedEntityId: entityId,
          relatedEntityId: relatedEntityId,
          relationshipType: relationship.relationship_type,
          relationshipTypeWeight: relationshipTypeWeight,
          direction: relationshipDirection,
          entityName: relatedEntityRecord.name,
          contentSnippetLength: contentSnippet.length,
          calculatedInitialScore: initialScore,
          seedEntityScore: seedEntityScore,
        });
      }

      this.logger.debug("Candidate snippets construction completed", {
        seedEntityId: entityId,
        totalSnippetsCreated: relatedEntitiesSnippets.length,
        uniqueEntitiesProcessed: processedEntityIds.size,
        totalRelationshipsProcessed: rawRelationships.length,
      });
    } catch (error) {
      this.logger.error("Error fetching relationships for entity", {
        error: error.message,
        stack: error.stack,
        seedEntityId: entityId,
        relationshipTypes: relationshipTypes,
        depth: depth,
      });

      // Return empty array on error to handle gracefully
      return relatedEntitiesSnippets;
    }

    // Log when returning snippets (Task 240 format: INFO/DEBUG level)
    this.logger.info(
      `Returning ${relatedEntitiesSnippets.length} relationship-derived snippets for seedId: ${entityId}`,
      {
        seedEntityId: entityId,
        snippetsReturned: relatedEntitiesSnippets.length,
        readyForMerging: true,
        allSnippetsFullyPopulated: relatedEntitiesSnippets.every(
          (snippet) =>
            snippet.id &&
            snippet.sourceType === "code_entity_related" &&
            snippet.contentSnippet &&
            typeof snippet.initialScore === "number" &&
            snippet.relationshipContext
        ),
        snippetDetails: relatedEntitiesSnippets.map((snippet) => ({
          id: snippet.id,
          entityName: snippet.entityName,
          relationshipType: snippet.relationshipContext.relationshipType,
          direction: snippet.relationshipContext.direction,
          initialScore: snippet.initialScore,
          contentLength: snippet.contentSnippet.length,
        })),
      }
    );

    return relatedEntitiesSnippets;
  }
}

export default RelationshipManager;
