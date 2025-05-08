/**
 * ContextIndexerLogic.js
 *
 * Provides functions for indexing code files and extracting structured information
 * about code entities and their relationships.
 */

import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import path from "path";
import * as acorn from "acorn";
import { executeQuery } from "../db.js";
import { tokenize, extractKeywords } from "./TextTokenizerLogic.js";
import { addRelationship } from "./RelationshipContextManagerLogic.js";
import { buildAST } from "./CodeStructureAnalyzerLogic.js";
import { calculateImportanceScore } from "./ContextPrioritizerLogic.js";
import { logMessage } from "../utils/logger.js";

/**
 * Calculate SHA-256 hash of content
 *
 * @param {string} content - Content to hash
 * @returns {string} SHA-256 hash as hex string
 */
function calculateContentHash(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Extract filename from path
 *
 * @param {string} filePath - Path to file
 * @returns {string} Filename without directory
 */
function extractFilename(filePath) {
  return path.basename(filePath);
}

/**
 * Detect language from file extension if not provided
 *
 * @param {string} filePath - Path to file
 * @param {string} languageHint - Language hint
 * @returns {string} Detected language
 */
function detectLanguage(filePath, languageHint) {
  if (languageHint) {
    return languageHint.toLowerCase();
  }

  const extension = path.extname(filePath).toLowerCase();

  const extensionMap = {
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".py": "python",
    ".rb": "ruby",
    ".java": "java",
    ".go": "go",
    ".rs": "rust",
    ".php": "php",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c",
    ".hpp": "cpp",
    ".cs": "csharp",
    ".swift": "swift",
    ".kt": "kotlin",
    ".html": "html",
    ".css": "css",
    ".scss": "scss",
    ".json": "json",
    ".md": "markdown",
    ".xml": "xml",
    ".yaml": "yaml",
    ".yml": "yaml",
  };

  return extensionMap[extension] || "unknown";
}

/**
 * Extract line number from character position
 *
 * @param {string} content - File content
 * @param {number} position - Character position
 * @returns {number} Line number
 */
function getLineFromPosition(content, position) {
  const lines = content.substring(0, position).split("\n");
  return lines.length;
}

/**
 * Extract code entities using regex for languages without AST support
 *
 * @param {string} content - File content
 * @param {string} language - Language of the file
 * @returns {Array} Extracted entities
 */
function extractEntitiesWithRegex(content, language) {
  const entities = [];

  // Common patterns for different languages
  const patterns = {
    // Function patterns
    function: {
      python: /def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)\s*:/g,
      ruby: /def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(\([^)]*\))?\s*(do|\n)/g,
      java: /(public|private|protected|static|\s) +[\w\<\>\[\]]+\s+(\w+) *\([^\)]*\) *(\{?|[^;])/g,
      go: /func\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)\s*(?:\([^)]*\))?\s*\{/g,
      php: /function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)\s*\{/g,
      default: /function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)\s*\{/g,
    },
    // Class patterns
    class: {
      python: /class\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(\([^)]*\))?\s*:/g,
      ruby: /class\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*((<|::)\s*[A-Za-z0-9_:]*)?/g,
      java: /class\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(extends\s+[A-Za-z0-9_]+)?\s*(implements\s+[A-Za-z0-9_,\s]+)?\s*\{/g,
      go: /type\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+struct\s*\{/g,
      php: /class\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(extends\s+[A-Za-z0-9_]+)?\s*(implements\s+[A-Za-z0-9_,\s]+)?\s*\{/g,
      default:
        /class\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(extends\s+[A-Za-z0-9_]+)?\s*\{/g,
    },
    // Variable/constant patterns
    variable: {
      python: /(^|\s)([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?!==)/g,
      ruby: /(^|\s)([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?!=)/g,
      java: /(private|protected|public|static|\s) +[\w\<\>\[\]]+\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*[^;]+;/g,
      go: /var\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+[\w\[\]]+(\s*=\s*[^;]+)?/g,
      php: /(\$[a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?!=)/g,
      default: /(const|let|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*[^;]+;/g,
    },
  };

  // Extract functions
  const functionPattern =
    patterns.function[language] || patterns.function.default;
  let match;
  while ((match = functionPattern.exec(content)) !== null) {
    const name = match[1] || match[2]; // Some patterns capture name in different groups
    const startPosition = match.index;

    // Find the end of the function
    // This is a simplification - would need language-specific logic for accurate ending
    const startLine = getLineFromPosition(content, startPosition);
    let endLine = startLine + 10; // Assume small functions for simplicity

    entities.push({
      type: "function",
      name,
      start_position: startPosition,
      start_line: startLine,
      end_line: endLine, // Approximation
      raw_content: content.substring(
        startPosition,
        startPosition + match[0].length + 100
      ), // Approximate content
    });
  }

  // Extract classes with similar approach
  const classPattern = patterns.class[language] || patterns.class.default;
  while ((match = classPattern.exec(content)) !== null) {
    const name = match[1];
    const startPosition = match.index;
    const startLine = getLineFromPosition(content, startPosition);
    let endLine = startLine + 20; // Assume larger for classes

    entities.push({
      type: "class",
      name,
      start_position: startPosition,
      start_line: startLine,
      end_line: endLine, // Approximation
      raw_content: content.substring(
        startPosition,
        startPosition + match[0].length + 500
      ), // Approximate content
    });
  }

  // Could continue with variables, methods, etc.

  return entities;
}

/**
 * Extract code entities from JavaScript/TypeScript AST
 *
 * @param {Object} ast - Abstract Syntax Tree
 * @param {string} content - File content
 * @returns {Object} Extracted entities and relationships
 */
function extractEntitiesFromAST(ast, content) {
  // Check if we're in MCP mode - control logging
  const inMcpMode = process.env.MCP_MODE === "true";

  const entities = [];
  const relationships = [];
  const idMap = new Map(); // Maps node to entity for relationship tracking
  const lines = content.split("\n");

  if (!ast || ast.error) {
    if (!inMcpMode) {
      logMessage("warn", "Invalid AST provided to extractEntitiesFromAST", {
        error: ast && ast.error ? ast.message : "No AST provided",
      });
    }
    return { entities, relationships };
  }

  function createEntity(
    type,
    name,
    startPosition,
    endPosition,
    startLine,
    endLine,
    rawContent,
    parentEntity = null,
    customMetadata = {}
  ) {
    const entity = {
      type,
      name,
      start_position: startPosition,
      end_position: endPosition,
      start_line: startLine,
      end_line: endLine,
      raw_content: rawContent,
      parent: parentEntity,
      custom_metadata: customMetadata,
    };

    entities.push(entity);

    // Log entity extraction in non-MCP mode
    if (!inMcpMode) {
      logMessage("debug", `Extracted ${type} entity: ${name}`, {
        lines: `${startLine}-${endLine}`,
        size: rawContent.length,
      });
    }

    return entity;
  }

  function visit(node, parentNode = null, parentEntity = null, scope = null) {
    if (!node || typeof node !== "object") return;

    // Track current scope for nested entities
    let currentScope = scope;

    // Process node based on type
    switch (node.type) {
      case "Program":
        // Process each statement in the program body
        if (node.body && Array.isArray(node.body)) {
          node.body.forEach((stmt) =>
            visit(stmt, node, parentEntity, "global")
          );
        }
        break;

      case "FunctionDeclaration":
        {
          const name = node.id ? node.id.name : "anonymous";
          const startLine = node.loc.start.line;
          const endLine = node.loc.end.line;
          const startPosition = node.start;
          const endPosition = node.end;
          const rawContent = content.substring(startPosition, endPosition);

          // Get function params
          const params = node.params.map((p) => p.name || "unnamed");

          // Create function entity
          const functionEntity = createEntity(
            "function",
            name,
            startPosition,
            endPosition,
            startLine,
            endLine,
            rawContent,
            parentEntity,
            { params }
          );

          // Create relationship to parent if exists
          if (parentEntity) {
            relationships.push({
              source: parentEntity,
              target: functionEntity,
              type: "contains",
            });
          }

          // Process function body with this function as parent
          if (node.body) {
            visit(node.body, node, functionEntity, name);
          }
        }
        break;

      case "ClassDeclaration":
      case "ClassExpression":
        {
          const name = node.id ? node.id.name : "AnonymousClass";
          const startLine = node.loc.start.line;
          const endLine = node.loc.end.line;
          const startPosition = node.start;
          const endPosition = node.end;
          const rawContent = content.substring(startPosition, endPosition);

          // Create class entity
          const classEntity = createEntity(
            "class",
            name,
            startPosition,
            endPosition,
            startLine,
            endLine,
            rawContent,
            parentEntity
          );

          // Create relationship to parent if exists
          if (parentEntity) {
            relationships.push({
              source: parentEntity,
              target: classEntity,
              type: "contains",
            });
          }

          // Process class body with this class as parent
          if (node.body && node.body.body) {
            node.body.body.forEach((member) => {
              visit(member, node, classEntity, name);
            });
          }
        }
        break;

      case "MethodDefinition":
        {
          const name = node.key.name || node.key.value || "unnamed";
          const startLine = node.loc.start.line;
          const endLine = node.loc.end.line;
          const startPosition = node.start;
          const endPosition = node.end;
          const rawContent = content.substring(startPosition, endPosition);

          // Create method entity
          const methodEntity = createEntity(
            "method",
            name,
            startPosition,
            endPosition,
            startLine,
            endLine,
            rawContent,
            parentEntity,
            { kind: node.kind } // constructor, method, get/set
          );

          // Create relationship to parent class
          if (parentEntity) {
            relationships.push({
              source: parentEntity,
              target: methodEntity,
              type: "contains",
            });
          }

          // Process method body with this method as parent
          if (node.value && node.value.body) {
            visit(node.value.body, node, methodEntity, `${scope}.${name}`);
          }
        }
        break;

      case "ArrowFunctionExpression":
      case "FunctionExpression":
        {
          // Only create entities for named function expressions or arrow functions assigned to variables
          if (
            parentNode &&
            (parentNode.type === "VariableDeclarator" ||
              parentNode.type === "AssignmentExpression")
          ) {
            let name = "anonymous";

            // Try to determine name from parent
            if (parentNode.id && parentNode.id.name) {
              name = parentNode.id.name;
            } else if (parentNode.left && parentNode.left.name) {
              name = parentNode.left.name;
            }

            const startLine = node.loc.start.line;
            const endLine = node.loc.end.line;
            const startPosition = node.start;
            const endPosition = node.end;
            const rawContent = content.substring(startPosition, endPosition);

            // Create function entity
            const functionEntity = createEntity(
              "function",
              name,
              startPosition,
              endPosition,
              startLine,
              endLine,
              rawContent,
              parentEntity
            );

            // Process function body with this function as parent
            if (node.body) {
              visit(node.body, node, functionEntity, name);
            }
          } else {
            // For anonymous functions, just process the body without creating an entity
            if (node.body) {
              visit(node.body, node, parentEntity, scope);
            }
          }
        }
        break;

      case "BlockStatement":
        // Process each statement in the block
        if (node.body && Array.isArray(node.body)) {
          node.body.forEach((stmt) => visit(stmt, node, parentEntity, scope));
        }
        break;

      // Handle variable declarations which might contain functions or classes
      case "VariableDeclaration":
        if (node.declarations) {
          node.declarations.forEach((decl) =>
            visit(decl, node, parentEntity, scope)
          );
        }
        break;

      case "VariableDeclarator":
        // Process initializer, which might be a function/class expression
        if (node.init) {
          visit(node.init, node, parentEntity, scope);
        }
        break;

      case "ExportNamedDeclaration":
      case "ExportDefaultDeclaration":
        // Process the exported declaration
        if (node.declaration) {
          visit(node.declaration, node, parentEntity, scope);
        }
        break;

      default:
        // For other node types, just traverse their children
        for (const key in node) {
          if (node.hasOwnProperty(key)) {
            const child = node[key];
            if (child && typeof child === "object") {
              if (Array.isArray(child)) {
                child.forEach((item) => visit(item, node, parentEntity, scope));
              } else {
                visit(child, node, parentEntity, scope);
              }
            }
          }
        }
        break;
    }
  }

  // Start traversal from the root
  visit(ast);

  return { entities, relationships };
}

/**
 * Stores file and its code entities in the database
 *
 * @param {string} filePath - Path to the file
 * @param {string} fileContent - Content of the file
 * @param {string} languageHint - Programming language hint
 * @returns {Promise<void>}
 */
export async function indexCodeFile(filePath, fileContent, languageHint) {
  try {
    // Check if we're in MCP mode - never log in MCP mode
    const inMcpMode = process.env.MCP_MODE === "true";

    if (!inMcpMode) {
      logMessage("info", `Indexing code file ${filePath}`);
    }

    // Calculate content hash
    const contentHash = calculateContentHash(fileContent);

    // Extract filename
    const filename = extractFilename(filePath);

    // Detect or use provided language
    const language = detectLanguage(filePath, languageHint);

    // Check if file already exists
    const existingFile = await executeQuery(
      `SELECT entity_id, content_hash FROM code_entities WHERE file_path = ? AND entity_type = 'file'`,
      [filePath]
    );

    // Initialize file entity ID
    let fileEntityId;

    // Update or create file entity
    if (existingFile.rows && existingFile.rows.length > 0) {
      fileEntityId = existingFile.rows[0].entity_id;

      // Skip indexing if content hash matches
      if (existingFile[0].content_hash === contentHash) {
        logMessage("info", `File ${filePath} is unchanged, skipping indexing`);
        return fileEntityId;
      }

      // Update existing file entity
      await executeQuery(
        `
        UPDATE code_entities SET
          raw_content = ?,
          content_hash = ?,
          language = ?,
          last_modified_at = CURRENT_TIMESTAMP
        WHERE entity_id = ?
      `,
        [fileContent, contentHash, language, fileEntityId]
      );

      // Delete existing sub-entities for re-indexing
      await executeQuery(
        `
        DELETE FROM code_entities
        WHERE parent_entity_id = ?
      `,
        [fileEntityId]
      );
    } else {
      // Create a new file entity
      fileEntityId = uuidv4();

      // Calculate importance score for the file entity
      let importanceScore = 1.0; // Default score
      try {
        importanceScore = await calculateImportanceScore({
          entity_id: fileEntityId,
          entity_type: "file",
          file_path: filePath,
          name: filename,
          raw_content: fileContent,
          language: language,
        });
      } catch (scoreError) {
        if (!inMcpMode) {
          logMessage(
            "warn",
            `Error calculating importance score for ${filePath}: ${scoreError.message}`
          );
        }
      }

      await executeQuery(
        `
        INSERT INTO code_entities (
          entity_id,
          file_path,
          entity_type,
          name,
          content_hash,
          raw_content,
          language,
          importance_score
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          fileEntityId,
          filePath,
          "file",
          filename,
          contentHash,
          fileContent,
          language,
          importanceScore,
        ]
      );
    }

    // Process file content based on language
    let codeEntities = [];
    let relationships = [];

    // Language-specific processing
    if (language === "javascript" || language === "typescript") {
      try {
        // Parse content using Acorn or a similar parser
        const ast = buildAST(fileContent, language);
        const { entities, entityRelationships } = extractEntitiesFromAST(
          ast,
          fileContent
        );
        codeEntities = entities;
        relationships = entityRelationships;
      } catch (parseError) {
        if (!inMcpMode) {
          logMessage(
            "warn",
            `Error parsing ${language} file ${filePath}: ${parseError.message}`
          );
          // Fallback to regex for basic extraction on parse error
          codeEntities = extractEntitiesWithRegex(fileContent, language);
        }
      }
    } else {
      // For other languages, use regex extraction
      codeEntities = extractEntitiesWithRegex(fileContent, language);
    }

    // Save extracted entities and relationships to database
    for (const entity of codeEntities) {
      const entityId = uuidv4();
      entity.id = entityId;

      // Calculate importance score for the entity
      let importanceScore = 1.0; // Default score
      try {
        // Create a proper entity object for scoring
        const entityForScoring = {
          entity_id: entityId,
          entity_type: entity.type,
          file_path: filePath,
          name: entity.name,
          raw_content: entity.raw_content,
          start_line: entity.start_line,
          end_line: entity.end_line,
          language: language,
          parent_entity_id: fileEntityId,
        };

        importanceScore = await calculateImportanceScore(entityForScoring);
      } catch (scoreError) {
        if (!inMcpMode) {
          logMessage(
            "warn",
            `Error calculating importance score for entity ${entity.name}: ${scoreError.message}`
          );
        }
      }

      // Generate summary for the entity
      let summary = null;
      try {
        // Import dynamically to avoid circular dependencies
        const { summarizeCodeEntity } = await import(
          "./ContextCompressorLogic.js"
        );

        // Create entity object for summarization - must include necessary properties
        const entityForSummary = {
          entity_type: entity.type,
          name: entity.name,
          raw_content: entity.raw_content,
        };

        // Generate summary with a reasonable character limit (increased from 500 to 1000)
        summary = summarizeCodeEntity(entityForSummary, 1000);

        // Log summary generation for debugging (only in non-MCP mode)
        if (!inMcpMode && summary) {
          logMessage(
            "debug",
            `Generated summary for ${entity.type} '${entity.name}' (${summary.length} chars)`
          );
        }
      } catch (summaryError) {
        if (!inMcpMode) {
          logMessage(
            "warn",
            `Error generating summary for entity ${entity.name}: ${summaryError.message}`
          );
        }
        // Continue without a summary
      }

      // Save entity to database
      await executeQuery(
        `
        INSERT INTO code_entities (
          entity_id,
          parent_entity_id,
          file_path,
          entity_type,
          name,
          start_line,
          end_line,
          raw_content,
          language,
          summary,
          importance_score
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          entityId,
          fileEntityId,
          filePath,
          entity.type,
          entity.name,
          entity.start_line,
          entity.end_line,
          entity.raw_content,
          language,
          summary,
          importanceScore,
        ]
      );

      // Extract keywords for the entity
      try {
        const keywords = extractKeywords(entity.raw_content);

        // Save keywords
        for (const keyword of keywords) {
          await executeQuery(
            `
            INSERT INTO entity_keywords (
              entity_id,
              keyword,
              term_frequency,
              keyword_type
            ) VALUES (?, ?, ?, ?)
            ON CONFLICT(entity_id, keyword, keyword_type) DO UPDATE SET
              term_frequency = excluded.term_frequency
          `,
            [entityId, keyword.term, keyword.frequency, "extracted"]
          );
        }
      } catch (keywordError) {
        if (!inMcpMode) {
          logMessage(
            "warn",
            `Error extracting keywords for ${entity.name}: ${keywordError.message}`
          );
        }
        // Continue despite keyword extraction errors
      }
    }

    // Save relationships
    for (const rel of relationships) {
      try {
        if (rel.source && rel.target) {
          await addRelationship(
            rel.source.id,
            rel.target.id,
            rel.type,
            rel.metadata
          );
        }
      } catch (relError) {
        if (!inMcpMode) {
          logMessage("warn", `Error saving relationship: ${relError.message}`);
        }
        // Continue despite relationship errors
      }
    }

    return fileEntityId;
  } catch (error) {
    if (process.env.MCP_MODE === "true") {
      throw new Error(); // Empty error in MCP mode to prevent logging
    } else {
      throw new Error(`Error indexing file ${filePath}: ${error.message}`);
    }
  }
}

/**
 * Message object type definition
 * @typedef {Object} MessageObject
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
 * Indexes a conversation message for later retrieval
 *
 * @param {MessageObject} message - Message object to index
 * @returns {Promise<void>}
 */
export async function indexConversationMessage(message) {
  try {
    logMessage("debug", "===== INDEX MESSAGE - START =====");
    logMessage("debug", "Input parameters:", {
      message_id: message.message_id,
      conversation_id: message.conversation_id,
      role: message.role,
      content_length: message.content ? message.content.length : 0,
      timestamp: message.timestamp,
    });

    // Validate required message properties
    if (
      !message.message_id ||
      !message.conversation_id ||
      !message.role ||
      !message.content
    ) {
      throw new Error("Message object missing required properties");
    }

    // Convert arrays and objects to JSON strings for storage
    const relatedContextEntityIds = message.relatedContextEntityIds
      ? message.relatedContextEntityIds
      : null;

    const semanticMarkers = message.semantic_markers
      ? message.semantic_markers
      : null;

    const sentimentIndicators = message.sentiment_indicators
      ? message.sentiment_indicators
      : null;

    // Format timestamp
    const timestamp =
      message.timestamp instanceof Date
        ? message.timestamp.toISOString()
        : message.timestamp || new Date().toISOString();

    // Check if message already exists
    const existingMessageQuery = `
      SELECT message_id FROM conversation_history 
      WHERE message_id = ?
    `;

    logMessage("debug", "Checking if message exists:", {
      message_id: message.message_id,
    });
    const existingMessage = await executeQuery(existingMessageQuery, [
      message.message_id,
    ]);

    logMessage("debug", "Existing message check result:", {
      result: JSON.stringify(existingMessage),
    });

    if (
      existingMessage &&
      existingMessage.rows &&
      existingMessage.rows.length > 0
    ) {
      logMessage("debug", "Updating existing message:", {
        message_id: message.message_id,
      });
      // Update existing message
      try {
        const updateQuery = `UPDATE conversation_history 
         SET content = ?, 
             summary = ?, 
             user_intent = ?, 
             topic_segment_id = ?, 
             related_context_entity_ids = ?, 
             semantic_markers = ?, 
             sentiment_indicators = ?
         WHERE message_id = ?`;

        const updateParams = [
          message.content,
          message.summary || null,
          message.userIntent || null,
          message.topicSegmentId || null,
          relatedContextEntityIds,
          semanticMarkers,
          sentimentIndicators,
          message.message_id,
        ];

        logMessage("debug", "Update query parameters:", {
          message_id: message.message_id,
          content_length: message.content ? message.content.length : 0,
        });

        const updateResult = await executeQuery(updateQuery, updateParams);
        logMessage("debug", "Message update result:", {
          result: JSON.stringify(updateResult),
        });
      } catch (updateError) {
        logMessage("error", "Update error:", { error: updateError });
        throw updateError;
      }
    } else {
      logMessage("debug", "Inserting new message:", {
        message_id: message.message_id,
      });
      // Insert new message
      try {
        const insertQuery = `INSERT INTO conversation_history (
          message_id, 
          conversation_id, 
          role, 
          content, 
          timestamp, 
          summary, 
          user_intent, 
          topic_segment_id, 
          related_context_entity_ids, 
          semantic_markers, 
          sentiment_indicators
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const insertParams = [
          message.message_id,
          message.conversation_id,
          message.role,
          message.content,
          timestamp,
          message.summary || null,
          message.userIntent || null,
          message.topicSegmentId || null,
          relatedContextEntityIds,
          semanticMarkers,
          sentimentIndicators,
        ];

        logMessage("debug", "Insert query parameters:", {
          message_id: message.message_id,
          conversation_id: message.conversation_id,
          role: message.role,
          timestamp: timestamp,
        });

        const insertResult = await executeQuery(insertQuery, insertParams);
        logMessage("debug", "Message insert result:", {
          result: JSON.stringify(insertResult),
        });
      } catch (insertError) {
        logMessage("error", "Insert error:", { error: insertError });
        logMessage("error", "Error stack:", { stack: insertError.stack });
        throw insertError;
      }
    }

    // Process message content for keywords
    const tokens = tokenize(message.content);
    const keywords = extractKeywords(tokens);

    logMessage("debug", "===== INDEX MESSAGE - COMPLETE =====");
    logMessage("info", "Successfully indexed message:", {
      message_id: message.message_id,
    });

    return {
      messageId: message.message_id,
      keywords: keywords,
    };
  } catch (error) {
    logMessage("error", "===== INDEX MESSAGE - ERROR =====");
    logMessage("error", `Error indexing message ${message?.message_id}:`, {
      error: error.message,
    });
    logMessage("error", "Error stack:", { stack: error.stack });
    throw error;
  }
}
