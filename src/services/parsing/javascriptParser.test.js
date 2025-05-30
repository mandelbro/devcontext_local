/**
 * JavaScript Parser Test
 *
 * This file contains a simple test to demonstrate how to use the JavaScript parser
 * with Tree-sitter to extract code entities and relationships from JavaScript/TypeScript code.
 * It can be run with: node src/services/parsing/javascriptParser.test.js
 */

import { TreeSitterManager } from "./treeSitterManager.js";
import { parseJavaScript, nodeToObject } from "./javascript.parser.js";
import logger from "../../utils/logger.js";

/**
 * Run tests for the JavaScript parser
 */
async function testJavaScriptParser() {
  try {
    // Initialize the TreeSitterManager
    const manager = new TreeSitterManager();

    // Load grammar for JavaScript and TypeScript
    await manager.initializeGrammars(["javascript", "typescript"]);

    // Check what languages were loaded
    const loadedLanguages = manager.getLoadedLanguages();
    logger.info(`Loaded languages: ${loadedLanguages.join(", ")}`);

    // Create a sample JavaScript file with relationships
    const javaScriptCode = `
      /**
       * This is a sample JavaScript file with different code constructs that demonstrate relationships
       */
      
      // Import statements (import relationships)
      import React from 'react';
      import { useState, useEffect } from 'react';
      
      // Parent class (inheritance relationship)
      class Parent {
        constructor() {
          this.name = 'Parent';
        }
        
        parentMethod() {
          return this.name;
        }
      }
      
      // Child class (extends relationship)
      class Child extends Parent {
        constructor() {
          super();
          this.name = 'Child';
        }
        
        // Override method (parent-child relationship)
        parentMethod() {
          // Call to super (function call relationship)
          return super.parentMethod() + ' -> Child';
        }
        
        // Child method (no relationship to parent)
        childMethod() {
          // Variable reference relationship
          console.log(this.name);
          return 'Child only';
        }
      }
      
      // Function declaration (parent entity)
      function processData(data) {
        // Nested function (parent-child relationship)
        function validate(input) {
          return input && typeof input === 'object';
        }
        
        // Function call relationship
        if (validate(data)) {
          // Variable reference relationship
          return data.value;
        }
        
        return null;
      }
      
      // Variable declarations
      const config = {
        enabled: true,
        timeout: 1000
      };
      
      // Function that references variables (variable reference relationship)
      function getConfig() {
        // Reference to the config variable
        return config.enabled ? config.timeout : 0;
      }
      
      // Export statement (export relationship)
      export { Parent, Child, processData, getConfig };
    `;

    // Parse the JavaScript code using Tree-sitter
    if (manager.hasLanguage("javascript")) {
      const parser = manager.getParserForLanguage("javascript");
      const tree = parser.parse(javaScriptCode);

      logger.info("JavaScript AST root node type:", tree.rootNode.type);

      // Extract code entities and relationships from the AST
      const { entities, relationships } = parseJavaScript(
        tree.rootNode,
        javaScriptCode
      );

      // Print the extracted entities
      logger.info(`Extracted ${entities.length} code entities:`);

      entities.forEach((entity, index) => {
        logger.info(`Entity ${index + 1}:`);
        logger.info(`  Type: ${entity.entity_type}`);
        logger.info(`  ID: ${entity.id}`);
        logger.info(`  Name: ${entity.name}`);
        logger.info(`  Lines: ${entity.start_line}-${entity.end_line}`);
        logger.info(`  Language: ${entity.language}`);

        // Print custom metadata if available
        if (Object.keys(entity.custom_metadata).length > 0) {
          logger.info("  Custom Metadata:", entity.custom_metadata);
        }

        // Print a condensed version of the raw content (first 40 chars)
        const contentPreview = entity.raw_content
          .substring(0, 40)
          .replace(/\n/g, "\\n");
        logger.info(
          `  Content: ${contentPreview}${
            entity.raw_content.length > 40 ? "..." : ""
          }`
        );
        logger.info("---");
      });

      // Print the extracted relationships
      logger.info(`\nExtracted ${relationships.length} code relationships:`);

      relationships.forEach((rel, index) => {
        logger.info(`Relationship ${index + 1}:`);
        logger.info(`  Type: ${rel.relationship_type}`);
        logger.info(`  Source Entity ID: ${rel.source_entity_id}`);
        logger.info(
          `  Target Entity ID: ${rel.target_entity_id || "None (external)"}`
        );
        logger.info(`  Target Symbol Name: ${rel.target_symbol_name}`);

        // Print custom metadata if available
        if (Object.keys(rel.custom_metadata).length > 0) {
          logger.info("  Custom Metadata:", rel.custom_metadata);
        }

        logger.info("---");
      });

      // Analyze specific relationship types
      const relationshipsByType = relationships.reduce((acc, rel) => {
        acc[rel.relationship_type] = (acc[rel.relationship_type] || 0) + 1;
        return acc;
      }, {});

      logger.info("\nRelationship Types Summary:");
      for (const [type, count] of Object.entries(relationshipsByType)) {
        logger.info(`  ${type}: ${count}`);
      }
    }

    // TypeScript example with interfaces and implementation
    const typeScriptCode = `
      /**
       * This is a sample TypeScript file demonstrating interfaces and implementations
       */
      
      // Interface declaration
      interface Vehicle {
        start(): void;
        stop(): void;
      }
      
      // Extended interface (interface extension relationship)
      interface Car extends Vehicle {
        drive(distance: number): void;
      }
      
      // Class implementing interfaces (implements relationship)
      class Sedan implements Car {
        constructor(private model: string) {}
        
        // Implementing interface methods
        start() {
          console.log(\`Starting \${this.model}\`);
        }
        
        stop() {
          console.log(\`Stopping \${this.model}\`);
        }
        
        drive(distance: number) {
          console.log(\`Driving \${this.model} for \${distance} miles\`);
        }
      }
      
      // Function using the class (function call relationships)
      function testDrive(car: Car) {
        car.start();
        car.drive(100);
        car.stop();
      }
      
      // Create an instance and test it
      const myCar = new Sedan("Toyota");
      testDrive(myCar);
      
      export { Vehicle, Car, Sedan, testDrive };
    `;

    // If TypeScript is available, parse TypeScript code
    if (manager.hasLanguage("typescript")) {
      const tsParser = manager.getParserForLanguage("typescript");
      const tsTree = tsParser.parse(typeScriptCode);

      logger.info("\n\nTypeScript AST root node type:", tsTree.rootNode.type);

      // Extract code entities and relationships from the AST
      const { entities: tsEntities, relationships: tsRelationships } =
        parseJavaScript(tsTree.rootNode, typeScriptCode);

      // Print the extracted TypeScript entities
      logger.info(`\nExtracted ${tsEntities.length} TypeScript code entities:`);

      tsEntities.forEach((entity, index) => {
        logger.info(`Entity ${index + 1}:`);
        logger.info(`  Type: ${entity.entity_type}`);
        logger.info(`  ID: ${entity.id}`);
        logger.info(`  Name: ${entity.name}`);
        logger.info(`  Lines: ${entity.start_line}-${entity.end_line}`);
        logger.info(`  Language: ${entity.language}`);

        // Print a condensed version of the raw content (first 40 chars)
        const contentPreview = entity.raw_content
          .substring(0, 40)
          .replace(/\n/g, "\\n");
        logger.info(
          `  Content: ${contentPreview}${
            entity.raw_content.length > 40 ? "..." : ""
          }`
        );
        logger.info("---");
      });

      // Print the extracted TypeScript relationships
      logger.info(
        `\nExtracted ${tsRelationships.length} TypeScript code relationships:`
      );

      tsRelationships.forEach((rel, index) => {
        logger.info(`Relationship ${index + 1}:`);
        logger.info(`  Type: ${rel.relationship_type}`);
        logger.info(`  Source Entity ID: ${rel.source_entity_id}`);
        logger.info(
          `  Target Entity ID: ${rel.target_entity_id || "None (external)"}`
        );
        logger.info(`  Target Symbol Name: ${rel.target_symbol_name}`);

        // Print custom metadata if available
        if (Object.keys(rel.custom_metadata).length > 0) {
          logger.info("  Custom Metadata:", rel.custom_metadata);
        }

        logger.info("---");
      });

      // Analyze TypeScript specific relationship types
      const tsRelationshipsByType = tsRelationships.reduce((acc, rel) => {
        acc[rel.relationship_type] = (acc[rel.relationship_type] || 0) + 1;
        return acc;
      }, {});

      logger.info("\nTypeScript Relationship Types Summary:");
      for (const [type, count] of Object.entries(tsRelationshipsByType)) {
        logger.info(`  ${type}: ${count}`);
      }

      // Show TypeScript-specific relationships
      logger.info("\nTypeScript Interface and Implementation Relationships:");
      tsRelationships
        .filter(
          (rel) =>
            rel.relationship_type === "EXTENDS_INTERFACE" ||
            rel.relationship_type === "IMPLEMENTS_INTERFACE"
        )
        .forEach((rel, index) => {
          logger.info(`  ${rel.relationship_type}: ${rel.target_symbol_name}`);
        });
    } else {
      logger.info(
        "TypeScript parser not available. Skipping TypeScript example."
      );
    }

    logger.info("JavaScript parser tests completed successfully");
  } catch (error) {
    logger.error(`JavaScript parser test failed: ${error.message}`, {
      error: error.stack,
    });
  }
}

// Run the tests
testJavaScriptParser().catch((err) => {
  logger.error("Unhandled error in JavaScript parser test", {
    error: err.stack,
  });
  process.exit(1);
});
