/**
 * TreeSitter Test
 *
 * This file contains a simple test to demonstrate how to use the TreeSitterManager.
 * It can be run with: node src/services/parsing/treeSitterTest.js
 */

import { TreeSitterManager } from "./treeSitterManager.js";
import logger from "../../utils/logger.js";

/**
 * Run tests for the TreeSitterManager
 */
async function testTreeSitter() {
  try {
    // Initialize the TreeSitterManager
    const manager = new TreeSitterManager();

    // Load grammars for JavaScript, TypeScript, and Python
    await manager.initializeGrammars(["javascript", "typescript", "python"]);

    // Check what languages were loaded
    const loadedLanguages = manager.getLoadedLanguages();
    logger.info(`Loaded languages: ${loadedLanguages.join(", ")}`);

    // Test parsing some JavaScript code
    if (manager.hasLanguage("javascript")) {
      const jsParser = manager.getParserForLanguage("javascript");
      const jsCode = 'function hello() { return "world"; }';
      const jsTree = jsParser.parse(jsCode);
      logger.info("JavaScript AST root node type:", jsTree.rootNode.type);
      logger.info("JavaScript AST child count:", jsTree.rootNode.childCount);
    }

    // Test parsing some Python code
    if (manager.hasLanguage("python")) {
      const pyParser = manager.getParserForLanguage("python");
      const pyCode = 'def hello():\n    return "world"';
      const pyTree = pyParser.parse(pyCode);
      logger.info("Python AST root node type:", pyTree.rootNode.type);
      logger.info("Python AST child count:", pyTree.rootNode.childCount);
    }

    // Test parsing some TypeScript code
    if (manager.hasLanguage("typescript")) {
      const tsParser = manager.getParserForLanguage("typescript");
      const tsCode = 'function hello(): string { return "world"; }';
      const tsTree = tsParser.parse(tsCode);
      logger.info("TypeScript AST root node type:", tsTree.rootNode.type);
      logger.info("TypeScript AST child count:", tsTree.rootNode.childCount);
    }

    logger.info("TreeSitterManager tests completed successfully");
  } catch (error) {
    logger.error(`TreeSitterManager test failed: ${error.message}`, {
      error: error.stack,
    });
  }
}

// Run the tests
testTreeSitter().catch((err) => {
  logger.error("Unhandled error in TreeSitterManager test", {
    error: err.stack,
  });
  process.exit(1);
});
