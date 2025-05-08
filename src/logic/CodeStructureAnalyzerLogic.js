/**
 * CodeStructureAnalyzerLogic.js
 *
 * Provides code structure analysis capabilities by parsing code into an AST
 * (Abstract Syntax Tree) for further analysis and understanding.
 */

import * as acorn from "acorn";
import { executeQuery } from "../db.js";
import { logMessage } from "../utils/logger.js";

/**
 * Builds an abstract syntax tree (AST) from code content
 *
 * @param {string} content - The code content to parse
 * @param {string} language - The programming language of the code
 * @returns {Promise<Object|null>} The AST node (for JS/TS) or null for unsupported languages
 */
export async function buildAST(content, language) {
  // Check if we're in MCP mode - control logging
  const inMcpMode = process.env.MCP_MODE === "true";

  // Handle empty content
  if (!content || content.trim() === "") {
    if (!inMcpMode) {
      logMessage("warn", "Empty code content provided to buildAST");
    }
    return null;
  }

  // Normalize language to lowercase
  const normalizedLanguage = language ? language.toLowerCase() : "unknown";

  // Handle JavaScript and TypeScript parsing with acorn
  if (
    ["javascript", "typescript", "js", "ts", "jsx", "tsx"].includes(
      normalizedLanguage
    )
  ) {
    try {
      // Configure acorn parser options
      const options = {
        ecmaVersion: "latest",
        sourceType: "module",
        locations: true,
        ranges: true,
        // Enable JSX parsing if the language includes 'jsx' or 'tsx'
        allowAwaitOutsideFunction: true,
        allowImportExportEverywhere: true,
        allowReserved: true,
        allowReturnOutsideFunction: false,
        allowSuperOutsideMethod: false,
      };

      // Parse the content using acorn
      const ast = acorn.parse(content, options);

      // Log successful parsing in non-MCP mode
      if (!inMcpMode) {
        logMessage("debug", `Successfully parsed ${normalizedLanguage} code`, {
          bodyType: ast.type,
          bodyLength: ast.body ? ast.body.length : 0,
        });
      }

      return ast;
    } catch (error) {
      if (!inMcpMode) {
        logMessage("error", `Error parsing ${normalizedLanguage} code:`, {
          message: error.message,
          location: error.loc
            ? `${error.loc.line}:${error.loc.column}`
            : "unknown",
        });
      }

      // Return a structured error object instead of null
      return {
        error: true,
        message: error.message,
        location: error.loc,
        type: "AST_PARSE_ERROR",
      };
    }
  } else {
    // For unsupported languages, try to use regex-based extraction
    if (!inMcpMode) {
      logMessage(
        "info",
        `AST generation not supported for ${normalizedLanguage}, using regex fallback`
      );
    }

    // Return null to signal fallback to regex
    return null;
  }
}

/**
 * Extracts structural features from an Abstract Syntax Tree
 *
 * @param {Object} ast - The AST node (output from buildAST)
 * @returns {Object} Object containing features array and complexity number
 */
export function extractStructuralFeatures(ast) {
  // Handle null or invalid AST
  if (!ast || ast.error) {
    return { features: [], complexity: 0 };
  }

  // Initialize the result object
  const result = {
    features: [],
    complexity: 1, // Base complexity is 1
  };

  // Track maximum nesting depth
  let maxNestingDepth = 0;
  let currentNestingDepth = 0;

  // Track visited nodes to prevent infinite recursion in case of circular references
  const visitedNodes = new WeakSet();

  // Visit function to traverse the AST
  function visit(node, parentNode = null, currentScope = "global") {
    // Skip if node is null, undefined, or already visited
    if (!node || visitedNodes.has(node)) {
      return;
    }

    visitedNodes.add(node);

    // Skip non-object nodes (primitive values)
    if (typeof node !== "object") {
      return;
    }

    // Get line number if available
    const line = node.loc?.start?.line;

    // Process node based on its type
    switch (node.type) {
      // Control flow statements
      case "IfStatement":
        result.features.push({
          type: "control_flow",
          statement: "if",
          line,
          nesting: currentNestingDepth,
        });
        result.complexity++; // Add to cyclomatic complexity
        break;

      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement":
        result.features.push({
          type: "control_flow",
          statement: "for",
          line,
          nesting: currentNestingDepth,
        });
        result.complexity++; // Add to cyclomatic complexity
        break;

      case "WhileStatement":
      case "DoWhileStatement":
        result.features.push({
          type: "control_flow",
          statement: "while",
          line,
          nesting: currentNestingDepth,
        });
        result.complexity++; // Add to cyclomatic complexity
        break;

      case "SwitchStatement":
        result.features.push({
          type: "control_flow",
          statement: "switch",
          line,
          nesting: currentNestingDepth,
        });
        // Each case adds to complexity
        const caseCount = node.cases?.length || 0;
        result.complexity += caseCount > 0 ? caseCount - 1 : 0;
        break;

      case "TryStatement":
        result.features.push({
          type: "control_flow",
          statement: "try",
          line,
          nesting: currentNestingDepth,
        });
        // Catch and finally don't add to complexity, but we record them
        break;

      case "ConditionalExpression": // ternary operator: a ? b : c
        result.features.push({
          type: "control_flow",
          statement: "conditional",
          line,
          nesting: currentNestingDepth,
        });
        result.complexity++; // Add to cyclomatic complexity
        break;

      case "LogicalExpression":
        if (node.operator === "&&" || node.operator === "||") {
          result.features.push({
            type: "control_flow",
            statement: "logical",
            operator: node.operator,
            line,
            nesting: currentNestingDepth,
          });
          result.complexity++; // Logical expressions add to complexity
        }
        break;

      // Function declarations and expressions
      case "FunctionDeclaration":
        result.features.push({
          type: "function_declaration",
          name: node.id?.name || "anonymous",
          params: node.params?.length || 0,
          line,
          async: node.async || false,
          generator: node.generator || false,
        });
        // Enter a new scope
        currentScope = node.id?.name || "anonymous";
        break;

      case "FunctionExpression":
      case "ArrowFunctionExpression":
        result.features.push({
          type: "function_expression",
          name: node.id?.name || "anonymous",
          params: node.params?.length || 0,
          line,
          async: node.async || false,
          generator:
            node.type === "FunctionExpression"
              ? node.generator || false
              : false,
          arrow: node.type === "ArrowFunctionExpression",
        });
        // Enter an anonymous scope
        currentScope = node.id?.name || "anonymous";
        break;

      // Function calls
      case "CallExpression":
        let callName = "unknown";

        // Determine the function name being called
        if (node.callee.type === "Identifier") {
          callName = node.callee.name;
        } else if (node.callee.type === "MemberExpression") {
          // For expressions like object.method()
          if (
            node.callee.property &&
            node.callee.property.type === "Identifier"
          ) {
            callName = node.callee.property.name;
            // If we can determine the object name, include it
            if (
              node.callee.object &&
              node.callee.object.type === "Identifier"
            ) {
              callName = `${node.callee.object.name}.${callName}`;
            }
          }
        }

        result.features.push({
          type: "function_call",
          name: callName,
          arguments: node.arguments?.length || 0,
          line,
        });
        break;

      // Variable declarations
      case "VariableDeclaration":
        // Process each declarator separately
        node.declarations.forEach((declarator) => {
          if (declarator.id && declarator.id.type === "Identifier") {
            result.features.push({
              type: "variable_declaration",
              name: declarator.id.name,
              kind: node.kind, // 'var', 'let', or 'const'
              scope: currentScope,
              line,
              initialized: declarator.init !== null,
            });
          }
        });
        break;

      // Class declarations
      case "ClassDeclaration":
        result.features.push({
          type: "class_declaration",
          name: node.id?.name || "anonymous",
          extends: node.superClass ? node.superClass.name || "unknown" : null,
          line,
        });
        break;

      // Import / Export statements
      case "ImportDeclaration":
        result.features.push({
          type: "import",
          source: node.source?.value,
          line,
        });
        break;

      case "ExportNamedDeclaration":
      case "ExportDefaultDeclaration":
        result.features.push({
          type: "export",
          default: node.type === "ExportDefaultDeclaration",
          line,
        });
        break;
    }

    // Track nesting depth for block statements
    if (node.type === "BlockStatement") {
      currentNestingDepth++;
      maxNestingDepth = Math.max(maxNestingDepth, currentNestingDepth);
    }

    // Recursively visit all child nodes
    for (const key in node) {
      const child = node[key];

      // Skip special properties and non-AST properties
      if (
        key === "type" ||
        key === "loc" ||
        key === "range" ||
        key === "parent" ||
        key === "leadingComments" ||
        key === "trailingComments"
      ) {
        continue;
      }

      if (Array.isArray(child)) {
        // For arrays (like body), visit each element
        for (const item of child) {
          visit(item, node, currentScope);
        }
      } else if (child && typeof child === "object") {
        // Visit child node
        visit(child, node, currentScope);
      }
    }

    // Decrement nesting depth when leaving a block
    if (node.type === "BlockStatement") {
      currentNestingDepth--;
    }
  }

  // Start traversal from the root node
  visit(ast);

  // Add overall nesting depth as a feature
  result.features.push({
    type: "metadata",
    name: "max_nesting_depth",
    value: maxNestingDepth,
  });

  return result;
}

/**
 * Stores structural metadata for a code entity in the database
 *
 * @param {string} entityId - ID of the code entity
 * @param {Array} features - Array of structural features from extractStructuralFeatures
 * @returns {Promise<void>} Promise that resolves when the update is complete
 */
export async function storeStructuralMetadata(entityId, features) {
  if (!entityId) {
    throw new Error("Entity ID is required for storing structural metadata");
  }

  if (!features || !Array.isArray(features)) {
    throw new Error("Features must be a valid array");
  }

  try {
    // First, retrieve the current custom_metadata to merge with it
    const currentMetadataQuery = `
      SELECT custom_metadata 
      FROM code_entities 
      WHERE id = ?
    `;

    const result = await executeQuery(currentMetadataQuery, [entityId]);

    // Parse existing metadata or initialize as empty object
    let existingMetadata = {};

    if (result && result.length > 0 && result[0].custom_metadata) {
      try {
        // Handle the case where custom_metadata might be stored as a string or object
        const metadataValue = result[0].custom_metadata;
        existingMetadata =
          typeof metadataValue === "string"
            ? JSON.parse(metadataValue)
            : metadataValue;
      } catch (parseError) {
        console.warn(
          `Error parsing existing metadata for entity ${entityId}:`,
          parseError
        );
        // Continue with empty object if parsing fails
      }
    }

    // Create the updated metadata by merging with existing
    // Overwrite specifically the structural_features key
    const updatedMetadata = {
      ...existingMetadata,
      structural_features: features,
      // Add timestamp of when this analysis was performed
      structural_analysis_timestamp: new Date().toISOString(),
    };

    // Prepare the UPDATE query
    const updateQuery = `
      UPDATE code_entities 
      SET 
        custom_metadata = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;

    // Execute the query with the serialized metadata
    await executeQuery(updateQuery, [
      JSON.stringify(updatedMetadata),
      entityId,
    ]);

    console.log(`Structural metadata updated for entity ${entityId}`);
  } catch (error) {
    console.error(
      `Error storing structural metadata for entity ${entityId}:`,
      error
    );
    throw error; // Re-throw to allow caller to handle
  }
}

/**
 * Compares two Abstract Syntax Trees to determine structural similarity
 *
 * @param {Object} ast1 - First AST node
 * @param {Object} ast2 - Second AST node
 * @returns {Object} Object containing similarity score and array of differences
 */
export function compareStructures(ast1, ast2) {
  // Handle null or invalid ASTs
  if (!ast1 || ast1.error || !ast2 || ast2.error) {
    return {
      similarity: 0,
      differences: [
        {
          type: "invalid_ast",
          description: "One or both ASTs are null or invalid",
        },
      ],
    };
  }

  // Array to collect structural differences
  const differences = [];

  // Extract node type distributions from both ASTs
  const dist1 = extractNodeTypeDistribution(ast1);
  const dist2 = extractNodeTypeDistribution(ast2);

  // Compare basic tree structure statistics
  const basicStats1 = extractBasicStats(ast1);
  const basicStats2 = extractBasicStats(ast2);

  // Generate structural fingerprints for comparison
  const fingerprint1 = generateStructuralFingerprint(ast1);
  const fingerprint2 = generateStructuralFingerprint(ast2);

  // Calculate similarity based on various metrics
  const typeSimilarity = calculateTypeDistributionSimilarity(dist1, dist2);
  const statsSimilarity = calculateStatsSimilarity(basicStats1, basicStats2);
  const fingerprintSimilarity = calculateFingerprintSimilarity(
    fingerprint1,
    fingerprint2
  );

  // Detect key structural differences
  detectStructuralDifferences(ast1, ast2, differences);

  // Weight the different similarity components for a final score
  // Fingerprint similarity should have the highest weight as it captures structure
  const similarity =
    typeSimilarity * 0.3 + statsSimilarity * 0.2 + fingerprintSimilarity * 0.5;

  // Return bounded similarity score and differences
  return {
    similarity: Math.max(0, Math.min(1, similarity)), // Ensure between 0 and 1
    differences,
  };
}

/**
 * Extracts the distribution of node types in an AST
 *
 * @param {Object} ast - The AST to analyze
 * @returns {Object} Map of node types to their frequency
 * @private
 */
function extractNodeTypeDistribution(ast) {
  const distribution = {};
  const visitedNodes = new WeakSet();

  function visit(node) {
    if (!node || typeof node !== "object" || visitedNodes.has(node)) {
      return;
    }

    visitedNodes.add(node);

    if (node.type) {
      distribution[node.type] = (distribution[node.type] || 0) + 1;
    }

    // Recursively visit child nodes
    for (const key in node) {
      const child = node[key];

      if (key === "type" || key === "loc" || key === "range") {
        continue;
      }

      if (Array.isArray(child)) {
        for (const item of child) {
          visit(item);
        }
      } else if (child && typeof child === "object") {
        visit(child);
      }
    }
  }

  visit(ast);
  return distribution;
}

/**
 * Extracts basic structural statistics from an AST
 *
 * @param {Object} ast - The AST to analyze
 * @returns {Object} Basic structure statistics
 * @private
 */
function extractBasicStats(ast) {
  const stats = {
    nodeCount: 0,
    maxDepth: 0,
    leafCount: 0,
    blockCount: 0,
    functionCount: 0,
    expressionCount: 0,
  };

  const visitedNodes = new WeakSet();

  function visit(node, depth = 0) {
    if (!node || typeof node !== "object" || visitedNodes.has(node)) {
      return;
    }

    visitedNodes.add(node);
    stats.nodeCount++;
    stats.maxDepth = Math.max(stats.maxDepth, depth);

    let hasChildren = false;

    // Count specific node types
    if (node.type) {
      if (node.type === "BlockStatement") {
        stats.blockCount++;
      } else if (
        node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression"
      ) {
        stats.functionCount++;
      } else if (node.type.includes("Expression")) {
        stats.expressionCount++;
      }
    }

    // Recursively visit child nodes
    for (const key in node) {
      const child = node[key];

      if (key === "type" || key === "loc" || key === "range") {
        continue;
      }

      if (Array.isArray(child)) {
        if (child.length > 0) {
          hasChildren = true;
          for (const item of child) {
            visit(item, depth + 1);
          }
        }
      } else if (child && typeof child === "object") {
        hasChildren = true;
        visit(child, depth + 1);
      }
    }

    if (!hasChildren) {
      stats.leafCount++;
    }
  }

  visit(ast);
  return stats;
}

/**
 * Generates a structural fingerprint for an AST
 * This creates a simplified representation of the AST structure
 *
 * @param {Object} ast - The AST to fingerprint
 * @returns {Object} Structural fingerprint with depth-based node sequences
 * @private
 */
function generateStructuralFingerprint(ast) {
  const fingerprint = {
    // Store sequences of node types at each depth
    sequencesByDepth: {},
    // Store parent-child type relationships
    relationships: {},
    // Top-level node structure
    topLevel: [],
  };

  const visitedNodes = new WeakSet();

  function visit(node, depth = 0, path = "") {
    if (!node || typeof node !== "object" || visitedNodes.has(node)) {
      return;
    }

    visitedNodes.add(node);

    if (node.type) {
      // Add to sequence at this depth
      if (!fingerprint.sequencesByDepth[depth]) {
        fingerprint.sequencesByDepth[depth] = [];
      }
      fingerprint.sequencesByDepth[depth].push(node.type);

      // For root level nodes, capture more detail
      if (depth === 1 && node.type) {
        fingerprint.topLevel.push(node.type);
      }
    }

    // Recursively visit child nodes
    for (const key in node) {
      const child = node[key];

      if (key === "type" || key === "loc" || key === "range") {
        continue;
      }

      if (Array.isArray(child)) {
        for (let i = 0; i < child.length; i++) {
          const item = child[i];
          const newPath = `${path}.${key}[${i}]`;

          if (item && item.type && node.type) {
            const relationship = `${node.type}->${item.type}`;
            fingerprint.relationships[relationship] =
              (fingerprint.relationships[relationship] || 0) + 1;
          }

          visit(item, depth + 1, newPath);
        }
      } else if (child && typeof child === "object") {
        const newPath = `${path}.${key}`;

        if (child.type && node.type) {
          const relationship = `${node.type}->${child.type}`;
          fingerprint.relationships[relationship] =
            (fingerprint.relationships[relationship] || 0) + 1;
        }

        visit(child, depth + 1, newPath);
      }
    }
  }

  visit(ast, 0, "root");
  return fingerprint;
}

/**
 * Calculates similarity between two node type distributions
 *
 * @param {Object} dist1 - First node type distribution
 * @param {Object} dist2 - Second node type distribution
 * @returns {number} Similarity score between 0 and 1
 * @private
 */
function calculateTypeDistributionSimilarity(dist1, dist2) {
  // Get all unique node types
  const allTypes = new Set([...Object.keys(dist1), ...Object.keys(dist2)]);

  if (allTypes.size === 0) {
    return 0;
  }

  // Calculate cosine similarity
  let dotProduct = 0;
  let magnitude1 = 0;
  let magnitude2 = 0;

  for (const type of allTypes) {
    const count1 = dist1[type] || 0;
    const count2 = dist2[type] || 0;

    dotProduct += count1 * count2;
    magnitude1 += count1 * count1;
    magnitude2 += count2 * count2;
  }

  magnitude1 = Math.sqrt(magnitude1);
  magnitude2 = Math.sqrt(magnitude2);

  if (magnitude1 === 0 || magnitude2 === 0) {
    return 0;
  }

  return dotProduct / (magnitude1 * magnitude2);
}

/**
 * Calculates similarity between two sets of basic structure statistics
 *
 * @param {Object} stats1 - First structure statistics
 * @param {Object} stats2 - Second structure statistics
 * @returns {number} Similarity score between 0 and 1
 * @private
 */
function calculateStatsSimilarity(stats1, stats2) {
  // Normalize and compare key statistics
  const metrics = [
    "nodeCount",
    "maxDepth",
    "leafCount",
    "blockCount",
    "functionCount",
    "expressionCount",
  ];

  let totalSimilarity = 0;

  for (const metric of metrics) {
    // If both values are 0, consider them perfectly similar for this metric
    if (stats1[metric] === 0 && stats2[metric] === 0) {
      totalSimilarity += 1;
      continue;
    }

    // Calculate ratio of smaller to larger value
    const ratio =
      Math.min(stats1[metric], stats2[metric]) /
      Math.max(stats1[metric], stats2[metric]);

    totalSimilarity += ratio;
  }

  return totalSimilarity / metrics.length;
}

/**
 * Calculates similarity between two structural fingerprints
 *
 * @param {Object} fp1 - First fingerprint
 * @param {Object} fp2 - Second fingerprint
 * @returns {number} Similarity score between 0 and 1
 * @private
 */
function calculateFingerprintSimilarity(fp1, fp2) {
  // Compare sequences at each depth (with higher weight for lower depths)
  let sequenceSimilarity = 0;
  let totalWeight = 0;

  // Find the maximum depth across both fingerprints
  const maxDepth = Math.max(
    ...Object.keys(fp1.sequencesByDepth).map(Number),
    ...Object.keys(fp2.sequencesByDepth).map(Number)
  );

  for (let depth = 0; depth <= maxDepth; depth++) {
    const seq1 = fp1.sequencesByDepth[depth] || [];
    const seq2 = fp2.sequencesByDepth[depth] || [];

    // Skip if both sequences are empty
    if (seq1.length === 0 && seq2.length === 0) {
      continue;
    }

    // Calculate longest common subsequence length
    const lcsLength = longestCommonSubsequenceLength(seq1, seq2);

    // Calculate sequence similarity as ratio of LCS to max length
    const maxSeqLength = Math.max(seq1.length, seq2.length);
    const seqSimilarity = maxSeqLength > 0 ? lcsLength / maxSeqLength : 0;

    // Weight decreases with depth (root nodes are more important)
    const weight = 1 / (depth + 1);
    sequenceSimilarity += seqSimilarity * weight;
    totalWeight += weight;
  }

  const normalizedSequenceSimilarity =
    totalWeight > 0 ? sequenceSimilarity / totalWeight : 0;

  // Compare top-level structure (higher weight)
  const topLevelSimilarity = compareArrays(fp1.topLevel, fp2.topLevel);

  // Compare parent-child relationships
  const relationshipSimilarity = compareRelationships(
    fp1.relationships,
    fp2.relationships
  );

  // Combine with weights
  return (
    normalizedSequenceSimilarity * 0.4 +
    topLevelSimilarity * 0.4 +
    relationshipSimilarity * 0.2
  );
}

/**
 * Compares arrays by finding elements in common
 *
 * @param {Array} arr1 - First array
 * @param {Array} arr2 - Second array
 * @returns {number} Similarity score between 0 and 1
 * @private
 */
function compareArrays(arr1, arr2) {
  if (arr1.length === 0 && arr2.length === 0) {
    return 1; // Both empty means they're identical
  }

  if (arr1.length === 0 || arr2.length === 0) {
    return 0; // One empty means no similarity
  }

  // Count elements in common
  const set1 = new Set(arr1);
  const set2 = new Set(arr2);

  let common = 0;
  for (const item of set1) {
    if (set2.has(item)) {
      common++;
    }
  }

  // Jaccard similarity: intersection size / union size
  const union = set1.size + set2.size - common;
  return union > 0 ? common / union : 0;
}

/**
 * Compares relationship maps between two fingerprints
 *
 * @param {Object} rel1 - First relationship map
 * @param {Object} rel2 - Second relationship map
 * @returns {number} Similarity score between 0 and 1
 * @private
 */
function compareRelationships(rel1, rel2) {
  const allRelationships = new Set([
    ...Object.keys(rel1),
    ...Object.keys(rel2),
  ]);

  if (allRelationships.size === 0) {
    return 0;
  }

  let similarity = 0;

  for (const rel of allRelationships) {
    const count1 = rel1[rel] || 0;
    const count2 = rel2[rel] || 0;

    // Ratio of smaller to larger count
    const ratio = Math.min(count1, count2) / Math.max(count1, count2);
    similarity += ratio;
  }

  return similarity / allRelationships.size;
}

/**
 * Finds the length of the longest common subsequence of two arrays
 *
 * @param {Array} arr1 - First array
 * @param {Array} arr2 - Second array
 * @returns {number} Length of longest common subsequence
 * @private
 */
function longestCommonSubsequenceLength(arr1, arr2) {
  if (!arr1.length || !arr2.length) {
    return 0;
  }

  // Initialize DP table
  const dp = Array(arr1.length + 1)
    .fill()
    .map(() => Array(arr2.length + 1).fill(0));

  // Fill the DP table
  for (let i = 1; i <= arr1.length; i++) {
    for (let j = 1; j <= arr2.length; j++) {
      if (arr1[i - 1] === arr2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp[arr1.length][arr2.length];
}

/**
 * Detects structural differences between two ASTs and adds them to the differences array
 *
 * @param {Object} ast1 - First AST
 * @param {Object} ast2 - Second AST
 * @param {Array} differences - Array to store detected differences
 * @private
 */
function detectStructuralDifferences(ast1, ast2, differences) {
  // Extract basic stats for comparison
  const stats1 = extractBasicStats(ast1);
  const stats2 = extractBasicStats(ast2);

  // Compare node counts
  const nodeDiff = Math.abs(stats1.nodeCount - stats2.nodeCount);
  const nodeRatio =
    stats1.nodeCount === 0 && stats2.nodeCount === 0
      ? 1
      : Math.min(stats1.nodeCount, stats2.nodeCount) /
        Math.max(stats1.nodeCount, stats2.nodeCount);

  if (nodeRatio < 0.7) {
    differences.push({
      type: "node_count_mismatch",
      description: `Node count differs significantly: ${stats1.nodeCount} vs ${stats2.nodeCount}`,
      severity: "high",
    });
  }

  // Compare depth
  if (Math.abs(stats1.maxDepth - stats2.maxDepth) > 2) {
    differences.push({
      type: "depth_mismatch",
      description: `Tree depth differs: ${stats1.maxDepth} vs ${stats2.maxDepth}`,
      severity: "medium",
    });
  }

  // Compare function counts
  if (stats1.functionCount !== stats2.functionCount) {
    differences.push({
      type: "function_count_mismatch",
      description: `Function count differs: ${stats1.functionCount} vs ${stats2.functionCount}`,
      severity: "medium",
    });
  }

  // Compare root structure
  const rootType1 = ast1.type;
  const rootType2 = ast2.type;

  if (rootType1 !== rootType2) {
    differences.push({
      type: "root_type_mismatch",
      description: `Root node type differs: ${rootType1} vs ${rootType2}`,
      severity: "high",
    });
  }

  // Analyze top-level structure
  const body1 = ast1.body || [];
  const body2 = ast2.body || [];

  if (body1.length !== body2.length) {
    differences.push({
      type: "program_body_length_mismatch",
      description: `Program body length differs: ${body1.length} vs ${body2.length}`,
      severity: "medium",
    });
  }

  // Compare top-level statement types
  const topLevelTypes1 = (body1 || []).map((node) => node.type);
  const topLevelTypes2 = (body2 || []).map((node) => node.type);

  // Find missing types in each direction
  const missingInAst2 = topLevelTypes1.filter(
    (type) => !topLevelTypes2.includes(type)
  );
  const missingInAst1 = topLevelTypes2.filter(
    (type) => !topLevelTypes1.includes(type)
  );

  if (missingInAst2.length > 0) {
    differences.push({
      type: "missing_node_types",
      description: `Node types in AST1 but missing in AST2: ${missingInAst2.join(
        ", "
      )}`,
      severity: "medium",
    });
  }

  if (missingInAst1.length > 0) {
    differences.push({
      type: "missing_node_types",
      description: `Node types in AST2 but missing in AST1: ${missingInAst1.join(
        ", "
      )}`,
      severity: "medium",
    });
  }
}

/**
 * Finds entities with similar structural features to the source entity
 *
 * @param {string} entityId - ID of the source entity
 * @param {number} threshold - Similarity threshold (0 to 1), defaults to 0.7
 * @returns {Promise<Array>} Array of similar entities with similarity scores
 */
export async function findStructurallySimilarEntities(
  entityId,
  threshold = 0.7
) {
  if (!entityId) {
    throw new Error("Entity ID is required for finding similar entities");
  }

  // Validate threshold
  if (threshold < 0 || threshold > 1) {
    throw new Error("Threshold must be between 0 and 1");
  }

  try {
    // 1. Retrieve the source entity's metadata including features
    const sourceQuery = `
      SELECT id, type, path, custom_metadata 
      FROM code_entities 
      WHERE id = ?
    `;

    const sourceResult = await executeQuery(sourceQuery, [entityId]);

    if (!sourceResult || sourceResult.length === 0) {
      throw new Error(`Source entity with ID ${entityId} not found`);
    }

    const sourceEntity = sourceResult[0];
    let sourceFeatures = null;

    // Try to get structural features from custom_metadata
    if (sourceEntity.custom_metadata) {
      try {
        const metadata =
          typeof sourceEntity.custom_metadata === "string"
            ? JSON.parse(sourceEntity.custom_metadata)
            : sourceEntity.custom_metadata;

        if (metadata.structural_features) {
          sourceFeatures = metadata.structural_features;
        }
      } catch (parseError) {
        console.warn(
          `Error parsing metadata for source entity ${entityId}:`,
          parseError
        );
      }
    }

    if (
      !sourceFeatures ||
      !Array.isArray(sourceFeatures) ||
      sourceFeatures.length === 0
    ) {
      console.warn(
        `No structural features found for entity ${entityId}. Cannot compare similarity.`
      );
      return [];
    }

    // 2. Find candidate entities (same type as source for more relevant comparisons)
    const candidatesQuery = `
      SELECT id, type, path, custom_metadata 
      FROM code_entities 
      WHERE id != ? 
      AND type = ?
    `;

    const candidateEntities = await executeQuery(candidatesQuery, [
      entityId,
      sourceEntity.type,
    ]);

    if (!candidateEntities || candidateEntities.length === 0) {
      console.log(
        `No candidate entities found for comparison with ${entityId}`
      );
      return [];
    }

    // 3. Compare source features with each candidate's features
    const similarEntities = [];

    for (const candidate of candidateEntities) {
      let candidateFeatures = null;

      // Extract candidate features from metadata
      if (candidate.custom_metadata) {
        try {
          const metadata =
            typeof candidate.custom_metadata === "string"
              ? JSON.parse(candidate.custom_metadata)
              : candidate.custom_metadata;

          if (metadata.structural_features) {
            candidateFeatures = metadata.structural_features;
          }
        } catch (parseError) {
          console.warn(
            `Error parsing metadata for candidate entity ${candidate.id}:`,
            parseError
          );
          continue; // Skip this candidate
        }
      }

      // Skip if candidate has no features
      if (
        !candidateFeatures ||
        !Array.isArray(candidateFeatures) ||
        candidateFeatures.length === 0
      ) {
        continue;
      }

      // Calculate similarity score between source and candidate features
      const similarityScore = calculateFeatureSimilarity(
        sourceFeatures,
        candidateFeatures
      );

      // Add to results if above threshold
      if (similarityScore >= threshold) {
        similarEntities.push({
          entityId: candidate.id,
          path: candidate.path,
          type: candidate.type,
          similarity: similarityScore,
        });
      }
    }

    // 4. Sort by similarity score (descending)
    similarEntities.sort((a, b) => b.similarity - a.similarity);

    return similarEntities;
  } catch (error) {
    console.error(
      `Error finding structurally similar entities for ${entityId}:`,
      error
    );
    throw error;
  }
}

/**
 * Calculates similarity between two sets of structural features
 *
 * @param {Array} features1 - First set of features
 * @param {Array} features2 - Second set of features
 * @returns {number} Similarity score between 0 and 1
 * @private
 */
function calculateFeatureSimilarity(features1, features2) {
  if (!features1 || !features2 || !features1.length || !features2.length) {
    return 0;
  }

  // Extract feature types for a simple Jaccard similarity
  const types1 = new Set(
    features1.map((f) => `${f.type}:${f.statement || f.name || ""}`)
  );
  const types2 = new Set(
    features2.map((f) => `${f.type}:${f.statement || f.name || ""}`)
  );

  // Find complexity value if present
  const getComplexity = (features) => {
    const metadataFeature = features.find(
      (f) => f.type === "metadata" && f.name === "max_nesting_depth"
    );
    return metadataFeature ? metadataFeature.value : 0;
  };

  const nestingDepth1 = getComplexity(features1);
  const nestingDepth2 = getComplexity(features2);

  // Calculate count of each feature type
  const countByType1 = countFeaturesByType(features1);
  const countByType2 = countFeaturesByType(features2);

  // Calculate different similarity components

  // 1. Jaccard similarity of feature types (40% weight)
  const intersection = new Set([...types1].filter((x) => types2.has(x)));
  const union = new Set([...types1, ...types2]);
  const jaccardSimilarity = intersection.size / union.size;

  // 2. Feature count similarity (30% weight)
  const countSimilarity = calculateCountSimilarity(countByType1, countByType2);

  // 3. Nesting depth similarity (30% weight)
  const maxNesting = Math.max(nestingDepth1, nestingDepth2);
  const nestingSimilarity =
    maxNesting === 0
      ? 1 // If both have zero nesting, they're similar
      : 1 - Math.abs(nestingDepth1 - nestingDepth2) / maxNesting;

  // Weighted combination of similarity measures
  return (
    jaccardSimilarity * 0.4 + countSimilarity * 0.3 + nestingSimilarity * 0.3
  );
}

/**
 * Count features by type in a feature array
 *
 * @param {Array} features - Array of features
 * @returns {Object} Map of feature types to counts
 * @private
 */
function countFeaturesByType(features) {
  const counts = {};

  for (const feature of features) {
    const type = feature.type;
    counts[type] = (counts[type] || 0) + 1;
  }

  return counts;
}

/**
 * Calculate similarity between feature type counts
 *
 * @param {Object} counts1 - Feature counts for first entity
 * @param {Object} counts2 - Feature counts for second entity
 * @returns {number} Similarity score between 0 and 1
 * @private
 */
function calculateCountSimilarity(counts1, counts2) {
  // Get all unique feature types
  const allTypes = new Set([...Object.keys(counts1), ...Object.keys(counts2)]);

  if (allTypes.size === 0) {
    return 0;
  }

  let similarity = 0;

  for (const type of allTypes) {
    const count1 = counts1[type] || 0;
    const count2 = counts2[type] || 0;

    // Skip if both counts are 0
    if (count1 === 0 && count2 === 0) {
      continue;
    }

    // Calculate ratio (smaller/larger)
    const ratio = Math.min(count1, count2) / Math.max(count1, count2);
    similarity += ratio;
  }

  return similarity / allTypes.size;
}

/**
 * Generates a data flow graph from a function's Abstract Syntax Tree
 *
 * @param {Object} functionAst - AST node representing a function
 * @returns {Object} Data flow graph with nodes and edges
 */
export function getDataFlowGraph(functionAst) {
  // Return empty graph for invalid input
  if (!functionAst || functionAst.error) {
    return { nodes: [], edges: [] };
  }

  // Verify that the AST node is a function
  const isFunctionNode =
    functionAst.type === "FunctionDeclaration" ||
    functionAst.type === "FunctionExpression" ||
    functionAst.type === "ArrowFunctionExpression";

  if (!isFunctionNode) {
    return { nodes: [], edges: [] };
  }

  // Initialize graph components
  const nodes = [];
  const edges = [];

  // Track node IDs to avoid duplicates
  const nodeIds = new Set();

  // Track variable declarations and their scopes
  const variables = new Map();

  // Track current scope and parent scope chain
  const scopeChain = [];
  let currentScope = "function";

  // Helper to add a node if it doesn't already exist
  function addNode(id, type) {
    if (!nodeIds.has(id)) {
      nodes.push({ id, type });
      nodeIds.add(id);
    }
  }

  // Helper to add an edge between nodes
  function addEdge(source, target, type) {
    // Ensure both nodes exist first
    if (nodeIds.has(source) && nodeIds.has(target)) {
      edges.push({ source, target, type });
    }
  }

  // Add function parameters as nodes
  functionAst.params?.forEach((param) => {
    if (param.type === "Identifier") {
      const paramId = param.name;
      addNode(paramId, "parameter");
      variables.set(paramId, currentScope);
    } else if (
      param.type === "AssignmentPattern" &&
      param.left.type === "Identifier"
    ) {
      // Handle default parameters: function(a = 1)
      const paramId = param.left.name;
      addNode(paramId, "parameter");
      variables.set(paramId, currentScope);

      // Add default value node and edge
      if (param.right) {
        const defaultValueId = `default_${paramId}`;
        addNode(defaultValueId, "literal");
        addEdge(defaultValueId, paramId, "default_value");
      }
    }
  });

  // Begin AST traversal for the function body
  const visitedNodes = new WeakSet();

  function visit(node, parentNode = null) {
    // Skip if node is null, undefined, or already visited
    if (!node || typeof node !== "object" || visitedNodes.has(node)) {
      return;
    }

    visitedNodes.add(node);

    // Handle variable declarations
    if (node.type === "VariableDeclaration") {
      node.declarations.forEach((declarator) => {
        if (declarator.id && declarator.id.type === "Identifier") {
          const varId = declarator.id.name;
          addNode(varId, "variable");
          variables.set(varId, currentScope);

          // If there's an initializer, create a data flow edge
          if (declarator.init) {
            // For literals, create a literal node
            if (declarator.init.type === "Literal") {
              const literalId = `literal_${varId}`;
              addNode(literalId, "literal");
              addEdge(literalId, varId, "assignment");
            }
            // For identifiers (another variable)
            else if (declarator.init.type === "Identifier") {
              const sourceId = declarator.init.name;
              // Only create edge if source exists as a node
              if (nodeIds.has(sourceId)) {
                addEdge(sourceId, varId, "assignment");
              }
            }
            // For binary expressions (e.g., a + b)
            else if (declarator.init.type === "BinaryExpression") {
              processExpression(declarator.init, varId);
            }
            // For function calls
            else if (declarator.init.type === "CallExpression") {
              processCallExpression(declarator.init, varId);
            }
          }
        }
      });
    }

    // Handle assignments
    else if (node.type === "AssignmentExpression") {
      if (node.left.type === "Identifier") {
        const targetId = node.left.name;

        // Make sure the target exists as a node
        if (!nodeIds.has(targetId)) {
          addNode(targetId, "variable");
          variables.set(targetId, currentScope);
        }

        // For identifier on right side (another variable)
        if (node.right.type === "Identifier") {
          const sourceId = node.right.name;
          if (nodeIds.has(sourceId)) {
            addEdge(sourceId, targetId, "assignment");
          }
        }
        // For literals
        else if (node.right.type === "Literal") {
          const literalId = `literal_${targetId}_${node.start}`;
          addNode(literalId, "literal");
          addEdge(literalId, targetId, "assignment");
        }
        // For binary expressions
        else if (node.right.type === "BinaryExpression") {
          processExpression(node.right, targetId);
        }
        // For function calls
        else if (node.right.type === "CallExpression") {
          processCallExpression(node.right, targetId);
        }
      }
    }

    // Handle return statements
    else if (node.type === "ReturnStatement") {
      if (node.argument) {
        const returnId = `return_${node.start}`;
        addNode(returnId, "return");

        // Create flow from returned value to return node
        if (node.argument.type === "Identifier") {
          const sourceId = node.argument.name;
          if (nodeIds.has(sourceId)) {
            addEdge(sourceId, returnId, "return_value");
          }
        }
        // For literals in return
        else if (node.argument.type === "Literal") {
          const literalId = `literal_return_${node.start}`;
          addNode(literalId, "literal");
          addEdge(literalId, returnId, "return_value");
        }
        // For expressions in return
        else if (node.argument.type === "BinaryExpression") {
          processExpression(node.argument, returnId, "return_value");
        }
        // For function calls in return
        else if (node.argument.type === "CallExpression") {
          processCallExpression(node.argument, returnId, "return_value");
        }
      }
    }

    // Handle function calls not covered in other cases
    else if (
      node.type === "CallExpression" &&
      parentNode?.type !== "VariableDeclarator" &&
      parentNode?.type !== "AssignmentExpression" &&
      parentNode?.type !== "ReturnStatement"
    ) {
      processCallExpression(node);
    }

    // Handle entering new block scope
    if (node.type === "BlockStatement") {
      scopeChain.push(currentScope);
      currentScope = `block_${node.start}`;
    }

    // Recursively visit all child nodes
    for (const key in node) {
      const child = node[key];

      // Skip special properties
      if (
        key === "type" ||
        key === "loc" ||
        key === "range" ||
        key === "parent"
      ) {
        continue;
      }

      if (Array.isArray(child)) {
        // For arrays (like body), visit each element
        for (const item of child) {
          visit(item, node);
        }
      } else if (child && typeof child === "object") {
        // Visit child node
        visit(child, node);
      }
    }

    // Handle exiting block scope
    if (node.type === "BlockStatement") {
      currentScope = scopeChain.pop();
    }
  }

  // Helper to process expressions and their effect on data flow
  function processExpression(expression, targetId, edgeType = "assignment") {
    // For binary expressions like a + b, track flow from operands to result
    if (expression.left?.type === "Identifier") {
      const leftId = expression.left.name;
      if (nodeIds.has(leftId)) {
        addEdge(leftId, targetId, edgeType);
      }
    }

    if (expression.right?.type === "Identifier") {
      const rightId = expression.right.name;
      if (nodeIds.has(rightId)) {
        addEdge(rightId, targetId, edgeType);
      }
    }

    // If operands are themselves expressions, process them recursively
    if (expression.left?.type === "BinaryExpression") {
      processExpression(expression.left, targetId, edgeType);
    }

    if (expression.right?.type === "BinaryExpression") {
      processExpression(expression.right, targetId, edgeType);
    }

    // If operands are literals, create nodes for them
    if (expression.left?.type === "Literal") {
      const literalId = `literal_left_${expression.left.start}`;
      addNode(literalId, "literal");
      addEdge(literalId, targetId, edgeType);
    }

    if (expression.right?.type === "Literal") {
      const literalId = `literal_right_${expression.right.start}`;
      addNode(literalId, "literal");
      addEdge(literalId, targetId, edgeType);
    }
  }

  // Helper to process function calls and their effect on data flow
  function processCallExpression(
    callNode,
    targetId = null,
    edgeType = "assignment"
  ) {
    const callId = `call_${callNode.start}`;
    let functionName = "unknown";

    // Try to determine the function name
    if (callNode.callee.type === "Identifier") {
      functionName = callNode.callee.name;
    } else if (
      callNode.callee.type === "MemberExpression" &&
      callNode.callee.property.type === "Identifier"
    ) {
      functionName = callNode.callee.property.name;
    }

    addNode(callId, "function_call");

    // Connect parameters/arguments to the function call
    callNode.arguments.forEach((arg, index) => {
      if (arg.type === "Identifier") {
        const argId = arg.name;
        if (nodeIds.has(argId)) {
          addEdge(argId, callId, "call_argument");
        }
      } else if (arg.type === "Literal") {
        const literalId = `literal_arg_${index}_${callNode.start}`;
        addNode(literalId, "literal");
        addEdge(literalId, callId, "call_argument");
      }
    });

    // If this call's result is assigned to a variable
    if (targetId) {
      addEdge(callId, targetId, edgeType);
    }
  }

  // Start traversal from the function body
  if (functionAst.body) {
    visit(functionAst.body);
  }

  return { nodes, edges };
}
