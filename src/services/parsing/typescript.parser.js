/**
 * TypeScript Parser
 *
 * This module provides functionality to traverse a Tree-sitter AST
 * for TypeScript/TSX and extract code entities and relationships.
 */

/**
 * Extract code entities and relationships from a TypeScript/TSX AST
 * @param {Object} astRootNode - The root node of the Tree-sitter AST
 * @param {String} fileContentString - The full content of the file
 * @returns {Object} Object containing arrays of extracted entities and relationships
 */
export function parseTypeScript(astRootNode, fileContentString) {
  // Initialize empty arrays to store the entities and relationships
  const entities = [];
  const relationships = [];

  // Track current parent entity for establishing hierarchical relationships
  let currentParentEntity = null;

  /**
   * Helper function to create a code entity object
   * @param {Object} node - The Tree-sitter AST node
   * @param {string} entityType - The type of entity
   * @param {Object|null} parentEntity - The parent entity (if any)
   * @returns {Object|null} The created entity object or null if creation failed
   * @private
   */
  function createCodeEntity(node, entityType, parentEntity = null) {
    if (!node) return null;

    // Extract the raw content from the file using node positions
    const startByte = node.startIndex;
    const endByte = node.endIndex;
    const rawContent = fileContentString.substring(startByte, endByte);

    // Extract position information
    const startLine = node.startPosition.row + 1; // Tree-sitter uses 0-based line numbers
    const startColumn = node.startPosition.column;
    const endLine = node.endPosition.row + 1;
    const endColumn = node.endPosition.column;

    // Create entity with a temporary ID that will be replaced by the database
    // This ID is just for establishing relationships within the same file
    const entity = {
      id: `temp_${entities.length + 1}`,
      entity_type: entityType,
      name: "", // Will be set by the specific entity creation function
      start_line: startLine,
      start_column: startColumn,
      end_line: endLine,
      end_column: endColumn,
      raw_content: rawContent,
      language: "typescript",
      parent_entity_id: parentEntity ? parentEntity.id : null,
      custom_metadata: {},
    };

    // Add the entity to our array
    entities.push(entity);

    // If this entity has a parent, create a parent-child relationship
    if (parentEntity) {
      createRelationship(
        parentEntity.id,
        entity.id,
        entity.id, // Use the entity ID as target_symbol_name since we don't have the name yet
        "DEFINES_CHILD_ENTITY"
      );
    }

    return entity;
  }

  /**
   * Helper function to create a relationship object
   * @param {string} sourceEntityId - The ID of the source entity
   * @param {string|null} targetEntityId - The ID of the target entity (if known)
   * @param {string} targetSymbolName - The name of the target symbol
   * @param {string} relationshipType - The type of relationship
   * @param {Object} customMetadata - Additional metadata for the relationship
   * @private
   */
  function createRelationship(
    sourceEntityId,
    targetEntityId,
    targetSymbolName,
    relationshipType,
    customMetadata = {}
  ) {
    if (!sourceEntityId || !targetSymbolName) return null;

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
   * Create an interface entity from an interface_declaration node
   * @param {Object} node - The Tree-sitter AST node
   * @param {Object|null} parentEntity - The parent entity (if any)
   * @returns {Object|null} The created entity object or null if creation failed
   * @private
   */
  function createInterfaceEntity(node, parentEntity = null) {
    if (!node) return null;

    // Find the identifier (name) node
    let nameNode = null;
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === "identifier") {
        nameNode = child;
        break;
      }
    }

    if (!nameNode) return null;

    const name = nameNode.text;
    const entity = createCodeEntity(
      node,
      "interface_declaration",
      parentEntity
    );
    if (!entity) return null;

    entity.name = name;

    // Check for extends clause
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === "extends_clause") {
        entity.custom_metadata.hasExtendsClause = true;
        break;
      }
    }

    return entity;
  }

  /**
   * Create a type alias entity from a type_alias_declaration node
   * @param {Object} node - The Tree-sitter AST node
   * @param {Object|null} parentEntity - The parent entity (if any)
   * @returns {Object|null} The created entity object or null if creation failed
   * @private
   */
  function createTypeAliasEntity(node, parentEntity = null) {
    if (!node) return null;

    // Find the identifier (name) node
    let nameNode = null;
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === "identifier") {
        nameNode = child;
        break;
      }
    }

    if (!nameNode) return null;

    const name = nameNode.text;
    const entity = createCodeEntity(
      node,
      "type_alias_declaration",
      parentEntity
    );
    if (!entity) return null;

    entity.name = name;

    // Get the type of alias (union, intersection, object, etc)
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type !== "identifier" && child.type !== "=") {
        entity.custom_metadata.valueType = child.type;
        break;
      }
    }

    return entity;
  }

  /**
   * Create an enum entity from an enum_declaration node
   * @param {Object} node - The Tree-sitter AST node
   * @param {Object|null} parentEntity - The parent entity (if any)
   * @returns {Object|null} The created entity object or null if creation failed
   * @private
   */
  function createEnumEntity(node, parentEntity = null) {
    if (!node) return null;

    // Find the identifier (name) node
    let nameNode = null;
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === "identifier") {
        nameNode = child;
        break;
      }
    }

    if (!nameNode) return null;

    const name = nameNode.text;
    const entity = createCodeEntity(node, "enum_declaration", parentEntity);
    if (!entity) return null;

    entity.name = name;
    return entity;
  }

  /**
   * Create an enum member entity from an enum_member node
   * @param {Object} node - The Tree-sitter AST node
   * @param {Object|null} parentEntity - The parent entity (if any)
   * @returns {Object|null} The created entity object or null if creation failed
   * @private
   */
  function createEnumMemberEntity(node, parentEntity = null) {
    if (!node) return null;

    // Find the property identifier (name) node
    let nameNode = null;
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === "property_identifier") {
        nameNode = child;
        break;
      }
    }

    if (!nameNode) return null;

    const name = nameNode.text;
    const entity = createCodeEntity(node, "enum_member", parentEntity);
    if (!entity) return null;

    entity.name = name;

    // Check for value assignment
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type !== "property_identifier" && child.type !== "=") {
        entity.custom_metadata.hasValue = true;
        break;
      }
    }

    return entity;
  }

  /**
   * Create a namespace entity from a namespace_declaration or module_declaration node
   * @param {Object} node - The Tree-sitter AST node
   * @param {Object|null} parentEntity - The parent entity (if any)
   * @returns {Object|null} The created entity object or null if creation failed
   * @private
   */
  function createNamespaceEntity(node, parentEntity = null) {
    if (!node) return null;

    // Find the identifier (name) node
    let nameNode = null;
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === "identifier" || child.type === "nested_identifier") {
        nameNode = child;
        break;
      }
    }

    if (!nameNode) return null;

    const name = nameNode.text;
    const entity = createCodeEntity(
      node,
      "namespace_declaration",
      parentEntity
    );
    if (!entity) return null;

    entity.name = name;
    return entity;
  }

  /**
   * Create a class entity from a class_declaration or abstract_class_declaration node
   * @param {Object} node - The Tree-sitter AST node
   * @param {Object|null} parentEntity - The parent entity (if any)
   * @returns {Object|null} The created entity object or null if creation failed
   * @private
   */
  function createClassEntity(node, parentEntity = null) {
    if (!node) return null;

    // Find the identifier (name) node
    let nameNode = null;
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === "identifier") {
        nameNode = child;
        break;
      }
    }

    if (!nameNode) return null;

    const name = nameNode.text;
    const entity = createCodeEntity(node, "class_declaration", parentEntity);
    if (!entity) return null;

    entity.name = name;

    // Check if the class is abstract
    if (node.type === "abstract_class_declaration") {
      entity.custom_metadata.isAbstract = true;
    }

    // Check for extends clause
    let hasExtends = false;
    let hasImplements = false;

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === "extends_clause") {
        hasExtends = true;
      } else if (child.type === "implements_clause") {
        hasImplements = true;
      }
    }

    if (hasExtends) {
      entity.custom_metadata.hasExtendsClause = true;
    }

    if (hasImplements) {
      entity.custom_metadata.hasImplementsClause = true;
    }

    return entity;
  }

  /**
   * Create a function entity from a function declaration node
   * @param {Object} node - The function declaration node
   * @param {Object|null} parentEntity - The parent entity (if any)
   * @returns {Object|null} The created entity object or null if creation failed
   * @private
   */
  function createFunctionEntity(node, parentEntity = null) {
    if (!node) return null;

    // Find the name of the function
    let nameNode = null;
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === "identifier") {
        nameNode = child;
        break;
      }
    }

    // Some functions might be anonymous
    let name = nameNode ? nameNode.text : "anonymous";

    const entity = createCodeEntity(node, "function_declaration", parentEntity);
    if (!entity) return null;

    entity.name = name;

    // Check if the function is async
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === "async") {
        entity.custom_metadata.isAsync = true;
        break;
      }
    }

    // Check for function return type
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === "type_annotation") {
        entity.custom_metadata.hasReturnType = true;
        break;
      }
    }

    return entity;
  }

  /**
   * Create a method entity from a method definition node
   * @param {Object} node - The method definition node
   * @param {Object|null} parentEntity - The parent entity (if any)
   * @returns {Object|null} The created entity object or null if creation failed
   * @private
   */
  function createMethodEntity(node, parentEntity = null) {
    if (!node) return null;

    // Find the property identifier (name) node
    let nameNode = null;
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === "property_identifier") {
        nameNode = child;
        break;
      }
    }

    if (!nameNode) return null;

    const name = nameNode.text;
    const entity = createCodeEntity(node, "method_definition", parentEntity);
    if (!entity) return null;

    entity.name = name;

    // Check for method modifiers
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === "static") {
        entity.custom_metadata.isStatic = true;
      } else if (child.type === "async") {
        entity.custom_metadata.isAsync = true;
      } else if (child.type === "get") {
        entity.custom_metadata.isGetter = true;
      } else if (child.type === "set") {
        entity.custom_metadata.isSetter = true;
      }
    }

    // Check for method return type
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === "type_annotation") {
        entity.custom_metadata.hasReturnType = true;
        break;
      }
    }

    return entity;
  }

  /**
   * Create a property entity from a property definition node
   * @param {Object} node - The property definition node
   * @param {Object|null} parentEntity - The parent entity (if any)
   * @returns {Object|null} The created entity object or null if creation failed
   * @private
   */
  function createPropertyEntity(node, parentEntity = null) {
    if (!node) return null;

    // Find the property identifier (name) node
    let nameNode = null;
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (
        child.type === "property_identifier" ||
        child.type === "private_property_identifier"
      ) {
        nameNode = child;
        break;
      }
    }

    if (!nameNode) return null;

    const name = nameNode.text;
    const entity = createCodeEntity(node, "property_definition", parentEntity);
    if (!entity) return null;

    entity.name = name;

    // Check for property modifiers
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === "readonly") {
        entity.custom_metadata.isReadonly = true;
      } else if (child.type === "private") {
        entity.custom_metadata.isPrivate = true;
      } else if (child.type === "protected") {
        entity.custom_metadata.isProtected = true;
      } else if (child.type === "public") {
        entity.custom_metadata.isPublic = true;
      } else if (child.type === "?") {
        entity.custom_metadata.isOptional = true;
      }
    }

    // Check for property type
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === "type_annotation") {
        entity.custom_metadata.hasType = true;
        break;
      }
    }

    return entity;
  }

  /**
   * Extract interface extension relationships from an interface declaration
   * @param {Object} node - The interface_declaration node
   * @param {Object} interfaceEntity - The interface entity object
   * @private
   */
  function extractInterfaceExtension(node, interfaceEntity) {
    if (!node || !interfaceEntity) return;

    // Find extends clause
    let extendsClause = null;
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === "extends_clause") {
        extendsClause = child;
        break;
      }
    }

    if (!extendsClause) return;

    // Find all extended interfaces
    for (let i = 0; i < extendsClause.namedChildCount; i++) {
      const child = extendsClause.namedChild(i);
      if (child.type === "type_reference" || child.type === "identifier") {
        const extendedName = child.text;
        createRelationship(
          interfaceEntity.id,
          null, // No target ID as it might be in another file
          extendedName,
          "EXTENDS_INTERFACE"
        );
      }
    }
  }

  /**
   * Extract implements relationships from a class declaration
   * @param {Object} node - The class_declaration node
   * @param {Object} classEntity - The class entity object
   * @private
   */
  function extractImplementsInterface(node, classEntity) {
    if (!node || !classEntity) return;

    // Find implements clause
    let implementsClause = null;
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === "implements_clause") {
        implementsClause = child;
        break;
      }
    }

    if (!implementsClause) return;

    // Find all implemented interfaces
    for (let i = 0; i < implementsClause.namedChildCount; i++) {
      const child = implementsClause.namedChild(i);
      if (child.type === "type_reference" || child.type === "identifier") {
        const implementedName = child.text;
        createRelationship(
          classEntity.id,
          null, // No target ID as it might be in another file
          implementedName,
          "IMPLEMENTS_INTERFACE"
        );
      }
    }
  }

  /**
   * Extract type references from various TypeScript type annotation nodes
   * @param {Object} node - The node containing type references
   * @param {Object} parentEntity - The entity containing the type reference
   * @private
   */
  function extractTypeReference(node, parentEntity) {
    if (!node || !parentEntity) return;

    const nodeType = node.type;

    // For type annotations, extract the referenced type
    if (nodeType === "type_annotation") {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (
          child.type === "type_reference" ||
          child.type === "predefined_type" ||
          child.type === "identifier"
        ) {
          createRelationship(
            parentEntity.id,
            null,
            child.text,
            "TYPE_REFERENCE"
          );
        } else if (child.type === "generic_type") {
          // Handle generic types (like Array<string>)
          for (let j = 0; j < child.namedChildCount; j++) {
            const grandchild = child.namedChild(j);
            if (grandchild.type === "identifier") {
              createRelationship(
                parentEntity.id,
                null,
                grandchild.text,
                "TYPE_REFERENCE",
                { isGeneric: true }
              );
            } else if (grandchild.type === "type_arguments") {
              // Process type arguments
              for (let k = 0; k < grandchild.namedChildCount; k++) {
                const typeArg = grandchild.namedChild(k);
                if (
                  typeArg.type === "identifier" ||
                  typeArg.type === "predefined_type"
                ) {
                  createRelationship(
                    parentEntity.id,
                    null,
                    typeArg.text,
                    "TYPE_REFERENCE",
                    { isTypeArgument: true }
                  );
                }
              }
            }
          }
        } else if (child.type === "union_type") {
          // Handle union types (like string | number)
          for (let j = 0; j < child.namedChildCount; j++) {
            const unionMember = child.namedChild(j);
            if (
              unionMember.type === "identifier" ||
              unionMember.type === "predefined_type"
            ) {
              createRelationship(
                parentEntity.id,
                null,
                unionMember.text,
                "TYPE_REFERENCE",
                { isUnionMember: true }
              );
            }
          }
        }
      }
    }
    // For type parameters, extract the constraint types
    else if (nodeType === "type_parameter") {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === "constraint") {
          for (let j = 0; j < child.namedChildCount; j++) {
            const constraint = child.namedChild(j);
            if (
              constraint.type === "identifier" ||
              constraint.type === "type_reference"
            ) {
              createRelationship(
                parentEntity.id,
                null,
                constraint.text,
                "TYPE_REFERENCE",
                { isConstraint: true }
              );
            }
          }
        }
      }
    }
  }

  /**
   * Extract a function call relationship from a call expression node
   * @param {Object} node - The call expression node
   * @param {Object|null} parentEntity - The parent entity making the call
   * @private
   */
  function extractFunctionCall(node, parentEntity = null) {
    if (!node || !parentEntity) return;

    // Find the function node (first child)
    let functionNode = null;
    if (node.namedChildCount > 0) {
      functionNode = node.namedChild(0);
    }

    if (!functionNode) return;

    let functionName = "";

    // Handle direct function calls vs method calls
    if (functionNode.type === "identifier") {
      functionName = functionNode.text;
    } else if (functionNode.type === "member_expression") {
      // For member expressions, get the property name
      for (let i = 0; i < functionNode.namedChildCount; i++) {
        const child = functionNode.namedChild(i);
        if (child.type === "property_identifier") {
          functionName = child.text;
          break;
        }
      }
    }

    if (functionName) {
      createRelationship(
        parentEntity.id,
        null, // No target ID as the function might be in another file
        functionName,
        "CALLS_FUNCTION"
      );
    }
  }

  /**
   * Extract a variable reference from a member expression node
   * @param {Object} node - The member expression node
   * @param {Object|null} parentEntity - The parent entity referencing the variable
   * @private
   */
  function extractMemberAccess(node, parentEntity = null) {
    if (!node || !parentEntity) return;

    // Find object (first child) and property (second child)
    let objectNode = null;
    let propertyNode = null;

    if (node.namedChildCount >= 2) {
      objectNode = node.namedChild(0);
      propertyNode = node.namedChild(1);
    }

    if (objectNode && propertyNode) {
      // For simplicity, we only track top-level variables, not complex chains
      if (objectNode.type === "identifier") {
        const objectName = objectNode.text;

        // Create a relationship for the variable reference
        createRelationship(
          parentEntity.id,
          null, // No target ID as the variable might be in another file
          objectName,
          "REFERENCES_VARIABLE"
        );
      }
    }
  }

  /**
   * Extract a variable assignment relationship
   * @param {Object} node - The variable declarator node
   * @param {Object|null} parentEntity - The parent entity containing the assignment
   * @private
   */
  function extractVariableAssignment(node, parentEntity = null) {
    if (!node || !parentEntity) return;

    // Find value node (usually the third child after name and =)
    let valueNode = null;
    if (node.namedChildCount >= 3) {
      valueNode = node.namedChild(2);
    } else if (node.namedChildCount >= 2) {
      // For simple assignments with no type annotation
      valueNode = node.namedChild(1);
    }

    if (valueNode) {
      if (valueNode.type === "call_expression") {
        extractFunctionCall(valueNode, parentEntity);
      } else if (valueNode.type === "member_expression") {
        extractMemberAccess(valueNode, parentEntity);
      }
    }
  }

  /**
   * Extract import relationships from an import statement
   * @param {Object} node - The import statement node
   * @private
   */
  function extractImportRelationship(node) {
    if (!node) return;

    // Find the source module (usually the last child)
    let sourceNode = null;
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child.type === "string") {
        sourceNode = child;
        break;
      }
    }

    if (!sourceNode) return;

    const sourcePath = sourceNode.text.replace(/['"]/g, ""); // Remove quotes

    // Create a simple import relationship for now
    for (let i = 0; i < entities.length; i++) {
      // Create one relationship for each top-level entity in the file
      if (!entities[i].parent_entity_id) {
        createRelationship(
          entities[i].id,
          null, // No target ID as we don't know what file this is
          sourcePath,
          "IMPORTS_MODULE",
          { isExternal: sourcePath.startsWith(".") ? false : true }
        );
      }
    }
  }

  /**
   * Extract export relationships from an export statement
   * @param {Object} node - The export statement node
   * @private
   */
  function extractExportRelationship(node) {
    if (!node) return;

    // TODO: Implement export relationship extraction
    // This would involve identifying what is being exported
    // and creating relationships accordingly
  }

  /**
   * Recursively visit AST nodes to extract code entities and relationships
   * @param {Object} node - The current tree-sitter AST node
   * @param {Object|null} parentEntity - The parent entity (if any)
   * @private
   */
  function visitNode(node, parentEntity = null) {
    if (!node) return;

    let createdEntity = null;
    const nodeType = node.type;

    // Extract entities based on node type
    switch (nodeType) {
      // Common JavaScript/TypeScript entities
      case "function_declaration":
      case "function":
      case "generator_function":
      case "generator_function_declaration":
      case "arrow_function":
        createdEntity = createFunctionEntity(node, parentEntity);
        break;

      case "class_declaration":
      case "abstract_class_declaration": // TypeScript-specific
        createdEntity = createClassEntity(node, parentEntity);
        break;

      case "method_definition":
        createdEntity = createMethodEntity(node, parentEntity);
        break;

      case "property_definition":
        createdEntity = createPropertyEntity(node, parentEntity);
        break;

      // TypeScript-specific entities
      case "interface_declaration":
        createdEntity = createInterfaceEntity(node, parentEntity);
        break;

      case "type_alias_declaration":
        createdEntity = createTypeAliasEntity(node, parentEntity);
        break;

      case "enum_declaration":
        createdEntity = createEnumEntity(node, parentEntity);
        break;

      case "enum_member":
        createdEntity = createEnumMemberEntity(node, parentEntity);
        break;

      case "namespace_declaration":
      case "module_declaration": // TypeScript namespace or module
        createdEntity = createNamespaceEntity(node, parentEntity);
        break;

      // Extract relationships
      case "call_expression":
        extractFunctionCall(node, parentEntity);
        break;

      case "member_expression":
        extractMemberAccess(node, parentEntity);
        break;

      case "variable_declarator":
        if (node.childCount >= 2 && node.child(1).type === "=") {
          extractVariableAssignment(node, parentEntity);
        }
        break;

      case "import_statement":
        extractImportRelationship(node);
        break;

      case "export_statement":
        extractExportRelationship(node);
        break;
    }

    // Handle TypeScript-specific relationships
    if (nodeType === "interface_declaration") {
      // Check if this interface has an extends clause
      let hasExtendsClause = false;
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === "extends_clause") {
          hasExtendsClause = true;
          break;
        }
      }

      if (hasExtendsClause && createdEntity) {
        extractInterfaceExtension(node, createdEntity);
      }
    }

    if (
      nodeType === "class_declaration" ||
      nodeType === "abstract_class_declaration"
    ) {
      // Check if this class has an implements clause
      let hasImplementsClause = false;
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === "implements_clause") {
          hasImplementsClause = true;
          break;
        }
      }

      if (hasImplementsClause && createdEntity) {
        extractImplementsInterface(node, createdEntity);
      }
    }

    // Extract type references in various TypeScript-specific contexts
    if (
      [
        "type_annotation",
        "type_parameter",
        "type_arguments",
        "extends_clause",
      ].includes(nodeType)
    ) {
      extractTypeReference(node, createdEntity || parentEntity);
    }

    // Continue traversing child nodes
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      visitNode(child, createdEntity || parentEntity);
    }
  }

  // Start traversing the AST from the root node
  visitNode(astRootNode, null);

  // Update relationship target_symbol_name with actual entity names for internal references
  for (let relationship of relationships) {
    if (relationship.target_entity_id) {
      const targetEntity = entities.find(
        (entity) => entity.id === relationship.target_entity_id
      );
      if (targetEntity) {
        relationship.target_symbol_name = targetEntity.name;
      }
    }
  }

  return { entities, relationships };
}

/**
 * Convert a Tree-sitter node to a serializable object
 * @param {Object} node - The Tree-sitter AST node
 * @returns {Object} A serializable object representing the node
 */
export function nodeToObject(node) {
  if (!node) return null;

  const result = {
    type: node.type,
    text: node.text,
    startPosition: node.startPosition,
    endPosition: node.endPosition,
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    children: [],
  };

  // Add named children
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    result.children.push(nodeToObject(child));
  }

  return result;
}
