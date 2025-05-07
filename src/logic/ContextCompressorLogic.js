/**
 * ContextCompressorLogic.js
 *
 * Logic for compressing and summarizing text content to fit within
 * specific size constraints while preserving important information.
 */

import { tokenize } from "./TextTokenizerLogic.js";

/**
 * @typedef {Object} ScoredSnippet
 * @property {Object} entity - The code entity object
 * @property {number} score - Relevance score
 * @property {string} [content] - Optional pre-provided content
 */

/**
 * @typedef {Object} ProcessedSnippet
 * @property {string} entity_id - ID of the entity
 * @property {string} summarizedContent - Final summarized content
 * @property {number} originalScore - Original relevance score
 */

/**
 * Manage token budget distribution across context snippets
 *
 * @param {ScoredSnippet[]} contextSnippets - Array of scored context snippets
 * @param {number} budget - Total character budget to distribute
 * @param {string[]} [queryKeywords] - Optional query keywords for targeted summarization
 * @returns {ProcessedSnippet[]} Array of processed snippets with summarized content
 */
export function manageTokenBudget(contextSnippets, budget, queryKeywords = []) {
  if (!contextSnippets || contextSnippets.length === 0) {
    return [];
  }

  // Initialize result array
  const processedSnippets = [];

  // Track remaining budget
  let remainingBudget = budget;

  // Calculate initial budget allocation based on scores
  const totalScore = contextSnippets.reduce(
    (sum, snippet) => sum + snippet.score,
    0
  );
  const budgetAllocations = contextSnippets.map((snippet) => {
    // Allocate budget proportionally to score, with a minimum of 100 chars
    return Math.max(100, Math.floor((snippet.score / totalScore) * budget));
  });

  // Process snippets in order of score/relevance (assume they're already sorted)
  for (let i = 0; i < contextSnippets.length; i++) {
    const snippet = contextSnippets[i];

    // Get content from snippet, preferring pre-provided content
    const content = snippet.content || snippet.entity.raw_content || "";

    // Skip if no content
    if (!content) {
      continue;
    }

    // Get allocated budget for this snippet
    let snippetBudget = Math.min(budgetAllocations[i], remainingBudget);

    // If remaining budget is too small, skip this snippet
    if (snippetBudget < 50) {
      continue;
    }

    // Check if content fits within allocated budget
    if (content.length <= snippetBudget) {
      // Content fits as-is
      processedSnippets.push({
        entity_id: snippet.entity.entity_id,
        summarizedContent: content,
        originalScore: snippet.score,
      });

      remainingBudget -= content.length;
    } else {
      // Need to summarize content
      let summarizedContent;

      // Summarize based on entity type
      if (snippet.entity.entity_type) {
        summarizedContent = summarizeCodeEntity(
          snippet.entity,
          snippetBudget,
          queryKeywords
        );
      } else {
        summarizedContent = summarizeText(content, snippetBudget);
      }

      // Add to processed snippets if summarization succeeded
      if (summarizedContent) {
        processedSnippets.push({
          entity_id: snippet.entity.entity_id,
          summarizedContent,
          originalScore: snippet.score,
        });

        remainingBudget -= summarizedContent.length;
      }
    }

    // Stop if budget is exhausted
    if (remainingBudget <= 50) {
      break;
    }

    // Redistribute remaining budget to future snippets
    if (i < contextSnippets.length - 1) {
      const remainingSnippets = contextSnippets.length - i - 1;
      const remainingScores = contextSnippets
        .slice(i + 1)
        .reduce((sum, s) => sum + s.score, 0);

      // Recalculate budget allocations for remaining snippets
      for (let j = i + 1; j < contextSnippets.length; j++) {
        budgetAllocations[j] = Math.max(
          100,
          Math.floor(
            (contextSnippets[j].score / remainingScores) * remainingBudget
          )
        );
      }
    }
  }

  // If we have significant remaining budget and processed snippets,
  // try to use it to expand summaries
  if (remainingBudget > 200 && processedSnippets.length > 0) {
    redistributeRemainingBudget(
      processedSnippets,
      contextSnippets,
      remainingBudget,
      queryKeywords
    );
  }

  return processedSnippets;
}

/**
 * Redistribute remaining budget to expand summaries
 *
 * @param {ProcessedSnippet[]} processedSnippets - Already processed snippets
 * @param {ScoredSnippet[]} originalSnippets - Original scored snippets
 * @param {number} remainingBudget - Remaining character budget
 * @param {string[]} queryKeywords - Query keywords for summarization
 */
function redistributeRemainingBudget(
  processedSnippets,
  originalSnippets,
  remainingBudget,
  queryKeywords
) {
  // Create a map of processed snippets for quick lookup
  const processedMap = new Map();
  processedSnippets.forEach((ps) => {
    processedMap.set(ps.entity_id, ps);
  });

  // Filter original snippets to only include those that were processed
  // and sort by score (highest first)
  const snippetsToExpand = originalSnippets
    .filter((s) => processedMap.has(s.entity.entity_id))
    .sort((a, b) => b.score - a.score);

  // Calculate additional budget per snippet
  const additionalBudgetPerSnippet = Math.floor(
    remainingBudget / snippetsToExpand.length
  );

  // Expand each snippet with additional budget
  for (const snippet of snippetsToExpand) {
    const processedSnippet = processedMap.get(snippet.entity.entity_id);
    const currentLength = processedSnippet.summarizedContent.length;
    const newBudget = currentLength + additionalBudgetPerSnippet;

    // Get content from snippet
    const content = snippet.content || snippet.entity.raw_content || "";

    // If original content fits in new budget, use it
    if (content.length <= newBudget) {
      processedSnippet.summarizedContent = content;
      remainingBudget -= content.length - currentLength;
    } else {
      // Otherwise, re-summarize with expanded budget
      let expandedContent;

      if (snippet.entity.entity_type) {
        expandedContent = summarizeCodeEntity(
          snippet.entity,
          newBudget,
          queryKeywords
        );
      } else {
        expandedContent = summarizeText(content, newBudget);
      }

      if (expandedContent && expandedContent.length > currentLength) {
        remainingBudget -= expandedContent.length - currentLength;
        processedSnippet.summarizedContent = expandedContent;
      }
    }

    // Stop if remaining budget gets too small
    if (remainingBudget < 100) {
      break;
    }
  }
}

/**
 * Summarize text to fit within a maximum length
 *
 * @param {string} text - The text to summarize
 * @param {number} maxLength - Maximum character length for the summary
 * @param {'rule-based' | 'ml-light'} [method='rule-based'] - Summarization method to use
 * @returns {string} Summarized text
 */
export function summarizeText(text, maxLength, method = "rule-based") {
  // Validate inputs
  if (!text) return "";
  if (text.length <= maxLength) return text;

  // Check method and apply fallback if necessary
  if (method === "ml-light") {
    console.log(
      "ML-light summarization not fully implemented, falling back to rule-based method"
    );
    method = "rule-based";
  }

  // Apply rule-based summarization
  return ruleBased(text, maxLength);
}

/**
 * Summarize a code entity based on its type and content
 *
 * @param {Object} entity - Code entity object from code_entities table
 * @param {number} budget - Maximum characters for the summary
 * @param {string[]} [queryKeywords] - Optional keywords to highlight in the summary
 * @returns {string} Summarized entity content
 */
export function summarizeCodeEntity(entity, budget, queryKeywords = []) {
  // Check if entity is valid
  if (!entity) return "";

  // Use existing summary if available and within budget
  if (entity.summary && entity.summary.length <= budget) {
    return entity.summary;
  }

  // If raw content is empty, return entity name
  if (!entity.raw_content) {
    return `${entity.name} (${entity.entity_type})`;
  }

  // If raw content fits within budget, return it directly
  if (entity.raw_content.length <= budget) {
    return entity.raw_content;
  }

  // Generate summary based on entity type
  const entityType = (entity.entity_type || "").toLowerCase();

  switch (entityType) {
    case "function":
    case "method":
      return summarizeFunction(entity, budget, queryKeywords);

    case "class":
      return summarizeClass(entity, budget, queryKeywords);

    case "file":
      return summarizeFile(entity, budget, queryKeywords);

    default:
      // For other entity types, use generic text summarization
      return summarizeText(entity.raw_content, budget);
  }
}

/**
 * Summarize a function or method
 *
 * @param {Object} entity - Function entity
 * @param {number} budget - Character budget
 * @param {string[]} queryKeywords - Keywords to prioritize
 * @returns {string} Function summary
 */
function summarizeFunction(entity, budget, queryKeywords) {
  const content = entity.raw_content;
  const lines = content.split("\n");

  // Extract function signature
  const signatureLine = extractFunctionSignature(lines);

  // If we can only fit the signature, return just that
  if (signatureLine.length >= budget - 10) {
    return truncateToMaxLength(signatureLine, budget);
  }

  // Score lines by importance
  const scoredLines = scoreCodeLines(lines, queryKeywords, "function");

  // Begin with the signature
  let summary = signatureLine;
  let remainingBudget = budget - signatureLine.length;

  // Add comment block if it exists
  const commentBlock = extractCommentBlock(lines);
  if (commentBlock && commentBlock.length < remainingBudget * 0.4) {
    summary += "\n" + commentBlock;
    remainingBudget -= commentBlock.length;
  }

  // Add important lines
  summary += "\n" + selectImportantLines(scoredLines, remainingBudget);

  // Ensure we're within budget
  return truncateToMaxLength(summary, budget);
}

/**
 * Summarize a class
 *
 * @param {Object} entity - Class entity
 * @param {number} budget - Character budget
 * @param {string[]} queryKeywords - Keywords to prioritize
 * @returns {string} Class summary
 */
function summarizeClass(entity, budget, queryKeywords) {
  const content = entity.raw_content;
  const lines = content.split("\n");

  // Extract class signature and method list
  const classSignature = extractClassSignature(lines);
  const methodList = extractMethodList(lines);

  // Start with class signature
  let summary = classSignature;
  let remainingBudget = budget - classSignature.length;

  // Add method list if it fits
  if (methodList && methodList.length < remainingBudget) {
    summary += "\n" + methodList;
    remainingBudget -= methodList.length;
  }

  // If we still have budget, add important lines
  if (remainingBudget > 50) {
    const scoredLines = scoreCodeLines(lines, queryKeywords, "class");
    summary += "\n" + selectImportantLines(scoredLines, remainingBudget);
  }

  return truncateToMaxLength(summary, budget);
}

/**
 * Summarize a file
 *
 * @param {Object} entity - File entity
 * @param {number} budget - Character budget
 * @param {string[]} queryKeywords - Keywords to prioritize
 * @returns {string} File summary
 */
function summarizeFile(entity, budget, queryKeywords) {
  const content = entity.raw_content;
  const lines = content.split("\n");

  // Check if it's a README or documentation file
  const isDocFile =
    (entity.name || "").toLowerCase().includes("readme") ||
    (entity.name || "").toLowerCase().includes("doc");

  if (isDocFile) {
    // For documentation files, use text summarization
    return summarizeText(content, budget);
  }

  // Extract import/require statements
  const importStatements = lines
    .filter(
      (line) =>
        line.trim().startsWith("import ") ||
        line.trim().startsWith("require(") ||
        line.trim().startsWith("from ") ||
        line.trim().includes(" from ")
    )
    .join("\n");

  // Extract export statements
  const exportStatements = lines
    .filter(
      (line) =>
        line.trim().startsWith("export ") ||
        line.trim().startsWith("module.exports")
    )
    .join("\n");

  // Start building summary
  let summary = `// File: ${entity.name || "Unnamed"}\n`;

  // Add imports if they fit
  if (importStatements && importStatements.length < budget * 0.3) {
    summary += `// Imports:\n${importStatements}\n`;
  }

  // Add exports if they fit
  const remainingAfterImports = budget - summary.length;
  if (
    exportStatements &&
    exportStatements.length < remainingAfterImports * 0.3
  ) {
    summary += `// Exports:\n${exportStatements}\n`;
  }

  // Score and add other important lines
  const remainingBudget = budget - summary.length;
  if (remainingBudget > 100) {
    const scoredLines = scoreCodeLines(lines, queryKeywords, "file");
    summary += `// Key sections:\n${selectImportantLines(
      scoredLines,
      remainingBudget
    )}`;
  }

  return truncateToMaxLength(summary, budget);
}

/**
 * Extract function signature from code lines
 *
 * @param {string[]} lines - Code lines
 * @returns {string} Function signature
 */
function extractFunctionSignature(lines) {
  // Look for function declarations
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (
      line.match(
        /^(async\s+)?(function\s+\w+|\w+\s*=\s*(async\s+)?function|\w+\s*:\s*(async\s+)?function|const\s+\w+\s*=\s*(async\s+)?(\([^)]*\)|[^=]*)\s*=>)/
      )
    ) {
      // Function found, get signature and opening bracket
      let signature = line;

      // If the line doesn't contain an opening brace, look for it
      if (!line.includes("{") && !line.includes("=>")) {
        let j = i + 1;
        while (j < lines.length && !lines[j].includes("{")) {
          signature += " " + lines[j].trim();
          j++;
        }
        if (j < lines.length) {
          signature += " " + lines[j].trim().split("{")[0] + "{ ... }";
        }
      } else if (line.includes("{")) {
        signature = signature.split("{")[0] + "{ ... }";
      } else if (line.includes("=>")) {
        const arrowParts = signature.split("=>");
        signature = arrowParts[0] + "=> { ... }";
      }

      return signature;
    }
  }

  // If no function signature found, return a placeholder
  return "function() { ... }";
}

/**
 * Extract class signature from code lines
 *
 * @param {string[]} lines - Code lines
 * @returns {string} Class signature
 */
function extractClassSignature(lines) {
  // Look for class declarations
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("class ")) {
      // Class found, get signature and opening bracket
      let signature = line;

      // If the line doesn't contain an opening brace, look for it
      if (!line.includes("{")) {
        let j = i + 1;
        while (j < lines.length && !lines[j].includes("{")) {
          signature += " " + lines[j].trim();
          j++;
        }
        if (j < lines.length) {
          signature += " " + lines[j].trim().split("{")[0] + "{ ... }";
        }
      } else {
        signature = signature.split("{")[0] + "{ ... }";
      }

      return signature;
    }
  }

  // If no class signature found, return a placeholder
  return "class { ... }";
}

/**
 * Extract a list of methods from a class
 *
 * @param {string[]} lines - Code lines
 * @returns {string} Formatted method list
 */
function extractMethodList(lines) {
  const methods = [];

  // Regex to match method declarations
  const methodRegex = /^\s*(async\s+)?(\w+)\s*\([^)]*\)/;

  // Skip the first few lines to avoid matching the class declaration
  const startFromLine = Math.min(5, lines.length);

  for (let i = startFromLine; i < lines.length; i++) {
    const match = lines[i].match(methodRegex);
    if (match && !lines[i].trim().startsWith("//")) {
      methods.push(match[2]); // Push the method name
    }
  }

  if (methods.length === 0) {
    return "";
  }

  return `// Methods: ${methods.join(", ")}`;
}

/**
 * Extract comment block from the beginning of code
 *
 * @param {string[]} lines - Code lines
 * @returns {string} Comment block or empty string
 */
function extractCommentBlock(lines) {
  let inComment = false;
  let commentLines = [];

  for (let i = 0; i < Math.min(20, lines.length); i++) {
    const line = lines[i].trim();

    // Check for JSDoc style comment start
    if (line.startsWith("/**")) {
      inComment = true;
      commentLines.push(line);
      continue;
    }

    // Continue collecting comment lines
    if (inComment) {
      commentLines.push(line);
      if (line.endsWith("*/")) {
        break;
      }
    }

    // Check for single-line comments at the beginning
    if (!inComment && commentLines.length === 0 && line.startsWith("//")) {
      commentLines.push(line);
    } else if (!inComment && commentLines.length > 0 && line.startsWith("//")) {
      commentLines.push(line);
    } else if (!inComment && commentLines.length > 0) {
      // Stop if we've collected some comments and hit a non-comment line
      break;
    }
  }

  return commentLines.join("\n");
}

/**
 * Score code lines based on importance for summarization
 *
 * @param {string[]} lines - Code lines
 * @param {string[]} queryKeywords - Keywords to prioritize
 * @param {string} entityType - Type of entity
 * @returns {Array<{line: string, score: number, index: number}>} Scored lines
 */
function scoreCodeLines(lines, queryKeywords, entityType) {
  const scoredLines = [];

  // Important patterns to look for in code
  const importantPatterns = {
    function: [
      /\breturn\s+/, // Return statements
      /\bthrow\s+/, // Error handling
      /\bif\s*\(/, // Conditionals
      /\bfor\s*\(/, // Loops
      /\bcatch\s*\(/, // Error catching
      /\bswitch\s*\(/, // Switch statements
      /\bconst\s+\w+\s*=/, // Important variable declarations
      /\blet\s+\w+\s*=/, // Variable declarations
      /\/\/ [A-Z]/, // Comments that start with capital letters (likely important)
    ],
    class: [
      /\bconstructor\s*\(/, // Constructor
      /\bstatic\s+/, // Static methods/properties
      /\bget\s+\w+\s*\(/, // Getters
      /\bset\s+\w+\s*\(/, // Setters
      /\bextends\s+/, // Inheritance
      /\bimplements\s+/, // Interface implementation
      /\breturn\s+/, // Return statements
    ],
    file: [
      /\bexport\s+(default\s+)?function\s+/, // Exported functions
      /\bexport\s+(default\s+)?class\s+/, // Exported classes
      /\bexport\s+(default\s+)?const\s+/, // Exported constants
      /\bmodule\.exports\s*=/, // CommonJS exports
      /\bimport\s+/, // Imports
      /\brequire\s*\(/, // Requires
    ],
  };

  // Common patterns across all entity types
  const commonPatterns = [
    /\/\/ TODO:/, // TODOs
    /\/\/ FIXME:/, // FIXMEs
    /\/\/ NOTE:/, // Notes
    /\/\*\*/, // JSDoc comments
  ];

  // Get patterns for this entity type
  const patterns = [
    ...(importantPatterns[entityType] || []),
    ...commonPatterns,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // Skip empty lines

    let score = 0;

    // Check for keyword matches
    if (queryKeywords.length > 0) {
      const tokens = tokenize(line, { includeIdentifiers: true });
      const keywordMatches = queryKeywords.filter(
        (keyword) =>
          tokens.includes(keyword.toLowerCase()) ||
          line.toLowerCase().includes(keyword.toLowerCase())
      );

      score += keywordMatches.length * 3; // High weight for query keywords
    }

    // Check for important patterns
    for (const pattern of patterns) {
      if (pattern.test(line)) {
        score += 2;
        break;
      }
    }

    // Special score for first 5 and last 5 non-empty lines
    if (i < 5) {
      score += 1;
    }

    // Add a small score for lines with brackets (opening/closing) - structure indicators
    if (line.includes("{") || line.includes("}")) {
      score += 0.5;
    }

    // Push to scored lines
    scoredLines.push({
      line,
      score,
      index: i,
    });
  }

  // Sort by score (highest first)
  return scoredLines.sort((a, b) => b.score - a.score);
}

/**
 * Select important lines from scored lines, respecting the budget
 *
 * @param {Array<{line: string, score: number, index: number}>} scoredLines - Lines with scores
 * @param {number} budget - Character budget
 * @returns {string} Selected important lines
 */
function selectImportantLines(scoredLines, budget) {
  const selectedLines = [];
  let usedBudget = 0;

  // First, include all lines with a score above 3 (very important)
  const highScoreLines = scoredLines.filter((item) => item.score >= 3);

  for (const item of highScoreLines) {
    if (usedBudget + item.line.length + 1 <= budget) {
      // +1 for newline
      selectedLines.push(item);
      usedBudget += item.line.length + 1;
    }
  }

  // Then add other lines if we have budget left
  if (usedBudget < budget) {
    const remainingLines = scoredLines
      .filter((item) => item.score < 3)
      .sort((a, b) => b.score - a.score); // Sort by score

    for (const item of remainingLines) {
      if (usedBudget + item.line.length + 1 <= budget) {
        selectedLines.push(item);
        usedBudget += item.line.length + 1;
      }
    }
  }

  // Sort by original index to maintain code order
  selectedLines.sort((a, b) => a.index - b.index);

  return selectedLines.map((item) => item.line).join("\n");
}

/**
 * Apply rule-based extractive summarization
 *
 * @param {string} text - The text to summarize
 * @param {number} maxLength - Maximum character length for the summary
 * @returns {string} Summarized text
 */
function ruleBased(text, maxLength) {
  // Split text into sentences
  const sentences = splitIntoSentences(text);

  // If we have very few sentences, handle specially
  if (sentences.length <= 3) {
    // For 1-3 sentences, return as much as fits within maxLength
    return truncateToMaxLength(text, maxLength);
  }

  // Score sentences
  const scoredSentences = sentences.map((sentence, index) => ({
    text: sentence,
    score: scoreSentence(sentence, index, sentences.length),
    index,
  }));

  // Sort sentences by score (highest first)
  scoredSentences.sort((a, b) => b.score - a.score);

  // Select sentences to include in summary
  const selectedSentences = [];
  let currentLength = 0;

  for (const scored of scoredSentences) {
    // Check if adding this sentence would exceed maxLength
    if (currentLength + scored.text.length + 1 <= maxLength) {
      // +1 for space
      selectedSentences.push(scored);
      currentLength += scored.text.length + 1;
    } else {
      // If we can't add even the highest-scoring sentence, we need to truncate
      if (selectedSentences.length === 0) {
        return truncateToMaxLength(scored.text, maxLength);
      }
      // Otherwise, we've selected as many as we can
      break;
    }
  }

  // Sort selected sentences by original position to maintain coherence
  selectedSentences.sort((a, b) => a.index - b.index);

  // Join selected sentences
  const summary = selectedSentences.map((s) => s.text).join(" ");

  // Final check to ensure we're within maxLength
  return truncateToMaxLength(summary, maxLength);
}

/**
 * Split text into sentences using regex
 *
 * @param {string} text - Text to split into sentences
 * @returns {string[]} Array of sentences
 */
function splitIntoSentences(text) {
  // This regex handles common sentence endings (., !, ?)
  // It tries to handle abbreviations, decimal numbers, etc.
  const sentenceRegex = /[^.!?]*[.!?](?:\s|$)/g;
  const matches = text.match(sentenceRegex);

  if (!matches) {
    // If no matches (perhaps text doesn't end with punctuation),
    // return the whole text as one sentence
    return [text];
  }

  // Clean up sentences (trim whitespace)
  return matches.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Score a sentence based on heuristics
 *
 * @param {string} sentence - The sentence to score
 * @param {number} index - Index of sentence in original text
 * @param {number} totalSentences - Total number of sentences in text
 * @returns {number} Score for the sentence (higher is more important)
 */
function scoreSentence(sentence, index, totalSentences) {
  let score = 0;

  // 1. Position score - first and last sentences are often important
  if (index === 0) {
    score += 3; // First sentence bonus
  } else if (index === totalSentences - 1) {
    score += 2; // Last sentence bonus
  } else if (index === 1 || index === totalSentences - 2) {
    score += 1; // Second and second-to-last sentence small bonus
  }

  // 2. Length score - penalize very short or very long sentences
  const wordCount = sentence.split(/\s+/).length;
  if (wordCount >= 5 && wordCount <= 20) {
    score += 1; // Ideal length
  } else if (wordCount < 3 || wordCount > 30) {
    score -= 1; // Too short or too long
  }

  // 3. Content score - check for indicators of important content
  const importantPhrases = [
    "key",
    "important",
    "significant",
    "critical",
    "essential",
    "main",
    "primary",
    "crucial",
    "fundamental",
    "vital",
    "result",
    "conclude",
    "summary",
    "therefore",
    "thus",
    "implement",
    "function",
    "method",
    "class",
    "object",
    "return",
    "export",
    "import",
    "require",
    "define",
  ];

  const lowerSentence = sentence.toLowerCase();

  for (const phrase of importantPhrases) {
    if (lowerSentence.includes(phrase)) {
      score += 1;
      break; // Only count once for important phrases
    }
  }

  // 4. Code indication score - sentences with code patterns are often important
  if (
    lowerSentence.includes("function") ||
    lowerSentence.includes("class") ||
    lowerSentence.includes("=") ||
    lowerSentence.includes("return") ||
    sentence.includes("()") ||
    sentence.includes("{}") ||
    sentence.includes("[]")
  ) {
    score += 2; // Code-related sentences are important in programming context
  }

  return score;
}

/**
 * Truncate text to ensure it doesn't exceed maxLength
 *
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum character length
 * @returns {string} Truncated text
 */
function truncateToMaxLength(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }

  // Try to cut at a sentence boundary
  for (let i = maxLength - 1; i >= 0; i--) {
    if (text[i] === "." || text[i] === "!" || text[i] === "?") {
      return text.substring(0, i + 1);
    }
  }

  // If no sentence boundary found, cut at a word boundary
  for (let i = maxLength - 1; i >= 0; i--) {
    if (text[i] === " ") {
      return text.substring(0, i) + "...";
    }
  }

  // If all else fails, just truncate
  return text.substring(0, maxLength - 3) + "...";
}

/**
 * Compresses a collection of context items to fit within token budget
 *
 * @param {Array<Object>} contextItems - Array of context items to compress
 * @param {Object} options - Compression options
 * @param {string} [options.detailLevel='medium'] - Detail level: 'high', 'medium', or 'low'
 * @param {number} [options.targetTokens=2000] - Target token count
 * @param {string[]} [options.queryKeywords=[]] - Optional query keywords for summarization
 * @returns {Promise<Array<Object>>} Compressed context items
 */
export async function compressContext(contextItems, options = {}) {
  if (!contextItems || contextItems.length === 0) {
    return [];
  }

  const detailLevel = options.detailLevel || "medium";
  const targetTokens = options.targetTokens || 2000;
  const queryKeywords = options.queryKeywords || [];

  // Estimate average tokens per character for budget calculation
  // This is a rough approximation (average English word is ~5 chars + 1 for space)
  const tokensPerChar = 1 / 6;

  // Convert token budget to character budget
  const charBudget = Math.floor(targetTokens / tokensPerChar);

  // Map context items to the format expected by manageTokenBudget
  const scoredSnippets = contextItems.map((item) => ({
    entity: {
      entity_id: item.entity_id,
      entity_type: item.type,
      raw_content: item.content,
      name: item.name,
      file_path: item.path,
    },
    score: item.relevanceScore || 0.5,
    content: item.content,
  }));

  // Apply detail level modifiers to budget
  let modifiedBudget = charBudget;
  switch (detailLevel) {
    case "high":
      // Increase budget by 30% for high detail
      modifiedBudget = Math.floor(charBudget * 1.3);
      break;
    case "low":
      // Decrease budget by 30% for low detail
      modifiedBudget = Math.floor(charBudget * 0.7);
      break;
    default:
      // Keep original budget for medium detail
      break;
  }

  // Process snippets using manageTokenBudget
  const processedSnippets = manageTokenBudget(
    scoredSnippets,
    modifiedBudget,
    queryKeywords
  );

  // Transform back to the original format
  return processedSnippets
    .map((processed) => {
      // Find the original item to copy properties from
      const originalItem = contextItems.find(
        (item) => item.entity_id === processed.entity_id
      );
      if (!originalItem) return null;

      return {
        ...originalItem,
        content: processed.summarizedContent,
        // Add compression metadata
        compression: {
          originalLength: originalItem.content.length,
          compressedLength: processed.summarizedContent.length,
          compressionRatio:
            processed.summarizedContent.length / originalItem.content.length,
          detailLevel,
        },
      };
    })
    .filter(Boolean); // Remove any nulls
}
