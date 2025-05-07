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
  const entities = [];
  const relationships = [];
  const idMap = new Map(); // Maps node to entity for relationship tracking

  // Track visited nodes to prevent infinite recursion
  const visitedNodes = new WeakSet();

  /**
   * Create a new entity object
   *
   * @param {string} type - Entity type
   * @param {string} name - Entity name
   * @param {number} startPosition - Start position in source
   * @param {number} endPosition - End position in source
   * @param {number} startLine - Start line number
   * @param {number} endLine - End line number
   * @param {string} rawContent - Raw content of the entity
   * @param {Object|null} parentEntity - Parent entity if exists
   * @param {Object} customMetadata - Additional metadata
   * @returns {Object} The created entity
   */
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
      custom_metadata: customMetadata,
    };

    entities.push(entity);

    // Set up parent-child relationship
    if (parentEntity) {
      relationships.push({
        source: parentEntity,
        target: entity,
        type: "contains",
      });
    }

    return entity;
  }

  /**
   * Process a node to extract relevant entity information
   */
  function visit(node, parentNode = null, parentEntity = null, scope = null) {
    if (!node || typeof node !== "object" || visitedNodes.has(node)) {
      return;
    }

    visitedNodes.add(node);

    // Skip if node doesn't have location data
    if (!node.loc) {
      return;
    }

    // Get line information
    const startLine = node.loc?.start?.line;
    const endLine = node.loc?.end?.line;
    const startPosition = node.start;
    const endPosition = node.end;
    const rawContent = content.substring(startPosition, endPosition);

    // Create currentEntity to track the entity for this node
    let currentEntity = null;

    // Extract entities based on node type
    switch (node.type) {
      case "FunctionDeclaration": {
        const name = node.id?.name || "anonymous";
        const params = node.params?.map((p) =>
          p.type === "Identifier" ? p.name : "param"
        );

        currentEntity = createEntity(
          "function",
          name,
          startPosition,
          endPosition,
          startLine,
          endLine,
          rawContent,
          parentEntity,
          {
            ast_node_type: node.type,
            params: params || [],
            is_async: node.async || false,
            is_generator: node.generator || false,
          }
        );

        // Store in idMap for relationship tracking
        idMap.set(node, currentEntity);

        // Visit function body with this entity as parent
        if (node.body) {
          visit(node.body, node, currentEntity, name);
        }
        break;
      }

      case "FunctionExpression":
      case "ArrowFunctionExpression": {
        // Try to infer name from parent if this is a variable declaration
        let name = "anonymous";
        let functionType = "function_expression";

        if (
          parentNode &&
          parentNode.type === "VariableDeclarator" &&
          parentNode.id
        ) {
          name = parentNode.id.name;
          functionType = "function";
        } else if (
          parentNode &&
          parentNode.type === "AssignmentExpression" &&
          parentNode.left
        ) {
          if (parentNode.left.type === "Identifier") {
            name = parentNode.left.name;
            functionType = "function";
          } else if (
            parentNode.left.type === "MemberExpression" &&
            parentNode.left.property
          ) {
            name = parentNode.left.property.name;
            functionType = "method";
          }
        } else if (
          parentNode &&
          parentNode.type === "Property" &&
          parentNode.key
        ) {
          name = parentNode.key.name || parentNode.key.value || "anonymous";
          functionType = "method";
        } else if (
          parentNode &&
          parentNode.type === "MethodDefinition" &&
          parentNode.key
        ) {
          name = parentNode.key.name || "anonymous";
          functionType = "method";
        }

        const params = node.params?.map((p) =>
          p.type === "Identifier" ? p.name : "param"
        );

        currentEntity = createEntity(
          functionType,
          name,
          startPosition,
          endPosition,
          startLine,
          endLine,
          rawContent,
          parentEntity,
          {
            ast_node_type: node.type,
            params: params || [],
            is_async: node.async || false,
            is_generator: node.generator || false,
            is_arrow: node.type === "ArrowFunctionExpression",
          }
        );

        idMap.set(node, currentEntity);

        // Visit function body with this entity as parent
        if (node.body) {
          visit(node.body, node, currentEntity, name);
        }
        break;
      }

      case "ClassDeclaration": {
        const name = node.id?.name || "anonymous";

        currentEntity = createEntity(
          "class",
          name,
          startPosition,
          endPosition,
          startLine,
          endLine,
          rawContent,
          parentEntity,
          {
            ast_node_type: node.type,
          }
        );

        idMap.set(node, currentEntity);

        // If this class extends another, record the relationship
        if (node.superClass) {
          if (node.superClass.type === "Identifier") {
            relationships.push({
              source: currentEntity,
              target: { name: node.superClass.name, type: "class" },
              type: "extends",
            });
          }
        }

        // Visit class body with this entity as parent
        if (node.body) {
          visit(node.body, node, currentEntity, name);
        }
        break;
      }

      case "ClassExpression": {
        // Try to infer name from parent if possible
        let name = node.id?.name || "anonymous";
        if (
          parentNode &&
          parentNode.type === "VariableDeclarator" &&
          parentNode.id
        ) {
          name = parentNode.id.name;
        }

        currentEntity = createEntity(
          "class",
          name,
          startPosition,
          endPosition,
          startLine,
          endLine,
          rawContent,
          parentEntity,
          {
            ast_node_type: node.type,
          }
        );

        idMap.set(node, currentEntity);

        // If this class extends another, record the relationship
        if (node.superClass) {
          if (node.superClass.type === "Identifier") {
            relationships.push({
              source: currentEntity,
              target: { name: node.superClass.name, type: "class" },
              type: "extends",
            });
          }
        }

        // Visit class body with this entity as parent
        if (node.body) {
          visit(node.body, node, currentEntity, name);
        }
        break;
      }

      case "MethodDefinition": {
        const name = node.key?.name || node.key?.value || "anonymous";
        const kind = node.kind || "method"; // "method", "constructor", "get", "set"

        currentEntity = createEntity(
          kind === "constructor" ? "constructor" : "method",
          name,
          startPosition,
          endPosition,
          startLine,
          endLine,
          rawContent,
          parentEntity,
          {
            ast_node_type: node.type,
            kind: kind,
            is_static: !!node.static,
            is_async: node.value?.async || false,
            is_generator: node.value?.generator || false,
          }
        );

        idMap.set(node, currentEntity);

        // Visit method value/body with this entity as parent
        if (node.value) {
          visit(node.value, node, currentEntity, name);
        }
        break;
      }

      case "VariableDeclaration": {
        // Don't create an entity for the declaration itself, just visit the declarators
        node.declarations.forEach((declarator) => {
          visit(declarator, node, parentEntity, scope);
        });
        break;
      }

      case "VariableDeclarator": {
        if (node.id && node.id.type === "Identifier") {
          const name = node.id.name;

          // Don't create entities for simple variable assignments to primitives
          // unless they have a function or object expression as initializer
          let shouldCreateEntity = false;
          let entityType = "variable";

          if (!node.init) {
            shouldCreateEntity = true; // Declarations without initializers
          } else if (
            [
              "FunctionExpression",
              "ArrowFunctionExpression",
              "ClassExpression",
              "ObjectExpression",
              "NewExpression",
            ].includes(node.init.type)
          ) {
            shouldCreateEntity = true;
            if (node.init.type === "ObjectExpression") {
              entityType = "object";
            }
          } else if (
            node.init.type === "Literal" &&
            typeof node.init.value === "object"
          ) {
            shouldCreateEntity = true;
            entityType = "object";
          } else if (parentEntity && parentEntity.type !== "variable") {
            // Always create if inside a function/class
            shouldCreateEntity = true;
          }

          if (shouldCreateEntity) {
            currentEntity = createEntity(
              entityType,
              name,
              startPosition,
              endPosition,
              startLine,
              endLine,
              rawContent,
              parentEntity,
              {
                ast_node_type: node.type,
                variable_kind: parentNode?.kind || "var", // 'var', 'let', or 'const'
              }
            );

            idMap.set(node, currentEntity);
          }
        }

        // Visit initializer
        if (node.init) {
          visit(node.init, node, parentEntity || currentEntity, scope);
        }
        break;
      }

      case "ImportDeclaration": {
        // Create an entity for the import statement
        const source = node.source.value;
        const specifiers = node.specifiers.map((specifier) => {
          if (specifier.type === "ImportDefaultSpecifier") {
            return { type: "default", name: specifier.local.name };
          } else if (specifier.type === "ImportNamespaceSpecifier") {
            return { type: "namespace", name: specifier.local.name };
          } else {
            return {
              type: "named",
              name: specifier.local.name,
              imported: specifier.imported?.name || specifier.local.name,
            };
          }
        });

        currentEntity = createEntity(
          "import",
          source,
          startPosition,
          endPosition,
          startLine,
          endLine,
          rawContent,
          parentEntity,
          {
            ast_node_type: node.type,
            specifiers: specifiers,
          }
        );

        idMap.set(node, currentEntity);

        // Add relationships for the imports
        specifiers.forEach((spec) => {
          relationships.push({
            source: currentEntity,
            target: { name: spec.name, type: "imported" },
            type: "imports",
            metadata: {
              source_module: source,
              import_type: spec.type,
              original_name: spec.imported,
            },
          });
        });

        break;
      }

      case "ExportNamedDeclaration": {
        // Create an entity for the export statement
        let name = "named_export";
        if (node.declaration) {
          if (
            node.declaration.type === "FunctionDeclaration" ||
            node.declaration.type === "ClassDeclaration"
          ) {
            name = node.declaration.id?.name || "anonymous";
          } else if (
            node.declaration.type === "VariableDeclaration" &&
            node.declaration.declarations.length > 0
          ) {
            name = node.declaration.declarations[0].id?.name || "anonymous";
          }
        } else if (node.specifiers && node.specifiers.length > 0) {
          name = node.specifiers
            .map((s) => s.exported?.name || s.local?.name || "anonymous")
            .join(",");
        }

        currentEntity = createEntity(
          "export",
          name,
          startPosition,
          endPosition,
          startLine,
          endLine,
          rawContent,
          parentEntity,
          {
            ast_node_type: node.type,
            source: node.source?.value,
          }
        );

        idMap.set(node, currentEntity);

        // Visit the declaration
        if (node.declaration) {
          visit(node.declaration, node, parentEntity, scope);
        }

        // Add relationships for the exports
        if (node.specifiers) {
          node.specifiers.forEach((spec) => {
            if (spec.local && spec.exported) {
              relationships.push({
                source: currentEntity,
                target: { name: spec.local.name, type: "exported" },
                type: "exports",
                metadata: {
                  exported_as: spec.exported.name,
                  source_module: node.source?.value,
                },
              });
            }
          });
        }

        break;
      }

      case "ExportDefaultDeclaration": {
        // Get name from declaration if possible
        let name = "default";
        if (node.declaration) {
          if (
            node.declaration.type === "FunctionDeclaration" ||
            node.declaration.type === "ClassDeclaration"
          ) {
            name = node.declaration.id?.name || "default";
          } else if (node.declaration.type === "Identifier") {
            name = node.declaration.name;
          }
        }

        currentEntity = createEntity(
          "export",
          name,
          startPosition,
          endPosition,
          startLine,
          endLine,
          rawContent,
          parentEntity,
          {
            ast_node_type: node.type,
            is_default: true,
          }
        );

        idMap.set(node, currentEntity);

        // Visit the declaration
        if (node.declaration) {
          visit(node.declaration, node, parentEntity, scope);
        }

        // Add relationship
        relationships.push({
          source: currentEntity,
          target: { name: name, type: "exported" },
          type: "exports",
          metadata: { is_default: true },
        });

        break;
      }

      case "InterfaceDeclaration": {
        // TypeScript interface
        const name = node.id?.name || "anonymous";

        currentEntity = createEntity(
          "interface",
          name,
          startPosition,
          endPosition,
          startLine,
          endLine,
          rawContent,
          parentEntity,
          {
            ast_node_type: node.type,
          }
        );

        idMap.set(node, currentEntity);

        // Add extends relationships
        if (node.extends) {
          node.extends.forEach((ext) => {
            if (ext.expression && ext.expression.type === "Identifier") {
              relationships.push({
                source: currentEntity,
                target: { name: ext.expression.name, type: "interface" },
                type: "extends",
              });
            }
          });
        }

        // Visit the interface body
        if (node.body) {
          visit(node.body, node, currentEntity, name);
        }

        break;
      }

      case "TypeAliasDeclaration": {
        // TypeScript type alias
        const name = node.id?.name || "anonymous";

        currentEntity = createEntity(
          "type_alias",
          name,
          startPosition,
          endPosition,
          startLine,
          endLine,
          rawContent,
          parentEntity,
          {
            ast_node_type: node.type,
          }
        );

        idMap.set(node, currentEntity);

        // Visit the type annotation
        if (node.typeAnnotation) {
          visit(node.typeAnnotation, node, currentEntity, name);
        }

        break;
      }

      case "EnumDeclaration": {
        // TypeScript enum
        const name = node.id?.name || "anonymous";

        currentEntity = createEntity(
          "enum",
          name,
          startPosition,
          endPosition,
          startLine,
          endLine,
          rawContent,
          parentEntity,
          {
            ast_node_type: node.type,
          }
        );

        idMap.set(node, currentEntity);

        // Visit the enum members
        if (node.members) {
          node.members.forEach((member) => {
            visit(member, node, currentEntity, name);
          });
        }

        break;
      }

      case "CallExpression": {
        // Record function call relationships
        if (parentEntity) {
          if (node.callee.type === "Identifier") {
            relationships.push({
              source: parentEntity,
              target: { name: node.callee.name, type: "function" },
              type: "calls",
            });
          } else if (node.callee.type === "MemberExpression") {
            if (
              node.callee.property &&
              node.callee.property.type === "Identifier"
            ) {
              relationships.push({
                source: parentEntity,
                target: { name: node.callee.property.name, type: "method" },
                type: "calls",
                metadata: {
                  object:
                    node.callee.object.type === "Identifier"
                      ? node.callee.object.name
                      : null,
                },
              });
            }
          }
        }

        // Visit callee and arguments
        if (node.callee) {
          visit(node.callee, node, parentEntity, scope);
        }

        if (node.arguments) {
          node.arguments.forEach((arg) => {
            visit(arg, node, parentEntity, scope);
          });
        }

        break;
      }

      // For nodes without explicit handlers, recursively visit child properties
      default: {
        for (const key in node) {
          const child = node[key];

          // Skip non-AST properties
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
              visit(item, node, parentEntity || currentEntity, scope);
            }
          } else if (child && typeof child === "object") {
            // Visit child node
            visit(child, node, parentEntity || currentEntity, scope);
          }
        }
      }
    }
  }

  // Start the traversal from the root node
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
    // Calculate content hash
    const contentHash = calculateContentHash(fileContent);

    // Extract filename
    const filename = extractFilename(filePath);

    // Detect or use provided language
    const language = detectLanguage(filePath, languageHint);

    // Check if file already exists and is unchanged
    const existingFileQuery = `
      SELECT entity_id, content_hash 
      FROM code_entities 
      WHERE file_path = ? AND entity_type = 'file'
    `;

    const existingFile = await executeQuery(existingFileQuery, [filePath]);

    let fileEntityId;

    if (existingFile && existingFile.length > 0) {
      fileEntityId = existingFile[0].entity_id;

      // If content hash matches, file is unchanged
      if (existingFile[0].content_hash === contentHash) {
        console.log(`File ${filePath} is unchanged, skipping indexing`);
        return;
      }

      // Update existing file entity
      await executeQuery(
        `
        UPDATE code_entities
        SET raw_content = ?, content_hash = ?, language = ?, last_modified_at = CURRENT_TIMESTAMP
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

      // Delete keywords for the file
      await executeQuery(
        `
        DELETE FROM entity_keywords
        WHERE entity_id = ?
      `,
        [fileEntityId]
      );
    } else {
      // Create new file entity
      fileEntityId = uuidv4();

      await executeQuery(
        `
        INSERT INTO code_entities (
          entity_id, file_path, entity_type, name, content_hash, raw_content, language, created_at, last_modified_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
        [
          fileEntityId,
          filePath,
          "file",
          filename,
          contentHash,
          fileContent,
          language,
        ]
      );
    }

    // Process file content based on language
    let codeEntities = [];
    let relationships = [];

    // For JavaScript/TypeScript, use AST-based extraction
    if (language === "javascript" || language === "typescript") {
      const ast = await buildAST(fileContent, language);

      if (ast && !ast.error) {
        const extracted = extractEntitiesFromAST(ast, fileContent);
        codeEntities = extracted.entities;
        relationships = extracted.relationships;
      } else {
        console.error(
          `Error building AST for ${filePath}:`,
          ast?.error || "Unknown error"
        );
        // Fallback to regex-based extraction for JS/TS with parsing errors
        codeEntities = extractEntitiesWithRegex(fileContent, language);
      }
    }
    // For other languages, use regex-based extraction
    else {
      codeEntities = extractEntitiesWithRegex(fileContent, language);
    }

    // Store each code entity
    for (const entity of codeEntities) {
      const entityId = uuidv4();

      // Convert custom_metadata to JSON string if it exists
      const customMetadataJson = entity.custom_metadata
        ? JSON.stringify(entity.custom_metadata)
        : null;

      // Insert entity into database
      await executeQuery(
        `
        INSERT INTO code_entities (
          entity_id, parent_entity_id, file_path, entity_type, name, 
          start_line, end_line, raw_content, language, custom_metadata,
          created_at, last_modified_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
        [
          entityId,
          fileEntityId, // All sub-entities have the file as parent by default
          filePath,
          entity.type,
          entity.name,
          entity.start_line,
          entity.end_line,
          entity.raw_content,
          language,
          customMetadataJson,
        ]
      );

      // Process content for keywords
      const tokens = tokenize(entity.raw_content);
      const keywords = extractKeywords(tokens, 20, language);

      // Store keywords
      for (const keyword of keywords) {
        await executeQuery(
          `
          INSERT INTO entity_keywords (
            entity_id, keyword, term_frequency, weight, keyword_type
          ) VALUES (?, ?, ?, ?, ?)
        `,
          [
            entityId,
            keyword.keyword,
            keyword.score || 1.0,
            keyword.score || 1.0,
            "term",
          ]
        );
      }

      // Store entity reference in memory for relationship processing
      entity.db_entity_id = entityId;
    }

    // Store parent-child relationships (e.g., method inside class, function inside function)
    // This second pass is needed because all entities now have their db_entity_id
    for (const rel of relationships) {
      // Skip incomplete relationships
      if (!rel.source || !rel.target) continue;

      const sourceId = rel.source.db_entity_id;
      const targetId = rel.target.db_entity_id;

      // If relationship is "contains", update the parent_entity_id in code_entities
      if (rel.type === "contains" && sourceId && targetId) {
        await executeQuery(
          `
          UPDATE code_entities
          SET parent_entity_id = ?
          WHERE entity_id = ?
          `,
          [sourceId, targetId]
        );
      }
      // For other relationships (calls, extends, imports, etc.), use the relationship table
      else if (sourceId && targetId) {
        await addRelationship(
          sourceId,
          targetId,
          rel.type,
          1.0,
          rel.metadata || {}
        );
      }
      // For target entities that might be in other files (calls, extends)
      else if (sourceId && !targetId && rel.target.name) {
        // Try to find the target entity by name and type
        const targetQuery = `
          SELECT entity_id 
          FROM code_entities 
          WHERE name = ? AND entity_type = ?
        `;

        const targetEntity = await executeQuery(targetQuery, [
          rel.target.name,
          rel.target.type,
        ]);

        if (targetEntity && targetEntity.length > 0) {
          await addRelationship(
            sourceId,
            targetEntity[0].entity_id,
            rel.type,
            1.0,
            rel.metadata || {}
          );
        }
      }
    }

    console.log(`Successfully indexed file ${filePath}`);
  } catch (error) {
    console.error(`Error indexing file ${filePath}:`, error);
    throw error;
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
    // Validate required message properties
    if (
      !message.message_id ||
      !message.conversation_id ||
      !message.role ||
      !message.content
    ) {
      throw new Error("Message object missing required properties");
    }

    console.log("===== INDEX MESSAGE - START =====");
    console.log("Input parameters:");
    console.log("- message_id:", message.message_id);
    console.log("- conversation_id:", message.conversation_id);
    console.log("- role:", message.role);
    console.log(
      "- content:",
      message.content &&
        message.content.substring(0, 50) +
          (message.content.length > 50 ? "..." : "")
    );
    console.log("- timestamp:", message.timestamp);

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

    console.log("Checking if message exists:", message.message_id);
    const existingMessage = await executeQuery(existingMessageQuery, [
      message.message_id,
    ]);

    console.log(
      "Existing message check result:",
      JSON.stringify(existingMessage)
    );

    if (
      existingMessage &&
      existingMessage.rows &&
      existingMessage.rows.length > 0
    ) {
      console.log("Updating existing message:", message.message_id);
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

        console.log("Update query parameters:", {
          message_id: message.message_id,
          content_length: message.content ? message.content.length : 0,
        });

        const updateResult = await executeQuery(updateQuery, updateParams);
        console.log("Message update result:", JSON.stringify(updateResult));
      } catch (updateError) {
        console.error("Update error:", updateError);
        throw updateError;
      }
    } else {
      console.log("Inserting new message:", message.message_id);
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

        console.log("Insert query parameters:", {
          message_id: message.message_id,
          conversation_id: message.conversation_id,
          role: message.role,
          timestamp: timestamp,
        });

        const insertResult = await executeQuery(insertQuery, insertParams);
        console.log("Message insert result:", JSON.stringify(insertResult));
      } catch (insertError) {
        console.error("Insert error:", insertError);
        console.error("Error stack:", insertError.stack);
        throw insertError;
      }
    }

    // Process message content for keywords
    const tokens = tokenize(message.content);
    const keywords = extractKeywords(tokens);

    console.log("===== INDEX MESSAGE - COMPLETE =====");
    console.log("Successfully indexed message:", message.message_id);

    return {
      messageId: message.message_id,
      keywords: keywords,
    };
  } catch (error) {
    console.error("===== INDEX MESSAGE - ERROR =====");
    console.error(`Error indexing message ${message?.message_id}:`, error);
    console.error("Error stack:", error.stack);
    throw error;
  }
}
