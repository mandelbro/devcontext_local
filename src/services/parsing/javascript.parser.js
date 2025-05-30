/**
 * JavaScript Parser
 *
 * This module provides functionality to traverse a Tree-sitter AST
 * for JavaScript/TypeScript and extract code entities and relationships.
 */

/**
 * Extract code entities and relationships from a JavaScript/TypeScript AST
 * @param {Object} astRootNode - The root node of the Tree-sitter AST
 * @param {String} fileContentString - The full content of the file
 * @returns {Object} Object containing arrays of extracted entities and relationships
 */
export function parseJavaScript(astRootNode, fileContentString) {
  // Initialize empty arrays to store the entities and relationships
  const entities = [];
  const relationships = [];

  // Track current parent entity for establishing relationships
  let currentParentEntity = null;

  /**
   * Helper function to create a code entity object
   * @param {Object} node - The Tree-sitter AST node
   * @param {String} entityType - Type of the entity (function_declaration, etc.)
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

    // Determine language - in the future, this could be more sophisticated
    // based on file extension or TypeScript-specific constructs
    const language =
      entityType.includes("interface") ||
      entityType.includes("type_alias") ||
      entityType.includes("enum")
        ? "typescript"
        : "javascript";

    // Create entity with a temporary ID that will be replaced by the database
    // This ID is just for establishing relationships within the same file
    const entity = {
      id: `temp_${entities.length + 1}`,
      entity_type: entityType,
      name: name,
      start_line: startLine,
      start_column: startColumn,
      end_line: endLine,
      end_column: endColumn,
      raw_content: rawContent,
      language: language,
      parent_entity_id: currentParentEntity ? currentParentEntity.id : null,
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
   * Find an entity by name in the current entities array
   * @param {String} name - The name of the entity to find
   * @param {String} type - Optional type to filter by
   * @returns {Object|null} The found entity or null
   */
  function findEntityByName(name, type = null) {
    for (const entity of entities) {
      if (entity.name === name && (!type || entity.entity_type === type)) {
        return entity;
      }
    }
    return null;
  }

  /**
   * Process function calls within a scope
   * @param {Object} node - The node to check for function calls
   * @param {Object} scopeEntity - The entity representing the current scope
   */
  function processFunctionCalls(node, scopeEntity) {
    if (!node || !scopeEntity) return;

    // Process call expressions
    if (node.type === "call_expression") {
      let functionName = "";
      let metadata = {};

      // Extract function name
      const functionNode = node.namedChild(0);
      if (functionNode) {
        if (functionNode.type === "identifier") {
          // Simple function call: foo()
          functionName = functionNode.text;
        } else if (functionNode.type === "member_expression") {
          // Method call: obj.method()
          for (let i = 0; i < functionNode.namedChildCount; i++) {
            const child = functionNode.namedChild(i);
            if (child.type === "property_identifier") {
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
   * @param {Object} node - Class declaration node
   * @param {Object} classEntity - The entity representing the class
   */
  function processClassInheritance(node, classEntity) {
    // Check for an extends clause
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === "extends_clause") {
        for (let j = 0; j < child.namedChildCount; j++) {
          const baseClassNode = child.namedChild(j);
          if (
            baseClassNode.type === "identifier" ||
            baseClassNode.type === "nested_identifier"
          ) {
            const baseClassName = baseClassNode.text;

            // Check if the base class is defined in this file
            const targetEntity = findEntityByName(
              baseClassName,
              "class_declaration"
            );

            createRelationship(
              classEntity.id,
              targetEntity ? targetEntity.id : null,
              baseClassName,
              "EXTENDS_CLASS"
            );
            break;
          }
        }
      }
    }
  }

  /**
   * Process TypeScript interface implementation
   * @param {Object} node - Class declaration node
   * @param {Object} classEntity - The entity representing the class
   */
  function processInterfaceImplementation(node, classEntity) {
    // Check for an implements clause
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === "implements_clause") {
        for (let j = 0; j < child.namedChildCount; j++) {
          const interfaceNode = child.namedChild(j);
          if (
            interfaceNode.type === "identifier" ||
            interfaceNode.type === "nested_identifier"
          ) {
            const interfaceName = interfaceNode.text;

            // Check if the interface is defined in this file
            const targetEntity = findEntityByName(
              interfaceName,
              "interface_declaration"
            );

            createRelationship(
              classEntity.id,
              targetEntity ? targetEntity.id : null,
              interfaceName,
              "IMPLEMENTS_INTERFACE"
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
      // Skip if part of declaration, function name, etc.
      node.parent &&
      ![
        "variable_declarator",
        "function_declaration",
        "method_definition",
      ].includes(node.parent.type)
    ) {
      const varName = node.text;

      // Try to find the variable in our entities
      const targetEntity = findEntityByName(varName, "variable_declarator");

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
   * Process import/export relationships
   * @param {Object} entity - The entity representing the import or export statement
   */
  function processImportExportRelationships(entity) {
    if (entity.entity_type === "import_statement") {
      const modulePath = entity.custom_metadata.source;
      const importNames = entity.custom_metadata.importNames || [];

      // Create relationship for each imported symbol
      for (const importName of importNames) {
        createRelationship(
          entity.id,
          null, // We don't know the target entity ID since it's in another file
          importName,
          "IMPORTS_MODULE",
          { modulePath }
        );
      }
    } else if (entity.entity_type === "export_statement") {
      const exportedNames = entity.custom_metadata.exportedNames || [];
      const isDefault = entity.custom_metadata.isDefault;

      // For each exported symbol, create a relationship
      for (const exportName of exportedNames) {
        // Try to find the exported entity in our list
        const targetEntity = findEntityByName(exportName);

        createRelationship(
          entity.id,
          targetEntity ? targetEntity.id : null,
          exportName,
          "EXPORTS_SYMBOL",
          { isDefault }
        );
      }
    }
  }

  /**
   * Process a function declaration node
   * @param {Object} node - Function declaration node
   */
  function processFunctionDeclaration(node) {
    // Find the identifier (function name) child node
    let nameNode = null;

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
        isAsync:
          node.type === "function_declaration" &&
          node.firstChild &&
          node.firstChild.type === "async",
      };

      const entity = createEntity(
        node,
        "function_declaration",
        functionName,
        customMetadata
      );
      entities.push(entity);

      // Store the previous parent and set this entity as the new parent
      const prevParent = currentParentEntity;
      currentParentEntity = entity;

      // Process the function body to extract nested entities
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === "statement_block") {
          traverseNode(child);

          // Process function calls and variable references in the function body
          processFunctionCalls(child, entity);
          processVariableReferences(child, entity);
        }
      }

      // Restore the previous parent
      currentParentEntity = prevParent;
    }
  }

  /**
   * Process a function expression node (including arrow functions)
   * @param {Object} node - Function expression node
   * @param {Object} parentNode - The parent node (e.g., variable declaration)
   */
  function processFunctionExpression(node, parentNode) {
    let functionName = "anonymous";
    let customMetadata = {
      isArrow: node.type === "arrow_function",
      isAsync: false,
    };

    // Check if this is an async function
    if (node.firstChild && node.firstChild.type === "async") {
      customMetadata.isAsync = true;
    }

    // If parent is a variable declaration, use that as the function name
    if (parentNode && parentNode.type === "variable_declarator") {
      for (let i = 0; i < parentNode.namedChildCount; i++) {
        const child = parentNode.namedChild(i);
        if (child.type === "identifier") {
          functionName = child.text;
          break;
        }
      }
    }

    // If parent is a pair (object property), use that as the function name
    if (parentNode && parentNode.type === "pair") {
      for (let i = 0; i < parentNode.namedChildCount; i++) {
        const child = parentNode.namedChild(i);
        if (child.type === "property_identifier") {
          functionName = child.text;
          break;
        }
      }
    }

    // If parent is a member expression assignment, use the property name
    if (
      parentNode &&
      (parentNode.type === "assignment_expression" ||
        parentNode.type === "pair") &&
      parentNode.namedChild(0) &&
      parentNode.namedChild(0).type === "member_expression"
    ) {
      const memberExpr = parentNode.namedChild(0);
      for (let i = 0; i < memberExpr.namedChildCount; i++) {
        const child = memberExpr.namedChild(i);
        if (child.type === "property_identifier") {
          functionName = child.text;
          break;
        }
      }
    }

    const entityType =
      node.type === "arrow_function"
        ? "arrow_function_expression"
        : "function_expression";

    const entity = createEntity(node, entityType, functionName, customMetadata);
    entities.push(entity);

    // Store the previous parent and set this entity as the new parent
    const prevParent = currentParentEntity;
    currentParentEntity = entity;

    // Process the function body to extract nested entities
    let bodyNode = null;
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === "statement_block") {
        bodyNode = child;
        traverseNode(child);
      }
    }

    // For arrow functions, the expression might be the body
    if (!bodyNode && node.type === "arrow_function") {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type !== "formal_parameters") {
          bodyNode = child;
          break;
        }
      }
    }

    // Process function calls and variable references in the function body
    if (bodyNode) {
      processFunctionCalls(bodyNode, entity);
      processVariableReferences(bodyNode, entity);
    }

    // Restore the previous parent
    currentParentEntity = prevParent;
  }

  /**
   * Process a class declaration node
   * @param {Object} node - Class declaration node
   */
  function processClassDeclaration(node) {
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
      const entity = createEntity(node, "class_declaration", className);
      entities.push(entity);

      // Process inheritance and interface implementation
      processClassInheritance(node, entity);
      processInterfaceImplementation(node, entity);

      // Store the previous parent and set this entity as the new parent
      const prevParent = currentParentEntity;
      currentParentEntity = entity;

      // Process the class body to extract methods
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === "class_body") {
          traverseNode(child);
        }
      }

      // Restore the previous parent
      currentParentEntity = prevParent;
    }
  }

  /**
   * Process a method definition node
   * @param {Object} node - Method definition node
   */
  function processMethodDefinition(node) {
    // Find the method name
    let nameNode = null;

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (
        child.type === "property_identifier" ||
        child.type === "computed_property_name"
      ) {
        nameNode = child;
        break;
      }
    }

    if (nameNode) {
      const methodName = nameNode.text;
      const customMetadata = {
        isAsync: node.firstChild && node.firstChild.type === "async",
        isStatic: node.firstChild && node.firstChild.type === "static",
        isGetter: node.firstChild && node.firstChild.type === "get",
        isSetter: node.firstChild && node.firstChild.type === "set",
      };

      const entity = createEntity(
        node,
        "method_definition",
        methodName,
        customMetadata
      );
      entities.push(entity);

      // Store the previous parent and set this entity as the new parent
      const prevParent = currentParentEntity;
      currentParentEntity = entity;

      // Process the method body to extract nested entities
      let bodyNode = null;
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === "statement_block") {
          bodyNode = child;
          traverseNode(child);
        }
      }

      // Process function calls and variable references in the method body
      if (bodyNode) {
        processFunctionCalls(bodyNode, entity);
        processVariableReferences(bodyNode, entity);
      }

      // Restore the previous parent
      currentParentEntity = prevParent;
    }
  }

  /**
   * Process a variable declaration node
   * @param {Object} node - Variable declaration node
   */
  function processVariableDeclaration(node) {
    const kind = node.firstChild ? node.firstChild.type : null; // var, let, const

    for (let i = 0; i < node.namedChildCount; i++) {
      const declarator = node.namedChild(i);
      if (declarator.type === "variable_declarator") {
        // Get the variable name
        let nameNode = null;
        for (let j = 0; j < declarator.namedChildCount; j++) {
          const child = declarator.namedChild(j);
          if (child.type === "identifier") {
            nameNode = child;
            break;
          }
        }

        if (nameNode) {
          const variableName = nameNode.text;

          // Check if this is a function assignment
          let valueNode = null;
          for (let j = 0; j < declarator.namedChildCount; j++) {
            const child = declarator.namedChild(j);
            if (child.type === "function" || child.type === "arrow_function") {
              valueNode = child;
              processFunctionExpression(valueNode, declarator);
              break;
            }
          }

          // If not a function, create a variable entity
          if (
            !valueNode ||
            (valueNode.type !== "function" &&
              valueNode.type !== "arrow_function")
          ) {
            const customMetadata = { kind: kind };
            const entity = createEntity(
              declarator,
              "variable_declarator",
              variableName,
              customMetadata
            );
            entities.push(entity);

            // If there's a value assigned, check for references
            for (let j = 0; j < declarator.namedChildCount; j++) {
              const child = declarator.namedChild(j);
              if (child.type !== "identifier") {
                // Process any variable references in the initialization
                if (currentParentEntity) {
                  processVariableReferences(child, currentParentEntity);
                }
                break;
              }
            }
          }
        }
      }
    }
  }

  /**
   * Process an interface declaration node (TypeScript)
   * @param {Object} node - Interface declaration node
   */
  function processInterfaceDeclaration(node) {
    // Find the identifier (interface name) child node
    let nameNode = null;

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === "identifier") {
        nameNode = child;
        break;
      }
    }

    if (nameNode) {
      const interfaceName = nameNode.text;
      const entity = createEntity(node, "interface_declaration", interfaceName);
      entity.language = "typescript";
      entities.push(entity);

      // Check for extends clauses to establish relationships
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === "extends_clause") {
          for (let j = 0; j < child.namedChildCount; j++) {
            const baseInterfaceNode = child.namedChild(j);
            if (
              baseInterfaceNode.type === "identifier" ||
              baseInterfaceNode.type === "nested_identifier"
            ) {
              const baseInterfaceName = baseInterfaceNode.text;

              // Check if the base interface is defined in this file
              const targetEntity = findEntityByName(
                baseInterfaceName,
                "interface_declaration"
              );

              createRelationship(
                entity.id,
                targetEntity ? targetEntity.id : null,
                baseInterfaceName,
                "EXTENDS_INTERFACE"
              );
            }
          }
        }
      }
    }
  }

  /**
   * Process a type alias declaration node (TypeScript)
   * @param {Object} node - Type alias declaration node
   */
  function processTypeAliasDeclaration(node) {
    // Find the identifier (type name) child node
    let nameNode = null;

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === "identifier") {
        nameNode = child;
        break;
      }
    }

    if (nameNode) {
      const typeName = nameNode.text;
      const entity = createEntity(node, "type_alias_declaration", typeName);
      entity.language = "typescript";
      entities.push(entity);
    }
  }

  /**
   * Process an enum declaration node (TypeScript)
   * @param {Object} node - Enum declaration node
   */
  function processEnumDeclaration(node) {
    // Find the identifier (enum name) child node
    let nameNode = null;

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === "identifier") {
        nameNode = child;
        break;
      }
    }

    if (nameNode) {
      const enumName = nameNode.text;
      const entity = createEntity(node, "enum_declaration", enumName);
      entity.language = "typescript";
      entities.push(entity);
    }
  }

  /**
   * Process an import statement
   * @param {Object} node - Import statement node
   */
  function processImportStatement(node) {
    // Gather the import specifiers or default import name
    let importNames = [];
    let importSource = null;

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);

      if (child.type === "import_specifier") {
        // Named import: import { name } from 'source'
        for (let j = 0; j < child.namedChildCount; j++) {
          const specifier = child.namedChild(j);
          if (specifier.type === "identifier") {
            importNames.push(specifier.text);
            break;
          }
        }
      } else if (child.type === "identifier") {
        // Default import: import name from 'source'
        importNames.push(child.text);
      } else if (child.type === "namespace_import") {
        // Namespace import: import * as name from 'source'
        for (let j = 0; j < child.namedChildCount; j++) {
          const specifier = child.namedChild(j);
          if (specifier.type === "identifier") {
            importNames.push(`* as ${specifier.text}`);
            break;
          }
        }
      } else if (child.type === "string") {
        // Import source: from 'source'
        importSource = child.text;
      }
    }

    // Create an entity for the import statement
    if (importNames.length > 0 && importSource) {
      const importName = importNames.join(", ");
      const customMetadata = {
        importNames: importNames,
        source: importSource,
      };

      const entity = createEntity(
        node,
        "import_statement",
        importName,
        customMetadata
      );
      entities.push(entity);

      // Process import relationships
      processImportExportRelationships(entity);
    }
  }

  /**
   * Process an export statement
   * @param {Object} node - Export statement node
   */
  function processExportStatement(node) {
    let exportName = "default";
    let customMetadata = {
      isDefault: false,
    };

    // Check if this is a default export
    if (node.type === "export_statement") {
      for (let i = 0; i < node.childCount; i++) {
        if (node.child(i).type === "default") {
          customMetadata.isDefault = true;
          break;
        }
      }
    }

    // Extract the exported name(s)
    let exportedNames = [];
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);

      if (child.type === "identifier") {
        exportedNames.push(child.text);
      } else if (child.type === "export_specifier") {
        // Named export specifier: export { name }
        for (let j = 0; j < child.namedChildCount; j++) {
          const specifier = child.namedChild(j);
          if (specifier.type === "identifier") {
            exportedNames.push(specifier.text);
            break;
          }
        }
      } else if (child.type === "export_clause") {
        // Get names from export clause: export { name1, name2 }
        for (let j = 0; j < child.namedChildCount; j++) {
          const specifier = child.namedChild(j);
          if (specifier.type === "export_specifier") {
            for (let k = 0; k < specifier.namedChildCount; k++) {
              const identifier = specifier.namedChild(k);
              if (identifier.type === "identifier") {
                exportedNames.push(identifier.text);
                break;
              }
            }
          }
        }
      } else if (
        child.type === "function_declaration" ||
        child.type === "class_declaration" ||
        child.type === "variable_declaration"
      ) {
        // Traverse the child node to process the exported declaration
        traverseNode(child);
      }
    }

    if (exportedNames.length > 0) {
      exportName = exportedNames.join(", ");
      customMetadata.exportedNames = exportedNames;
    }

    // Create an entity for the export statement
    const entity = createEntity(
      node,
      "export_statement",
      exportName,
      customMetadata
    );
    entities.push(entity);

    // Process export relationships
    processImportExportRelationships(entity);
  }

  /**
   * Process a JSX/TSX element (React component)
   * @param {Object} node - JSX element node
   */
  function processJsxElement(node) {
    // Find the opening tag name
    let tagName = "unknown";

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);

      if (child.type === "jsx_opening_element") {
        for (let j = 0; j < child.namedChildCount; j++) {
          const nameNode = child.namedChild(j);
          if (
            nameNode.type === "identifier" ||
            nameNode.type === "nested_identifier" ||
            nameNode.type === "jsx_identifier"
          ) {
            tagName = nameNode.text;
            break;
          }
        }
        break;
      }
    }

    // Create a custom component entity if the tag name starts with a capital letter
    // (following React's convention for custom components)
    if (tagName.match(/^[A-Z]/)) {
      const customMetadata = {
        isComponent: true,
      };

      const entity = createEntity(node, "jsx_element", tagName, customMetadata);
      entities.push(entity);

      // If we're in a component and this is a custom component usage,
      // create a "USES_COMPONENT" relationship
      if (currentParentEntity) {
        // Try to find a component declaration in our entities
        const targetEntity = findEntityByName(tagName);

        createRelationship(
          currentParentEntity.id,
          targetEntity ? targetEntity.id : null,
          tagName,
          "USES_COMPONENT"
        );
      }
    }
  }

  /**
   * Process a comment node
   * @param {Object} node - Comment node
   */
  function processComment(node) {
    // Extract the comment text, removing comment markers
    let commentText = node.text;

    // For block comments
    if (node.type === "comment" && commentText.startsWith("/*")) {
      commentText = commentText.substring(2, commentText.length - 2).trim();
    }
    // For line comments
    else if (node.type === "comment" && commentText.startsWith("//")) {
      commentText = commentText.substring(2).trim();
    }

    // Only create entities for significant comments (more than a few words)
    const words = commentText.split(/\s+/).filter(Boolean);
    if (words.length >= 3) {
      const customMetadata = {
        isBlock: node.type === "comment" && node.text.startsWith("/*"),
        isJSDoc: node.type === "comment" && node.text.startsWith("/**"),
      };

      // Use first few words as a name
      const name =
        words.slice(0, 3).join(" ") + (words.length > 3 ? "..." : "");

      const entity = createEntity(node, "comment", name, customMetadata);
      entities.push(entity);
    }
  }

  /**
   * Recursively traverse the AST node
   * @param {Object} node - Current node in traversal
   */
  function traverseNode(node) {
    switch (node.type) {
      case "function_declaration":
        processFunctionDeclaration(node);
        break;

      case "function":
      case "arrow_function":
        processFunctionExpression(node, node.parent);
        break;

      case "class_declaration":
        processClassDeclaration(node);
        break;

      case "method_definition":
        processMethodDefinition(node);
        break;

      case "lexical_declaration":
      case "variable_declaration":
        processVariableDeclaration(node);
        break;

      case "interface_declaration":
        processInterfaceDeclaration(node);
        break;

      case "type_alias_declaration":
        processTypeAliasDeclaration(node);
        break;

      case "enum_declaration":
        processEnumDeclaration(node);
        break;

      case "import_statement":
        processImportStatement(node);
        break;

      case "export_statement":
        processExportStatement(node);
        break;

      case "jsx_element":
      case "jsx_self_closing_element":
        processJsxElement(node);
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

export default {
  parseJavaScript,
  nodeToObject,
};
