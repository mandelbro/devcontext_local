/**
 * SemanticPatternRecognizerLogic.js
 *
 * Logic for recognizing semantic patterns in code entities.
 * Uses both textual and structural analysis to identify patterns.
 */

import * as TextTokenizerLogic from "./TextTokenizerLogic.js";
import * as CodeStructureAnalyzerLogic from "./CodeStructureAnalyzerLogic.js";
import * as RelationshipContextManagerLogic from "./RelationshipContextManagerLogic.js";
import { executeQuery } from "../db.js";
import { v4 as uuidv4 } from "uuid";

/**
 * @typedef {Object} Pattern
 * @property {string} id - Unique identifier for the pattern
 * @property {string} name - Human-readable name for the pattern
 * @property {string} description - Description of what the pattern represents
 * @property {string} language - Programming language this pattern applies to (e.g., 'javascript', 'python', or 'any' for language-agnostic patterns)
 * @property {string} category - Category of the pattern (e.g., 'design_pattern', 'antipattern', 'common_idiom')
 * @property {string} representation - Textual or structured representation of the pattern
 * @property {string} detection_rules - JSON string of rules used to detect this pattern
 * @property {number} importance - Importance score of this pattern (0-1)
 * @property {string} created_at - When this pattern was created
 * @property {string} updated_at - When this pattern was last updated
 */

/**
 * @typedef {Object} PatternDefinition
 * @property {string} name - Human-readable name for the pattern
 * @property {string} description - Description of what the pattern represents
 * @property {string} language - Programming language this pattern applies to (e.g., 'javascript', 'python', or 'any' for language-agnostic patterns)
 * @property {string} category - Category of the pattern
 * @property {string} representation - Textual or structured representation of the pattern
 * @property {Object} detection_rules - Rules used to detect this pattern
 * @property {number} importance - Importance score of this pattern (0-1)
 */

/**
 * @typedef {Object} CodeEntity
 * @property {string} id - Unique identifier for the code entity
 * @property {string} path - File path of the code entity
 * @property {string} type - Type of code entity ('file', 'function', 'class', etc.)
 * @property {string} name - Name of the code entity
 * @property {string} content - Content of the code entity
 * @property {string} raw_content - Raw unprocessed content of the entity
 * @property {string} language - Programming language of the entity
 * @property {Object} custom_metadata - Optional metadata including structural information
 */

/**
 * Recognizes semantic patterns in a code entity
 *
 * @param {CodeEntity} entity - The code entity to analyze
 * @returns {Promise<{patterns: Pattern[], confidence: number}>} Matched patterns and overall confidence
 */
export async function recognizePatterns(entity) {
  try {
    // 1. Extract key information from the entity
    const { content, raw_content, language, type, custom_metadata } = entity;

    // If entity has no content, return empty result
    if (!content && !raw_content) {
      return { patterns: [], confidence: 0 };
    }

    const entityContent = raw_content || content;

    // 2. Get structural features - either from metadata or by analyzing
    let structuralFeatures = custom_metadata?.structuralFeatures;

    if (!structuralFeatures) {
      // Build AST and extract structural features
      const ast = await CodeStructureAnalyzerLogic.buildAST(
        entityContent,
        language
      );
      structuralFeatures =
        await CodeStructureAnalyzerLogic.extractStructuralFeatures(ast);
    }

    // 3. Get token-based features using TextTokenizerLogic
    const tokenizedContent = TextTokenizerLogic.tokenize(entityContent);
    const keywords = TextTokenizerLogic.extractKeywords(tokenizedContent);
    const codeNgrams = TextTokenizerLogic.extractNGrams(tokenizedContent, 3); // Extract up to 3-grams

    // 4. Retrieve known patterns from database
    const knownPatterns = await getKnownPatterns({
      language: language, // Filter by entity's language
      minConfidence: 0.3, // Only get reasonably confident patterns
    });

    if (knownPatterns.length === 0) {
      return { patterns: [], confidence: 0 };
    }

    // 5. Match patterns against the entity
    const matchResults = await Promise.all(
      knownPatterns.map((pattern) =>
        matchPattern(
          pattern,
          entityContent,
          structuralFeatures,
          keywords,
          codeNgrams,
          type
        )
      )
    );

    // 6. Filter patterns with positive matches and sort by confidence
    const matchedPatterns = matchResults
      .filter((result) => result.confidence > 0.1) // Only include patterns with reasonable confidence
      .sort((a, b) => b.confidence - a.confidence);

    // 7. Calculate overall confidence (weighted average based on pattern importance)
    let overallConfidence = 0;
    let totalImportance = 0;

    if (matchedPatterns.length > 0) {
      for (const match of matchedPatterns) {
        const importance = match.pattern.importance || 0.5; // Default importance if not specified
        overallConfidence += match.confidence * importance;
        totalImportance += importance;
      }

      overallConfidence =
        totalImportance > 0
          ? overallConfidence / totalImportance
          : matchedPatterns[0].confidence; // If no importance values, use highest confidence
    }

    // 8. Return matched patterns and overall confidence
    return {
      patterns: matchedPatterns.map((match) => match.pattern),
      confidence: overallConfidence,
    };
  } catch (error) {
    console.error("Error in pattern recognition:", error);
    return { patterns: [], confidence: 0 };
  }
}

/**
 * Retrieves known patterns from the database with optional filtering
 *
 * @param {Object} filterOptions - Options to filter the patterns
 * @param {string} [filterOptions.type] - Filter by pattern type
 * @param {number} [filterOptions.minConfidence] - Filter by minimum confidence score
 * @param {string} [filterOptions.language] - Filter by programming language
 * @returns {Promise<Pattern[]>} Array of patterns matching the filters
 */
export async function getKnownPatterns(filterOptions = {}) {
  try {
    const { type, minConfidence, language } = filterOptions;

    // Build the query
    let query = "SELECT * FROM project_patterns WHERE 1=1";
    const params = [];

    // Apply type filter
    if (type) {
      query += " AND pattern_type = ?";
      params.push(type);
    }

    // Apply confidence filter
    if (minConfidence !== undefined && !isNaN(minConfidence)) {
      query += " AND confidence_score >= ?";
      params.push(minConfidence);
    }

    // Apply language filter
    if (language) {
      query += " AND (language = ? OR language = ? OR language IS NULL)";
      params.push(language, "any"); // Include language-specific, universal patterns, and legacy NULL values
    }

    // Order by confidence and frequency
    query += " ORDER BY confidence_score DESC, frequency DESC";

    // Execute the query
    const patterns = await executeQuery(query, params);

    // Parse detection_rules JSON for each pattern
    return patterns.map((pattern) => ({
      ...pattern,
      detection_rules: JSON.parse(pattern.detection_rules || "{}"),
    }));
  } catch (error) {
    console.error("Error retrieving patterns with filters:", error);
    throw new Error(`Failed to retrieve patterns: ${error.message}`);
  }
}

/**
 * Retrieves known patterns from the database
 *
 * @param {string} language - Programming language to filter by (optional)
 * @returns {Promise<Pattern[]>} Array of known patterns
 * @private
 */
async function _getKnownPatternsInternal(language) {
  try {
    let query = "SELECT * FROM project_patterns";
    const params = [];

    // Filter by language if specified
    if (language) {
      query += " WHERE language = ? OR language = ? OR language IS NULL";
      params.push(language, "any"); // Include language-specific, universal patterns, and legacy NULL values
    }

    const patterns = await executeQuery(query, params);

    // Parse detection_rules JSON
    return patterns.map((pattern) => ({
      ...pattern,
      detection_rules: JSON.parse(pattern.detection_rules || "{}"),
    }));
  } catch (error) {
    console.error("Error retrieving known patterns:", error);
    return [];
  }
}

/**
 * Matches a pattern against an entity
 *
 * @param {Pattern} pattern - The pattern to match
 * @param {string} content - The entity content
 * @param {Object} structuralFeatures - Structural features of the entity
 * @param {string[]} keywords - Extracted keywords from the entity
 * @param {Object[]} codeNgrams - N-grams extracted from the entity
 * @param {string} entityType - Type of the entity (file, function, class, etc.)
 * @returns {Promise<{pattern: Pattern, confidence: number}>} Match result with confidence
 * @private
 */
async function matchPattern(
  pattern,
  content,
  structuralFeatures,
  keywords,
  codeNgrams,
  entityType
) {
  try {
    const { detection_rules } = pattern;
    let textualMatchScore = 0;
    let structuralMatchScore = 0;
    let typeMatchScore = 0;

    // Check if pattern applies to this entity type
    if (
      detection_rules.applicable_types &&
      Array.isArray(detection_rules.applicable_types)
    ) {
      typeMatchScore = detection_rules.applicable_types.includes(entityType)
        ? 1
        : 0;

      // If pattern explicitly doesn't apply to this type, return zero confidence
      if (typeMatchScore === 0 && detection_rules.strict_type_matching) {
        return { pattern, confidence: 0 };
      }
    } else {
      // If no type restrictions, full score
      typeMatchScore = 1;
    }

    // Perform textual matching
    if (detection_rules.keywords && Array.isArray(detection_rules.keywords)) {
      const keywordMatches = detection_rules.keywords.filter((keyword) =>
        keywords.includes(keyword)
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
          const pattern =
            textPattern instanceof RegExp
              ? textPattern
              : new RegExp(textPattern.pattern, textPattern.flags || "");

          if (pattern.test(content)) {
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

    // Perform structural matching
    if (
      detection_rules.structural_rules &&
      Array.isArray(detection_rules.structural_rules)
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
          ? structRuleMatchCount / detection_rules.structural_rules.length
          : 0;
    }

    // Calculate combined confidence
    const weights = detection_rules.weights || {
      textual: 0.4,
      structural: 0.4,
      type: 0.2,
    };

    // Calculate weighted average
    const confidence =
      textualMatchScore * weights.textual +
      structuralMatchScore * weights.structural +
      typeMatchScore * weights.type;

    return { pattern, confidence };
  } catch (error) {
    console.error(`Error matching pattern ${pattern.name}:`, error);
    return { pattern, confidence: 0 };
  }
}

/**
 * Adds a new pattern to the pattern repository
 *
 * @param {PatternDefinition} patternDefinition - The pattern definition to add
 * @returns {Promise<string>} The ID of the newly added pattern
 */
export async function addPatternToRepository(patternDefinition) {
  try {
    // 1. Generate a unique ID for the pattern
    const pattern_id = uuidv4();

    // 2. Extract and prepare pattern data with defaults
    const {
      pattern_type,
      name = `Pattern_${pattern_id.substring(0, 8)}`,
      description = "",
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

    // 4. Set default scores and counters
    const frequency = 1;
    const utility_score = 0.1;
    const confidence_score = 0.5;
    const reinforcement_count = 1;
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
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      confidence_score,
      reinforcement_count,
      created_at,
      updated_at,
    ];

    await executeQuery(query, params);

    console.log(`Added new pattern "${name}" (${pattern_id}) to repository`);

    // 6. Return the generated pattern ID
    return pattern_id;
  } catch (error) {
    console.error("Error adding pattern to repository:", error);
    throw new Error(`Failed to add pattern: ${error.message}`);
  }
}

/**
 * Finds code entities that match a specific pattern
 *
 * @param {string} patternId - ID of the pattern to match against
 * @param {number} [limit=10] - Maximum number of matches to return
 * @returns {Promise<CodeEntity[]>} Array of code entities that match the pattern
 */
export async function findSimilarCodeByPattern(patternId, limit = 10) {
  try {
    // 1. Retrieve the pattern from the database
    const patternQuery = "SELECT * FROM project_patterns WHERE pattern_id = ?";
    const patterns = await executeQuery(patternQuery, [patternId]);

    if (patterns.length === 0) {
      console.warn(`Pattern with ID ${patternId} not found`);
      return [];
    }

    const pattern = {
      ...patterns[0],
      detection_rules: JSON.parse(patterns[0].detection_rules || "{}"),
    };

    // 2. Determine if we can optimize by filtering entities
    const preFilters = [];
    const preFilterParams = [];

    // Filter by language if the pattern is language-specific
    if (pattern.language && pattern.language !== "any") {
      preFilters.push("language = ?");
      preFilterParams.push(pattern.language);
    }

    // Filter by entity type if the pattern has applicable types
    if (
      pattern.detection_rules.applicable_types &&
      Array.isArray(pattern.detection_rules.applicable_types) &&
      pattern.detection_rules.applicable_types.length > 0
    ) {
      const typePlaceholders = pattern.detection_rules.applicable_types
        .map(() => "?")
        .join(", ");
      preFilters.push(`type IN (${typePlaceholders})`);
      preFilterParams.push(...pattern.detection_rules.applicable_types);
    }

    // 3. Create a query to get candidate entities
    let entityQuery = "SELECT * FROM code_entities";

    if (preFilters.length > 0) {
      entityQuery += " WHERE " + preFilters.join(" AND ");
    }

    // 4. Perform keyword search optimization if possible
    if (
      pattern.detection_rules.keywords &&
      Array.isArray(pattern.detection_rules.keywords) &&
      pattern.detection_rules.keywords.length > 0
    ) {
      // Get the first few keywords to use as a pre-filter
      // This optimization assumes there's a full-text search or that content is indexed
      // We'll limit to 3 keywords to avoid over-filtering
      const keywordsToUse = pattern.detection_rules.keywords.slice(0, 3);

      // Search for entities with content containing any of these keywords
      // This is a simplified approach - a real implementation might use a more sophisticated
      // full-text search or entity_keywords table
      if (keywordsToUse.length > 0) {
        const keywordConditions = keywordsToUse
          .map((keyword) => "content LIKE ?")
          .join(" OR ");

        if (preFilters.length > 0) {
          entityQuery += ` AND (${keywordConditions})`;
        } else {
          entityQuery += ` WHERE (${keywordConditions})`;
        }

        // Add the LIKE parameters with wildcards
        keywordsToUse.forEach((keyword) => {
          preFilterParams.push(`%${keyword}%`);
        });
      }
    }

    // Add a reasonable limit to avoid processing too many entities
    // We'll process more than the requested limit since some might not match
    const processingLimit = Math.min(limit * 5, 100);
    entityQuery += ` LIMIT ${processingLimit}`;

    // 5. Get candidate entities
    const entities = await executeQuery(entityQuery, preFilterParams);

    // 6. Check each entity for pattern matches
    const matchResults = [];

    for (const entity of entities) {
      // Perform pattern matching similar to recognizePatterns but for a single pattern
      try {
        // Extract content and prepare for analysis
        const entityContent = entity.raw_content || entity.content;

        if (!entityContent) continue;

        // Get token-based features
        const tokenizedContent = TextTokenizerLogic.tokenize(entityContent);
        const keywords = TextTokenizerLogic.extractKeywords(tokenizedContent);
        const codeNgrams = TextTokenizerLogic.extractNGrams(
          tokenizedContent,
          3
        );

        // Get or generate structural features if needed for this pattern
        let structuralFeatures = entity.custom_metadata?.structuralFeatures;

        // Only parse the AST if the pattern has structural rules and we don't already have features
        const needsStructuralAnalysis =
          pattern.detection_rules.structural_rules && !structuralFeatures;

        if (needsStructuralAnalysis) {
          try {
            const ast = await CodeStructureAnalyzerLogic.buildAST(
              entityContent,
              entity.language
            );
            structuralFeatures =
              await CodeStructureAnalyzerLogic.extractStructuralFeatures(ast);
          } catch (error) {
            console.warn(
              `Could not analyze structure for entity ${entity.id}:`,
              error
            );
            structuralFeatures = {};
          }
        }

        // Match this entity against the pattern
        const matchResult = await matchPattern(
          pattern,
          entityContent,
          structuralFeatures || {},
          keywords,
          codeNgrams,
          entity.type
        );

        // If confidence is above threshold, add to results
        if (matchResult.confidence > 0.3) {
          // Using a slightly higher threshold than recognizePatterns
          matchResults.push({
            entity,
            confidence: matchResult.confidence,
          });
        }
      } catch (error) {
        console.warn(
          `Error matching entity ${entity.id} against pattern:`,
          error
        );
      }
    }

    // 7. Sort by confidence and limit results
    matchResults.sort((a, b) => b.confidence - a.confidence);

    // 8. Return the entities, limited by the requested limit
    return matchResults.slice(0, limit).map((result) => result.entity);
  } catch (error) {
    console.error("Error finding similar code by pattern:", error);
    return [];
  }
}

/**
 * Generates a pattern definition from example code entities
 *
 * @param {CodeEntity[]} examples - Code entities that exemplify the pattern
 * @param {string} name - Name to give the generated pattern
 * @param {string} [patternType='derived_from_examples'] - Type of pattern to create
 * @returns {PatternDefinition} Generated pattern definition
 */
export function generatePatternFromExamples(
  examples,
  name,
  patternType = "derived_from_examples"
) {
  if (!examples || examples.length === 0) {
    throw new Error("At least one example is required to generate a pattern");
  }

  // 1. Extract necessary information from examples
  const language = identifyCommonLanguage(examples);
  const entityType = identifyCommonEntityType(examples);

  // 2. Extract textual features from all examples
  const textualFeatures = extractTextualFeatures(examples);

  // 3. Extract structural features if possible
  const structuralFeatures = extractStructuralFeatures(examples);

  // 4. Generate a description based on examples
  const description = `Pattern derived from ${examples.length} examples related to ${name}`;

  // 5. Create detection rules based on commonalities
  const detectionRules = {
    keywords: textualFeatures.commonKeywords,
    text_patterns: textualFeatures.commonNgrams.map((ngram) => ngram.text),
    structural_rules: structuralFeatures.rules,
    applicable_types: [entityType],
    weights: {
      textual: 0.5,
      structural: 0.4,
      type: 0.1,
    },
  };

  // 6. Create a representation based on the most representative example
  // Choose the example with the highest number of common features
  let bestExampleIndex = 0;
  let bestMatchScore = -1;

  examples.forEach((example, index) => {
    const content = example.raw_content || example.content;
    if (!content) return;

    let matchScore = 0;

    // Count how many common keywords and n-grams this example contains
    const tokenizedContent = TextTokenizerLogic.tokenize(content);
    const keywords = TextTokenizerLogic.extractKeywords(tokenizedContent);

    textualFeatures.commonKeywords.forEach((keyword) => {
      if (keywords.includes(keyword)) matchScore++;
    });

    textualFeatures.commonNgrams.forEach((ngram) => {
      if (content.includes(ngram.text)) matchScore++;
    });

    if (matchScore > bestMatchScore) {
      bestMatchScore = matchScore;
      bestExampleIndex = index;
    }
  });

  // Use the best example as the representation template
  const representativeExample = examples[bestExampleIndex];
  const representation = {
    template:
      representativeExample.raw_content || representativeExample.content,
    variables: textualFeatures.variableTokens,
    structure: structuralFeatures.commonPattern,
  };

  // 7. Return the pattern definition
  return {
    pattern_type: patternType,
    name,
    description,
    language,
    representation: JSON.stringify(representation),
    detection_rules: detectionRules,
    importance: 0.5, // Default moderate importance
  };
}

/**
 * Identifies the common programming language from examples
 *
 * @param {CodeEntity[]} examples - Code entities to analyze
 * @returns {string} Common language or 'any' if mixed
 * @private
 */
function identifyCommonLanguage(examples) {
  const languages = examples.map((ex) => ex.language).filter(Boolean);

  if (languages.length === 0) return "any";

  // Check if all examples have the same language
  const firstLanguage = languages[0];
  const allSameLanguage = languages.every((lang) => lang === firstLanguage);

  return allSameLanguage ? firstLanguage : "any";
}

/**
 * Identifies the common entity type from examples
 *
 * @param {CodeEntity[]} examples - Code entities to analyze
 * @returns {string} Common entity type
 * @private
 */
function identifyCommonEntityType(examples) {
  const types = examples.map((ex) => ex.type).filter(Boolean);

  if (types.length === 0) return "any";

  // Check if all examples have the same type
  const firstType = types[0];
  const allSameType = types.every((type) => type === firstType);

  return allSameType ? firstType : "any";
}

/**
 * Extracts textual features from examples
 *
 * @param {CodeEntity[]} examples - Code entities to analyze
 * @returns {Object} Extracted textual features
 * @private
 */
function extractTextualFeatures(examples) {
  // 1. Extract tokens, keywords, and n-grams from each example
  const allKeywords = [];
  const allNgrams = [];
  const allTokens = [];

  examples.forEach((example) => {
    const content = example.raw_content || example.content;
    if (!content) return;

    const tokenizedContent = TextTokenizerLogic.tokenize(content);
    const keywords = TextTokenizerLogic.extractKeywords(tokenizedContent);
    const ngrams = TextTokenizerLogic.extractNGrams(tokenizedContent, 3);

    allKeywords.push(keywords);
    allNgrams.push(ngrams);
    allTokens.push(tokenizedContent);
  });

  // 2. Find common keywords across examples
  let commonKeywords = [];
  if (allKeywords.length > 0) {
    // Start with first example's keywords
    commonKeywords = [...allKeywords[0]];

    // Intersect with all other examples
    for (let i = 1; i < allKeywords.length; i++) {
      commonKeywords = commonKeywords.filter((keyword) =>
        allKeywords[i].includes(keyword)
      );
    }

    // Limit to most significant keywords (top 10)
    commonKeywords = commonKeywords.slice(0, 10);
  }

  // 3. Find common n-grams
  let commonNgrams = [];
  if (allNgrams.length > 0) {
    // Create a frequency map of n-grams
    const ngramFrequency = new Map();

    allNgrams.forEach((exampleNgrams) => {
      exampleNgrams.forEach((ngram) => {
        const key = ngram.text;
        ngramFrequency.set(key, (ngramFrequency.get(key) || 0) + 1);
      });
    });

    // Find n-grams that appear in at least half of the examples
    const threshold = Math.max(1, Math.floor(examples.length / 2));

    commonNgrams = Array.from(ngramFrequency.entries())
      .filter(([_, count]) => count >= threshold)
      .map(([text, _]) => ({ text }))
      .slice(0, 5); // Limit to top 5 common n-grams
  }

  // 4. Identify variable tokens (tokens that vary across examples)
  const variableTokens = [];

  // If we have more than one example, find tokens that vary in position
  if (allTokens.length > 1) {
    const firstTokens = allTokens[0];

    // Simple approach: look for positions where token differs across examples
    // For each token position in the first example:
    for (let i = 0; i < Math.min(firstTokens.length, 30); i++) {
      // Limit to first 30 tokens
      if (i >= firstTokens.length) break;

      const token = firstTokens[i];
      let isVariable = false;

      // Check if this position has different tokens in other examples
      for (let j = 1; j < allTokens.length; j++) {
        const otherTokens = allTokens[j];
        if (i >= otherTokens.length || otherTokens[i] !== token) {
          isVariable = true;
          break;
        }
      }

      if (isVariable) {
        variableTokens.push({
          position: i,
          examples: examples
            .map((ex) => {
              const tokens = TextTokenizerLogic.tokenize(
                ex.raw_content || ex.content || ""
              );
              return i < tokens.length ? tokens[i] : null;
            })
            .filter(Boolean),
        });
      }
    }
  }

  return {
    commonKeywords,
    commonNgrams,
    variableTokens,
  };
}

/**
 * Extracts structural features from examples
 *
 * @param {CodeEntity[]} examples - Code entities to analyze
 * @returns {Object} Extracted structural features
 * @private
 */
function extractStructuralFeatures(examples) {
  // Default result with empty values
  const defaultResult = {
    rules: [],
    commonPattern: null,
  };

  try {
    // 1. Extract structural features from each example if possible
    const allFeatures = [];

    for (const example of examples) {
      const content = example.raw_content || example.content;
      if (!content) continue;

      // Use existing structural features if available
      if (example.custom_metadata?.structuralFeatures) {
        allFeatures.push(example.custom_metadata.structuralFeatures);
        continue;
      }

      // Otherwise try to extract features (synchronously)
      try {
        // Note: We're calling async functions synchronously here which is not ideal,
        // but for simplicity in this example we'll assume they can work synchronously
        const ast = CodeStructureAnalyzerLogic.buildAST(
          content,
          example.language
        );
        if (!ast) continue;

        const features =
          CodeStructureAnalyzerLogic.extractStructuralFeatures(ast);
        if (features) {
          allFeatures.push(features);
        }
      } catch (error) {
        console.warn(
          `Could not extract structural features for example: ${error.message}`
        );
      }
    }

    if (allFeatures.length === 0) {
      return defaultResult;
    }

    // 2. Find common structural properties
    const structuralRules = [];

    // Start with the first example's features
    const firstFeatures = allFeatures[0];

    // For each property in the first example, check if it's common across all examples
    for (const [feature, value] of Object.entries(firstFeatures)) {
      // Skip if the value is complex or undefined
      if (typeof value === "undefined" || typeof value === "object") continue;

      // Check if this feature has the same value across all examples
      const isCommon = allFeatures.every((features) => {
        return features[feature] === value;
      });

      // If common, add a structural rule
      if (isCommon) {
        structuralRules.push({
          feature,
          condition: "equals",
          value,
        });
      }
      // If not exactly the same but similar (for numeric values)
      else if (typeof value === "number") {
        // Calculate range
        const values = allFeatures
          .map((f) => f[feature])
          .filter((v) => typeof v === "number");
        const min = Math.min(...values);
        const max = Math.max(...values);

        // If there's a reasonable range, add a range rule
        if (max - min < max * 0.5) {
          // Max is no more than 50% larger than min
          structuralRules.push({
            feature,
            condition: "greater_than",
            value: min * 0.9, // 10% below minimum observed
          });

          structuralRules.push({
            feature,
            condition: "less_than",
            value: max * 1.1, // 10% above maximum observed
          });
        }
      }
    }

    // 3. Identify common structural pattern
    // For simplicity, we'll use the most important structural features
    const commonPattern = {
      nodeType: examples[0].type,
      structuralRules: structuralRules.slice(0, 3), // Top 3 rules
      complexity:
        allFeatures.reduce((sum, f) => sum + (f.complexity || 0), 0) /
        allFeatures.length,
    };

    return {
      rules: structuralRules,
      commonPattern,
    };
  } catch (error) {
    console.error("Error extracting structural features:", error);
    return defaultResult;
  }
}

/**
 * Detects design patterns in a set of code entities
 *
 * @param {CodeEntity[]} entities - Code entities to analyze
 * @returns {Array<{patternType: string, entities: string[], confidence: number}>} Detected design patterns
 */
export async function detectDesignPatterns(entities) {
  if (!entities || entities.length === 0) {
    return [];
  }

  // Results array
  const detectedPatterns = [];

  // Get entity IDs for relationship lookup
  const entityIds = entities.map((entity) => entity.id);

  // Get relationships between entities if available
  let relationships = [];
  try {
    relationships = await RelationshipContextManagerLogic.getRelationships(
      entityIds
    );
  } catch (error) {
    console.warn("Error retrieving relationships between entities:", error);
    // Continue without relationships
  }

  // Define pattern detectors
  const patternDetectors = [
    detectSingletonPattern,
    detectFactoryPattern,
    detectObserverPattern,
    // Add more pattern detectors here as needed
  ];

  // Apply each detector
  for (const detector of patternDetectors) {
    const result = await detector(entities, relationships);
    if (result.length > 0) {
      detectedPatterns.push(...result);
    }
  }

  return detectedPatterns;
}

/**
 * Detects Singleton pattern
 *
 * @param {CodeEntity[]} entities - Code entities to analyze
 * @param {Array} relationships - Relationships between entities
 * @returns {Array<{patternType: string, entities: string[], confidence: number}>} Detected patterns
 * @private
 */
async function detectSingletonPattern(entities, relationships) {
  const results = [];

  // Find class entities
  const classEntities = entities.filter(
    (entity) => entity.type === "class" || entity.type === "interface"
  );

  for (const classEntity of classEntities) {
    let confidence = 0;
    let evidence = [];

    const content = classEntity.raw_content || classEntity.content;
    if (!content) continue;

    // Look for private/protected constructor
    const hasPrivateConstructor =
      /private\s+constructor|protected\s+constructor/.test(content);
    if (hasPrivateConstructor) {
      confidence += 0.3;
      evidence.push("private/protected constructor");
    }

    // Look for static instance field
    const hasStaticInstance =
      /static\s+(\w+)\s*:\s*\w+|static\s+(\w+)\s*=/.test(content);
    if (hasStaticInstance) {
      confidence += 0.3;
      evidence.push("static instance field");
    }

    // Look for getInstance method
    const hasGetInstanceMethod =
      /static\s+getInstance\s*\(|static\s+instance\s*\(|static\s+get\s+instance\s*\(/.test(
        content
      );
    if (hasGetInstanceMethod) {
      confidence += 0.4;
      evidence.push("getInstance method");
    }

    // Look for self-assignment in constructor
    const hasSelfAssignment =
      /this\._instance\s*=\s*this|instance\s*=\s*this/.test(content);
    if (hasSelfAssignment) {
      confidence += 0.2;
      evidence.push("self-assignment in constructor");
    }

    // Check if this class is being instantiated elsewhere
    const isInstantiatedElsewhere = relationships.some(
      (rel) =>
        rel.relationship_type === "instantiates" &&
        rel.target_entity_id === classEntity.id
    );

    // If instantiated in multiple places, it's less likely to be a Singleton
    if (isInstantiatedElsewhere) {
      confidence -= 0.2;
      evidence.push("instantiated elsewhere (negative)");
    }

    // If confidence is high enough, add to results
    if (confidence >= 0.6) {
      results.push({
        patternType: "Singleton",
        entities: [classEntity.id],
        confidence,
        evidence,
      });
    }
  }

  return results;
}

/**
 * Detects Factory pattern
 *
 * @param {CodeEntity[]} entities - Code entities to analyze
 * @param {Array} relationships - Relationships between entities
 * @returns {Array<{patternType: string, entities: string[], confidence: number}>} Detected patterns
 * @private
 */
async function detectFactoryPattern(entities, relationships) {
  const results = [];

  // Find class and function entities
  const classEntities = entities.filter((entity) => entity.type === "class");
  const functionEntities = entities.filter(
    (entity) => entity.type === "function" || entity.type === "method"
  );

  // Look for factory classes
  for (const classEntity of classEntities) {
    let confidence = 0;
    let evidence = [];
    const involvedEntities = [classEntity.id];

    const content = classEntity.raw_content || classEntity.content;
    if (!content) continue;

    // Class name suggests Factory
    if (/Factory|Builder|Creator|Producer/i.test(classEntity.name)) {
      confidence += 0.2;
      evidence.push("name suggests factory");
    }

    // Look for create/make/build methods in the class
    const hasCreateMethods =
      /\b(create|make|build|produce|get)\w*\s*\([^)]*\)\s*{/.test(content);
    if (hasCreateMethods) {
      confidence += 0.3;
      evidence.push("has creation methods");
    }

    // Check if this class has relationships that indicate creation of other objects
    const creationRelationships = relationships.filter(
      (rel) =>
        rel.source_entity_id === classEntity.id &&
        (rel.relationship_type === "creates" ||
          rel.relationship_type === "instantiates")
    );

    if (creationRelationships.length > 0) {
      confidence += 0.3;
      evidence.push(`creates ${creationRelationships.length} other entities`);

      // Add related entities
      creationRelationships.forEach((rel) => {
        if (!involvedEntities.includes(rel.target_entity_id)) {
          involvedEntities.push(rel.target_entity_id);
        }
      });
    }

    // Look for method return types that match other known entities
    const otherClassNames = classEntities
      .filter((e) => e.id !== classEntity.id)
      .map((e) => e.name);

    let returnTypeMatches = 0;
    for (const otherClass of otherClassNames) {
      const returnTypeRegex = new RegExp(
        `:\\s*${otherClass}\\b|return\\s+(new\\s+)?${otherClass}\\b`
      );
      if (returnTypeRegex.test(content)) {
        returnTypeMatches++;
      }
    }

    if (returnTypeMatches > 0) {
      confidence += 0.2;
      evidence.push(`returns known types (${returnTypeMatches})`);
    }

    // If confidence is high enough, add to results
    if (confidence >= 0.5) {
      results.push({
        patternType: "Factory",
        entities: involvedEntities,
        confidence,
        evidence,
      });
    }
  }

  // Look for standalone factory functions
  for (const functionEntity of functionEntities) {
    let confidence = 0;
    let evidence = [];
    const involvedEntities = [functionEntity.id];

    const content = functionEntity.raw_content || functionEntity.content;
    if (!content) continue;

    // Function name suggests Factory
    if (/create|make|build|produce|factory|new/i.test(functionEntity.name)) {
      confidence += 0.3;
      evidence.push("name suggests factory function");
    }

    // Check if this function has relationships that indicate creation of objects
    const creationRelationships = relationships.filter(
      (rel) =>
        rel.source_entity_id === functionEntity.id &&
        (rel.relationship_type === "creates" ||
          rel.relationship_type === "instantiates")
    );

    if (creationRelationships.length > 0) {
      confidence += 0.3;
      evidence.push(`creates ${creationRelationships.length} entities`);

      // Add related entities
      creationRelationships.forEach((rel) => {
        if (!involvedEntities.includes(rel.target_entity_id)) {
          involvedEntities.push(rel.target_entity_id);
        }
      });
    }

    // Look for 'new' keyword
    if (/return\s+new\s+\w+/.test(content)) {
      confidence += 0.3;
      evidence.push("returns new instance");
    }

    // If confidence is high enough, add to results
    if (confidence >= 0.5) {
      results.push({
        patternType: "Factory",
        entities: involvedEntities,
        confidence,
        evidence,
      });
    }
  }

  return results;
}

/**
 * Detects Observer pattern
 *
 * @param {CodeEntity[]} entities - Code entities to analyze
 * @param {Array} relationships - Relationships between entities
 * @returns {Array<{patternType: string, entities: string[], confidence: number}>} Detected patterns
 * @private
 */
async function detectObserverPattern(entities, relationships) {
  const results = [];

  // Find class entities
  const classEntities = entities.filter((entity) => entity.type === "class");

  // Look for potential subject classes
  for (const potentialSubject of classEntities) {
    let confidence = 0;
    let evidence = [];
    const involvedEntities = [potentialSubject.id];

    const content = potentialSubject.raw_content || potentialSubject.content;
    if (!content) continue;

    // Look for observer list/collection
    const hasObserverCollection =
      /(\w+)?\s*observers\s*=|(\w+)?\s*listeners\s*=/.test(content);
    if (hasObserverCollection) {
      confidence += 0.2;
      evidence.push("has observer collection");
    }

    // Look for add/remove/notify observer methods
    const hasAddObserver =
      /add(Observer|Listener|Subscriber|Handler)|subscribe/.test(content);
    if (hasAddObserver) {
      confidence += 0.2;
      evidence.push("has add observer method");
    }

    const hasRemoveObserver =
      /remove(Observer|Listener|Subscriber|Handler)|unsubscribe/.test(content);
    if (hasRemoveObserver) {
      confidence += 0.2;
      evidence.push("has remove observer method");
    }

    const hasNotifyMethod =
      /notify|notifyObservers|emit|trigger|dispatch|fire/.test(content);
    if (hasNotifyMethod) {
      confidence += 0.3;
      evidence.push("has notify method");
    }

    // Look for potential observers
    let potentialObservers = [];

    // Check relationships for "observes" relationship
    const observerRelationships = relationships.filter(
      (rel) =>
        rel.target_entity_id === potentialSubject.id &&
        rel.relationship_type === "observes"
    );

    if (observerRelationships.length > 0) {
      confidence += 0.3;
      evidence.push(`has ${observerRelationships.length} explicit observers`);

      // Add observer entities
      observerRelationships.forEach((rel) => {
        const observerId = rel.source_entity_id;
        if (!involvedEntities.includes(observerId)) {
          involvedEntities.push(observerId);
          potentialObservers.push(observerId);
        }
      });
    }

    // If no explicit observers found, look for classes with "update" or "handle" methods
    if (potentialObservers.length === 0) {
      for (const potentialObserver of classEntities) {
        if (potentialObserver.id === potentialSubject.id) continue;

        const observerContent =
          potentialObserver.raw_content || potentialObserver.content;
        if (!observerContent) continue;

        const hasUpdateMethod =
          /\bupdate\s*\(|\bhandle\w+\s*\(|\bon\w+\s*\(/.test(observerContent);
        if (hasUpdateMethod) {
          potentialObservers.push(potentialObserver.id);
          if (!involvedEntities.includes(potentialObserver.id)) {
            involvedEntities.push(potentialObserver.id);
          }

          confidence += 0.1;
          evidence.push(`found potential observer: ${potentialObserver.name}`);
        }
      }
    }

    // If confidence is high enough and we have potential observers, add to results
    if (confidence >= 0.5 && potentialObservers.length > 0) {
      results.push({
        patternType: "Observer",
        entities: involvedEntities,
        confidence,
        evidence,
      });
    }
  }

  return results;
}
