/**
 * TypeScript Parser Test
 *
 * This file contains a simple test to demonstrate how to use the TypeScript parser
 * with Tree-sitter to extract code entities from TypeScript code.
 * It can be run with: node src/services/parsing/typescriptParser.test.js
 */

import { TreeSitterManager } from "./treeSitterManager.js";
import { parseTypeScript, nodeToObject } from "./typescript.parser.js";
import logger from "../../utils/logger.js";

/**
 * Run tests for the TypeScript parser
 */
async function testTypeScriptParser() {
  try {
    // Initialize the TreeSitterManager
    const manager = new TreeSitterManager();

    // Load grammar for TypeScript
    await manager.initializeGrammars(["typescript"]);

    // Check what languages were loaded
    const loadedLanguages = manager.getLoadedLanguages();
    logger.info(`Loaded languages: ${loadedLanguages.join(", ")}`);

    // Sample TypeScript code with various TypeScript-specific constructs
    const typeScriptCode = `
      // Interface declaration
      interface User {
        id: number;
        name: string;
        email?: string;
        readonly createdAt: Date;
      }

      // Interface extending another interface
      interface AdminUser extends User {
        permissions: string[];
        role: 'admin' | 'superadmin';
      }

      // Type alias with union type
      type UserRole = 'guest' | 'user' | 'admin' | 'superadmin';

      // Type alias with object type
      type UserProfile = {
        user: User;
        settings: {
          theme: string;
          notifications: boolean;
        }
      }

      // Enum declaration
      enum Status {
        Active = 1,
        Inactive = 2,
        Pending = 3
      }

      // Namespace declaration
      namespace Validation {
        export interface StringValidator {
          isValid(s: string): boolean;
        }

        export class EmailValidator implements StringValidator {
          isValid(s: string): boolean {
            return s.includes('@');
          }
        }
      }

      // Class with decorators, modifiers, and generics
      @Component({
        selector: 'app-user'
      })
      abstract class UserComponent<T extends User> {
        @Input() user?: T;
        
        private userId: number = 0;
        protected readonly apiUrl: string = '/api/users';
        
        constructor(private userService: UserService) {}
        
        abstract renderUser(): void;
        
        async fetchUser(id: number): Promise<T> {
          this.userId = id;
          return this.userService.getUser(id) as Promise<T>;
        }
        
        get displayName(): string {
          return this.user?.name || 'Guest';
        }
      }
    `;

    // Parse TypeScript code
    const tsParser = manager.getParserForLanguage("typescript");

    if (!tsParser) {
      logger.error("Failed to get TypeScript parser");
      return;
    }

    const tsTree = tsParser.parse(typeScriptCode);

    logger.info("\nTypeScript AST root node type:", tsTree.rootNode.type);

    // Debug: Print top-level AST node types to understand the structure
    logger.info("\nTop-level AST nodes:");
    for (let i = 0; i < tsTree.rootNode.namedChildCount; i++) {
      const child = tsTree.rootNode.namedChild(i);
      logger.info(
        `${i + 1}. Type: ${child.type}, Text: "${child.text
          .substring(0, 30)
          .replace(/\n/g, "\\n")}${child.text.length > 30 ? "..." : ""}"`
      );
    }

    // Extract code entities and relationships from the AST
    const { entities, relationships } = parseTypeScript(
      tsTree.rootNode,
      typeScriptCode
    );

    // Print the extracted TypeScript entities
    logger.info(`\nExtracted ${entities.length} TypeScript code entities:`);

    // Log all entities for debugging
    logger.info("\nAll entities (for debugging):");
    entities.forEach((entity, index) => {
      logger.info(
        `${index + 1}. Type: ${entity.entity_type}, Name: ${entity.name}`
      );
    });

    // Group entities by type for better readability
    const groupedEntities = {};

    entities.forEach((entity) => {
      const type = entity.entity_type;
      if (!groupedEntities[type]) {
        groupedEntities[type] = [];
      }
      groupedEntities[type].push(entity);
    });

    // Print counts for each entity type
    logger.info("\nEntity Types Summary:");
    for (const [type, entities] of Object.entries(groupedEntities)) {
      logger.info(`  ${type}: ${entities.length}`);
    }

    // Print detailed information for each entity type
    for (const [type, typeEntities] of Object.entries(groupedEntities)) {
      logger.info(`\n== ${type} (${typeEntities.length}) ==`);

      typeEntities.forEach((entity, index) => {
        logger.info(`${index + 1}. ${entity.name}`);
        logger.info(`   Lines: ${entity.start_line}-${entity.end_line}`);

        // Print custom metadata if available
        if (Object.keys(entity.custom_metadata).length > 0) {
          logger.info("   Metadata:");
          for (const [key, value] of Object.entries(entity.custom_metadata)) {
            if (value === true) {
              logger.info(`     - ${key}`);
            } else if (
              value !== false &&
              value !== undefined &&
              value !== null
            ) {
              logger.info(`     - ${key}: ${value}`);
            }
          }
        }

        // Print a condensed version of the raw content (first 40 chars)
        const contentPreview = entity.raw_content
          .substring(0, 60)
          .replace(/\n/g, "\\n");
        logger.info(
          `   Content: ${contentPreview}${
            entity.raw_content.length > 60 ? "..." : ""
          }`
        );
        logger.info("---");
      });
    }

    // Print the extracted TypeScript relationships
    logger.info(
      `\nExtracted ${relationships.length} TypeScript code relationships:`
    );

    // Group relationships by type
    const groupedRelationships = {};
    relationships.forEach((relationship) => {
      const type = relationship.relationship_type;
      if (!groupedRelationships[type]) {
        groupedRelationships[type] = [];
      }
      groupedRelationships[type].push(relationship);
    });

    // Print counts for each relationship type
    logger.info("\nRelationship Types Summary:");
    for (const [type, rels] of Object.entries(groupedRelationships)) {
      logger.info(`  ${type}: ${rels.length}`);
    }

    // Print detailed information for TypeScript-specific relationships
    const tsSpecificRelationships = [
      "EXTENDS_INTERFACE",
      "IMPLEMENTS_INTERFACE",
      "TYPE_REFERENCE",
    ];

    for (const relType of tsSpecificRelationships) {
      const typeRelationships = groupedRelationships[relType] || [];

      if (typeRelationships.length > 0) {
        logger.info(
          `\n== ${relType} Relationships (${typeRelationships.length}) ==`
        );

        typeRelationships.forEach((rel, index) => {
          // Find source entity name for better display
          const sourceEntity = entities.find(
            (e) => e.id === rel.source_entity_id
          );
          const sourceName = sourceEntity ? sourceEntity.name : "unknown";

          logger.info(
            `${index + 1}. ${sourceName} → ${rel.target_symbol_name}`
          );

          // Print metadata if available
          if (Object.keys(rel.custom_metadata).length > 0) {
            logger.info("   Metadata:");
            for (const [key, value] of Object.entries(rel.custom_metadata)) {
              if (value === true) {
                logger.info(`     - ${key}`);
              } else if (typeof value === "object") {
                logger.info(`     - ${key}: ${JSON.stringify(value)}`);
              } else if (
                value !== false &&
                value !== undefined &&
                value !== null
              ) {
                logger.info(`     - ${key}: ${value}`);
              }
            }
          }

          logger.info("---");
        });
      }
    }

    logger.info("TypeScript parser tests completed successfully");
  } catch (error) {
    logger.error(`TypeScript parser test failed: ${error.message}`, {
      error: error.stack,
    });
  }
}

// Run the tests
testTypeScriptParser();
