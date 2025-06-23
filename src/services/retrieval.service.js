/**
 * RetrievalService
 *
 * Service for fetching various context components for conversation initialization
 * and other context-aware operations. This service will be expanded significantly
 * to support different types of context retrieval.
 */

import * as dbQueries from "../db/queries.js";
import { KEY_ARCHITECTURE_DOCUMENT_PATHS } from "../config.js";
import CompressionService from "./compression.service.js";

/**
 * RetrievalService class for handling context retrieval operations
 */
class RetrievalService {
  /**
   * Constructor for RetrievalService
   * @param {Object} dependencies - Service dependencies
   * @param {Object} dependencies.dbClient - Database client instance
   * @param {Object} dependencies.logger - Logger instance
   * @param {Object} dependencies.configService - Configuration service instance
   * @param {Object} dependencies.compressionService - Compression service instance
   * @param {Object} dependencies.relationshipManager - Relationship manager instance
   */
  constructor({
    dbClient,
    logger,
    configService,
    compressionService,
    relationshipManager,
  }) {
    this.dbClient = dbClient;
    this.logger = logger;
    this.configService = configService;
    this.compressionService = compressionService;
    this.relationshipManager = relationshipManager;

    // Log successful initialization
    this.logger.info("RetrievalService initialized successfully", {
      hasDbClient: !!this.dbClient,
      hasLogger: !!this.logger,
      hasConfigService: !!this.configService,
      hasCompressionService: !!this.compressionService,
      hasRelationshipManager: !!this.relationshipManager,
    });
  }

  // ===========================================
  // PROJECT STRUCTURE SUMMARY METHODS
  // ===========================================

  /**
   * Retrieves and assembles the project structure summary
   * Calls all relevant DB query functions and transforms results into structured format
   * @returns {Promise<Object>} Project structure object with counts and summary
   */
  async getProjectStructureSummary() {
    try {
      this.logger.debug("Starting project structure summary retrieval");

      // Call all DB query functions for counts
      const [
        langCounts,
        typeCounts,
        entityAiStatusCounts,
        docTypeCounts,
        docAiStatusCounts,
        relTypeCounts,
      ] = await Promise.all([
        dbQueries.getCodeEntityCountsByLanguage(this.dbClient),
        dbQueries.getCodeEntityCountsByType(this.dbClient),
        dbQueries.getCodeEntityCountsByAiStatus(this.dbClient),
        dbQueries.getProjectDocumentCountsByType(this.dbClient),
        dbQueries.getProjectDocumentCountsByAiStatus(this.dbClient),
        dbQueries.getCodeRelationshipCountsByType(this.dbClient),
      ]);

      this.logger.debug("Retrieved all project structure counts", {
        langCountsLength: langCounts.length,
        typeCountsLength: typeCounts.length,
        entityAiStatusCountsLength: entityAiStatusCounts.length,
        docTypeCountsLength: docTypeCounts.length,
        docAiStatusCountsLength: docAiStatusCounts.length,
        relTypeCountsLength: relTypeCounts.length,
      });

      // Transform arrays of objects into map/record format
      const entityCountsByLanguage = this._transformCountsToMap(
        langCounts,
        "language"
      );
      const entityCountsByType = this._transformCountsToMap(
        typeCounts,
        "entity_type"
      );
      const documentCountsByType = this._transformCountsToMap(
        docTypeCounts,
        "file_type"
      );
      const relationshipTypeCounts = this._transformCountsToMap(
        relTypeCounts,
        "relationship_type"
      );

      // Transform AI status counts for nested structure
      const entityAiStatus = this._transformCountsToMap(
        entityAiStatusCounts,
        "ai_status"
      );
      const docAiStatus = this._transformCountsToMap(
        docAiStatusCounts,
        "ai_status"
      );

      // Calculate totals for dynamic summary
      const totalEntities = this._sumCounts(entityCountsByLanguage);
      const totalDocuments = this._sumCounts(documentCountsByType);
      const totalRelationships = this._sumCounts(relationshipTypeCounts);
      const primaryLanguages = Object.keys(entityCountsByLanguage).slice(0, 3); // Top 3 languages

      // Generate dynamic summary
      const summary = this._generateProjectSummary({
        totalEntities,
        totalDocuments,
        totalRelationships,
        primaryLanguages,
      });

      // Construct the project structure object
      const projectStructure = {
        summary,
        entityCountsByLanguage,
        entityCountsByType,
        documentCountsByType,
        aiProcessingStatus: {
          codeEntities: entityAiStatus,
          projectDocuments: docAiStatus,
        },
        relationshipTypeCounts,
      };

      this.logger.info("Project structure summary assembled successfully", {
        totalEntities,
        totalDocuments,
        totalRelationships,
        languageCount: Object.keys(entityCountsByLanguage).length,
        documentTypeCount: Object.keys(documentCountsByType).length,
      });

      return projectStructure;
    } catch (error) {
      this.logger.error("Error retrieving project structure summary", {
        error: error.message,
        stack: error.stack,
      });

      // Return a fallback structure with error indication
      return {
        summary:
          "Error retrieving project structure. Some data may be unavailable.",
        entityCountsByLanguage: {},
        entityCountsByType: {},
        documentCountsByType: {},
        aiProcessingStatus: {
          codeEntities: {},
          projectDocuments: {},
        },
        relationshipTypeCounts: {},
        error: error.message,
      };
    }
  }

  /**
   * Retrieves and formats recent conversation topics for context
   * @param {string|null} initialQueryString - Optional initial query for filtering/prioritization
   * @returns {Promise<Object>} Object with topics array
   */
  async getRecentConversationTopicsSummary(initialQueryString = null) {
    try {
      this.logger.debug("Retrieving recent conversation topics summary", {
        hasInitialQuery: !!initialQueryString,
        initialQueryLength: initialQueryString?.length || 0,
      });

      // Define limit for topics
      const topicsLimit = 5;

      // Tokenize initialQueryString into terms if provided
      let initialQueryTerms = [];
      if (initialQueryString && typeof initialQueryString === "string") {
        initialQueryTerms = initialQueryString
          .toLowerCase()
          .split(/\s+/)
          .filter((term) => term.length > 2); // Filter out very short terms
      }

      // Fetch more topics if we need to filter, otherwise just fetch the limit
      const fetchLimit =
        initialQueryTerms.length > 0 ? topicsLimit * 2 : topicsLimit;

      // Call the database query function
      const recentTopicsFromDb = await dbQueries.getRecentConversationTopics(
        this.dbClient,
        fetchLimit,
        initialQueryTerms
      );

      let selectedTopics = recentTopicsFromDb;

      // Optional filtering/prioritization if initialQueryString exists
      if (initialQueryTerms.length > 0 && recentTopicsFromDb.length > 0) {
        this.logger.debug("Applying relevance filtering for recent topics", {
          initialQueryTerms,
          topicsToFilter: recentTopicsFromDb.length,
        });

        // Score topics based on relevance to initial query terms
        const scoredTopics = recentTopicsFromDb.map((topic) => {
          let relevanceScore = 0;

          // Check summary for matches (case-insensitive)
          if (topic.summary) {
            const summaryLower = topic.summary.toLowerCase();
            for (const term of initialQueryTerms) {
              if (summaryLower.includes(term)) {
                relevanceScore += 2; // Higher weight for summary matches
              }
            }
          }

          // Check keywords for matches
          if (topic.keywords) {
            try {
              const keywordsArray = JSON.parse(topic.keywords);
              if (Array.isArray(keywordsArray)) {
                for (const keyword of keywordsArray) {
                  const keywordLower = keyword.toLowerCase();
                  for (const term of initialQueryTerms) {
                    if (keywordLower.includes(term)) {
                      relevanceScore += 1; // Lower weight for keyword matches
                    }
                  }
                }
              }
            } catch (error) {
              // If keywords is not valid JSON, treat as string and search
              const keywordsLower = topic.keywords.toLowerCase();
              for (const term of initialQueryTerms) {
                if (keywordsLower.includes(term)) {
                  relevanceScore += 1;
                }
              }
            }
          }

          return {
            ...topic,
            relevanceScore,
          };
        });

        // Sort by relevance score (descending), then by recency (already sorted from DB)
        scoredTopics.sort((a, b) => {
          if (a.relevanceScore !== b.relevanceScore) {
            return b.relevanceScore - a.relevanceScore; // Higher score first
          }
          return 0; // Maintain original order (recency) for same scores
        });

        // Take top topics after scoring
        selectedTopics = scoredTopics.slice(0, topicsLimit);

        this.logger.debug("Applied relevance filtering", {
          originalCount: recentTopicsFromDb.length,
          filteredCount: selectedTopics.length,
          hasRelevantTopics: selectedTopics.some((t) => t.relevanceScore > 0),
        });
      } else {
        // No filtering needed, just take the limit
        selectedTopics = recentTopicsFromDb.slice(0, topicsLimit);
      }

      // Format the final selected topics
      const formattedTopics = selectedTopics.map((topic) => ({
        topicId: topic.topicId,
        summary: topic.summary || "",
        purposeTag: topic.purposeTag || null,
      }));

      this.logger.info("Recent conversation topics summary retrieved", {
        topicsCount: formattedTopics.length,
        requestedLimit: topicsLimit,
        hadInitialQuery: !!initialQueryString,
      });

      return {
        topics: formattedTopics,
      };
    } catch (error) {
      this.logger.error("Error retrieving recent conversation topics summary", {
        error: error.message,
        stack: error.stack,
        initialQueryString,
      });

      // Return empty topics array on error
      return {
        topics: [],
      };
    }
  }

  /**
   * Helper method to transform array of count objects to map format
   * @param {Array} countsArray - Array of objects with key and count properties
   * @param {string} keyField - The field name to use as the map key
   * @returns {Object} Map with key -> count pairs
   */
  _transformCountsToMap(countsArray, keyField) {
    const map = {};
    if (Array.isArray(countsArray)) {
      for (const item of countsArray) {
        if (item[keyField] && typeof item.count === "number") {
          map[item[keyField]] = item.count;
        }
      }
    }
    return map;
  }

  /**
   * Helper method to sum all values in a counts map
   * @param {Object} countsMap - Map with count values
   * @returns {number} Total sum of all counts
   */
  _sumCounts(countsMap) {
    return Object.values(countsMap).reduce((sum, count) => sum + count, 0);
  }

  /**
   * Helper method to generate dynamic project summary text
   * @param {Object} stats - Project statistics
   * @returns {string} Generated summary text
   */
  _generateProjectSummary({
    totalEntities,
    totalDocuments,
    totalRelationships,
    primaryLanguages,
  }) {
    const parts = [];

    if (totalEntities > 0) {
      parts.push(`${totalEntities} code entities`);
    }

    if (totalDocuments > 0) {
      parts.push(`${totalDocuments} documents`);
    }

    if (totalRelationships > 0) {
      parts.push(`${totalRelationships} relationships`);
    }

    if (primaryLanguages.length > 0) {
      parts.push(`Primary languages: ${primaryLanguages.join(", ")}`);
    }

    if (parts.length === 0) {
      return "Project context summary: No data available or project not yet analyzed.";
    }

    return `Project context summary: ${parts.join(", ")}.`;
  }

  // ===========================================
  // ARCHITECTURE CONTEXT METHODS
  // ===========================================

  /**
   * Retrieves and formats key architecture documents for context
   * Fetches documents defined in KEY_ARCHITECTURE_DOCUMENT_PATHS, prioritizing AI summaries
   * @returns {Promise<Object>} Object with keyDocuments array and optional overallProjectGoalHint
   */
  async getArchitectureContextSummary() {
    try {
      this.logger.debug("Retrieving architecture context summary", {
        documentPathsCount: KEY_ARCHITECTURE_DOCUMENT_PATHS.length,
        documentPaths: KEY_ARCHITECTURE_DOCUMENT_PATHS,
      });

      // Initialize array for key documents data
      const keyDocumentsData = [];
      let overallProjectGoalHint = null;

      // Iterate through each configured document path
      for (const docPath of KEY_ARCHITECTURE_DOCUMENT_PATHS) {
        try {
          this.logger.debug(`Fetching architecture document: ${docPath}`);

          // Fetch the document from the database
          const doc = await dbQueries.getProjectDocumentByFilePath(
            this.dbClient,
            docPath
          );

          if (doc) {
            this.logger.debug(`Found architecture document: ${docPath}`, {
              documentId: doc.document_id,
              aiStatus: doc.ai_status,
              hasSummary: !!doc.summary,
              hasContent: !!doc.raw_content,
            });

            // Determine summarySnippet based on AI status and available content
            let summarySnippet;

            if (
              doc.ai_status === "completed" &&
              doc.summary &&
              doc.summary.trim()
            ) {
              // Use AI summary if available and completed
              summarySnippet = doc.summary.trim();
              this.logger.debug(`Using AI summary for ${docPath}`);
            } else if (doc.raw_content && doc.raw_content.trim()) {
              // Use raw content snippet if AI summary not available
              const content = doc.raw_content.trim();
              const maxSnippetLength = 500;

              if (content.length <= maxSnippetLength) {
                summarySnippet = content;
              } else {
                // Take first 500 characters and add ellipsis
                summarySnippet = content.substring(0, maxSnippetLength) + "...";
              }
              this.logger.debug(`Using raw content snippet for ${docPath}`, {
                originalLength: content.length,
                snippetLength: summarySnippet.length,
              });
            } else {
              // No content available
              summarySnippet = "Content not available or not summarized.";
              this.logger.debug(`No content available for ${docPath}`);
            }

            // Add formatted document data
            keyDocumentsData.push({
              filePath: doc.file_path,
              aiStatus: doc.ai_status,
              summarySnippet,
            });

            // Optional: Set overallProjectGoalHint from primary goal documents
            if (
              !overallProjectGoalHint &&
              (docPath === "README.md" || docPath === "docs/prd.md") &&
              summarySnippet &&
              summarySnippet !== "Content not available or not summarized."
            ) {
              // Use first part of the summary as goal hint (max 200 chars)
              const maxHintLength = 200;
              if (summarySnippet.length <= maxHintLength) {
                overallProjectGoalHint = summarySnippet;
              } else {
                overallProjectGoalHint =
                  summarySnippet.substring(0, maxHintLength) + "...";
              }
              this.logger.debug(`Set overallProjectGoalHint from ${docPath}`, {
                hintLength: overallProjectGoalHint.length,
              });
            }
          } else {
            // Document not found in the database
            this.logger.debug(
              `Key architecture document not found: ${docPath}`
            );

            // Optionally add an entry for missing documents
            keyDocumentsData.push({
              filePath: docPath,
              aiStatus: "not_found",
              summarySnippet: "Document not found in index.",
            });
          }
        } catch (docError) {
          this.logger.error(
            `Error fetching architecture document: ${docPath}`,
            {
              error: docError.message,
              stack: docError.stack,
              docPath,
            }
          );

          // Add an error entry for this document
          keyDocumentsData.push({
            filePath: docPath,
            aiStatus: "error",
            summarySnippet: `Error retrieving document: ${docError.message}`,
          });
        }
      }

      this.logger.info("Architecture context summary retrieved successfully", {
        keyDocumentsCount: keyDocumentsData.length,
        documentsFound: keyDocumentsData.filter(
          (doc) => doc.aiStatus !== "not_found" && doc.aiStatus !== "error"
        ).length,
        hasProjectGoalHint: !!overallProjectGoalHint,
      });

      // Return the assembled architecture context
      const result = {
        keyDocuments: keyDocumentsData,
      };

      if (overallProjectGoalHint) {
        result.overallProjectGoalHint = overallProjectGoalHint;
      }

      return result;
    } catch (error) {
      this.logger.error("Error retrieving architecture context summary", {
        error: error.message,
        stack: error.stack,
      });

      // Return fallback structure on error
      return {
        keyDocuments: [],
        error: error.message,
      };
    }
  }

  // ===========================================
  // FTS QUERY PREPARATION METHODS
  // ===========================================

  /**
   * Prepares an FTS query string from natural language query text
   * Converts user input into a format suitable for SQLite FTS5 MATCH operations
   * @param {string} naturalLanguageQuery - The user's natural language query
   * @returns {string} FTS5-compatible query string
   * @private
   */
  _prepareFtsQueryString(naturalLanguageQuery) {
    try {
      this.logger.debug("Preparing FTS query string", {
        originalQuery: naturalLanguageQuery,
        queryLength: naturalLanguageQuery?.length || 0,
      });

      // Handle null, undefined, or empty queries
      if (!naturalLanguageQuery || typeof naturalLanguageQuery !== "string") {
        this.logger.debug("Invalid or empty query provided");
        return "";
      }

      // Convert to lowercase for consistent processing
      let processedQuery = naturalLanguageQuery.toLowerCase().trim();

      // Basic tokenization - split by spaces and punctuation
      // Remove special characters but keep alphanumeric and basic punctuation
      let tokens = processedQuery
        .split(/[\s\.,;:!?\-\(\)\[\]{}'"]+/)
        .filter((token) => token.length > 0);

      this.logger.debug("Initial tokenization completed", {
        tokenCount: tokens.length,
        tokens: tokens.slice(0, 10), // Log first 10 tokens for debugging
      });

      // Filter out very short tokens and common stop words
      const stopWords = new Set([
        "a",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "by",
        "for",
        "from",
        "has",
        "he",
        "in",
        "is",
        "it",
        "its",
        "of",
        "on",
        "that",
        "the",
        "to",
        "was",
        "will",
        "with",
        "the",
        "this",
        "that",
        "they",
        "them",
        "their",
        "what",
        "where",
        "when",
        "why",
        "how",
        "i",
        "you",
        "we",
        "me",
        "my",
        "your",
        "our",
      ]);

      const filteredTokens = tokens.filter((token) => {
        // Keep tokens that are:
        // - At least 2 characters long
        // - Not common stop words
        // - Contain at least one letter (to avoid pure punctuation)
        return (
          token.length >= 2 && !stopWords.has(token) && /[a-zA-Z]/.test(token)
        );
      });

      this.logger.debug("Token filtering completed", {
        originalTokenCount: tokens.length,
        filteredTokenCount: filteredTokens.length,
        filteredTokens: filteredTokens,
      });

      // If no valid tokens remain, return empty string
      if (filteredTokens.length === 0) {
        this.logger.debug("No valid tokens found after filtering");
        return "";
      }

      // Escape any special FTS5 characters in individual tokens
      const escapedTokens = filteredTokens.map((token) => {
        // Escape FTS5 special characters: " * ( ) [ ] { } ^ ~ -
        return token.replace(/["\*\(\)\[\]\{\}\^\~\-]/g, "\\$&");
      });

      // Join tokens with OR for broader matching in initial snippets
      // This casts a wider net to find relevant content
      const ftsQueryString = escapedTokens.join(" OR ");

      this.logger.debug("FTS query string preparation completed", {
        originalQuery: naturalLanguageQuery,
        finalQueryString: ftsQueryString,
        tokenCount: escapedTokens.length,
      });

      return ftsQueryString;
    } catch (error) {
      this.logger.error("Error preparing FTS query string", {
        error: error.message,
        stack: error.stack,
        naturalLanguageQuery,
      });

      // Return empty string on error to avoid breaking FTS queries
      return "";
    }
  }

  // ===========================================
  // FTS SNIPPET RETRIEVAL METHODS
  // ===========================================

  /**
   * Retrieves FTS-based context snippets for an initial query
   * Orchestrates full-text search across code entities and project documents
   * @param {string} initialQueryString - The user's initial query text
   * @param {number} limit - Maximum number of snippets to return (default: 3)
   * @returns {Promise<Array>} Array of formatted snippet objects
   */
  async getFtsSnippetsForInitialQuery(initialQueryString, limit = 3) {
    try {
      this.logger.debug("Starting FTS snippets retrieval for initial query", {
        initialQueryString,
        limit,
        queryLength: initialQueryString?.length || 0,
      });

      // Initialize empty results array
      const initialQueryContextSnippets = [];

      // Validate input
      if (
        !initialQueryString ||
        typeof initialQueryString !== "string" ||
        initialQueryString.trim() === ""
      ) {
        this.logger.debug(
          "No valid initial query provided, returning empty snippets"
        );
        return initialQueryContextSnippets;
      }

      // Prepare FTS query string using the helper method from Task 166
      const ftsQueryString = this._prepareFtsQueryString(initialQueryString);

      if (!ftsQueryString || ftsQueryString.trim() === "") {
        this.logger.debug(
          "No valid FTS query string generated, returning empty snippets"
        );
        return initialQueryContextSnippets;
      }

      this.logger.debug("FTS query string prepared for snippet retrieval", {
        originalQuery: initialQueryString,
        ftsQueryString,
        limit,
      });

      // Task 168: Perform FTS calls for code entities and documents
      let codeEntityHits = [];
      let documentHits = [];

      try {
        // Fetch more than the limit to allow for merging and re-ranking
        const ftsLimit = limit * 2;

        this.logger.debug("Executing FTS queries", {
          ftsQueryString,
          ftsLimit,
        });

        // Execute FTS queries in parallel for better performance
        const [codeEntityResults, documentResults] = await Promise.allSettled([
          dbQueries.searchCodeEntitiesFts(
            this.dbClient,
            ftsQueryString,
            ftsLimit
          ),
          dbQueries.searchProjectDocumentsFts(
            this.dbClient,
            ftsQueryString,
            ftsLimit
          ),
        ]);

        // Handle code entity FTS results
        if (codeEntityResults.status === "fulfilled") {
          codeEntityHits = codeEntityResults.value || [];
          this.logger.debug("Code entity FTS query completed successfully", {
            hitCount: codeEntityHits.length,
            ftsQueryString,
          });
        } else {
          this.logger.error("Code entity FTS query failed", {
            error: codeEntityResults.reason?.message || "Unknown error",
            ftsQueryString,
          });
          // Continue with empty results for code entities
        }

        // Handle document FTS results
        if (documentResults.status === "fulfilled") {
          documentHits = documentResults.value || [];
          this.logger.debug("Document FTS query completed successfully", {
            hitCount: documentHits.length,
            ftsQueryString,
          });
        } else {
          this.logger.error("Document FTS query failed", {
            error: documentResults.reason?.message || "Unknown error",
            ftsQueryString,
          });
          // Continue with empty results for documents
        }

        this.logger.info("FTS queries completed", {
          codeEntityHitsCount: codeEntityHits.length,
          documentHitsCount: documentHits.length,
          totalHits: codeEntityHits.length + documentHits.length,
          originalQuery: initialQueryString,
        });

        // If both queries failed or returned no results, return empty array
        if (codeEntityHits.length === 0 && documentHits.length === 0) {
          this.logger.debug("No FTS hits found from either source", {
            ftsQueryString,
            originalQuery: initialQueryString,
          });
          return initialQueryContextSnippets;
        }
      } catch (error) {
        this.logger.error("Unexpected error during FTS queries", {
          error: error.message,
          stack: error.stack,
          ftsQueryString,
          originalQuery: initialQueryString,
        });
        // Return empty array on unexpected error
        return initialQueryContextSnippets;
      }

      // Task 169: Combine and rank FTS results
      let allHits = [];

      try {
        this.logger.debug("Starting to combine and rank FTS results", {
          codeEntityHitsCount: codeEntityHits.length,
          documentHitsCount: documentHits.length,
        });

        // Transform code entity hits to common structure
        const transformedCodeEntityHits = codeEntityHits.map((hit) => ({
          id: hit.entity_id,
          type: "code_entity",
          rank: hit.rank,
          ftsSnippet: hit.highlight_snippet,
        }));

        // Transform document hits to common structure
        const transformedDocumentHits = documentHits.map((hit) => ({
          id: hit.document_id,
          type: "project_document",
          rank: hit.rank,
          ftsSnippet: hit.highlight_snippet,
        }));

        // Combine transformed hits into single array
        allHits = [...transformedCodeEntityHits, ...transformedDocumentHits];

        this.logger.debug("FTS hits transformed and combined", {
          codeEntityTransformed: transformedCodeEntityHits.length,
          documentTransformed: transformedDocumentHits.length,
          totalCombined: allHits.length,
        });

        // Sort by FTS rank - lower rank is better in SQLite FTS5
        allHits.sort((a, b) => a.rank - b.rank);

        this.logger.info("FTS results combined and ranked successfully", {
          totalCombinedHits: allHits.length,
          topHitRank: allHits.length > 0 ? allHits[0].rank : null,
          topHitType: allHits.length > 0 ? allHits[0].type : null,
          rankRange:
            allHits.length > 0
              ? {
                  best: allHits[0].rank,
                  worst: allHits[allHits.length - 1].rank,
                }
              : null,
        });

        // Log sample of top hits for debugging
        if (allHits.length > 0) {
          const sampleSize = Math.min(3, allHits.length);
          const topHitsSample = allHits.slice(0, sampleSize).map((hit) => ({
            id: hit.id,
            type: hit.type,
            rank: hit.rank,
            snippetPreview: hit.ftsSnippet?.substring(0, 50) + "...",
          }));
          this.logger.debug("Top FTS hits sample", {
            sampleSize,
            topHits: topHitsSample,
          });
        }
      } catch (error) {
        this.logger.error("Error combining and ranking FTS results", {
          error: error.message,
          stack: error.stack,
          codeEntityHitsCount: codeEntityHits.length,
          documentHitsCount: documentHits.length,
        });
        // Continue with empty allHits array
        allHits = [];
      }

      // If no hits after combining, return empty array
      if (allHits.length === 0) {
        this.logger.debug("No combined FTS hits available for processing", {
          originalQuery: initialQueryString,
          ftsQueryString,
        });
        return initialQueryContextSnippets;
      }

      // Task 170: Fetch full records for top FTS hits
      let hydratedResults = [];

      try {
        // Take the top N hits (limit the number of results we process)
        const topHits = allHits.slice(0, limit);

        this.logger.debug("Starting to fetch full records for top FTS hits", {
          totalHitsAvailable: allHits.length,
          topHitsSelected: topHits.length,
          limit,
        });

        // Process each top hit to fetch its full record
        for (let i = 0; i < topHits.length; i++) {
          const hit = topHits[i];

          try {
            this.logger.debug(
              `Fetching full record for hit ${i + 1}/${topHits.length}`,
              {
                hitId: hit.id,
                hitType: hit.type,
                rank: hit.rank,
              }
            );

            let record = null;

            // Fetch the appropriate record based on hit type
            if (hit.type === "code_entity") {
              record = await dbQueries.getCodeEntityById(this.dbClient, hit.id);
            } else if (hit.type === "project_document") {
              record = await dbQueries.getProjectDocumentById(
                this.dbClient,
                hit.id
              );
            } else {
              this.logger.error("Unknown hit type encountered", {
                hitId: hit.id,
                hitType: hit.type,
                rank: hit.rank,
              });
              continue; // Skip this hit
            }

            // Check if record was found
            if (record) {
              // Successfully fetched record, add to hydrated results
              hydratedResults.push({
                hit,
                record,
                ftsSnippet: hit.ftsSnippet,
              });

              this.logger.debug("Successfully fetched full record", {
                hitId: hit.id,
                hitType: hit.type,
                recordFound: true,
                hasFilePath: !!record.file_path,
                hasAiStatus: !!record.ai_status,
              });
            } else {
              // Record not found - this indicates FTS data inconsistency
              this.logger.warn("FTS hit points to non-existent record", {
                hitId: hit.id,
                hitType: hit.type,
                rank: hit.rank,
                message: "FTS index may be out of sync with main tables",
              });
              // Skip this hit as instructed
            }
          } catch (recordError) {
            this.logger.error("Error fetching full record for FTS hit", {
              error: recordError.message,
              stack: recordError.stack,
              hitId: hit.id,
              hitType: hit.type,
              rank: hit.rank,
            });
            // Skip this hit on error
          }
        }

        this.logger.info("Full record fetching completed", {
          topHitsProcessed: topHits.length,
          recordsSuccessfullyFetched: hydratedResults.length,
          recordsFailed: topHits.length - hydratedResults.length,
          successRate:
            topHits.length > 0
              ? Math.round((hydratedResults.length / topHits.length) * 100)
              : 0,
        });

        // Log sample of successfully hydrated results
        if (hydratedResults.length > 0) {
          const sampleSize = Math.min(2, hydratedResults.length);
          const hydratedSample = hydratedResults
            .slice(0, sampleSize)
            .map((result) => ({
              hitId: result.hit.id,
              hitType: result.hit.type,
              rank: result.hit.rank,
              filePath: result.record.file_path,
              aiStatus: result.record.ai_status,
              hasContent: !!result.record.raw_content,
              hasSummary: !!result.record.summary,
            }));

          this.logger.debug("Sample of hydrated results", {
            sampleSize,
            hydratedSample,
          });
        }
      } catch (error) {
        this.logger.error("Error during full record fetching process", {
          error: error.message,
          stack: error.stack,
          allHitsCount: allHits.length,
          limit,
        });
        // Continue with empty hydrated results
        hydratedResults = [];
      }

      // If no records were successfully fetched, return empty array
      if (hydratedResults.length === 0) {
        this.logger.debug("No full records successfully fetched", {
          topHitsAttempted: Math.min(allHits.length, limit),
          originalQuery: initialQueryString,
        });
        return initialQueryContextSnippets;
      }

      // Task 171: Format final snippets for initialQueryContextSnippets
      try {
        this.logger.debug("Starting to format final snippets", {
          hydratedResultsCount: hydratedResults.length,
          originalQuery: initialQueryString,
        });

        // Process each hydrated result into the final snippet format
        for (let i = 0; i < hydratedResults.length; i++) {
          const { hit, record, ftsSnippet } = hydratedResults[i];

          try {
            this.logger.debug(
              `Formatting snippet ${i + 1}/${hydratedResults.length}`,
              {
                hitId: hit.id,
                hitType: hit.type,
                filePath: record.file_path,
                aiStatus: record.ai_status,
              }
            );

            // Construct snippet object as per Story 3.5 schema
            const snippetObject = {
              filePath: record.file_path,
              type:
                hit.type === "code_entity"
                  ? record.entity_type
                  : record.file_type,
              aiStatus: record.ai_status,
            };

            // Add entityName if it's a code entity with a name
            if (hit.type === "code_entity" && record.name) {
              snippetObject.entityName = record.name;
            }

            // Determine the best snippet content (priority: AI summary → FTS snippet → raw content)
            let snippetContent = null;

            if (
              record.ai_status === "completed" &&
              record.summary &&
              record.summary.trim()
            ) {
              // Use AI summary if available and completed
              snippetContent = record.summary.trim();
              this.logger.debug(`Using AI summary for snippet ${i + 1}`, {
                summaryLength: snippetContent.length,
              });
            } else if (ftsSnippet && ftsSnippet.trim()) {
              // Use FTS highlighted snippet
              snippetContent = ftsSnippet.trim();
              this.logger.debug(`Using FTS snippet for snippet ${i + 1}`, {
                ftsSnippetLength: snippetContent.length,
              });
            } else if (record.raw_content && record.raw_content.trim()) {
              // Fallback to truncated raw content
              const rawContent = record.raw_content.trim();
              const maxFallbackLength = 300;

              if (rawContent.length <= maxFallbackLength) {
                snippetContent = rawContent;
              } else {
                snippetContent =
                  rawContent.substring(0, maxFallbackLength) + "...";
              }
              this.logger.debug(
                `Using raw content fallback for snippet ${i + 1}`,
                {
                  originalLength: rawContent.length,
                  truncatedLength: snippetContent.length,
                }
              );
            } else {
              // No usable content available
              snippetContent = "No content available for this result.";
              this.logger.warn(`No usable content for snippet ${i + 1}`, {
                hitId: hit.id,
                hitType: hit.type,
                hasAiSummary: !!record.summary,
                hasFtsSnippet: !!ftsSnippet,
                hasRawContent: !!record.raw_content,
              });
            }

            // Add the snippet content to the object
            snippetObject.snippet = snippetContent;

            // Add the formatted snippet to the final array
            initialQueryContextSnippets.push(snippetObject);

            this.logger.debug(`Successfully formatted snippet ${i + 1}`, {
              filePath: snippetObject.filePath,
              type: snippetObject.type,
              hasEntityName: !!snippetObject.entityName,
              snippetLength: snippetContent.length,
              aiStatus: snippetObject.aiStatus,
            });
          } catch (snippetError) {
            this.logger.error(`Error formatting snippet ${i + 1}`, {
              error: snippetError.message,
              stack: snippetError.stack,
              hitId: hit.id,
              hitType: hit.type,
            });
            // Skip this snippet on error, continue with others
          }
        }

        this.logger.info("Final snippet formatting completed", {
          totalHydratedResults: hydratedResults.length,
          successfullyFormattedSnippets: initialQueryContextSnippets.length,
          formattingSuccessRate:
            hydratedResults.length > 0
              ? Math.round(
                  (initialQueryContextSnippets.length /
                    hydratedResults.length) *
                    100
                )
              : 0,
          originalQuery: initialQueryString,
        });

        // Log sample of formatted snippets for debugging
        if (initialQueryContextSnippets.length > 0) {
          const sampleSize = Math.min(2, initialQueryContextSnippets.length);
          const snippetSample = initialQueryContextSnippets
            .slice(0, sampleSize)
            .map((snippet) => ({
              filePath: snippet.filePath,
              type: snippet.type,
              aiStatus: snippet.aiStatus,
              hasEntityName: !!snippet.entityName,
              snippetPreview: snippet.snippet?.substring(0, 100) + "...",
            }));

          this.logger.debug("Sample of formatted snippets", {
            sampleSize,
            snippetSample,
          });
        }
      } catch (error) {
        this.logger.error("Error during final snippet formatting", {
          error: error.message,
          stack: error.stack,
          hydratedResultsCount: hydratedResults.length,
          originalQuery: initialQueryString,
        });
        // Continue with whatever snippets were successfully formatted
        // initialQueryContextSnippets will contain partial results
      }

      this.logger.info("FTS snippets retrieval completed successfully", {
        queryProvided: !!initialQueryString,
        snippetsCount: initialQueryContextSnippets.length,
        limit,
      });

      return initialQueryContextSnippets;
    } catch (error) {
      this.logger.error("Error retrieving FTS snippets for initial query", {
        error: error.message,
        stack: error.stack,
        initialQueryString,
        limit,
      });

      // Return empty array on error to avoid breaking the context initialization
      return [];
    }
  }

  // ===========================================
  // CONTEXT RETRIEVAL METHODS
  // ===========================================

  /**
   * Retrieves relevant context snippets based on a query within a conversation session
   * This is a stub implementation for Story 4.1 - will be expanded in subsequent stories
   * @param {string} query - The agent's query for context
   * @param {string} conversationId - The active conversation session ID
   * @param {number} tokenBudget - Maximum desired token count for returned snippets
   * @param {Object} retrievalParameters - Additional retrieval parameters
   * @returns {Promise<Object>} Object with contextSnippets and retrievalSummary
   */
  async getRelevantContext(
    query,
    conversationId,
    tokenBudget,
    retrievalParameters
  ) {
    // Constants for result limits
    const MAX_FTS_CANDIDATES_PER_SOURCE = 20;
    const MAX_KEYWORD_CANDIDATES = 20;
    const MAX_CONVO_HISTORY_CANDIDATES = 10; // New constant for conversation history limit
    const MAX_CONVO_TOPIC_CANDIDATES = 5; // New constant for conversation topics limit
    const MAX_GIT_COMMIT_CANDIDATES = 10; // New constant for Git commit search limit
    const MAX_GIT_FILE_CHANGE_CANDIDATES = 15; // New constant for Git file change search limit

    this.logger.debug("getRelevantContext invoked", {
      query: query,
      conversationId: conversationId,
      tokenBudget: tokenBudget,
      hasRetrievalParameters: !!retrievalParameters,
      retrievalParameters: retrievalParameters,
    });

    try {
      // Step 1: Get processed search terms using the helper method from Task 182
      const searchTerms = this._getSearchTerms(query);
      this.logger.debug("Processed search terms from query", {
        originalQuery: query,
        searchTerms: searchTerms,
        searchTermsCount: searchTerms.length,
      });

      // Step 2: Prepare FTS query string from search terms
      // Using the existing _prepareFtsQueryString method, but we need to join searchTerms
      // The method expects a natural language query, so we'll reconstruct it from searchTerms
      const reconstructedQuery = searchTerms.join(" ");
      const ftsQueryString = this._prepareFtsQueryString(reconstructedQuery);

      this.logger.debug("Prepared FTS query string", {
        reconstructedQuery: reconstructedQuery,
        ftsQueryString: ftsQueryString,
      });

      // Step 3: Perform FTS search on code_entities_fts
      let codeEntityHits = [];

      if (ftsQueryString && ftsQueryString.trim() !== "") {
        try {
          codeEntityHits = await dbQueries.searchCodeEntitiesFts(
            this.dbClient,
            ftsQueryString,
            MAX_FTS_CANDIDATES_PER_SOURCE
          );

          this.logger.debug("FTS search completed for code entities", {
            ftsQueryString: ftsQueryString,
            rawHitsCount: codeEntityHits.length,
            limit: MAX_FTS_CANDIDATES_PER_SOURCE,
          });

          // Task 241: INFO level logging for stage completion
          this.logger.info(
            `Retrieval: FTS search complete, ${codeEntityHits.length} code entity candidates.`,
            {
              conversationId: conversationId,
              stage: "fts_code_entities",
              candidatesFound: codeEntityHits.length,
            }
          );
        } catch (ftsError) {
          this.logger.error("Error during FTS search on code_entities_fts", {
            error: ftsError.message,
            stack: ftsError.stack,
            ftsQueryString: ftsQueryString,
          });

          // Initialize to empty array on error
          codeEntityHits = [];
        }
      } else {
        this.logger.debug(
          "FTS query string is empty, skipping code entities FTS search",
          {
            originalQuery: query,
            searchTerms: searchTerms,
          }
        );
        codeEntityHits = [];
      }

      // Step 4: Perform FTS search on project_documents_fts
      let documentHits = [];

      if (ftsQueryString && ftsQueryString.trim() !== "") {
        try {
          documentHits = await dbQueries.searchProjectDocumentsFts(
            this.dbClient,
            ftsQueryString,
            MAX_FTS_CANDIDATES_PER_SOURCE
          );

          this.logger.debug("FTS search completed for project documents", {
            ftsQueryString: ftsQueryString,
            rawHitsCount: documentHits.length,
            limit: MAX_FTS_CANDIDATES_PER_SOURCE,
          });

          // Task 241: INFO level logging for stage completion
          this.logger.info(
            `Retrieval: Document FTS search complete, ${documentHits.length} document candidates.`,
            {
              conversationId: conversationId,
              stage: "fts_documents",
              candidatesFound: documentHits.length,
            }
          );
        } catch (ftsError) {
          this.logger.error(
            "Error during FTS search on project_documents_fts",
            {
              error: ftsError.message,
              stack: ftsError.stack,
              ftsQueryString: ftsQueryString,
            }
          );

          // Initialize to empty array on error
          documentHits = [];
        }
      } else {
        this.logger.debug(
          "FTS query string is empty, skipping project documents FTS search",
          {
            originalQuery: query,
            searchTerms: searchTerms,
          }
        );
        documentHits = [];
      }

      // Step 5: Perform keyword search on entity_keywords table
      let keywordMatchedEntities = [];

      if (searchTerms && searchTerms.length > 0) {
        try {
          keywordMatchedEntities = await dbQueries.searchEntityKeywords(
            this.dbClient,
            searchTerms,
            MAX_KEYWORD_CANDIDATES
          );

          this.logger.debug("Keyword search completed on entity_keywords", {
            searchTerms: searchTerms,
            entityIdsFound: keywordMatchedEntities.length,
            limit: MAX_KEYWORD_CANDIDATES,
          });

          // Task 241: INFO level logging for stage completion
          this.logger.info(
            `Retrieval: Keyword search complete, ${keywordMatchedEntities.length} candidates.`,
            {
              conversationId: conversationId,
              stage: "keyword_search",
              candidatesFound: keywordMatchedEntities.length,
            }
          );
        } catch (keywordError) {
          this.logger.error("Error during keyword search on entity_keywords", {
            error: keywordError.message,
            stack: keywordError.stack,
            searchTerms: searchTerms,
          });

          // Initialize to empty array on error
          keywordMatchedEntities = [];
        }
      } else {
        this.logger.debug(
          "No search terms available, skipping keyword search",
          {
            originalQuery: query,
            searchTerms: searchTerms,
          }
        );
        keywordMatchedEntities = [];
      }

      // Step 6: Fetch full records for code entities from FTS and keyword search hits
      const retrievedCodeEntities = {};

      try {
        this.logger.debug("Starting to fetch full code entity records", {
          codeEntityHitsCount: codeEntityHits.length,
          keywordMatchedEntitiesCount: keywordMatchedEntities.length,
        });

        // Collect all unique entity_id values
        const uniqueEntityIds = new Set();

        // Add entity IDs from FTS code entity hits
        for (const hit of codeEntityHits) {
          if (hit.entity_id) {
            uniqueEntityIds.add(hit.entity_id);
          }
        }

        // Add entity IDs from keyword matches (these could be code entities or documents)
        // For this task, we assume they could be code entities and try fetching them
        for (const match of keywordMatchedEntities) {
          if (match.entity_id) {
            uniqueEntityIds.add(match.entity_id);
          }
        }

        this.logger.debug(
          "Collected unique entity IDs for code entity fetching",
          {
            uniqueEntityIdsCount: uniqueEntityIds.size,
            fromCodeEntityHits: codeEntityHits.length,
            fromKeywordMatches: keywordMatchedEntities.length,
          }
        );

        // Fetch full code entity records for each unique ID
        let successfullyFetchedCount = 0;

        for (const entityId of uniqueEntityIds) {
          try {
            const entityRecord = await dbQueries.getCodeEntityById(
              this.dbClient,
              entityId
            );

            if (entityRecord) {
              // Successfully fetched, store in the map
              retrievedCodeEntities[entityId] = entityRecord;
              successfullyFetchedCount++;

              this.logger.debug("Successfully fetched code entity record", {
                entityId: entityId,
                entityName: entityRecord.name,
                filePath: entityRecord.file_path,
                entityType: entityRecord.entity_type,
                language: entityRecord.language,
              });
            } else {
              // Entity ID doesn't correspond to a code entity (could be a document ID from keywords)
              this.logger.debug("Entity ID not found in code_entities table", {
                entityId: entityId,
                note: "This could be a project document ID from keyword search",
              });
            }
          } catch (fetchError) {
            this.logger.error("Error fetching code entity record", {
              error: fetchError.message,
              stack: fetchError.stack,
              entityId: entityId,
            });
            // Skip this entity on error
          }
        }

        this.logger.info("Code entity record fetching completed", {
          uniqueEntityIdsProcessed: uniqueEntityIds.size,
          codeEntitiesSuccessfullyFetched: successfullyFetchedCount,
          fetchSuccessRate:
            uniqueEntityIds.size > 0
              ? Math.round(
                  (successfullyFetchedCount / uniqueEntityIds.size) * 100
                )
              : 0,
        });
      } catch (error) {
        this.logger.error("Error during code entity record fetching", {
          error: error.message,
          stack: error.stack,
          codeEntityHitsCount: codeEntityHits.length,
          keywordMatchedEntitiesCount: keywordMatchedEntities.length,
        });
        // Continue with empty retrievedCodeEntities map
      }

      // Step 7: Fetch full records for project documents from FTS and keyword search hits
      const retrievedProjectDocuments = {};

      try {
        this.logger.debug("Starting to fetch full project document records", {
          documentHitsCount: documentHits.length,
          keywordMatchedEntitiesCount: keywordMatchedEntities.length,
        });

        // Collect all unique document_id values
        const uniqueDocumentIds = new Set();

        // Add document IDs from FTS document hits
        for (const hit of documentHits) {
          if (hit.document_id) {
            uniqueDocumentIds.add(hit.document_id);
          }
        }

        // Add entity IDs from keyword matches that weren't found as code entities
        // These could potentially be project document IDs
        for (const match of keywordMatchedEntities) {
          if (match.entity_id && !retrievedCodeEntities[match.entity_id]) {
            // Only try fetching as document if it wasn't found as a code entity
            uniqueDocumentIds.add(match.entity_id);
          }
        }

        this.logger.debug(
          "Collected unique document IDs for project document fetching",
          {
            uniqueDocumentIdsCount: uniqueDocumentIds.size,
            fromDocumentHits: documentHits.length,
            fromKeywordMatches: keywordMatchedEntities.filter(
              (match) => !retrievedCodeEntities[match.entity_id]
            ).length,
          }
        );

        // Fetch full project document records for each unique ID
        let successfullyFetchedCount = 0;

        for (const documentId of uniqueDocumentIds) {
          try {
            const documentRecord = await dbQueries.getProjectDocumentById(
              this.dbClient,
              documentId
            );

            if (documentRecord) {
              // Successfully fetched, store in the map
              retrievedProjectDocuments[documentId] = documentRecord;
              successfullyFetchedCount++;

              this.logger.debug(
                "Successfully fetched project document record",
                {
                  documentId: documentId,
                  filePath: documentRecord.file_path,
                  fileType: documentRecord.file_type,
                  aiStatus: documentRecord.ai_status,
                }
              );
            } else {
              // Document ID not found in project_documents table
              this.logger.debug(
                "Document ID not found in project_documents table",
                {
                  documentId: documentId,
                  note: "This ID may not correspond to a valid project document",
                }
              );
            }
          } catch (fetchError) {
            this.logger.error("Error fetching project document record", {
              error: fetchError.message,
              stack: fetchError.stack,
              documentId: documentId,
            });
            // Skip this document on error
          }
        }

        this.logger.info("Project document record fetching completed", {
          uniqueDocumentIdsProcessed: uniqueDocumentIds.size,
          projectDocumentsSuccessfullyFetched: successfullyFetchedCount,
          fetchSuccessRate:
            uniqueDocumentIds.size > 0
              ? Math.round(
                  (successfullyFetchedCount / uniqueDocumentIds.size) * 100
                )
              : 0,
        });
      } catch (error) {
        this.logger.error("Error during project document record fetching", {
          error: error.message,
          stack: error.stack,
          documentHitsCount: documentHits.length,
          keywordMatchedEntitiesCount: keywordMatchedEntities.length,
        });
        // Continue with empty retrievedProjectDocuments map
      }

      // Step 8: Construct candidate code entity snippets from FTS/Keyword results

      /**
       * @typedef {Object} CandidateSnippet
       * @property {string} id - Unique ID of the source item (e.g., entity_id, document_id, message_id, commit_hash, composite IDs)
       * @property {'code_entity_fts' | 'code_entity_keyword' | 'project_document_fts' | 'project_document_keyword' | 'conversation_message' | 'conversation_topic' | 'git_commit' | 'git_commit_file_change' | 'code_entity_related'} sourceType - The origin/source type of this snippet
       * @property {string} contentSnippet - The actual text content to be potentially shown to the agent (AI summary, FTS highlight, raw content excerpt, etc.)
       * @property {number} initialScore - Relevance score from its source retrieval (e.g., FTS rank-based score, keyword match score, conversation relevance, Git relevance)
       * @property {string} [filePath] - File path if applicable (for code entities, project documents, Git file changes)
       * @property {string} [entityName] - Name of the code entity, if applicable (function name, class name, etc.)
       * @property {string} [entityType] - Type of entity or document (e.g., 'function_declaration', 'class_definition', 'markdown', 'javascript', etc.)
       * @property {string} [language] - Programming language, if code entity (e.g., 'javascript', 'python', 'typescript')
       * @property {string} [aiStatus] - AI processing status ('pending', 'completed', 'failed', etc.), if applicable
       * @property {string} [timestamp] - Timestamp for time-sensitive items like conversation messages or Git commits (ISO string format)
       * @property {Object} [metadata] - Source-specific metadata object containing additional context
       * @property {string} [metadata.role] - Message role for conversation messages ('user', 'assistant', 'system')
       * @property {string} [metadata.conversationId] - Conversation ID for conversation messages
       * @property {string} [metadata.purposeTag] - Purpose tag for conversation topics
       * @property {string[]} [metadata.keywords] - Parsed keywords array for conversation topics
       * @property {string} [metadata.commitHash] - Git commit hash for Git-related snippets
       * @property {string} [metadata.authorName] - Git commit author name
       * @property {string} [metadata.commitDate] - Git commit date (ISO string)
       * @property {string} [metadata.status] - Git file change status ('added', 'modified', 'deleted')
       * @property {string} [metadata.commitMessage] - Full Git commit message for file changes
       * @property {string} [metadata.commitAuthor] - Git commit author for file changes
       * @property {Object} [relationshipContext] - For snippets from relationship expansion (future Story 4.7) - contains relationship type and context
       * @property {number} [consolidatedScore] - Final calculated score after applying ranking factors (populated by ranking logic in Story 4.5)
       */

      /** @type {CandidateSnippet[]} */
      const candidateSnippets = [];
      const processedEntityIds = new Set(); // Track processed entities to avoid duplicates

      try {
        this.logger.debug(
          "Starting to construct candidate code entity snippets",
          {
            codeEntityHitsCount: codeEntityHits.length,
            keywordMatchedEntitiesCount: keywordMatchedEntities.length,
            retrievedCodeEntitiesCount: Object.keys(retrievedCodeEntities)
              .length,
          }
        );

        // Helper function to calculate score from FTS rank (lower rank = higher score)
        const calculateScoreFromFtsRank = (rank) => {
          // FTS rank is lower for better matches, so invert it to a 0-1 score
          // Use a logarithmic scale to differentiate between ranks
          return Math.max(0, 1 - Math.log(rank + 1) / 10);
        };

        // Helper function to calculate score from keyword matches
        const calculateScoreFromKeywordMatches = (totalWeight, matchCount) => {
          // Combine match count and total weight for scoring
          // Normalize to a 0-1 scale similar to FTS scores
          const weightScore = Math.min(totalWeight / 10, 1); // Cap at 1
          const countScore = Math.min(matchCount / 5, 1); // Cap at 1
          return (weightScore + countScore) / 2; // Average the two components
        };

        // Helper function to determine content snippet
        const determineContentSnippet = (entityRecord, ftsHighlight = null) => {
          // Priority: AI summary → FTS highlight → truncated raw content
          if (
            entityRecord.ai_status === "completed" &&
            entityRecord.summary &&
            entityRecord.summary.trim()
          ) {
            return entityRecord.summary.trim();
          }

          if (ftsHighlight && ftsHighlight.trim()) {
            return ftsHighlight.trim();
          }

          if (entityRecord.raw_content && entityRecord.raw_content.trim()) {
            const rawContent = entityRecord.raw_content.trim();
            const maxLength = 300;
            if (rawContent.length <= maxLength) {
              return rawContent;
            }
            return rawContent.substring(0, maxLength) + "...";
          }

          return "No content available for this code entity.";
        };

        // Process FTS code entity hits
        for (const hit of codeEntityHits) {
          if (!hit.entity_id) continue;

          const entityRecord = retrievedCodeEntities[hit.entity_id];
          if (!entityRecord) {
            this.logger.debug("Skipping FTS hit - entity record not found", {
              entityId: hit.entity_id,
              rank: hit.rank,
            });
            continue;
          }

          // Determine content snippet
          const contentSnippet = determineContentSnippet(
            entityRecord,
            hit.highlight_snippet
          );

          // Calculate initial score from FTS rank
          const initialScore = calculateScoreFromFtsRank(hit.rank);

          // Create candidate snippet object
          const candidateSnippet = {
            sourceType: "code_entity_fts",
            id: entityRecord.entity_id,
            filePath: entityRecord.file_path,
            entityName: entityRecord.name || null,
            entityType: entityRecord.entity_type,
            language: entityRecord.language,
            aiStatus: entityRecord.ai_status,
            contentSnippet: contentSnippet,
            initialScore: initialScore,
          };

          candidateSnippets.push(candidateSnippet);
          processedEntityIds.add(hit.entity_id);

          this.logger.debug("Added FTS code entity candidate snippet", {
            entityId: entityRecord.entity_id,
            entityName: entityRecord.name,
            sourceType: "code_entity_fts",
            initialScore: initialScore,
            contentSnippetLength: contentSnippet.length,
          });
        }

        // Process keyword matched entities that are code entities
        for (const match of keywordMatchedEntities) {
          if (!match.entity_id) continue;

          const entityRecord = retrievedCodeEntities[match.entity_id];
          if (!entityRecord) {
            // This entity ID wasn't found as a code entity (likely a document ID)
            continue;
          }

          // Check if we already processed this entity from FTS
          if (processedEntityIds.has(match.entity_id)) {
            this.logger.debug(
              "Skipping keyword match - entity already processed from FTS",
              {
                entityId: match.entity_id,
                entityName: entityRecord.name,
              }
            );
            continue;
          }

          // Determine content snippet (no FTS highlight for keyword matches)
          const contentSnippet = determineContentSnippet(entityRecord);

          // Calculate initial score from keyword match data
          const initialScore = calculateScoreFromKeywordMatches(
            match.total_weight,
            match.match_count
          );

          // Create candidate snippet object
          const candidateSnippet = {
            sourceType: "code_entity_keyword",
            id: entityRecord.entity_id,
            filePath: entityRecord.file_path,
            entityName: entityRecord.name || null,
            entityType: entityRecord.entity_type,
            language: entityRecord.language,
            aiStatus: entityRecord.ai_status,
            contentSnippet: contentSnippet,
            initialScore: initialScore,
          };

          candidateSnippets.push(candidateSnippet);
          processedEntityIds.add(match.entity_id);

          this.logger.debug("Added keyword code entity candidate snippet", {
            entityId: entityRecord.entity_id,
            entityName: entityRecord.name,
            sourceType: "code_entity_keyword",
            initialScore: initialScore,
            totalWeight: match.total_weight,
            matchCount: match.match_count,
            contentSnippetLength: contentSnippet.length,
          });
        }

        // Filter candidate snippets to only code entities
        const codeEntityCandidateSnippets = candidateSnippets.filter(
          (snippet) =>
            snippet.sourceType === "code_entity_fts" ||
            snippet.sourceType === "code_entity_keyword"
        );

        this.logger.info(
          "Code entity candidate snippets construction completed",
          {
            codeEntityFtsSnippets: candidateSnippets.filter(
              (s) => s.sourceType === "code_entity_fts"
            ).length,
            codeEntityKeywordSnippets: candidateSnippets.filter(
              (s) => s.sourceType === "code_entity_keyword"
            ).length,
            totalCodeEntitySnippets: codeEntityCandidateSnippets.length,
            processedEntityIds: processedEntityIds.size,
          }
        );
      } catch (error) {
        this.logger.error(
          "Error during code entity candidate snippets construction",
          {
            error: error.message,
            stack: error.stack,
            codeEntityHitsCount: codeEntityHits.length,
            keywordMatchedEntitiesCount: keywordMatchedEntities.length,
          }
        );
        // Continue with whatever snippets were successfully constructed
      }

      // Step 9: Construct candidate project document snippets from FTS/Keyword results
      const processedDocumentIds = new Set(); // Track processed documents to avoid duplicates

      try {
        this.logger.debug(
          "Starting to construct candidate project document snippets",
          {
            documentHitsCount: documentHits.length,
            keywordMatchedEntitiesCount: keywordMatchedEntities.length,
            retrievedProjectDocumentsCount: Object.keys(
              retrievedProjectDocuments
            ).length,
          }
        );

        // Helper function to determine content snippet for documents
        const determineDocumentContentSnippet = (
          documentRecord,
          ftsHighlight = null
        ) => {
          // Priority: AI summary → FTS highlight → truncated raw content
          if (
            documentRecord.ai_status === "completed" &&
            documentRecord.summary &&
            documentRecord.summary.trim()
          ) {
            return documentRecord.summary.trim();
          }

          if (ftsHighlight && ftsHighlight.trim()) {
            return ftsHighlight.trim();
          }

          if (documentRecord.raw_content && documentRecord.raw_content.trim()) {
            const rawContent = documentRecord.raw_content.trim();
            const maxLength = 300;
            if (rawContent.length <= maxLength) {
              return rawContent;
            }
            return rawContent.substring(0, maxLength) + "...";
          }

          return "No content available for this project document.";
        };

        // Process FTS document hits
        for (const hit of documentHits) {
          if (!hit.document_id) continue;

          const documentRecord = retrievedProjectDocuments[hit.document_id];
          if (!documentRecord) {
            this.logger.debug(
              "Skipping FTS document hit - document record not found",
              {
                documentId: hit.document_id,
                rank: hit.rank,
              }
            );
            continue;
          }

          // Determine content snippet
          const contentSnippet = determineDocumentContentSnippet(
            documentRecord,
            hit.highlight_snippet
          );

          // Calculate initial score from FTS rank (reuse the same function as code entities)
          const initialScore = calculateScoreFromFtsRank(hit.rank);

          // Create candidate snippet object
          const candidateSnippet = {
            sourceType: "project_document_fts",
            id: documentRecord.document_id,
            filePath: documentRecord.file_path,
            entityType: documentRecord.file_type, // Using entityType for consistency
            aiStatus: documentRecord.ai_status,
            contentSnippet: contentSnippet,
            initialScore: initialScore,
          };

          candidateSnippets.push(candidateSnippet);
          processedDocumentIds.add(hit.document_id);

          this.logger.debug("Added FTS project document candidate snippet", {
            documentId: documentRecord.document_id,
            filePath: documentRecord.file_path,
            sourceType: "project_document_fts",
            initialScore: initialScore,
            contentSnippetLength: contentSnippet.length,
          });
        }

        // Process keyword matched entities that are project documents
        for (const match of keywordMatchedEntities) {
          if (!match.entity_id) continue;

          const documentRecord = retrievedProjectDocuments[match.entity_id];
          if (!documentRecord) {
            // This entity ID wasn't found as a project document (likely a code entity ID)
            continue;
          }

          // Check if we already processed this document from FTS
          if (processedDocumentIds.has(match.entity_id)) {
            this.logger.debug(
              "Skipping keyword match - document already processed from FTS",
              {
                documentId: match.entity_id,
                filePath: documentRecord.file_path,
              }
            );
            continue;
          }

          // Determine content snippet (no FTS highlight for keyword matches)
          const contentSnippet =
            determineDocumentContentSnippet(documentRecord);

          // Calculate initial score from keyword match data (reuse the same function as code entities)
          const initialScore = calculateScoreFromKeywordMatches(
            match.total_weight,
            match.match_count
          );

          // Create candidate snippet object
          const candidateSnippet = {
            sourceType: "project_document_keyword",
            id: documentRecord.document_id,
            filePath: documentRecord.file_path,
            entityType: documentRecord.file_type, // Using entityType for consistency
            aiStatus: documentRecord.ai_status,
            contentSnippet: contentSnippet,
            initialScore: initialScore,
          };

          candidateSnippets.push(candidateSnippet);
          processedDocumentIds.add(match.entity_id);

          this.logger.debug(
            "Added keyword project document candidate snippet",
            {
              documentId: documentRecord.document_id,
              filePath: documentRecord.file_path,
              sourceType: "project_document_keyword",
              initialScore: initialScore,
              totalWeight: match.total_weight,
              matchCount: match.match_count,
              contentSnippetLength: contentSnippet.length,
            }
          );
        }

        // Filter candidate snippets to only project documents
        const documentCandidateSnippets = candidateSnippets.filter(
          (snippet) =>
            snippet.sourceType === "project_document_fts" ||
            snippet.sourceType === "project_document_keyword"
        );

        this.logger.info(
          "Project document candidate snippets construction completed",
          {
            projectDocumentFtsSnippets: candidateSnippets.filter(
              (s) => s.sourceType === "project_document_fts"
            ).length,
            projectDocumentKeywordSnippets: candidateSnippets.filter(
              (s) => s.sourceType === "project_document_keyword"
            ).length,
            totalProjectDocumentSnippets: documentCandidateSnippets.length,
            processedDocumentIds: processedDocumentIds.size,
          }
        );
      } catch (error) {
        this.logger.error(
          "Error during project document candidate snippets construction",
          {
            error: error.message,
            stack: error.stack,
            documentHitsCount: documentHits.length,
            keywordMatchedEntitiesCount: keywordMatchedEntities.length,
          }
        );
        // Continue with whatever snippets were successfully constructed
      }

      // Step 10: Search for relevant conversation history
      let matchedMessages = [];

      try {
        this.logger.debug("Starting conversation history search", {
          conversationId: conversationId,
          searchTermsCount: searchTerms.length,
          searchTerms: searchTerms,
          limit: MAX_CONVO_HISTORY_CANDIDATES,
        });

        if (searchTerms && searchTerms.length > 0) {
          matchedMessages = await dbQueries.searchConversationHistoryByTerms(
            this.dbClient,
            conversationId,
            searchTerms,
            MAX_CONVO_HISTORY_CANDIDATES
          );

          this.logger.debug("Conversation history search completed", {
            conversationId: conversationId,
            messagesFound: matchedMessages.length,
            searchTermsCount: searchTerms.length,
            limit: MAX_CONVO_HISTORY_CANDIDATES,
          });

          // Task 241: INFO level logging for stage completion
          this.logger.info(
            `Retrieval: Conversation history search complete, ${matchedMessages.length} candidates.`,
            {
              conversationId: conversationId,
              stage: "conversation_history",
              candidatesFound: matchedMessages.length,
            }
          );
        } else {
          this.logger.debug(
            "No search terms available for conversation history search",
            {
              conversationId: conversationId,
            }
          );
        }
      } catch (error) {
        this.logger.error("Error searching conversation history", {
          error: error.message,
          stack: error.stack,
          conversationId: conversationId,
          searchTermsCount: searchTerms?.length || 0,
        });
        // Continue with empty matched messages array
        matchedMessages = [];
      }

      // Step 11: Search for relevant conversation topics
      let matchedTopics = [];

      try {
        this.logger.debug("Starting conversation topics search", {
          conversationId: conversationId,
          searchTermsCount: searchTerms.length,
          searchTerms: searchTerms,
          limit: MAX_CONVO_TOPIC_CANDIDATES,
        });

        if (searchTerms && searchTerms.length > 0) {
          matchedTopics = await dbQueries.searchConversationTopicsByTerms(
            this.dbClient,
            searchTerms,
            MAX_CONVO_TOPIC_CANDIDATES
          );

          this.logger.debug("Conversation topics search completed", {
            conversationId: conversationId,
            topicsFound: matchedTopics.length,
            searchTermsCount: searchTerms.length,
            limit: MAX_CONVO_TOPIC_CANDIDATES,
          });

          // Task 241: INFO level logging for stage completion
          this.logger.info(
            `Retrieval: Conversation topics search complete, ${matchedTopics.length} candidates.`,
            {
              conversationId: conversationId,
              stage: "conversation_topics",
              candidatesFound: matchedTopics.length,
            }
          );
        } else {
          this.logger.debug(
            "No search terms available for conversation topics search",
            {
              conversationId: conversationId,
            }
          );
        }
      } catch (error) {
        this.logger.error("Error searching conversation topics", {
          error: error.message,
          stack: error.stack,
          conversationId: conversationId,
          searchTermsCount: searchTerms?.length || 0,
        });
        // Continue with empty matched topics array
        matchedTopics = [];
      }

      // Step 12: Construct candidate snippets from matched conversation history messages
      try {
        this.logger.debug(
          "Starting to construct conversation message snippets",
          {
            conversationId: conversationId,
            matchedMessagesCount: matchedMessages.length,
          }
        );

        // Helper function to calculate score for conversation messages
        const calculateScoreForMessage = (
          message,
          queryTerms,
          currentConversationId
        ) => {
          let score = 0;

          // Base score for message from current conversation (higher priority)
          if (message.conversation_id === currentConversationId) {
            score += 0.5; // 50% bonus for current conversation
          }

          // Recency score (newer messages get higher scores)
          // Convert timestamp to Date and calculate days ago
          try {
            const messageDate = new Date(message.timestamp);
            const now = new Date();
            const daysAgo = (now - messageDate) / (1000 * 60 * 60 * 24);

            // Recency score: newer messages get higher scores, decay over time
            // Maximum 0.3 points for very recent (same day), decay exponentially
            const recencyScore = Math.max(0, 0.3 * Math.exp(-daysAgo / 7)); // 7-day half-life
            score += recencyScore;
          } catch (dateError) {
            this.logger.debug("Error parsing message timestamp for scoring", {
              messageId: message.message_id,
              timestamp: message.timestamp,
              error: dateError.message,
            });
            // Continue without recency score if timestamp parsing fails
          }

          // Relevance score based on query terms found in message content
          if (queryTerms && queryTerms.length > 0 && message.content) {
            const contentLower = message.content.toLowerCase();
            let matchCount = 0;

            for (const term of queryTerms) {
              if (contentLower.includes(term.toLowerCase())) {
                matchCount++;
              }
            }

            // Relevance score: up to 0.2 points based on term matches
            const relevanceScore = Math.min(
              0.2,
              (matchCount / queryTerms.length) * 0.2
            );
            score += relevanceScore;
          }

          // Ensure score is between 0 and 1
          return Math.min(1, Math.max(0, score));
        };

        // Process each matched message into a candidate snippet
        for (const message of matchedMessages) {
          try {
            // Calculate initial score for this message
            const initialScore = calculateScoreForMessage(
              message,
              searchTerms,
              conversationId
            );

            // Create candidate snippet object
            const candidateSnippet = {
              sourceType: "conversation_message",
              id: message.message_id,
              contentSnippet: message.content, // Full message content as snippet
              metadata: {
                role: message.role,
                timestamp: message.timestamp, // ISO string
                conversationId: message.conversation_id,
              },
              initialScore: initialScore,
            };

            candidateSnippets.push(candidateSnippet);

            this.logger.debug("Added conversation message candidate snippet", {
              messageId: message.message_id,
              role: message.role,
              conversationId: message.conversation_id,
              sourceType: "conversation_message",
              initialScore: initialScore,
              contentSnippetLength: message.content?.length || 0,
            });
          } catch (snippetError) {
            this.logger.error(
              "Error constructing conversation message snippet",
              {
                error: snippetError.message,
                stack: snippetError.stack,
                messageId: message.message_id,
                conversationId: conversationId,
              }
            );
            // Skip this message on error
          }
        }

        // Filter candidate snippets to only conversation messages for logging
        const conversationMessageSnippets = candidateSnippets.filter(
          (snippet) => snippet.sourceType === "conversation_message"
        );

        this.logger.info(
          "Conversation message snippets construction completed",
          {
            conversationId: conversationId,
            messagesProcessed: matchedMessages.length,
            conversationMessageSnippets: conversationMessageSnippets.length,
          }
        );
      } catch (error) {
        this.logger.error(
          "Error during conversation message snippets construction",
          {
            error: error.message,
            stack: error.stack,
            conversationId: conversationId,
            matchedMessagesCount: matchedMessages.length,
          }
        );
        // Continue with whatever snippets were successfully constructed
      }

      // Step 13: Construct candidate snippets from matched conversation topics
      try {
        this.logger.debug("Starting to construct conversation topic snippets", {
          conversationId: conversationId,
          matchedTopicsCount: matchedTopics.length,
        });

        // Helper function to calculate score for conversation topics
        const calculateScoreForTopic = (topic, queryTerms) => {
          let score = 0;

          // Relevance score based on query terms found in topic summary
          if (queryTerms && queryTerms.length > 0 && topic.summary) {
            const summaryLower = topic.summary.toLowerCase();
            let summaryMatchCount = 0;

            for (const term of queryTerms) {
              if (summaryLower.includes(term.toLowerCase())) {
                summaryMatchCount++;
              }
            }

            // Summary matches get higher weight (up to 0.6 points)
            const summaryScore = Math.min(
              0.6,
              (summaryMatchCount / queryTerms.length) * 0.6
            );
            score += summaryScore;
          }

          // Additional relevance score based on query terms found in keywords
          if (queryTerms && queryTerms.length > 0 && topic.keywords) {
            try {
              const parsedKeywords = JSON.parse(topic.keywords || "[]");
              if (Array.isArray(parsedKeywords)) {
                let keywordMatchCount = 0;

                for (const keyword of parsedKeywords) {
                  const keywordLower = keyword.toLowerCase();
                  for (const term of queryTerms) {
                    if (keywordLower.includes(term.toLowerCase())) {
                      keywordMatchCount++;
                      break; // Count each keyword match only once per term
                    }
                  }
                }

                // Keyword matches get moderate weight (up to 0.4 points)
                const keywordScore = Math.min(
                  0.4,
                  (keywordMatchCount / Math.max(parsedKeywords.length, 1)) * 0.4
                );
                score += keywordScore;
              }
            } catch (keywordParseError) {
              this.logger.debug("Error parsing topic keywords for scoring", {
                topicId: topic.topic_id,
                keywords: topic.keywords,
                error: keywordParseError.message,
              });
              // Continue without keyword scoring if parsing fails
            }
          }

          // Ensure score is between 0 and 1
          return Math.min(1, Math.max(0, score));
        };

        // Process each matched topic into a candidate snippet
        for (const topic of matchedTopics) {
          try {
            // Parse keywords safely
            let parsedKeywords = [];
            try {
              parsedKeywords = JSON.parse(topic.keywords || "[]");
              if (!Array.isArray(parsedKeywords)) {
                parsedKeywords = [];
              }
            } catch (keywordParseError) {
              this.logger.debug("Error parsing topic keywords", {
                topicId: topic.topic_id,
                keywords: topic.keywords,
                error: keywordParseError.message,
              });
              parsedKeywords = [];
            }

            // Calculate initial score for this topic
            const initialScore = calculateScoreForTopic(topic, searchTerms);

            // Create candidate snippet object
            const candidateSnippet = {
              sourceType: "conversation_topic",
              id: topic.topic_id,
              contentSnippet: topic.summary, // Topic summary as the snippet
              metadata: {
                purposeTag: topic.purpose_tag,
                keywords: parsedKeywords, // Parse keywords JSON string from DB
              },
              initialScore: initialScore,
            };

            candidateSnippets.push(candidateSnippet);

            this.logger.debug("Added conversation topic candidate snippet", {
              topicId: topic.topic_id,
              purposeTag: topic.purpose_tag,
              sourceType: "conversation_topic",
              initialScore: initialScore,
              contentSnippetLength: topic.summary?.length || 0,
              keywordsCount: parsedKeywords.length,
            });
          } catch (snippetError) {
            this.logger.error("Error constructing conversation topic snippet", {
              error: snippetError.message,
              stack: snippetError.stack,
              topicId: topic.topic_id,
              conversationId: conversationId,
            });
            // Skip this topic on error
          }
        }

        // Filter candidate snippets to only conversation topics for logging
        const conversationTopicSnippets = candidateSnippets.filter(
          (snippet) => snippet.sourceType === "conversation_topic"
        );

        this.logger.info("Conversation topic snippets construction completed", {
          conversationId: conversationId,
          topicsProcessed: matchedTopics.length,
          conversationTopicSnippets: conversationTopicSnippets.length,
        });
      } catch (error) {
        this.logger.error(
          "Error during conversation topic snippets construction",
          {
            error: error.message,
            stack: error.stack,
            conversationId: conversationId,
            matchedTopicsCount: matchedTopics.length,
          }
        );
        // Continue with whatever snippets were successfully constructed
      }

      // Step 14: Search for relevant Git commits
      let matchedGitCommits = [];

      try {
        this.logger.debug("Starting Git commit search", {
          conversationId: conversationId,
          searchTermsCount: searchTerms.length,
          searchTerms: searchTerms,
          limit: MAX_GIT_COMMIT_CANDIDATES,
        });

        // Use the Git history heuristic to determine if Git search should be performed
        const isGitRelevantQuery = this._isGitHistoryQuery(query, searchTerms);

        this.logger.debug("Git history relevance check completed", {
          query: query,
          isGitRelevantQuery: isGitRelevantQuery,
          searchTermsCount: searchTerms.length,
        });

        // Perform Git commit search if we have search terms and the query suggests Git relevance
        // For now, we'll search if either the heuristic suggests it OR if we have valid search terms
        // This allows for both targeted Git searches and general inclusion of Git context
        if (searchTerms && searchTerms.length > 0) {
          if (isGitRelevantQuery) {
            this.logger.debug(
              "Query identified as Git-relevant, performing Git commit search",
              {
                searchTermsCount: searchTerms.length,
                limit: MAX_GIT_COMMIT_CANDIDATES,
              }
            );
          } else {
            this.logger.debug(
              "Query not specifically Git-relevant, but performing Git commit search with search terms",
              {
                searchTermsCount: searchTerms.length,
                limit: MAX_GIT_COMMIT_CANDIDATES,
              }
            );
          }

          matchedGitCommits = await dbQueries.searchGitCommitsByTerms(
            this.dbClient,
            searchTerms,
            MAX_GIT_COMMIT_CANDIDATES
          );

          this.logger.debug("Git commit search completed", {
            conversationId: conversationId,
            commitsFound: matchedGitCommits.length,
            searchTermsCount: searchTerms.length,
            limit: MAX_GIT_COMMIT_CANDIDATES,
            isGitRelevantQuery: isGitRelevantQuery,
          });

          // Task 241: INFO level logging for stage completion
          this.logger.info(
            `Retrieval: Git commits search complete, ${matchedGitCommits.length} candidates.`,
            {
              conversationId: conversationId,
              stage: "git_commits",
              candidatesFound: matchedGitCommits.length,
            }
          );
        } else {
          this.logger.debug("No search terms available for Git commit search", {
            conversationId: conversationId,
            isGitRelevantQuery: isGitRelevantQuery,
          });
        }
      } catch (error) {
        this.logger.error("Error searching Git commits", {
          error: error.message,
          stack: error.stack,
          conversationId: conversationId,
          searchTermsCount: searchTerms?.length || 0,
          query: query,
        });
        // Continue with empty matched commits array
        matchedGitCommits = [];
      }

      // Step 14.5: Construct candidate snippets from matched Git commits
      try {
        this.logger.debug(
          "Starting to construct Git commit candidate snippets",
          {
            conversationId: conversationId,
            matchedGitCommitsCount: matchedGitCommits.length,
          }
        );

        // Helper function to calculate score for Git commits
        const calculateScoreForGitCommit = (commit, queryTerms) => {
          let score = 0;

          // Base relevance score based on query terms found in commit message
          if (queryTerms && queryTerms.length > 0 && commit.message) {
            const messageLower = commit.message.toLowerCase();
            let matchCount = 0;

            for (const term of queryTerms) {
              if (messageLower.includes(term.toLowerCase())) {
                matchCount++;
              }
            }

            // Message matches get moderate weight (up to 0.5 points)
            const messageScore = Math.min(
              0.5,
              (matchCount / queryTerms.length) * 0.5
            );
            score += messageScore;
          }

          // Author relevance score based on query terms found in author name
          if (queryTerms && queryTerms.length > 0 && commit.author_name) {
            const authorLower = commit.author_name.toLowerCase();
            let authorMatchCount = 0;

            for (const term of queryTerms) {
              if (authorLower.includes(term.toLowerCase())) {
                authorMatchCount++;
              }
            }

            // Author matches get lower weight (up to 0.2 points)
            const authorScore = Math.min(
              0.2,
              (authorMatchCount / queryTerms.length) * 0.2
            );
            score += authorScore;
          }

          // Recency score (newer commits get higher scores)
          try {
            const commitDate = new Date(commit.commit_date);
            const now = new Date();
            const daysAgo = (now - commitDate) / (1000 * 60 * 60 * 24);

            // Recency score: newer commits get higher scores, decay over time
            // Maximum 0.3 points for very recent (same day), decay exponentially
            const recencyScore = Math.max(0, 0.3 * Math.exp(-daysAgo / 30)); // 30-day half-life
            score += recencyScore;
          } catch (dateError) {
            this.logger.debug("Error parsing commit date for scoring", {
              commitHash: commit.commit_hash,
              commitDate: commit.commit_date,
              error: dateError.message,
            });
            // Continue without recency score if date parsing fails
          }

          // Ensure score is between 0 and 1
          return Math.min(1, Math.max(0, score));
        };

        // Process each matched Git commit into a candidate snippet
        for (const commit of matchedGitCommits) {
          try {
            // Calculate initial score for this commit
            const initialScore = calculateScoreForGitCommit(
              commit,
              searchTerms
            );

            // Create candidate snippet object
            const candidateSnippet = {
              sourceType: "git_commit",
              id: commit.commit_hash,
              contentSnippet: commit.message, // Commit message as the snippet
              metadata: {
                commitHash: commit.commit_hash,
                authorName: commit.author_name,
                commitDate: commit.commit_date, // ISO string or Date object
                // Note: List of changed files could be added here if available from the query
              },
              initialScore: initialScore,
            };

            candidateSnippets.push(candidateSnippet);

            this.logger.debug("Added Git commit candidate snippet", {
              commitHash: commit.commit_hash,
              authorName: commit.author_name,
              sourceType: "git_commit",
              initialScore: initialScore,
              contentSnippetLength: commit.message?.length || 0,
            });
          } catch (snippetError) {
            this.logger.error("Error constructing Git commit snippet", {
              error: snippetError.message,
              stack: snippetError.stack,
              commitHash: commit.commit_hash,
              conversationId: conversationId,
            });
            // Skip this commit on error
          }
        }

        // Filter candidate snippets to only Git commits for logging
        const gitCommitSnippets = candidateSnippets.filter(
          (snippet) => snippet.sourceType === "git_commit"
        );

        this.logger.info("Git commit snippets construction completed", {
          conversationId: conversationId,
          commitsProcessed: matchedGitCommits.length,
          gitCommitSnippets: gitCommitSnippets.length,
        });
      } catch (error) {
        this.logger.error("Error during Git commit snippets construction", {
          error: error.message,
          stack: error.stack,
          conversationId: conversationId,
          matchedGitCommitsCount: matchedGitCommits.length,
        });
        // Continue with whatever snippets were successfully constructed
      }

      // Step 15: Search for relevant Git commit file changes
      let matchedCommitFiles = [];

      try {
        this.logger.debug("Starting Git commit file change search", {
          conversationId: conversationId,
          searchTermsCount: searchTerms.length,
          searchTerms: searchTerms,
          limit: MAX_GIT_FILE_CHANGE_CANDIDATES,
        });

        // Use the same Git history heuristic as for commits
        const isGitRelevantQuery = this._isGitHistoryQuery(query, searchTerms);

        this.logger.debug(
          "Git history relevance check for file changes completed",
          {
            query: query,
            isGitRelevantQuery: isGitRelevantQuery,
            searchTermsCount: searchTerms.length,
          }
        );

        // Extract terms that are likely file paths or use all search terms
        // File path terms are those containing "/" or ending with common file extensions
        let pathSearchTerms = [];

        if (searchTerms && searchTerms.length > 0) {
          // Filter for path-like terms (contains "/" or ends with file extensions)
          const fileExtensions = [
            ".js",
            ".ts",
            ".jsx",
            ".tsx",
            ".py",
            ".java",
            ".cpp",
            ".c",
            ".h",
            ".cs",
            ".php",
            ".rb",
            ".go",
            ".rs",
            ".swift",
            ".kt",
            ".scala",
            ".html",
            ".css",
            ".scss",
            ".sass",
            ".json",
            ".xml",
            ".yaml",
            ".yml",
            ".md",
            ".txt",
            ".sql",
          ];

          pathSearchTerms = searchTerms.filter((term) => {
            // Check if term contains forward slash (path separator)
            if (term.includes("/")) {
              return true;
            }

            // Check if term ends with common file extension
            return fileExtensions.some((ext) =>
              term.toLowerCase().endsWith(ext)
            );
          });

          // If no path-like terms found, use all search terms
          if (pathSearchTerms.length === 0) {
            pathSearchTerms = searchTerms;
            this.logger.debug(
              "No path-like terms found, using all search terms for file change search",
              {
                searchTermsCount: searchTerms.length,
              }
            );
          } else {
            this.logger.debug("Found path-like terms for file change search", {
              pathSearchTerms: pathSearchTerms,
              pathTermsCount: pathSearchTerms.length,
              totalSearchTerms: searchTerms.length,
            });
          }

          // Perform Git commit file change search
          if (isGitRelevantQuery) {
            this.logger.debug(
              "Query identified as Git-relevant, performing Git commit file change search",
              {
                pathSearchTermsCount: pathSearchTerms.length,
                limit: MAX_GIT_FILE_CHANGE_CANDIDATES,
              }
            );
          } else {
            this.logger.debug(
              "Query not specifically Git-relevant, but performing Git commit file change search with path terms",
              {
                pathSearchTermsCount: pathSearchTerms.length,
                limit: MAX_GIT_FILE_CHANGE_CANDIDATES,
              }
            );
          }

          matchedCommitFiles = await dbQueries.searchGitCommitFilesByTerms(
            this.dbClient,
            pathSearchTerms,
            MAX_GIT_FILE_CHANGE_CANDIDATES
          );

          this.logger.debug("Git commit file change search completed", {
            conversationId: conversationId,
            fileChangesFound: matchedCommitFiles.length,
            searchTermsCount: searchTerms.length,
            pathSearchTermsCount: pathSearchTerms.length,
            limit: MAX_GIT_FILE_CHANGE_CANDIDATES,
            isGitRelevantQuery: isGitRelevantQuery,
          });

          // Task 241: INFO level logging for stage completion
          this.logger.info(
            `Retrieval: Git commit files search complete, ${matchedCommitFiles.length} candidates.`,
            {
              conversationId: conversationId,
              stage: "git_commit_files",
              candidatesFound: matchedCommitFiles.length,
            }
          );
        } else {
          this.logger.debug(
            "No search terms available for Git commit file change search",
            {
              conversationId: conversationId,
              isGitRelevantQuery: isGitRelevantQuery,
            }
          );
        }
      } catch (error) {
        this.logger.error("Error searching Git commit file changes", {
          error: error.message,
          stack: error.stack,
          conversationId: conversationId,
          searchTermsCount: searchTerms?.length || 0,
          query: query,
        });
        // Continue with empty matched commit files array
        matchedCommitFiles = [];
      }

      // Step 15.5: Construct candidate snippets from matched Git commit file changes
      try {
        this.logger.debug(
          "Starting to construct Git commit file change candidate snippets",
          {
            conversationId: conversationId,
            matchedCommitFilesCount: matchedCommitFiles.length,
          }
        );

        // Helper function to calculate score for Git commit file changes
        const calculateScoreForFileChange = (change, queryTerms) => {
          let score = 0;

          // File path relevance score based on query terms found in file_path
          if (queryTerms && queryTerms.length > 0 && change.file_path) {
            const filePathLower = change.file_path.toLowerCase();
            let pathMatchCount = 0;

            for (const term of queryTerms) {
              if (filePathLower.includes(term.toLowerCase())) {
                pathMatchCount++;
              }
            }

            // File path matches get high weight (up to 0.6 points)
            const pathScore = Math.min(
              0.6,
              (pathMatchCount / queryTerms.length) * 0.6
            );
            score += pathScore;
          }

          // Commit message relevance score based on query terms found in commit message
          if (queryTerms && queryTerms.length > 0 && change.commit_message) {
            const messageLower = change.commit_message.toLowerCase();
            let messageMatchCount = 0;

            for (const term of queryTerms) {
              if (messageLower.includes(term.toLowerCase())) {
                messageMatchCount++;
              }
            }

            // Message matches get moderate weight (up to 0.3 points)
            const messageScore = Math.min(
              0.3,
              (messageMatchCount / queryTerms.length) * 0.3
            );
            score += messageScore;
          }

          // Change status bonus (some statuses might be more relevant)
          if (change.status) {
            const statusLower = change.status.toLowerCase();
            if (statusLower === "modified" || statusLower === "added") {
              score += 0.05; // Small bonus for modified/added files
            } else if (statusLower === "deleted") {
              score += 0.02; // Smaller bonus for deleted files
            }
          }

          // Recency score based on commit date (newer commits get higher scores)
          try {
            const commitDate = new Date(change.commit_date);
            const now = new Date();
            const daysAgo = (now - commitDate) / (1000 * 60 * 60 * 24);

            // Recency score: newer commits get higher scores, decay over time
            // Maximum 0.2 points for very recent (same day), decay exponentially
            const recencyScore = Math.max(0, 0.2 * Math.exp(-daysAgo / 30)); // 30-day half-life
            score += recencyScore;
          } catch (dateError) {
            this.logger.debug(
              "Error parsing commit date for file change scoring",
              {
                commitHash: change.commit_hash,
                filePath: change.file_path,
                commitDate: change.commit_date,
                error: dateError.message,
              }
            );
            // Continue without recency score if date parsing fails
          }

          // Ensure score is between 0 and 1
          return Math.min(1, Math.max(0, score));
        };

        // Process each matched Git commit file change into a candidate snippet
        for (const change of matchedCommitFiles) {
          try {
            // Calculate initial score for this file change
            const initialScore = calculateScoreForFileChange(
              change,
              searchTerms
            );

            // Create a unique ID for this file change (composite of commit hash and file path)
            const uniqueId = `${change.commit_hash}_${change.file_path}`;

            // Create informative content snippet
            const truncatedMessage =
              change.commit_message && change.commit_message.length > 100
                ? change.commit_message.substring(0, 100) + "..."
                : change.commit_message || "No commit message";

            const contentSnippet = `File '${change.file_path}' was ${change.status}. Commit: ${truncatedMessage}`;

            // Create candidate snippet object
            const candidateSnippet = {
              sourceType: "git_commit_file_change",
              id: uniqueId,
              contentSnippet: contentSnippet,
              metadata: {
                filePath: change.file_path,
                status: change.status,
                commitHash: change.commit_hash,
                commitMessage: change.commit_message,
                commitAuthor: change.commit_author,
                commitDate: change.commit_date,
              },
              initialScore: initialScore,
            };

            candidateSnippets.push(candidateSnippet);

            this.logger.debug(
              "Added Git commit file change candidate snippet",
              {
                filePath: change.file_path,
                status: change.status,
                commitHash: change.commit_hash,
                sourceType: "git_commit_file_change",
                initialScore: initialScore,
                contentSnippetLength: contentSnippet.length,
              }
            );
          } catch (snippetError) {
            this.logger.error(
              "Error constructing Git commit file change snippet",
              {
                error: snippetError.message,
                stack: snippetError.stack,
                commitHash: change.commit_hash,
                filePath: change.file_path,
                conversationId: conversationId,
              }
            );
            // Skip this file change on error
          }
        }

        // Filter candidate snippets to only Git commit file changes for logging
        const gitCommitFileChangeSnippets = candidateSnippets.filter(
          (snippet) => snippet.sourceType === "git_commit_file_change"
        );

        this.logger.info(
          "Git commit file change snippets construction completed",
          {
            conversationId: conversationId,
            commitFilesProcessed: matchedCommitFiles.length,
            gitCommitFileChangeSnippets: gitCommitFileChangeSnippets.length,
          }
        );
      } catch (error) {
        this.logger.error(
          "Error during Git commit file change snippets construction",
          {
            error: error.message,
            stack: error.stack,
            conversationId: conversationId,
            matchedCommitFilesCount: matchedCommitFiles.length,
          }
        );
        // Continue with whatever snippets were successfully constructed
      }

      // Step 15a: Identify seed entities for relationship expansion (Task 235)
      const seedEntities = [];
      try {
        this.logger.debug(
          "Starting seed entity identification for relationship expansion",
          {
            conversationId: conversationId,
            totalCandidateSnippets: candidateSnippets.length,
          }
        );

        // Import configuration for maximum seed entities
        const config = (await import("../config.js")).default;
        const maxSeedEntities = config.MAX_SEED_ENTITIES_FOR_EXPANSION;

        // Filter candidate snippets to get only code_entity types
        const codeEntitySnippets = candidateSnippets.filter(
          (snippet) =>
            snippet.sourceType === "code_entity_fts" ||
            snippet.sourceType === "code_entity_keyword"
        );

        this.logger.debug("Filtered candidate snippets to code entities", {
          totalCandidateSnippets: candidateSnippets.length,
          codeEntitySnippets: codeEntitySnippets.length,
        });

        if (codeEntitySnippets.length === 0) {
          this.logger.debug(
            "No code entity snippets found for seed entity identification",
            {
              conversationId: conversationId,
            }
          );
        } else {
          // Sort code entity snippets by their initialScore in descending order
          const sortedCodeEntitySnippets = [...codeEntitySnippets].sort(
            (a, b) => (b.initialScore || 0) - (a.initialScore || 0)
          );

          // Select the top N snippets as seed entities
          const selectedSeedSnippets = sortedCodeEntitySnippets.slice(
            0,
            maxSeedEntities
          );

          // Extract seed entity information
          for (const snippet of selectedSeedSnippets) {
            const seedEntity = {
              id: snippet.id,
              seedEntityScore: snippet.initialScore || 0,
              entityName: snippet.entityName,
              sourceType: snippet.sourceType,
              filePath: snippet.filePath,
              entityType: snippet.entityType,
            };

            seedEntities.push(seedEntity);

            this.logger.debug(
              "Selected seed entity for relationship expansion",
              {
                entityId: seedEntity.id,
                entityName: seedEntity.entityName,
                seedEntityScore: seedEntity.seedEntityScore,
                sourceType: seedEntity.sourceType,
                filePath: seedEntity.filePath,
              }
            );
          }

          this.logger.info("Seed entity identification completed", {
            conversationId: conversationId,
            totalCodeEntitySnippets: codeEntitySnippets.length,
            maxSeedEntities: maxSeedEntities,
            seedEntitiesIdentified: seedEntities.length,
            seedEntityIds: seedEntities.map((se) => se.id),
          });
        }
      } catch (error) {
        this.logger.error("Error during seed entity identification", {
          error: error.message,
          stack: error.stack,
          conversationId: conversationId,
        });
        // Continue without seed entities if there's an error
      }

      // Step 15b: Perform relationship expansion for seed entities (Task 236) and merge results (Task 237)
      let relationshipDerivedSnippets = []; // Collect all relationship-derived snippets
      try {
        this.logger.debug("Starting relationship expansion for seed entities", {
          conversationId: conversationId,
          seedEntitiesCount: seedEntities.length,
          hasRelationshipManager: !!this.relationshipManager,
        });

        if (seedEntities.length > 0 && this.relationshipManager) {
          // Process each seed entity for relationship expansion
          for (let i = 0; i < seedEntities.length; i++) {
            const seedEntity = seedEntities[i];

            try {
              this.logger.debug(
                `Processing seed entity ${i + 1}/${
                  seedEntities.length
                } for relationship expansion`,
                {
                  seedEntityId: seedEntity.id,
                  seedEntityName: seedEntity.entityName,
                  seedEntityScore: seedEntity.initialScore,
                  conversationId: conversationId,
                }
              );

              // Call RelationshipManager to get related entities
              const relatedSnippets =
                await this.relationshipManager.getRelatedEntities(
                  seedEntity.id,
                  searchTerms, // Pass the search terms for query relevance scoring
                  seedEntity.initialScore // Pass the seed entity's score for scoring calculations
                );

              this.logger.debug(
                "Relationship expansion completed for seed entity",
                {
                  seedEntityId: seedEntity.id,
                  seedEntityName: seedEntity.entityName,
                  relatedSnippetsFound: relatedSnippets.length,
                  conversationId: conversationId,
                }
              );

              // Collect relationship-derived snippets for later merging
              if (relatedSnippets.length > 0) {
                relationshipDerivedSnippets.push(...relatedSnippets);

                this.logger.debug(
                  "Collected relationship-derived snippets for merging",
                  {
                    seedEntityId: seedEntity.id,
                    addedSnippetsCount: relatedSnippets.length,
                    totalRelationshipSnippetsCollected:
                      relationshipDerivedSnippets.length,
                    conversationId: conversationId,
                  }
                );
              }
            } catch (seedEntityError) {
              this.logger.error(
                "Error processing seed entity for relationship expansion",
                {
                  error: seedEntityError.message,
                  stack: seedEntityError.stack,
                  seedEntityId: seedEntity.id,
                  seedEntityName: seedEntity.entityName,
                  conversationId: conversationId,
                }
              );
              // Continue with the next seed entity
            }
          }

          this.logger.info(
            "Relationship expansion completed for all seed entities",
            {
              conversationId: conversationId,
              seedEntitiesProcessed: seedEntities.length,
              relationshipDerivedSnippetsCollected:
                relationshipDerivedSnippets.length,
              relationshipExpansionComplete: true,
            }
          );
        } else {
          this.logger.debug("Skipping relationship expansion", {
            conversationId: conversationId,
            reason:
              seedEntities.length === 0
                ? "No seed entities identified"
                : "RelationshipManager not available",
            seedEntitiesCount: seedEntities.length,
            hasRelationshipManager: !!this.relationshipManager,
          });
        }
      } catch (error) {
        this.logger.error("Error during relationship expansion", {
          error: error.message,
          stack: error.stack,
          conversationId: conversationId,
          seedEntitiesCount: seedEntities.length,
        });
        // Continue with empty relationship-derived snippets
        relationshipDerivedSnippets = [];
      }

      // Task 237: Merge relationship-derived snippets into main candidate list with duplicate handling
      try {
        this.logger.debug("Starting merge of relationship-derived snippets", {
          conversationId: conversationId,
          existingCandidateSnippets: candidateSnippets.length,
          relationshipDerivedSnippets: relationshipDerivedSnippets.length,
        });

        if (relationshipDerivedSnippets.length > 0) {
          // Use Map to handle duplicates based on entity ID for code entities
          const candidateSnippetsMap = new Map();

          // First, add all existing candidate snippets to the map
          for (const snippet of candidateSnippets) {
            let mapKey;

            // For code entities, use entity ID as the key to detect duplicates
            if (
              (snippet.sourceType === "code_entity_fts" ||
                snippet.sourceType === "code_entity_keyword") &&
              snippet.id
            ) {
              mapKey = `entity_${snippet.id}`;
            } else {
              // For other types (documents, conversations, git), use their specific IDs
              mapKey = `${snippet.sourceType}_${snippet.id}`;
            }

            candidateSnippetsMap.set(mapKey, snippet);
          }

          this.logger.debug("Added existing candidate snippets to merge map", {
            conversationId: conversationId,
            candidateSnippetsInMap: candidateSnippetsMap.size,
          });

          // Process relationship-derived snippets and handle duplicates
          let mergedCount = 0;
          let duplicatesHandled = 0;

          for (const relationshipSnippet of relationshipDerivedSnippets) {
            // For relationship-derived snippets (which should be code entities),
            // use entity ID as the key
            const mapKey = `entity_${relationshipSnippet.id}`;

            if (candidateSnippetsMap.has(mapKey)) {
              // Handle duplicate - compare scores and keep the better one
              const existingSnippet = candidateSnippetsMap.get(mapKey);
              const existingScore = existingSnippet.initialScore || 0;
              const relationshipScore = relationshipSnippet.initialScore || 0;

              if (relationshipScore > existingScore) {
                // Relationship snippet has better score, replace the existing one
                // But preserve any existing relationship context if both exist
                if (
                  existingSnippet.relationshipContext &&
                  relationshipSnippet.relationshipContext
                ) {
                  // Keep the existing relationship context and log the conflict
                  this.logger.debug(
                    "Multiple relationship contexts found for entity, keeping existing",
                    {
                      entityId: relationshipSnippet.id,
                      existingRelationshipType:
                        existingSnippet.relationshipContext.relationshipType,
                      newRelationshipType:
                        relationshipSnippet.relationshipContext
                          .relationshipType,
                      conversationId: conversationId,
                    }
                  );
                }

                candidateSnippetsMap.set(mapKey, relationshipSnippet);
                duplicatesHandled++;

                this.logger.debug(
                  "Replaced existing snippet with higher-scoring relationship snippet",
                  {
                    entityId: relationshipSnippet.id,
                    existingScore: existingScore,
                    relationshipScore: relationshipScore,
                    conversationId: conversationId,
                  }
                );
              } else {
                // Existing snippet has better score, but add relationship context if missing
                if (
                  !existingSnippet.relationshipContext &&
                  relationshipSnippet.relationshipContext
                ) {
                  existingSnippet.relationshipContext =
                    relationshipSnippet.relationshipContext;

                  this.logger.debug(
                    "Added relationship context to existing higher-scoring snippet",
                    {
                      entityId: relationshipSnippet.id,
                      existingScore: existingScore,
                      relationshipScore: relationshipScore,
                      relationshipType:
                        relationshipSnippet.relationshipContext
                          .relationshipType,
                      conversationId: conversationId,
                    }
                  );
                }
                duplicatesHandled++;
              }
            } else {
              // No duplicate, add the relationship-derived snippet
              candidateSnippetsMap.set(mapKey, relationshipSnippet);
              mergedCount++;
            }
          }

          // Convert the map back to an array and update candidateSnippets
          candidateSnippets.length = 0; // Clear the array
          candidateSnippets.push(...Array.from(candidateSnippetsMap.values()));

          this.logger.info(
            "Relationship-derived snippets merged successfully",
            {
              conversationId: conversationId,
              relationshipSnippetsProcessed: relationshipDerivedSnippets.length,
              newSnippetsMerged: mergedCount,
              duplicatesHandled: duplicatesHandled,
              finalCandidateSnippetsCount: candidateSnippets.length,
            }
          );

          // Task 241: INFO level logging for all sources merged stage completion
          this.logger.info(
            `Retrieval: Merged all sources, ${candidateSnippets.length} total candidates.`,
            {
              conversationId: conversationId,
              stage: "merged_all_sources",
              totalCandidates: candidateSnippets.length,
              sourceBreakdown: {
                code_entity_fts: candidateSnippets.filter(
                  (s) => s.sourceType === "code_entity_fts"
                ).length,
                code_entity_keyword: candidateSnippets.filter(
                  (s) => s.sourceType === "code_entity_keyword"
                ).length,
                project_document_fts: candidateSnippets.filter(
                  (s) => s.sourceType === "project_document_fts"
                ).length,
                project_document_keyword: candidateSnippets.filter(
                  (s) => s.sourceType === "project_document_keyword"
                ).length,
                conversation_message: candidateSnippets.filter(
                  (s) => s.sourceType === "conversation_message"
                ).length,
                conversation_topic: candidateSnippets.filter(
                  (s) => s.sourceType === "conversation_topic"
                ).length,
                git_commit: candidateSnippets.filter(
                  (s) => s.sourceType === "git_commit"
                ).length,
                git_commit_file_change: candidateSnippets.filter(
                  (s) => s.sourceType === "git_commit_file_change"
                ).length,
                code_entity_related: candidateSnippets.filter(
                  (s) => s.sourceType === "code_entity_related"
                ).length,
              },
            }
          );
        } else {
          this.logger.debug("No relationship-derived snippets to merge", {
            conversationId: conversationId,
            existingCandidateSnippets: candidateSnippets.length,
          });
        }
      } catch (mergeError) {
        this.logger.error("Error during relationship snippets merging", {
          error: mergeError.message,
          stack: mergeError.stack,
          conversationId: conversationId,
          relationshipDerivedSnippetsCount: relationshipDerivedSnippets.length,
          existingCandidateSnippetsCount: candidateSnippets.length,
        });

        // Fallback: simple concatenation if merging fails
        if (relationshipDerivedSnippets.length > 0) {
          candidateSnippets.push(...relationshipDerivedSnippets);
          this.logger.debug(
            "Applied fallback merge strategy (simple concatenation)",
            {
              conversationId: conversationId,
              finalCandidateSnippetsCount: candidateSnippets.length,
            }
          );
        }
      }

      // Step 16: Calculate consolidated scores for all candidate snippets
      // Apply multi-factor ranking using source type weights, AI status weights, and recency factors
      try {
        // Task 213: Log number of candidate snippets before ranking
        this.logger.debug("Number of candidate snippets before ranking", {
          conversationId: conversationId,
          candidateSnippetsBeforeRanking: candidateSnippets.length,
        });

        this.logger.debug(
          "Starting multi-factor score calculation for candidate snippets",
          {
            conversationId: conversationId,
            totalCandidateSnippets: candidateSnippets.length,
          }
        );

        // Import ranking factor weights from configuration
        const { RANKING_FACTOR_WEIGHTS } = await import("../config.js");

        // Helper function to calculate recency boost for time-sensitive snippets
        const calculateRecencyBoost = (timestampString) => {
          if (!timestampString) {
            return 0; // No recency boost if no timestamp
          }

          try {
            const itemDate = new Date(timestampString);
            const now = new Date();
            const ageInMillis = now.getTime() - itemDate.getTime();
            const ageInHours = ageInMillis / (1000 * 60 * 60);

            const { maxBoost, decayRateHours, minAgeForDecay, maxAgeForBoost } =
              RANKING_FACTOR_WEIGHTS.recency;

            // No boost if item is too old
            if (ageInHours > maxAgeForBoost) {
              return 0;
            }

            // No decay if item is very recent
            if (ageInHours <= minAgeForDecay) {
              return maxBoost;
            }

            // Exponential decay based on age
            const decayFactor = Math.exp(-ageInHours / decayRateHours);
            return maxBoost * decayFactor;
          } catch (dateError) {
            this.logger.debug(
              "Error parsing timestamp for recency calculation",
              {
                timestamp: timestampString,
                error: dateError.message,
              }
            );
            return 0; // No boost if timestamp is invalid
          }
        };

        // Process each candidate snippet to calculate consolidated score
        let scoreCalculationCount = 0;
        let scoreCalculationErrors = 0;
        let relationshipSnippetsProcessed = 0; // Task 238: Track relationship-derived snippets

        for (const snippet of candidateSnippets) {
          try {
            // Start with normalized initial score
            let consolidatedScore = snippet.initialScore || 0;

            // Apply source type weight
            const sourceTypeWeight =
              RANKING_FACTOR_WEIGHTS.sourceType[snippet.sourceType] || 1.0;
            consolidatedScore *= sourceTypeWeight;

            // Apply AI status weight if applicable
            if (snippet.aiStatus) {
              const aiStatusWeight =
                RANKING_FACTOR_WEIGHTS.aiStatus[snippet.aiStatus] || 1.0;
              consolidatedScore *= aiStatusWeight;
            }

            // Task 238: Special handling for relationship-derived snippets
            let relationshipBoost = 0;
            let relationshipTypeWeight = 1.0;

            if (snippet.relationshipContext) {
              relationshipSnippetsProcessed++;

              // Apply relationship type-specific weight if available
              const relationshipType =
                snippet.relationshipContext.relationshipType;
              relationshipTypeWeight =
                RANKING_FACTOR_WEIGHTS.relationshipType[relationshipType] ||
                1.0;

              // Apply relationship type weight as a multiplier
              consolidatedScore *= relationshipTypeWeight;

              // Add relationship context boost for being derived from a relevant relationship
              // This provides an additional boost beyond just the source type weight
              relationshipBoost = 0.1; // Base relationship context boost

              // Additional boost for high-priority relationship types
              const highPriorityTypes = [
                "CALLS_FUNCTION",
                "CALLS_METHOD",
                "IMPLEMENTS_INTERFACE",
                "EXTENDS_CLASS",
              ];
              if (highPriorityTypes.includes(relationshipType)) {
                relationshipBoost += 0.05; // Extra boost for high-priority relationships
              }

              consolidatedScore += relationshipBoost;

              this.logger.debug("Applied relationship context scoring", {
                snippetId: snippet.id,
                relationshipType: relationshipType,
                relationshipDirection: snippet.relationshipContext.direction,
                relationshipTypeWeight: relationshipTypeWeight,
                relationshipBoost: relationshipBoost,
                relatedToSeedEntityId:
                  snippet.relationshipContext.relatedToSeedEntityId,
              });
            }

            // Apply recency boost for time-sensitive snippets
            let recencyBoost = 0;
            if (
              snippet.timestamp ||
              snippet.metadata?.timestamp ||
              snippet.metadata?.commitDate
            ) {
              const timestampToUse =
                snippet.timestamp ||
                snippet.metadata?.timestamp ||
                snippet.metadata?.commitDate;
              recencyBoost = calculateRecencyBoost(timestampToUse);
              consolidatedScore += recencyBoost;
            }

            // Ensure consolidated score stays within reasonable bounds (0-2.0 max to account for boosts)
            consolidatedScore = Math.min(2.0, Math.max(0.0, consolidatedScore));

            // Store the consolidated score on the snippet
            snippet.consolidatedScore = consolidatedScore;

            scoreCalculationCount++;

            // Log detailed calculation for a sample of snippets for debugging/tuning
            if (scoreCalculationCount <= 5) {
              this.logger.debug("Detailed score calculation sample", {
                snippetId: snippet.id,
                sourceType: snippet.sourceType,
                initialScore: snippet.initialScore,
                sourceTypeWeight: sourceTypeWeight,
                aiStatus: snippet.aiStatus,
                aiStatusWeight: snippet.aiStatus
                  ? RANKING_FACTOR_WEIGHTS.aiStatus[snippet.aiStatus]
                  : "N/A",
                relationshipTypeWeight: relationshipTypeWeight, // Task 238: Log relationship weight
                relationshipBoost: relationshipBoost, // Task 238: Log relationship boost
                recencyBoost: recencyBoost,
                consolidatedScore: consolidatedScore,
                hasTimestamp: !!(
                  snippet.timestamp ||
                  snippet.metadata?.timestamp ||
                  snippet.metadata?.commitDate
                ),
                hasRelationshipContext: !!snippet.relationshipContext, // Task 238: Log relationship context presence
              });

              // Task 213: Enhanced ranking details in specific format for tuning
              const aiStatusWeightValue = snippet.aiStatus
                ? RANKING_FACTOR_WEIGHTS.aiStatus[snippet.aiStatus] || 1.0
                : 1.0;

              // Task 238: Enhanced logging to include relationship context effects
              if (snippet.relationshipContext) {
                this.logger.debug(
                  `Ranking snippet ${snippet.id} (type: ${snippet.sourceType}): initial=${snippet.initialScore}, sourceWeight=${sourceTypeWeight}, aiStatusWeight=${aiStatusWeightValue}, relationshipTypeWeight=${relationshipTypeWeight}, relationshipBoost=${relationshipBoost}, recencyBoost=${recencyBoost} => consolidated=${consolidatedScore}`
                );
              } else {
                this.logger.debug(
                  `Ranking snippet ${snippet.id} (type: ${snippet.sourceType}): initial=${snippet.initialScore}, sourceWeight=${sourceTypeWeight}, aiStatusWeight=${aiStatusWeightValue}, recencyBoost=${recencyBoost} => consolidated=${consolidatedScore}`
                );
              }
            }
          } catch (snippetError) {
            this.logger.error(
              "Error calculating consolidated score for snippet",
              {
                error: snippetError.message,
                stack: snippetError.stack,
                snippetId: snippet.id,
                sourceType: snippet.sourceType,
                conversationId: conversationId,
              }
            );

            // Set a fallback score to prevent breaking the entire process
            snippet.consolidatedScore = snippet.initialScore || 0;
            scoreCalculationErrors++;
          }
        }

        this.logger.info("Multi-factor score calculation completed", {
          conversationId: conversationId,
          snippetsProcessed: scoreCalculationCount,
          relationshipSnippetsProcessed: relationshipSnippetsProcessed, // Task 238: Log relationship snippet count
          calculationErrors: scoreCalculationErrors,
          successRate:
            scoreCalculationCount > 0
              ? Math.round(
                  ((scoreCalculationCount - scoreCalculationErrors) /
                    scoreCalculationCount) *
                    100
                )
              : 0,
        });

        // Task 241: INFO level logging for ranking stage completion
        this.logger.info(`Retrieval: Ranking complete.`, {
          conversationId: conversationId,
          stage: "ranking_complete",
          snippetsRanked: scoreCalculationCount,
          rankingErrors: scoreCalculationErrors,
        });

        // Calculate score distribution after consolidation for comparison
        const consolidatedScores = candidateSnippets
          .map((s) => s.consolidatedScore)
          .filter((score) => typeof score === "number" && !isNaN(score));

        if (consolidatedScores.length > 0) {
          const sortedScores = [...consolidatedScores].sort((a, b) => a - b);
          const consolidatedStats = {
            count: consolidatedScores.length,
            min: sortedScores[0],
            max: sortedScores[sortedScores.length - 1],
            avg:
              consolidatedScores.reduce((sum, s) => sum + s, 0) /
              consolidatedScores.length,
            median: sortedScores[Math.floor(sortedScores.length / 2)],
          };

          this.logger.debug("Consolidated score distribution", {
            consolidatedStats: consolidatedStats,
            scoreRange: consolidatedStats.max - consolidatedStats.min,
          });
        }
      } catch (error) {
        this.logger.error("Error during multi-factor score calculation", {
          error: error.message,
          stack: error.stack,
          conversationId: conversationId,
          candidateSnippetsCount: candidateSnippets.length,
        });

        // Set fallback consolidated scores to prevent breaking the process
        for (const snippet of candidateSnippets) {
          if (typeof snippet.consolidatedScore !== "number") {
            snippet.consolidatedScore = snippet.initialScore || 0;
          }
        }
      }

      // Step 17: Sort candidate snippets by consolidated score (highest first)
      try {
        this.logger.debug(
          "Starting to sort candidate snippets by consolidated score",
          {
            conversationId: conversationId,
            totalCandidateSnippets: candidateSnippets.length,
          }
        );

        // Sort the candidateSnippets array in descending order by consolidatedScore
        candidateSnippets.sort(
          (a, b) => b.consolidatedScore - a.consolidatedScore
        );

        this.logger.info("Candidate snippets sorted by consolidated score", {
          conversationId: conversationId,
          totalRankedSnippets: candidateSnippets.length,
          topSnippetScore:
            candidateSnippets.length > 0
              ? candidateSnippets[0].consolidatedScore
              : null,
          bottomSnippetScore:
            candidateSnippets.length > 0
              ? candidateSnippets[candidateSnippets.length - 1]
                  .consolidatedScore
              : null,
        });

        // Log top few snippets for debugging/tuning
        if (candidateSnippets.length > 0) {
          const topSnippetsCount = Math.min(5, candidateSnippets.length);
          const topSnippetsSample = candidateSnippets
            .slice(0, topSnippetsCount)
            .map((snippet, index) => ({
              rank: index + 1,
              id: snippet.id,
              sourceType: snippet.sourceType,
              consolidatedScore: snippet.consolidatedScore,
              initialScore: snippet.initialScore,
            }));

          this.logger.debug("Top ranked snippets after sorting", {
            conversationId: conversationId,
            topSnippetsSample: topSnippetsSample,
          });
        }
      } catch (error) {
        this.logger.error("Error during candidate snippets sorting", {
          error: error.message,
          stack: error.stack,
          conversationId: conversationId,
          candidateSnippetsCount: candidateSnippets.length,
        });
        // Continue without sorting if there's an error
      }

      // Analyze score distribution across all candidate snippets for debugging/tuning
      this._analyzeScoreDistribution(candidateSnippets);

      // Log overall candidate snippet statistics including normalization status
      this.logger.info("Candidate snippet collection and analysis completed", {
        conversationId: conversationId,
        totalCandidateSnippets: candidateSnippets.length,
        candidateSnippetsBySource: {
          code_entity_fts: candidateSnippets.filter(
            (s) => s.sourceType === "code_entity_fts"
          ).length,
          code_entity_keyword: candidateSnippets.filter(
            (s) => s.sourceType === "code_entity_keyword"
          ).length,
          project_document_fts: candidateSnippets.filter(
            (s) => s.sourceType === "project_document_fts"
          ).length,
          project_document_keyword: candidateSnippets.filter(
            (s) => s.sourceType === "project_document_keyword"
          ).length,
          conversation_message: candidateSnippets.filter(
            (s) => s.sourceType === "conversation_message"
          ).length,
          conversation_topic: candidateSnippets.filter(
            (s) => s.sourceType === "conversation_topic"
          ).length,
          git_commit: candidateSnippets.filter(
            (s) => s.sourceType === "git_commit"
          ).length,
          git_commit_file_change: candidateSnippets.filter(
            (s) => s.sourceType === "git_commit_file_change"
          ).length,
          relationship_derived: candidateSnippets.filter(
            // New: Track relationship-derived snippets
            (s) => s.sourceType === "relationship_derived"
          ).length,
        },
        normalizationAnalysisComplete: true,
      });

      // Task 222: Apply compression to ranked candidate snippets using CompressionService
      this.logger.info("Starting context compression process", {
        conversationId: conversationId,
        rankedCandidateSnippets: candidateSnippets.length,
        tokenBudget: tokenBudget,
      });

      let compressionResult;
      try {
        // Call CompressionService with the ranked snippets and token budget
        compressionResult = this.compressionService.compressSnippets(
          candidateSnippets,
          tokenBudget
        );

        this.logger.info("Context compression completed successfully", {
          conversationId: conversationId,
          snippetsFoundBeforeCompression:
            compressionResult.summaryStats.snippetsFoundBeforeCompression,
          snippetsReturnedAfterCompression:
            compressionResult.summaryStats.snippetsReturnedAfterCompression,
          estimatedTokensIn: compressionResult.summaryStats.estimatedTokensIn,
          estimatedTokensOut: compressionResult.summaryStats.estimatedTokensOut,
          tokenBudgetGiven: compressionResult.summaryStats.tokenBudgetGiven,
          tokenBudgetRemaining:
            compressionResult.summaryStats.tokenBudgetRemaining,
        });

        // Task 241: INFO level logging for compression stage completion
        this.logger.info(`Retrieval: Compression complete.`, {
          conversationId: conversationId,
          stage: "compression_complete",
          snippetsBeforeCompression:
            compressionResult.summaryStats.snippetsFoundBeforeCompression,
          snippetsAfterCompression:
            compressionResult.summaryStats.snippetsReturnedAfterCompression,
          tokenBudgetUsed:
            compressionResult.summaryStats.tokenBudgetGiven -
            compressionResult.summaryStats.tokenBudgetRemaining,
        });
      } catch (compressionError) {
        this.logger.error("Error during context compression", {
          error: compressionError.message,
          stack: compressionError.stack,
          conversationId: conversationId,
          candidateSnippetsCount: candidateSnippets.length,
          tokenBudget: tokenBudget,
        });

        // Create fallback result if compression fails
        compressionResult = {
          finalSnippets: [],
          summaryStats: {
            snippetsFoundBeforeCompression: candidateSnippets.length,
            snippetsReturnedAfterCompression: 0,
            estimatedTokensIn: 0,
            estimatedTokensOut: 0,
            tokenBudgetGiven: tokenBudget,
            tokenBudgetRemaining: tokenBudget,
            error: compressionError.message,
          },
        };
      }

      // For Story 4.1, return the stub response while storing the hits for future use
      // TODO: In subsequent tasks, these hits will be processed into actual context snippets

      this.logger.info("getRelevantContext processing completed", {
        conversationId: conversationId,
        codeEntityHitsFound: codeEntityHits.length,
        documentHitsFound: documentHits.length,
        keywordMatchedEntitiesFound: keywordMatchedEntities.length,
        codeEntitiesFetched: Object.keys(retrievedCodeEntities).length,
        projectDocumentsFetched: Object.keys(retrievedProjectDocuments).length,
        codeEntityCandidateSnippets: candidateSnippets.filter(
          (s) =>
            s.sourceType === "code_entity_fts" ||
            s.sourceType === "code_entity_keyword"
        ).length,
        projectDocumentCandidateSnippets: candidateSnippets.filter(
          (s) =>
            s.sourceType === "project_document_fts" ||
            s.sourceType === "project_document_keyword"
        ).length,
        totalCandidateSnippets: candidateSnippets.length,
        conversationHistorySnippets: matchedMessages.length,
        conversationTopicsSnippets: matchedTopics.length,
        conversationMessageCandidateSnippets: candidateSnippets.filter(
          (s) => s.sourceType === "conversation_message"
        ).length,
        conversationTopicCandidateSnippets: candidateSnippets.filter(
          (s) => s.sourceType === "conversation_topic"
        ).length,
        gitCommitsFound: matchedGitCommits.length, // New: Git commit search results
        gitCommitFilesFound: matchedCommitFiles.length, // New: Git commit file change search results
        seedEntitiesIdentified: seedEntities.length, // New: Seed entities for relationship expansion
        relationshipDerivedSnippets: candidateSnippets.filter(
          // New: Relationship-derived snippets
          (s) => s.sourceType === "relationship_derived"
        ).length,
        finalContextSnippets: compressionResult.finalSnippets.length, // New: Final compressed snippets
        // Will be expanded with snippet processing in subsequent tasks
      });

      return {
        contextSnippets: compressionResult.finalSnippets,
        retrievalSummary: compressionResult.summaryStats,
        // processedOk is handled by the handler based on whether this throws
      };
    } catch (error) {
      this.logger.error("Error in getRelevantContext", {
        error: error.message,
        stack: error.stack,
        query: query,
        conversationId: conversationId,
      });

      // Re-throw the error to let the handler deal with it
      throw error;
    }
  }

  /**
   * Private helper method to tokenize and normalize a query string for FTS and keyword searches
   * @param {string} queryString - The raw query string from the agent
   * @returns {string[]} Array of processed search terms
   * @private
   */
  _getSearchTerms(queryString) {
    if (!queryString || typeof queryString !== "string") {
      return [];
    }

    // Convert to lowercase
    const lowerQuery = queryString.toLowerCase();

    // Define common English stop words to filter out
    const stopWords = new Set([
      "the",
      "is",
      "a",
      "an",
      "to",
      "of",
      "for",
      "and",
      "or",
      "but",
      "in",
      "on",
      "at",
      "with",
      "by",
      "from",
      "as",
      "be",
      "are",
      "was",
      "were",
      "been",
      "have",
      "has",
      "had",
      "do",
      "does",
      "did",
      "will",
      "would",
      "could",
      "should",
      "may",
      "might",
      "can",
      "this",
      "that",
      "these",
      "those",
      "i",
      "you",
      "he",
      "she",
      "it",
      "we",
      "they",
      "me",
      "him",
      "her",
      "us",
      "them",
      "my",
      "your",
      "his",
      "her",
      "its",
      "our",
      "their",
    ]);

    // Define significant short terms that should NOT be filtered out
    const significantShortTerms = new Set([
      "go",
      "js",
      "ts",
      "py",
      "c#",
      "cs",
      "cc",
      "c++",
      "sql",
      "xml",
      "css",
      "dom",
      "api",
      "url",
      "uri",
      "id",
      "ui",
      "ux",
      "ai",
      "ml",
      "db",
      "os",
      "io",
      "if",
      "or",
      "and",
      "not",
    ]);

    // Split by spaces and common punctuation, keeping alphanumeric sequences
    // This regex splits on whitespace and punctuation but preserves alphanumeric characters, underscores, and hyphens
    const tokens = lowerQuery
      .split(/[\s\.,\(\)\{\}\[\]:;!@#$%^&*+=<>?/\\|"'`~]+/)
      .filter((token) => token.length > 0); // Remove empty strings

    // Filter tokens based on criteria
    const processedTerms = tokens.filter((token) => {
      // Keep significant short terms regardless of length
      if (significantShortTerms.has(token)) {
        return true;
      }

      // Filter out stop words
      if (stopWords.has(token)) {
        return false;
      }

      // Filter out very short tokens (less than 2 characters)
      // unless they are significant programming-related terms
      if (token.length < 2) {
        return false;
      }

      return true;
    });

    return processedTerms;
  }

  // ===========================================
  // GIT HISTORY HEURISTICS
  // ===========================================

  /**
   * Analyzes the input query for terms or patterns that strongly suggest Git history relevance
   * Used to determine whether to prioritize or gate Git searches in context retrieval
   * @param {string} queryString - Original query string
   * @param {Array<string>} searchTerms - Tokenized search terms
   * @returns {boolean} True if Git-related terms/patterns are found, false otherwise
   */
  _isGitHistoryQuery(queryString, searchTerms) {
    try {
      this.logger.debug("Analyzing query for Git history relevance", {
        queryString: queryString,
        searchTermsCount: searchTerms?.length || 0,
        searchTerms: searchTerms,
      });

      // Ensure we have valid inputs
      if (!queryString || typeof queryString !== "string") {
        this.logger.debug("Invalid query string provided", {
          queryString: queryString,
          type: typeof queryString,
        });
        return false;
      }

      if (!searchTerms || !Array.isArray(searchTerms)) {
        this.logger.debug("Invalid search terms provided", {
          searchTerms: searchTerms,
          isArray: Array.isArray(searchTerms),
        });
        return false;
      }

      const lowerQuery = queryString.toLowerCase();

      // Git-related keywords to check for
      const gitKeywords = [
        "commit",
        "commits",
        "history",
        "change",
        "changes",
        "changed",
        "log",
        "logs",
        "author",
        "authors",
        "blame",
        "version",
        "versions",
        "branch",
        "branches",
        "merge",
        "merged",
        "diff",
        "diffs",
        "revision",
        "revisions",
        "checkout",
        "pull",
        "push",
        "repository",
        "repo",
      ];

      // Check for Git keywords in the original query
      let hasGitKeywords = false;
      for (const keyword of gitKeywords) {
        if (lowerQuery.includes(keyword)) {
          hasGitKeywords = true;
          this.logger.debug("Found Git keyword in query", {
            keyword: keyword,
            queryString: queryString,
          });
          break;
        }
      }

      // Check if any search terms look like file paths
      // File paths typically contain forward slashes or have common file extensions
      const fileExtensions = [
        ".js",
        ".ts",
        ".jsx",
        ".tsx",
        ".py",
        ".java",
        ".cpp",
        ".c",
        ".h",
        ".cs",
        ".php",
        ".rb",
        ".go",
        ".rs",
        ".swift",
        ".kt",
        ".scala",
        ".clj",
        ".ml",
        ".hs",
        ".elm",
        ".dart",
        ".vue",
        ".svelte",
        ".html",
        ".css",
        ".scss",
        ".sass",
        ".less",
        ".json",
        ".xml",
        ".yaml",
        ".yml",
        ".toml",
        ".ini",
        ".cfg",
        ".conf",
        ".md",
        ".txt",
        ".sql",
      ];

      let hasFilePaths = false;
      for (const term of searchTerms) {
        // Check if term contains forward slash (path separator)
        if (term.includes("/")) {
          hasFilePaths = true;
          this.logger.debug("Found file path pattern in search terms", {
            term: term,
            pattern: "contains forward slash",
          });
          break;
        }

        // Check if term ends with common file extension
        for (const extension of fileExtensions) {
          if (term.toLowerCase().endsWith(extension)) {
            hasFilePaths = true;
            this.logger.debug("Found file extension pattern in search terms", {
              term: term,
              extension: extension,
            });
            break;
          }
        }

        if (hasFilePaths) break;
      }

      // Check for patterns resembling commit hashes (7+ hex characters)
      const commitHashPattern = /\b[a-f0-9]{7,}\b/i;
      let hasCommitHashes = false;

      // Check in original query
      if (commitHashPattern.test(lowerQuery)) {
        hasCommitHashes = true;
        this.logger.debug("Found commit hash pattern in query", {
          queryString: queryString,
          pattern: "7+ hex characters",
        });
      }

      // Check in search terms
      if (!hasCommitHashes) {
        for (const term of searchTerms) {
          if (commitHashPattern.test(term)) {
            hasCommitHashes = true;
            this.logger.debug("Found commit hash pattern in search terms", {
              term: term,
              pattern: "7+ hex characters",
            });
            break;
          }
        }
      }

      // Determine if query suggests Git history relevance
      const isGitHistoryRelevant =
        hasGitKeywords || hasFilePaths || hasCommitHashes;

      this.logger.debug("Git history relevance analysis completed", {
        queryString: queryString,
        searchTermsCount: searchTerms.length,
        hasGitKeywords: hasGitKeywords,
        hasFilePaths: hasFilePaths,
        hasCommitHashes: hasCommitHashes,
        isGitHistoryRelevant: isGitHistoryRelevant,
      });

      return isGitHistoryRelevant;
    } catch (error) {
      this.logger.error("Error analyzing query for Git history relevance", {
        error: error.message,
        stack: error.stack,
        queryString: queryString,
        searchTermsCount: searchTerms?.length || 0,
      });

      // Return false on error to be safe
      return false;
    }
  }

  // ===========================================
  // SCORE NORMALIZATION
  // ===========================================

  /**
   * Analyzes and optionally normalizes initial scores from different sources to ensure comparability
   * Currently, all scoring functions are designed to return 0-1 range, but this provides
   * centralized score analysis and potential future normalization if needed
   * @param {number} score - The initial score to analyze/normalize
   * @param {string} sourceType - The source type of the snippet (e.g., 'code_entity_fts', 'conversation_message')
   * @param {Object} scoreProperties - Additional properties about the score calculation (e.g., rank, matchCount)
   * @returns {number} Normalized score in 0-1 range
   * @private
   */
  _normalizeScore(score, sourceType, scoreProperties = {}) {
    try {
      // Validate input score
      if (typeof score !== "number" || isNaN(score)) {
        this.logger.debug("Invalid score provided for normalization", {
          score: score,
          sourceType: sourceType,
          scoreProperties: scoreProperties,
        });
        return 0.0; // Return minimum score for invalid input
      }

      // Current analysis: All scoring functions are designed to return 0-1 range
      // FTS: calculateScoreFromFtsRank uses logarithmic scale, returns 0-1
      // Keyword: calculateScoreFromKeywordMatches normalizes to 0-1
      // Conversation: calculateScoreForMessage/Topic ensures 0-1 range
      // Git: calculateScoreForGitCommit/FileChange ensures 0-1 range

      // Since all sources already normalize to 0-1, we primarily validate and log
      let normalizedScore = Math.min(1.0, Math.max(0.0, score));

      // Log score distribution for analysis and tuning
      this.logger.debug("Score normalization analysis", {
        sourceType: sourceType,
        originalScore: score,
        normalizedScore: normalizedScore,
        scoreProperties: scoreProperties,
        wasNormalizationNeeded: score !== normalizedScore,
      });

      // Future enhancement: If different sources show vastly different effective ranges,
      // source-specific normalization could be implemented here:
      /*
      switch (sourceType) {
        case 'code_entity_fts':
          // FTS scores based on rank - currently well normalized
          break;
        case 'code_entity_keyword':
          // Keyword scores based on weight/count - currently well normalized
          break;
        case 'conversation_message':
          // Message scores with recency/relevance - currently well normalized
          break;
        case 'git_commit':
          // Git commit scores with recency/relevance - currently well normalized
          break;
        // Add other cases as needed
      }
      */

      return normalizedScore;
    } catch (error) {
      this.logger.error("Error during score normalization", {
        error: error.message,
        stack: error.stack,
        score: score,
        sourceType: sourceType,
        scoreProperties: scoreProperties,
      });
      // Return a safe default score on error
      return 0.0;
    }
  }

  /**
   * Analyzes score distribution across all candidate snippets for debugging and tuning
   * @param {Array<Object>} candidateSnippets - Array of candidate snippet objects
   * @private
   */
  _analyzeScoreDistribution(candidateSnippets) {
    if (!candidateSnippets || candidateSnippets.length === 0) {
      return;
    }

    try {
      // Group scores by source type for analysis
      const scoresBySource = {};
      let allScores = [];

      for (const snippet of candidateSnippets) {
        const sourceType = snippet.sourceType;
        const score = snippet.initialScore;

        if (typeof score === "number" && !isNaN(score)) {
          if (!scoresBySource[sourceType]) {
            scoresBySource[sourceType] = [];
          }
          scoresBySource[sourceType].push(score);
          allScores.push(score);
        }
      }

      // Calculate distribution statistics
      const calculateStats = (scores) => {
        if (scores.length === 0) return null;

        const sorted = [...scores].sort((a, b) => a - b);
        return {
          count: scores.length,
          min: sorted[0],
          max: sorted[sorted.length - 1],
          avg: scores.reduce((sum, s) => sum + s, 0) / scores.length,
          median: sorted[Math.floor(sorted.length / 2)],
        };
      };

      // Log overall distribution
      const overallStats = calculateStats(allScores);
      this.logger.debug("Overall score distribution analysis", {
        totalSnippets: candidateSnippets.length,
        scoredSnippets: allScores.length,
        stats: overallStats,
      });

      // Log per-source distribution
      for (const [sourceType, scores] of Object.entries(scoresBySource)) {
        const sourceStats = calculateStats(scores);
        this.logger.debug(`Score distribution for ${sourceType}`, {
          sourceType: sourceType,
          stats: sourceStats,
        });
      }

      // Log potential normalization concerns
      if (overallStats && overallStats.max - overallStats.min > 0.8) {
        this.logger.debug(
          "Wide score range detected - normalization effectiveness confirmed",
          {
            scoreRange: overallStats.max - overallStats.min,
            minScore: overallStats.min,
            maxScore: overallStats.max,
          }
        );
      }
    } catch (error) {
      this.logger.error("Error during score distribution analysis", {
        error: error.message,
        stack: error.stack,
        candidateSnippetsCount: candidateSnippets.length,
      });
    }
  }

  // ===========================================
  // TODO SECTIONS FOR FUTURE IMPLEMENTATION
  // ===========================================

  /**
   * TODO: Implement recent development activity context retrieval
   * Will support Story 3.3: Recent development activity context
   *
   * Methods to be implemented:
   * - getRecentCommits()
   * - getRecentFileChanges()
   * - getRecentConversations()
   */

  /**
   * TODO: Implement relevant conversation history retrieval
   * Will support Story 3.4: Relevant conversation history context
   *
   * Methods to be implemented:
   * - getRelevantConversations()
   * - searchConversationsByQuery()
   * - getConversationsByTopic()
   */

  /**
   * TODO: Implement smart entity and document recommendations
   * Will support Story 3.5: Smart entity and document recommendations
   *
   * Methods to be implemented:
   * - getRecommendedEntities()
   * - getRecommendedDocuments()
   * - getSemanticMatches()
   */

  /**
   * TODO: Implement comprehensive context assembly
   * Will support assembling all context components into structured response
   *
   * Methods to be implemented:
   * - assembleComprehensiveContext()
   * - prioritizeContextComponents()
   * - enforceTokenLimits()
   */

  // ===========================================
  // SCORE NORMALIZATION
  // ===========================================

  /**
   * Calculates a recency boost score based on the age of an item
   * More recent items receive higher boosts, with exponential decay over time
   * @param {string|Date} itemTimestampStringOrDate - Timestamp from git commits, conversation messages, etc.
   * @returns {Promise<number>} Recency boost value (additive to consolidated score)
   * @private
   */
  async _calculateRecencyBoost(itemTimestampStringOrDate) {
    try {
      // Return 0 if no timestamp provided
      if (!itemTimestampStringOrDate) {
        this.logger.debug("No timestamp provided for recency calculation");
        return 0;
      }

      // Convert input to Date object if it's a string
      let itemDate;
      if (typeof itemTimestampStringOrDate === "string") {
        itemDate = new Date(itemTimestampStringOrDate);
      } else if (itemTimestampStringOrDate instanceof Date) {
        itemDate = itemTimestampStringOrDate;
      } else {
        this.logger.debug("Invalid timestamp type for recency calculation", {
          timestamp: itemTimestampStringOrDate,
          type: typeof itemTimestampStringOrDate,
        });
        return 0;
      }

      // Validate the parsed date
      if (isNaN(itemDate.getTime())) {
        this.logger.debug("Invalid date for recency calculation", {
          timestamp: itemTimestampStringOrDate,
          parsedDate: itemDate,
        });
        return 0;
      }

      // Calculate age of the item
      const now = new Date();
      const ageInMillis = now.getTime() - itemDate.getTime();
      const ageInHours = ageInMillis / (1000 * 60 * 60);

      // Get recency configuration from ranking factor weights
      let maxBoost = 0.2;
      let decayRateHours = 24;
      let minAgeForDecay = 1;
      let maxAgeForBoost = 168; // 1 week

      try {
        // Import configuration dynamically to avoid circular dependencies
        const { RANKING_FACTOR_WEIGHTS } = await import("../config.js");
        if (RANKING_FACTOR_WEIGHTS.recency) {
          maxBoost = RANKING_FACTOR_WEIGHTS.recency.maxBoost || maxBoost;
          decayRateHours =
            RANKING_FACTOR_WEIGHTS.recency.decayRateHours || decayRateHours;
          minAgeForDecay =
            RANKING_FACTOR_WEIGHTS.recency.minAgeForDecay || minAgeForDecay;
          maxAgeForBoost =
            RANKING_FACTOR_WEIGHTS.recency.maxAgeForBoost || maxAgeForBoost;
        }
      } catch (configError) {
        this.logger.debug(
          "Could not load recency configuration, using defaults",
          {
            error: configError.message,
          }
        );
        // Continue with default values
      }

      // Calculate recency boost based on age
      let recencyBoost = 0;

      // No boost if item is too old
      if (ageInHours > maxAgeForBoost) {
        recencyBoost = 0;
      }
      // Maximum boost if item is very recent
      else if (ageInHours <= minAgeForDecay) {
        recencyBoost = maxBoost;
      }
      // Exponential decay for items between minAgeForDecay and maxAgeForBoost
      else {
        const decayFactor = Math.exp(-ageInHours / decayRateHours);
        recencyBoost = maxBoost * decayFactor;
      }

      this.logger.debug("Recency boost calculated", {
        timestamp: itemTimestampStringOrDate,
        ageInHours: ageInHours,
        recencyBoost: recencyBoost,
        maxBoost: maxBoost,
        decayRateHours: decayRateHours,
      });

      return recencyBoost;
    } catch (error) {
      this.logger.error("Error calculating recency boost", {
        error: error.message,
        stack: error.stack,
        timestamp: itemTimestampStringOrDate,
      });
      // Return 0 boost on error to avoid breaking the scoring process
      return 0;
    }
  }

}

export default RetrievalService;
