/**
 * SmartSearchServiceLogic.js
 *
 * Provides advanced search capabilities for code entities using a combination
 * of Full-Text Search (FTS) and keyword-based matching.
 */

import { executeQuery } from "../db.js";
import { tokenize, extractKeywords, stem } from "./TextTokenizerLogic.js";

/**
 * @typedef {Object} SearchOptions
 * @property {string[]} [entityTypes] - Types of entities to search (e.g., 'file', 'function', 'class')
 * @property {string[]} [filePaths] - File paths to limit the search to
 * @property {Object} [dateRange] - Date range to filter by last modified date
 * @property {Date} [dateRange.start] - Start date of range
 * @property {Date} [dateRange.end] - End date of range
 * @property {string} [sortBy] - Field to sort results by
 * @property {number} [limit] - Maximum number of results to return
 * @property {number} [minRelevance] - Minimum relevance score for results
 * @property {string} [strategy] - Search strategy to use ('fts', 'keywords', 'combined')
 * @property {string} [booleanOperator] - Boolean operator for keyword combination
 * @property {boolean} [useExactMatch] - Whether to use exact phrase matching
 * @property {boolean} [useProximity] - Whether to use proximity search
 * @property {number} [proximityDistance] - Distance for proximity search
 */

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
 * @property {string} [created_at] - Creation timestamp
 * @property {string} [last_modified_at] - Last modification timestamp
 */

/**
 * @typedef {Object} SearchResult
 * @property {CodeEntity} entity - The found code entity
 * @property {number} relevanceScore - Relevance score for the search result
 */

/**
 * Searches code entities by keywords using Full-Text Search and/or entity_keywords table
 *
 * @param {string[]} keywords - Keywords to search for
 * @param {SearchOptions} [options={}] - Search options including:
 *   - entityTypes: Types of entities to search
 *   - filePaths: File paths with glob pattern support
 *   - dateRange: Date range to filter by
 *   - sortBy: Field to sort by
 *   - limit: Max results
 *   - minRelevance: Minimum relevance score
 *   - strategy: Search strategy ('fts', 'keywords', 'combined')
 *   - booleanOperator: 'AND' or 'OR' for keyword combination
 *   - useExactMatch: Whether to use exact phrase matching
 *   - useProximity: Whether to use proximity search
 *   - proximityDistance: Distance for proximity search
 * @returns {Promise<SearchResult[]>} Array of search results
 */
export async function searchByKeywords(keywords, options = {}) {
  try {
    // Validate and normalize input
    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      throw new Error("Keywords array is required and cannot be empty");
    }

    // Handle single string input with boolean operators
    if (
      keywords.length === 1 &&
      /\s+(AND|OR|NOT|NEAR\/\d+)\s+/i.test(keywords[0])
    ) {
      // Keep as is - will be processed by searchUsingFTS
    } else {
      // Process and clean keywords
      keywords = keywords.map((kw) => kw.trim()).filter((kw) => kw.length > 0);
    }

    // Set default options
    options = {
      strategy: "combined", // Default to combined search
      booleanOperator: "OR", // Default to OR for broader matches
      limit: 100, // Default result limit
      ...options,
    };

    // Prepare results array
    let searchResults = [];

    // If strategy is 'fts' or 'combined', perform FTS search
    if (options.strategy === "fts" || options.strategy === "combined") {
      const ftsResults = await searchUsingFTS(keywords, options);
      searchResults = [...ftsResults];
    }

    // If strategy is 'keywords' or 'combined', or if FTS returned no results, perform keyword-based search
    if (
      options.strategy === "keywords" ||
      options.strategy === "combined" ||
      (options.strategy === "fts" && searchResults.length === 0)
    ) {
      const keywordResults = await searchUsingKeywords(keywords, options);

      if (options.strategy === "combined" && searchResults.length > 0) {
        // Merge and deduplicate results
        searchResults = mergeSearchResults(searchResults, keywordResults);
      } else {
        searchResults = keywordResults;
      }
    }

    // Apply minimum relevance filter if specified
    if (options.minRelevance) {
      searchResults = searchResults.filter(
        (result) => result.relevanceScore >= options.minRelevance
      );
    }

    // Apply result limit if not already applied in search functions
    if (options.limit && searchResults.length > options.limit) {
      searchResults = searchResults.slice(0, options.limit);
    }

    // Return the search results
    return searchResults;
  } catch (error) {
    console.error("Error in searchByKeywords:", error);
    throw error;
  }
}

/**
 * Searches code entities using Full-Text Search
 *
 * @param {string[]} keywords - Keywords to search for
 * @param {SearchOptions} options - Search options
 * @returns {Promise<SearchResult[]>} Search results
 */
async function searchUsingFTS(keywords, options) {
  try {
    // Process keywords for FTS5 query
    const processedKeywords = keywords.map((keyword) => {
      // Apply stemming to match the behavior used when indexing content
      const stemmed = stem(keyword.toLowerCase());

      // Sanitize special characters and escape quotes for FTS
      // Note: SQLite FTS5 has special handling for " and other special characters
      const sanitized = stemmed.replace(
        /[\\"\(\)\[\]\{\}\^\$\+\*\?\.]/g,
        (char) => `\\${char}`
      );

      return sanitized;
    });

    // Determine boolean operator based on options or use default
    // Default to OR for broader results, use AND for more specific matching
    const booleanOperator =
      options.booleanOperator?.toUpperCase() === "AND" ? "AND" : "OR";

    // Construct the FTS query
    let ftsQuery;

    if (options.useExactMatch) {
      // For exact phrase matching, wrap the entire phrase in quotes
      ftsQuery = `"${processedKeywords.join(" ")}"`;
    } else if (options.useProximity && processedKeywords.length > 1) {
      // For proximity search, use NEAR operator with optional distance
      const distance = options.proximityDistance || 10;
      ftsQuery = `${processedKeywords.join(` NEAR/${distance} `)}`;
    } else {
      // Standard boolean search
      ftsQuery = processedKeywords.join(` ${booleanOperator} `);
    }

    // Check if the user provided explicit boolean syntax like "library AND file OR module"
    // If so, respect their input instead of our processing
    if (
      keywords.length === 1 &&
      /\s+(AND|OR|NOT|NEAR\/\d+)\s+/i.test(keywords[0])
    ) {
      ftsQuery = keywords[0];
    }

    // Start building the SQL query
    let sql = `
      SELECT
        e.*,
        fts.rank as relevance_score
      FROM
        code_entities_fts fts
      JOIN
        code_entities e ON fts.rowid = e.rowid
      WHERE
        fts.code_entities_fts MATCH ?
    `;

    // Array to hold query parameters
    const queryParams = [ftsQuery];

    // Apply filters from options
    if (options.entityTypes && options.entityTypes.length > 0) {
      const placeholders = options.entityTypes.map(() => "?").join(", ");
      sql += ` AND e.entity_type IN (${placeholders})`;
      queryParams.push(...options.entityTypes);
    }

    // Apply file path filters with proper wildcard handling
    if (options.filePaths && options.filePaths.length > 0) {
      sql += " AND (";

      const filePathConditions = [];

      for (const pathPattern of options.filePaths) {
        // Handle glob patterns by converting to SQL LIKE patterns
        let sqlPattern = pathPattern
          .replace(/\*/g, "%") // Convert * to %
          .replace(/\?/g, "_"); // Convert ? to _

        // Handle **/ pattern (recursive directory matching)
        sqlPattern = sqlPattern.replace(/%\/%/g, "%");

        filePathConditions.push("e.file_path LIKE ?");
        queryParams.push(sqlPattern);
      }

      sql += filePathConditions.join(" OR ");
      sql += ")";
    }

    // Apply date range filter
    if (options.dateRange) {
      if (options.dateRange.start) {
        sql += " AND e.last_modified_at >= ?";
        queryParams.push(options.dateRange.start.toISOString());
      }

      if (options.dateRange.end) {
        sql += " AND e.last_modified_at <= ?";
        queryParams.push(options.dateRange.end.toISOString());
      }
    }

    // Apply custom ranking if available, otherwise use default FTS rank
    if (options.customRanking) {
      sql += ` ORDER BY ${options.customRanking}`;
    } else {
      // Enhance default ranking with optional boosts
      sql += `
        ORDER BY 
          relevance_score * 
          CASE 
            WHEN e.entity_type = 'file' THEN 1.2
            WHEN e.entity_type = 'class' THEN 1.1
            WHEN e.entity_type = 'function' THEN 1.0
            ELSE 0.9
          END DESC
      `;
    }

    // Apply limit with reasonable default
    const limit = options.limit && options.limit > 0 ? options.limit : 100;
    sql += " LIMIT ?";
    queryParams.push(limit);

    // Execute the query
    const results = await executeQuery(sql, queryParams);

    // Map results to SearchResult objects
    return mapToSearchResults(results);
  } catch (error) {
    console.error("Error in searchUsingFTS:", error);
    throw error;
  }
}

/**
 * Searches code entities using the entity_keywords table
 *
 * @param {string[]} keywords - Keywords to search for
 * @param {SearchOptions} options - Search options
 * @returns {Promise<SearchResult[]>} Search results
 */
async function searchUsingKeywords(keywords, options) {
  try {
    // Handle single string input with boolean operators by splitting into individual terms
    let processedKeywords;
    if (keywords.length === 1 && /\s+(AND|OR|NOT)\s+/i.test(keywords[0])) {
      // Split the complex query string into individual terms, ignoring operators
      processedKeywords = keywords[0]
        .split(/\s+(?:AND|OR|NOT)\s+/i)
        .map((term) => term.trim())
        .filter((term) => term.length > 0);
    } else {
      processedKeywords = keywords;
    }

    // Stem the keywords for more effective matching with the entity_keywords table
    const stemmedKeywords = processedKeywords.map((keyword) =>
      stem(keyword.toLowerCase())
    );

    // Use prepared statement with placeholders for security
    let sql = `
      SELECT 
        e.*,
        SUM(ek.weight * (1.0 + (0.1 * count_matches))) as relevance_score
      FROM (
        SELECT 
          entity_id, 
          COUNT(DISTINCT keyword) as count_matches,
          MAX(weight) as weight
        FROM 
          entity_keywords
        WHERE 
          keyword IN (${stemmedKeywords.map(() => "?").join(",")})
        GROUP BY 
          entity_id
      ) as ek
      JOIN 
        code_entities e ON ek.entity_id = e.entity_id
    `;

    // Array to hold query parameters
    const queryParams = [...stemmedKeywords];

    // Apply filters using our updated filter function
    sql = applyFilters(sql, options, queryParams);

    // Apply ranking with type-based boosts similar to searchUsingFTS
    if (options.sortBy) {
      sql += ` ORDER BY e.${options.sortBy}`;
    } else {
      // Provide entity-type-based boosting along with the keyword match score
      sql += `
        ORDER BY 
          relevance_score * 
          CASE 
            WHEN e.entity_type = 'file' THEN 1.2
            WHEN e.entity_type = 'class' THEN 1.1
            WHEN e.entity_type = 'function' THEN 1.0
            ELSE 0.9
          END DESC
      `;
    }

    // Apply limit with reasonable default
    const limit = options.limit && options.limit > 0 ? options.limit : 100;
    sql += " LIMIT ?";
    queryParams.push(limit);

    // Execute the query
    const results = await executeQuery(sql, queryParams);

    // Map results to SearchResult objects
    return mapToSearchResults(results);
  } catch (error) {
    console.error("Error in searchUsingKeywords:", error);
    throw error;
  }
}

/**
 * Apply filters from search options to SQL query
 * Note: This function is mainly used by searchUsingKeywords.
 * The searchUsingFTS function now applies filters directly for better query construction.
 *
 * @param {string} sql - SQL query to enhance
 * @param {SearchOptions} options - Search options
 * @param {Array} queryParams - Query parameters array to append to
 * @returns {string} Enhanced SQL query with filters
 */
function applyFilters(sql, options, queryParams) {
  // The provided SQL should already have a WHERE clause, so we'll use AND

  // Apply entity type filters
  if (options.entityTypes && options.entityTypes.length > 0) {
    const placeholders = options.entityTypes.map(() => "?").join(", ");
    sql += ` AND e.entity_type IN (${placeholders})`;
    queryParams.push(...options.entityTypes);
  }

  // Apply file path filters with proper glob pattern support
  if (options.filePaths && options.filePaths.length > 0) {
    sql += " AND (";

    const filePathConditions = [];

    for (const pathPattern of options.filePaths) {
      // Handle glob patterns by converting to SQL LIKE patterns
      let sqlPattern = pathPattern
        .replace(/\*/g, "%") // Convert * to %
        .replace(/\?/g, "_"); // Convert ? to _

      // Handle **/ pattern (recursive directory matching)
      sqlPattern = sqlPattern.replace(/%\/%/g, "%");

      filePathConditions.push("e.file_path LIKE ?");
      queryParams.push(sqlPattern);
    }

    sql += filePathConditions.join(" OR ");
    sql += ")";
  }

  // Apply date range filter
  if (options.dateRange) {
    if (options.dateRange.start) {
      sql += " AND e.last_modified_at >= ?";
      queryParams.push(options.dateRange.start.toISOString());
    }

    if (options.dateRange.end) {
      sql += " AND e.last_modified_at <= ?";
      queryParams.push(options.dateRange.end.toISOString());
    }
  }

  return sql;
}

/**
 * Map database results to SearchResult objects
 *
 * @param {Array} results - Database query results
 * @returns {Array<SearchResult>} Mapped search results
 */
function mapToSearchResults(results) {
  // Check if results has a rows property and it's an array
  const rows =
    results && results.rows && Array.isArray(results.rows)
      ? results.rows
      : Array.isArray(results)
      ? results
      : [];

  // If no valid results, return empty array
  if (rows.length === 0) {
    console.warn("No valid search results found to map");
    return [];
  }

  return rows.map((row) => ({
    entity: {
      entity_id: row.entity_id,
      file_path: row.file_path,
      entity_type: row.entity_type,
      name: row.name,
      parent_entity_id: row.parent_entity_id,
      content_hash: row.content_hash,
      raw_content: row.raw_content,
      start_line: row.start_line,
      end_line: row.end_line,
      language: row.language,
      created_at: row.created_at,
      last_modified_at: row.last_modified_at,
    },
    relevanceScore: row.relevance_score,
  }));
}

/**
 * Merge and deduplicate search results from multiple sources
 *
 * @param {Array<SearchResult>} resultsA - First set of search results
 * @param {Array<SearchResult>} resultsB - Second set of search results
 * @returns {Array<SearchResult>} Merged and deduplicated results
 */
function mergeSearchResults(resultsA, resultsB) {
  // Create a map to deduplicate by entity_id
  const entityMap = new Map();

  // Process the first result set (higher priority)
  for (const result of resultsA) {
    entityMap.set(result.entity.entity_id, result);
  }

  // Process the second result set, only adding entities not already present
  // or combining scores if the entity already exists
  for (const result of resultsB) {
    const entityId = result.entity.entity_id;

    if (entityMap.has(entityId)) {
      // Entity already exists, update relevance score
      // Using a weighted average here, favoring FTS results
      const existingResult = entityMap.get(entityId);
      const combinedScore =
        existingResult.relevanceScore * 0.7 + result.relevanceScore * 0.3;

      entityMap.set(entityId, {
        ...existingResult,
        relevanceScore: combinedScore,
      });
    } else {
      // New entity, add to results
      entityMap.set(entityId, result);
    }
  }

  // Convert map back to array and sort by relevance score
  return Array.from(entityMap.values()).sort(
    (a, b) => b.relevanceScore - a.relevanceScore
  );
}

/**
 * Calculate a custom relevance score for an entity based on non-vector factors
 *
 * @param {CodeEntity} entity - The code entity to score
 * @param {string[]} queryKeywords - Keywords from the search query
 * @param {string[]} [focusKeywords=[]] - Keywords representing the current focus area
 * @returns {number} A relevance score between 0 and 1
 */
export function nonVectorRelevanceScore(
  entity,
  queryKeywords,
  focusKeywords = []
) {
  // Ensure we have valid inputs
  if (!entity || !queryKeywords || queryKeywords.length === 0) {
    return 0;
  }

  // Initialize base score
  let score = 0.5;

  // Prepare keywords by stemming
  const stemmedQueryKeywords = queryKeywords.map((kw) =>
    stem(kw.toLowerCase())
  );
  const stemmedFocusKeywords = focusKeywords.map((kw) =>
    stem(kw.toLowerCase())
  );

  // 1. Keyword Matching Score
  const keywordMatchScore = calculateKeywordMatchScore(
    entity,
    stemmedQueryKeywords
  );

  // 2. Focus Area Boost
  const focusBoost = calculateFocusAreaBoost(entity, stemmedFocusKeywords);

  // 3. Recency Factor
  const recencyFactor = calculateRecencyFactor(entity);

  // 4. Importance Score Factor
  const importanceFactor =
    entity.importance_score !== undefined ? entity.importance_score : 0.5;

  // 5. Type-Based Weighting
  const typeWeight = calculateTypeWeight(entity);

  // 6. Hierarchical Proximity (simplified first pass)
  const hierarchyBoost = 1.0; // Default value for now, can be enhanced later

  // Combine all factors with appropriate weights
  score =
    (keywordMatchScore * 0.35 + // 35% weight for keyword matching
      focusBoost * 0.2 + // 20% weight for focus area boost
      recencyFactor * 0.15 + // 15% weight for recency
      importanceFactor * 0.2 + // 20% weight for importance
      typeWeight * 0.1) * // 10% weight for entity type
    hierarchyBoost; // Apply hierarchy boost as a multiplier

  // Ensure score is between 0 and 1
  return Math.max(0, Math.min(1, score));
}

/**
 * Calculate keyword matching score based on entity content and query keywords
 *
 * @param {CodeEntity} entity - The code entity
 * @param {string[]} stemmedQueryKeywords - Stemmed query keywords
 * @returns {number} Keyword match score between 0 and 1
 */
function calculateKeywordMatchScore(entity, stemmedQueryKeywords) {
  // Extract meaningful tokens from entity name and content
  const nameTokens = tokenize(entity.name || "").map((token) =>
    stem(token.toLowerCase())
  );

  // Use summary if available, otherwise use raw_content
  const contentText = entity.summary || entity.raw_content || "";
  const contentTokens = tokenize(contentText).map((token) =>
    stem(token.toLowerCase())
  );

  // Combine unique tokens
  const entityTokens = Array.from(new Set([...nameTokens, ...contentTokens]));

  if (entityTokens.length === 0) return 0;

  // Calculate matches
  let nameMatches = 0;
  let contentMatches = 0;

  for (const queryKw of stemmedQueryKeywords) {
    // Check for matches in name (higher importance)
    if (nameTokens.includes(queryKw)) {
      nameMatches++;
    }
    // Check for matches in content
    else if (contentTokens.includes(queryKw)) {
      contentMatches++;
    }
  }

  // Calculate Jaccard index for overall similarity
  const matchingTokens = stemmedQueryKeywords.filter((kw) =>
    entityTokens.includes(kw)
  ).length;

  const jaccardIndex =
    matchingTokens /
    (entityTokens.length + stemmedQueryKeywords.length - matchingTokens);

  // Calculate final keyword score with boosted name matches
  const nameMatchScore = (nameMatches / stemmedQueryKeywords.length) * 1.5; // 50% boost for name matches
  const contentMatchScore = contentMatches / stemmedQueryKeywords.length;
  const overallMatchScore = jaccardIndex * 0.5; // Base similarity

  return Math.min(1.0, nameMatchScore + contentMatchScore + overallMatchScore);
}

/**
 * Calculate focus area boost based on overlap with focus keywords
 *
 * @param {CodeEntity} entity - The code entity
 * @param {string[]} stemmedFocusKeywords - Stemmed focus area keywords
 * @returns {number} Focus area boost between 0 and 1
 */
function calculateFocusAreaBoost(entity, stemmedFocusKeywords) {
  if (!stemmedFocusKeywords || stemmedFocusKeywords.length === 0) {
    return 0;
  }

  // Extract tokens from entity
  const entityText = [
    entity.name || "",
    entity.summary || "",
    entity.raw_content || "",
  ].join(" ");

  const entityTokens = tokenize(entityText).map((token) =>
    stem(token.toLowerCase())
  );

  // Count matching focus keywords
  const matchingFocusKeywords = stemmedFocusKeywords.filter((kw) =>
    entityTokens.includes(kw)
  ).length;

  // Calculate focus boost based on proportion of matching focus keywords
  return matchingFocusKeywords / stemmedFocusKeywords.length;
}

/**
 * Calculate recency factor based on entity's last modified or accessed date
 *
 * @param {CodeEntity} entity - The code entity
 * @returns {number} Recency factor between 0 and 1
 */
function calculateRecencyFactor(entity) {
  // Use last_modified_at or last_accessed_at, whichever is more recent
  const lastModified = entity.last_modified_at
    ? new Date(entity.last_modified_at)
    : null;
  const lastAccessed = entity.last_accessed_at
    ? new Date(entity.last_accessed_at)
    : null;

  if (!lastModified && !lastAccessed) {
    return 0.5; // Default value if no dates available
  }

  // Use the most recent date
  const mostRecentDate = !lastAccessed
    ? lastModified
    : !lastModified
    ? lastAccessed
    : lastAccessed > lastModified
    ? lastAccessed
    : lastModified;

  const now = new Date();
  const ageInDays = (now - mostRecentDate) / (1000 * 60 * 60 * 24);

  // Exponential decay function: score = e^(-ageInDays/30)
  // This gives a score of ~1.0 for today, ~0.37 for 30 days ago, ~0.14 for 60 days ago
  return Math.exp(-ageInDays / 30);
}

/**
 * Calculate type-based weight for different entity types
 *
 * @param {CodeEntity} entity - The code entity
 * @returns {number} Type weight between 0 and 1
 */
function calculateTypeWeight(entity) {
  // Define weights for different entity types
  const typeWeights = {
    function: 0.9,
    class: 0.9,
    method: 0.85,
    file: 0.8,
    variable: 0.75,
    comment: 0.5,
    default: 0.7, // Default weight for unknown types
  };

  const entityType = (entity.entity_type || "").toLowerCase();
  return typeWeights[entityType] || typeWeights.default;
}

/**
 * Retrieves code entities by their entity IDs
 *
 * @param {string[]} entityIds - Array of entity IDs to retrieve
 * @returns {Promise<CodeEntity[]>} Array of code entities
 */
export async function searchByEntityIds(entityIds) {
  try {
    // Validate input
    if (!entityIds || !Array.isArray(entityIds) || entityIds.length === 0) {
      throw new Error("Entity IDs array is required and cannot be empty");
    }

    // Create placeholders for the IN clause
    const placeholders = entityIds.map(() => "?").join(", ");

    // Build and execute the query
    const sql = `
      SELECT * FROM code_entities
      WHERE entity_id IN (${placeholders})
    `;

    const results = await executeQuery(sql, entityIds);

    // Return the raw entity objects
    return results;
  } catch (error) {
    console.error("Error in searchByEntityIds:", error);
    throw error;
  }
}
