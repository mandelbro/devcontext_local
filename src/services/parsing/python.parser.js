/**
 * Python Parser
 *
 * This module provides functionality to traverse a Tree-sitter AST
 * for Python and extract code entities and relationships.
 */

/**
 * Extract code entities and relationships from a Python AST
 * @param {Object} astRootNode - The root node of the Tree-sitter AST
 * @param {String} fileContentString - The full content of the file
 * @returns {Object} Object containing arrays of extracted entities and relationships
 */
export function parsePython(astRootNode, fileContentString) {
  // Initialize empty arrays to store the entities and relationships
  const entities = [];
  const relationships = [];

  // Track current parent entity for establishing hierarchical relationships
  let currentParentEntity = null;

  /**
   * Helper function to create a code entity object
   * @param {Object} node - The Tree-sitter AST node
   * @param {String} entityType - Type of the entity (function_definition, etc.)
   * @param {String} name - Name of the entity
   * @param {Object} customMetadata - Additional metadata for the entity
   * @returns {Object} A code entity object
   */
  function createEntity(node, entityType, name, customMetadata = {}) {
    // Extract the raw content from the file using node positions
    const startByte = node.startIndex;
    const endByte = node.endIndex;
    const rawContent = fileContentString.substring(startByte, endByte);

    // Extract position information
    const startLine = node.startPosition.row;
    const startColumn = node.startPosition.column;
    const endLine = node.endPosition.row;
    const endColumn = node.endPosition.column;

    // Create a unique ID for the entity based on its location
    const id = `python-${entityType}-${startLine}-${startColumn}-${endLine}-${endColumn}`;

    // Create and return the entity object
    const entity = {
      id,
      entity_type: entityType,
      name,
      language: "python",
      start_line: startLine,
      start_column: startColumn,
      end_line: endLine,
      end_column: endColumn,
      start_byte: startByte,
      end_byte: endByte,
      raw_content: rawContent,
      custom_metadata: customMetadata,
    };

    // If this entity has a parent, create a parent-child relationship
    if (currentParentEntity) {
      createRelationship(
        currentParentEntity.id,
        entity.id,
        entity.name,
        "DEFINES_CHILD_ENTITY"
      );
    }

    return entity;
  }

  /**
   * Helper function to create a code relationship object
   * @param {String} sourceEntityId - ID of the source entity
   * @param {String|null} targetEntityId - ID of the target entity, if available
   * @param {String} targetSymbolName - Name of the target symbol
   * @param {String} relationshipType - Type of relationship (e.g., CALLS_FUNCTION)
   * @param {Object} customMetadata - Additional metadata for the relationship
   * @returns {Object} A code relationship object
   */
  function createRelationship(
    sourceEntityId,
    targetEntityId,
    targetSymbolName,
    relationshipType,
    customMetadata = {}
  ) {
    const relationship = {
      source_entity_id: sourceEntityId,
      target_entity_id: targetEntityId,
      target_symbol_name: targetSymbolName,
      relationship_type: relationshipType,
      custom_metadata: customMetadata,
    };

    relationships.push(relationship);
    return relationship;
  }

  /**
   * Find an entity by name and optionally by type
   * @param {String} name - Name of the entity to find
   * @param {String} [type] - Optional entity type filter
   * @returns {Object|null} - Found entity or null
   */
  function findEntityByName(name, type = null) {
    return entities.find(
      (entity) => entity.name === name && (!type || entity.entity_type === type)
    );
  }

  /**
   * Process a function definition node
   * @param {Object} node - Function definition node
   */
  function processFunctionDefinition(node) {
    // Find the identifier (function name) child node
    let nameNode = null;
    let isAsync = false;

    // Check if the function is defined with 'async' keyword
    if (node.firstChild && node.firstChild.type === "async") {
      isAsync = true;
    }

    // Loop through all named children to find the identifier (name)
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === "identifier") {
        nameNode = child;
        break;
      }
    }

    if (nameNode) {
      const functionName = nameNode.text;
      const customMetadata = {
        isAsync: isAsync,
        isMethod:
          currentParentEntity &&
          currentParentEntity.entity_type === "class_definition",
      };

      const entity = createEntity(
        node,
        customMetadata.isMethod ? "method_definition" : "function_definition",
        functionName,
        customMetadata
      );
      entities.push(entity);

      // Store the previous parent and set this entity as the new parent
      const prevParent = currentParentEntity;
      currentParentEntity = entity;

      // Process the function body to extract nested entities and relationships
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === "block") {
          traverseNode(child);

          // Process function calls and variable references
          processFunctionCalls(child, entity);
          processVariableReferences(child, entity);
        }
      }

      // Restore the previous parent
      currentParentEntity = prevParent;
    }
  }

  /**
   * Process a class definition node
   * @param {Object} node - Class definition node
   */
  function processClassDefinition(node) {
    // Find the identifier (class name) child node
    let nameNode = null;

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === "identifier") {
        nameNode = child;
        break;
      }
    }

    if (nameNode) {
      const className = nameNode.text;

      // Check for inheritance
      let baseClasses = [];
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === "argument_list") {
          // Process base classes
          for (let j = 0; j < child.namedChildCount; j++) {
            const baseClassNode = child.namedChild(j);
            if (baseClassNode.type === "identifier") {
              baseClasses.push(baseClassNode.text);
            }
          }
          break;
        }
      }

      const customMetadata = {
        baseClasses: baseClasses,
      };

      const entity = createEntity(
        node,
        "class_definition",
        className,
        customMetadata
      );
      entities.push(entity);

      // Process inheritance relationships
      processClassInheritance(node, entity);

      // Store the previous parent and set this entity as the new parent
      const prevParent = currentParentEntity;
      currentParentEntity = entity;

      // Process the class body to extract methods
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === "block") {
          traverseNode(child);
        }
      }

      // Restore the previous parent
      currentParentEntity = prevParent;
    }
  }

  /**
   * Process a variable assignment node
   * @param {Object} node - Assignment node
   */
  function processAssignment(node) {
    // Process the left side of the assignment (targets)
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);

      // Find the left side of the assignment
      if (i === 0) {
        // First child is the left side in Python assignments
        // Handle simple variable assignments
        if (child.type === "identifier") {
          const variableName = child.text;
          const entity = createEntity(node, "assignment", variableName, {
            scope: currentParentEntity
              ? currentParentEntity.entity_type
              : "module",
          });
          entities.push(entity);
        }
        // Handle multiple assignments (a, b = 1, 2)
        else if (child.type === "tuple") {
          for (let j = 0; j < child.namedChildCount; j++) {
            const tupleItem = child.namedChild(j);
            if (tupleItem.type === "identifier") {
              const variableName = tupleItem.text;
              const entity = createEntity(
                tupleItem,
                "assignment",
                variableName,
                {
                  isMultipleAssignment: true,
                  scope: currentParentEntity
                    ? currentParentEntity.entity_type
                    : "module",
                }
              );
              entities.push(entity);
            }
          }
        }
        break; // We only process the left side here
      }
    }
  }

  /**
   * Process an import statement
   * @param {Object} node - Import node
   */
  function processImport(node) {
    const importNames = [];
    let fromModule = null;

    // Process import statement
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);

      if (child.type === "dotted_name") {
        // Regular import: import foo.bar
        importNames.push(child.text);
      } else if (child.type === "aliased_import") {
        // Import with alias: import foo as bar
        for (let j = 0; j < child.namedChildCount; j++) {
          const aliasChild = child.namedChild(j);
          if (aliasChild.type === "dotted_name") {
            const name = aliasChild.text;
            const nextChild = child.namedChild(j + 1);
            if (nextChild && nextChild.type === "identifier") {
              importNames.push(`${name} as ${nextChild.text}`);
            } else {
              importNames.push(name);
            }
            break;
          }
        }
      } else if (
        child.type === "identifier" &&
        node.type === "import_from_statement"
      ) {
        // From import: from foo import bar
        importNames.push(child.text);
      }

      // Handle 'from' part of import
      if (
        child.type === "dotted_name" &&
        node.type === "import_from_statement"
      ) {
        fromModule = child.text;
      }
    }

    if (importNames.length > 0) {
      const importName = importNames.join(", ");
      const customMetadata = {
        importedNames: importNames,
        fromModule: fromModule,
      };

      const entity = createEntity(
        node,
        fromModule ? "import_from" : "import",
        importName,
        customMetadata
      );
      entities.push(entity);

      // Create import relationships
      processImportRelationships(entity);
    }
  }

  /**
   * Process a comment node
   * @param {Object} node - Comment node
   */
  function processComment(node) {
    // Only process top-level or class-level comments
    if (
      !currentParentEntity ||
      currentParentEntity.entity_type === "class_definition"
    ) {
      // Extract the comment text
      const commentText = node.text.trim();

      // Only create entities for substantial comments
      if (commentText.length > 3) {
        const entity = createEntity(
          node,
          "comment",
          commentText.substring(0, 30) + (commentText.length > 30 ? "..." : ""),
          {
            scope: currentParentEntity
              ? currentParentEntity.entity_type
              : "module",
          }
        );
        entities.push(entity);
      }
    }
  }

  /**
   * Process function calls within a code block
   * @param {Object} node - Node to check for function calls
   * @param {Object} scopeEntity - Entity that contains this code block
   */
  function processFunctionCalls(node, scopeEntity) {
    if (!node || !scopeEntity) return;

    // Python call expression can have different forms
    if (node.type === "call") {
      let functionName = "";
      let metadata = {};

      // Get the function being called (first child)
      const functionNode = node.namedChild(0);

      if (functionNode) {
        if (functionNode.type === "identifier") {
          // Simple function call: foo()
          functionName = functionNode.text;
        } else if (functionNode.type === "attribute") {
          // Method call: obj.method()
          // Find the attribute name (method name)
          for (let i = 0; i < functionNode.namedChildCount; i++) {
            const child = functionNode.namedChild(i);
            if (
              child.type === "identifier" &&
              i === functionNode.namedChildCount - 1
            ) {
              functionName = child.text;

              // Get the object name for more context
              const objectNode = functionNode.namedChild(0);
              if (objectNode && objectNode.type === "identifier") {
                metadata.objectName = objectNode.text;
              }
              break;
            }
          }
        }

        if (functionName) {
          // Check if this is calling a function we've already defined
          const targetEntity = findEntityByName(functionName);

          createRelationship(
            scopeEntity.id,
            targetEntity ? targetEntity.id : null,
            functionName,
            "CALLS_FUNCTION",
            {
              callLocation: {
                line: node.startPosition.row,
                column: node.startPosition.column,
              },
              ...metadata,
            }
          );
        }
      }
    }

    // Recursively process children
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      processFunctionCalls(child, scopeEntity);
    }
  }

  /**
   * Process class inheritance relationships
   * @param {Object} node - Class definition node
   * @param {Object} classEntity - The entity representing the class
   */
  function processClassInheritance(node, classEntity) {
    // Check for base classes in the argument list
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === "argument_list") {
        for (let j = 0; j < child.namedChildCount; j++) {
          const baseClassNode = child.namedChild(j);
          if (baseClassNode.type === "identifier") {
            const baseClassName = baseClassNode.text;

            // Check if the base class is defined in this file
            const targetEntity = findEntityByName(
              baseClassName,
              "class_definition"
            );

            createRelationship(
              classEntity.id,
              targetEntity ? targetEntity.id : null,
              baseClassName,
              "EXTENDS_CLASS"
            );
          }
        }
      }
    }
  }

  /**
   * Process variable references within a scope
   * @param {Object} node - The node to check for variable references
   * @param {Object} scopeEntity - The entity representing the current scope
   */
  function processVariableReferences(node, scopeEntity) {
    if (!node || !scopeEntity) return;

    // Process identifiers that might be variable references
    if (
      node.type === "identifier" &&
      // Skip if part of declaration or function definition
      node.parent &&
      ![
        "function_definition",
        "class_definition",
        // Skip left side of assignments
        "assignment",
      ].includes(node.parent.type) &&
      // If part of an assignment but not on the left side (first child)
      !(node.parent.type === "assignment" && node.parent.namedChild(0) === node)
    ) {
      const varName = node.text;

      // Try to find the variable in our entities
      const targetEntity = findEntityByName(varName, "assignment");

      createRelationship(
        scopeEntity.id,
        targetEntity ? targetEntity.id : null,
        varName,
        "REFERENCES_VARIABLE",
        {
          referenceLocation: {
            line: node.startPosition.row,
            column: node.startPosition.column,
          },
        }
      );
    }

    // Recursively process children
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      processVariableReferences(child, scopeEntity);
    }
  }

  /**
   * Process import relationships
   * @param {Object} entity - The entity representing the import statement
   */
  function processImportRelationships(entity) {
    if (
      entity.entity_type === "import" ||
      entity.entity_type === "import_from"
    ) {
      const fromModule = entity.custom_metadata.fromModule;
      const importedNames = entity.custom_metadata.importedNames || [];

      // Create relationship for each imported symbol
      for (const importName of importedNames) {
        // Extract the actual name (without "as" alias)
        const actualName = importName.includes(" as ")
          ? importName.split(" as ")[0]
          : importName;

        createRelationship(
          entity.id,
          null, // We don't know the target entity ID since it's in another file
          actualName,
          "IMPORTS_MODULE",
          {
            fromModule: fromModule,
            fullImport: importName,
          }
        );
      }
    }
  }

  /**
   * Recursively traverse the AST node
   * @param {Object} node - Current node in traversal
   */
  function traverseNode(node) {
    switch (node.type) {
      case "function_definition":
        processFunctionDefinition(node);
        break;

      case "class_definition":
        processClassDefinition(node);
        break;

      case "assignment":
        processAssignment(node);
        break;

      case "import_statement":
      case "import_from_statement":
        processImport(node);
        break;

      case "comment":
        processComment(node);
        break;

      default:
        // Continue traversing for other node types
        for (let i = 0; i < node.namedChildCount; i++) {
          traverseNode(node.namedChild(i));
        }
        break;
    }
  }

  // Start traversal from the root node
  traverseNode(astRootNode);

  // Return the extracted entities and relationships
  return { entities, relationships };
}

/**
 * Utility function to convert a node object to a plain JavaScript object
 * This can be useful for debugging or serializing the node
 * @param {Object} node - Tree-sitter node
 * @returns {Object} Plain object representation
 */
export function nodeToObject(node) {
  if (!node) return null;

  const obj = {
    type: node.type,
    text: node.text,
    startPosition: {
      row: node.startPosition.row,
      column: node.startPosition.column,
    },
    endPosition: {
      row: node.endPosition.row,
      column: node.endPosition.column,
    },
    childCount: node.childCount,
    namedChildCount: node.namedChildCount,
    children: [],
  };

  // Add children recursively
  for (let i = 0; i < node.namedChildCount; i++) {
    obj.children.push(nodeToObject(node.namedChild(i)));
  }

  return obj;
}
