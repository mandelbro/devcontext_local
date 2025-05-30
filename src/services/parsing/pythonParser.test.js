/**
 * Python Parser Test
 *
 * This file contains a simple test to demonstrate how to use the Python parser
 * with Tree-sitter to extract code entities from Python code.
 * It can be run with: node src/services/parsing/pythonParser.test.js
 */

import { TreeSitterManager } from "./treeSitterManager.js";
import { parsePython, nodeToObject } from "./python.parser.js";
import logger from "../../utils/logger.js";

/**
 * Run tests for the Python parser
 */
async function testPythonParser() {
  try {
    // Initialize the TreeSitterManager
    const manager = new TreeSitterManager();

    // Load grammar for Python
    await manager.initializeGrammars(["python"]);

    // Check what languages were loaded
    const loadedLanguages = manager.getLoadedLanguages();
    logger.info(`Loaded languages: ${loadedLanguages.join(", ")}`);

    // Create a sample Python file with various code constructs
    const pythonCode = `
# This is a sample Python file with different code constructs
import math
from os import path, system as sys_call

# Parent class (inheritance will be demonstrated)
class Animal:
    """Base class for all animals"""
    
    def __init__(self, name):
        self.name = name
    
    def make_sound(self):
        return "Some generic sound"

# Child class that inherits from Animal
class Dog(Animal):
    """Class representing a dog"""
    
    def __init__(self, name, breed):
        super().__init__(name)
        self.breed = breed
    
    # Override method from parent
    def make_sound(self):
        return "Woof!"
    
    # Method specific to Dog
    def fetch(self, item):
        return f"{self.name} fetched the {item}!"

# Function with nested function
def process_data(data_list):
    """Process a list of data items"""
    
    # Nested function
    def validate(item):
        return isinstance(item, dict) and "value" in item
    
    result = []
    for item in data_list:
        if validate(item):
            result.append(item["value"])
    
    return result

# Multiple variable assignment
x, y = 10, 20

# Dictionary variable
config = {
    "debug": True,
    "max_items": 100,
    "timeout": 30
}

# Function that uses the variables
def get_config_value(key, default=None):
    """Get a configuration value"""
    return config.get(key, default)

# Async function example
async def fetch_data(url):
    """Fetch data from a URL asynchronously"""
    # This would use aiohttp or similar in real code
    return {"status": "success", "data": [1, 2, 3]}

# Class with method calling function
class DataProcessor:
    def __init__(self, data_source):
        self.data_source = data_source
        self.config = config  # Using the global config
    
    def process(self):
        # Call the global function
        data = process_data(self.data_source)
        return data
    
    @classmethod
    def create_default(cls):
        return cls([{"value": i} for i in range(5)])

# Main block
if __name__ == "__main__":
    # Create an instance
    processor = DataProcessor.create_default()
    result = processor.process()
    print(f"Processed {len(result)} items")
    
    # Create animals
    dog = Dog("Rex", "German Shepherd")
    print(dog.make_sound())
    print(dog.fetch("ball"))
`;

    // Parse the Python code using Tree-sitter
    if (manager.hasLanguage("python")) {
      const parser = manager.getParserForLanguage("python");
      const tree = parser.parse(pythonCode);

      logger.info("Python AST root node type:", tree.rootNode.type);

      // Extract code entities and relationships from the AST
      const { entities, relationships } = parsePython(
        tree.rootNode,
        pythonCode
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

      // Analyze entity types
      const entityTypes = entities.reduce((acc, entity) => {
        acc[entity.entity_type] = (acc[entity.entity_type] || 0) + 1;
        return acc;
      }, {});

      logger.info("\nEntity Types Summary:");
      for (const [type, count] of Object.entries(entityTypes)) {
        logger.info(`  ${type}: ${count}`);
      }

      // Print the extracted relationships
      logger.info(`\nExtracted ${relationships.length} code relationships:`);

      // Group relationships by type
      const relationshipsByType = relationships.reduce((acc, rel) => {
        acc[rel.relationship_type] = (acc[rel.relationship_type] || []).concat(
          rel
        );
        return acc;
      }, {});

      // Print relationships by type
      for (const [type, rels] of Object.entries(relationshipsByType)) {
        logger.info(`\n${type} Relationships (${rels.length}):`);

        // Print 3 examples of each type
        rels.slice(0, 3).forEach((rel, index) => {
          const sourceEntity = entities.find(
            (e) => e.id === rel.source_entity_id
          );
          const targetEntity = entities.find(
            (e) => e.id === rel.target_entity_id
          );

          logger.info(
            `  ${index + 1}. ${sourceEntity?.name || "Unknown"} -> ${
              rel.target_symbol_name
            }`
          );
          logger.info(
            `     Source: ${sourceEntity?.entity_type || "Unknown"} (ID: ${
              rel.source_entity_id
            })`
          );
          if (targetEntity) {
            logger.info(
              `     Target: ${targetEntity.entity_type} (ID: ${rel.target_entity_id})`
            );
          } else {
            logger.info(
              `     Target: Not found in file (Symbol: ${rel.target_symbol_name})`
            );
          }

          // Print custom metadata if available
          if (Object.keys(rel.custom_metadata).length > 0) {
            logger.info(`     Metadata:`, rel.custom_metadata);
          }
        });

        // If there are more than 3, just print the count
        if (rels.length > 3) {
          logger.info(
            `  ... and ${rels.length - 3} more ${type} relationships`
          );
        }
      }

      // Analyze class hierarchies
      logger.info("\nClass Hierarchies:");
      relationships
        .filter((rel) => rel.relationship_type === "EXTENDS_CLASS")
        .forEach((rel) => {
          const sourceEntity = entities.find(
            (e) => e.id === rel.source_entity_id
          );
          logger.info(
            `  ${sourceEntity?.name || "Unknown"} extends ${
              rel.target_symbol_name
            }`
          );
        });

      // Count methods per class
      logger.info("\nMethods per Class:");
      entities
        .filter((entity) => entity.entity_type === "class_definition")
        .forEach((classEntity) => {
          const methodCount = entities.filter(
            (entity) =>
              entity.entity_type === "method_definition" &&
              entity.start_line > classEntity.start_line &&
              entity.end_line < classEntity.end_line
          ).length;
          logger.info(`  ${classEntity.name}: ${methodCount} methods`);
        });

      // Analyze function calls
      logger.info("\nFunction Call Analysis:");
      const functionCallsBy = {};
      relationships
        .filter((rel) => rel.relationship_type === "CALLS_FUNCTION")
        .forEach((rel) => {
          const sourceEntity = entities.find(
            (e) => e.id === rel.source_entity_id
          );
          if (sourceEntity) {
            functionCallsBy[sourceEntity.name] =
              functionCallsBy[sourceEntity.name] || [];
            functionCallsBy[sourceEntity.name].push(rel.target_symbol_name);
          }
        });

      for (const [caller, called] of Object.entries(functionCallsBy)) {
        logger.info(`  ${caller} calls: ${called.join(", ")}`);
      }

      // Analyze import relationships
      logger.info("\nImport Analysis:");
      relationships
        .filter((rel) => rel.relationship_type === "IMPORTS_MODULE")
        .forEach((rel) => {
          const metadata = rel.custom_metadata;
          if (metadata.fromModule) {
            logger.info(
              `  From ${metadata.fromModule} imports ${rel.target_symbol_name}`
            );
          } else {
            logger.info(`  Imports ${rel.target_symbol_name}`);
          }
        });

      logger.info("\nPython parser tests completed successfully");
    } else {
      logger.error("Python language grammar not available");
    }
  } catch (error) {
    logger.error(`Python parser test failed: ${error.message}`, {
      error: error.stack,
    });
  }
}

// Run the tests
testPythonParser().catch((err) => {
  logger.error("Unhandled error in Python parser test", {
    error: err.stack,
  });
  process.exit(1);
});
