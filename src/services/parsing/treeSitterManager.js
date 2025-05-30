/**
 * TreeSitterManager - Loads and manages tree-sitter language grammars
 *
 * This module is responsible for loading the specified tree-sitter language
 * grammars (JavaScript, Python, TypeScript) from their NPM package locations
 * and providing access to initialized parsers for these languages.
 */

import pkg from "tree-sitter";
const { Parser } = pkg;
import path from "path";
import fs from "fs";
import logger from "../../utils/logger.js";

/**
 * TreeSitterManager class
 * Responsible for loading and managing tree-sitter language grammars
 */
export class TreeSitterManager {
  /**
   * Creates a new TreeSitterManager instance
   */
  constructor() {
    this.loadedGrammars = new Map();
    this.initialized = false;
  }

  /**
   * Initialize tree-sitter language grammars
   * @param {string[]} configuredLanguages - Array of language names to load (e.g., ['javascript', 'python', 'typescript'])
   * @returns {Promise<boolean>} - True if all configured languages were loaded successfully
   */
  async initializeGrammars(configuredLanguages) {
    if (this.initialized) {
      logger.warn(
        "TreeSitterManager.initializeGrammars called, but grammars are already initialized"
      );
      return true;
    }

    logger.info(
      `Initializing Tree-sitter grammars for: ${configuredLanguages.join(", ")}`
    );

    let allSuccessful = true;

    // Process each configured language
    for (const language of configuredLanguages) {
      try {
        // Handle special cases for languages with native bindings
        if (language === "typescript") {
          await this.loadTypescriptGrammar();
          continue;
        } else if (language === "python") {
          await this.loadPythonGrammar();
          continue;
        } else if (language === "javascript") {
          await this.loadJavaScriptGrammar();
          continue;
        }

        // If we get here, we don't have a specific loader for this language
        logger.warn(`No specific loader available for language: ${language}`);
        allSuccessful = false;
      } catch (error) {
        logger.error(
          `Failed to load grammar for ${language}: ${error.message}`,
          {
            error: error.stack,
          }
        );
        allSuccessful = false;
      }
    }

    // Set initialized flag
    this.initialized = this.loadedGrammars.size > 0;

    if (!this.initialized) {
      logger.error("Failed to initialize any Tree-sitter grammars");
      return false;
    }

    logger.info(
      `Successfully initialized ${this.loadedGrammars.size} Tree-sitter grammars`
    );
    return allSuccessful;
  }

  /**
   * Load the JavaScript grammar using WASM
   * @private
   */
  async loadJavaScriptGrammar() {
    try {
      logger.info("Loading JavaScript grammar using require");

      // Use CommonJS require for loading the JavaScript grammar
      const { createRequire } = await import("module");
      const require = createRequire(import.meta.url);

      // Load the JavaScript grammar
      const jsLanguage = require("tree-sitter-javascript");

      if (!jsLanguage) {
        throw new Error("Failed to load JavaScript grammar module");
      }

      this.loadedGrammars.set("javascript", jsLanguage);
      logger.info("Successfully loaded grammar for javascript");
    } catch (error) {
      logger.error(`Failed to load JavaScript grammar: ${error.message}`, {
        error: error.stack,
      });
      throw error;
    }
  }

  /**
   * Load the TypeScript grammar using Node.js bindings
   * @private
   */
  async loadTypescriptGrammar() {
    try {
      logger.info("Loading TypeScript grammars using Node.js bindings");

      // Use Node.js require for native modules
      // Since we're in ESM context, we need to use createRequire
      const { createRequire } = await import("module");
      const require = createRequire(import.meta.url);

      // Load TypeScript module
      const tsModule = require("tree-sitter-typescript");

      if (!tsModule) {
        throw new Error("Failed to load TypeScript grammar module");
      }

      // TypeScript grammar
      if (tsModule.typescript) {
        this.loadedGrammars.set("typescript", tsModule.typescript);
        logger.info("Successfully loaded grammar for typescript");
      } else {
        logger.error("TypeScript grammar not found in the module");
      }

      // TSX grammar
      if (tsModule.tsx) {
        this.loadedGrammars.set("tsx", tsModule.tsx);
        logger.info("Successfully loaded grammar for tsx");
      } else {
        logger.error("TSX grammar not found in the module");
      }
    } catch (error) {
      logger.error(`Failed to load TypeScript grammars: ${error.message}`, {
        error: error.stack,
      });
      throw error;
    }
  }

  /**
   * Load the Python grammar using Node.js bindings
   * @private
   */
  async loadPythonGrammar() {
    try {
      logger.info("Loading Python grammar using Node.js bindings");

      // Use Node.js require for native modules
      // Since we're in ESM context, we need to use createRequire
      const { createRequire } = await import("module");
      const require = createRequire(import.meta.url);

      // Load Python module
      const pythonModule = require("tree-sitter-python");

      if (!pythonModule) {
        throw new Error("Failed to load Python grammar module");
      }

      this.loadedGrammars.set("python", pythonModule);
      logger.info("Successfully loaded grammar for python");
    } catch (error) {
      logger.error(`Failed to load Python grammar: ${error.message}`, {
        error: error.stack,
      });
      throw error;
    }
  }

  /**
   * Get a parser for the specified language
   * @param {string} languageName - Name of the language (e.g., 'javascript', 'python', 'typescript', 'tsx')
   * @returns {Parser|null} - Initialized parser for the language or null if not available
   */
  getParserForLanguage(languageName) {
    if (!this.initialized) {
      logger.warn(
        "TreeSitterManager.getParserForLanguage called before initialization"
      );
      return null;
    }

    const grammar = this.loadedGrammars.get(languageName);

    if (!grammar) {
      logger.warn(`No grammar loaded for language: ${languageName}`);
      return null;
    }

    try {
      // Create a new parser instance
      const parser = new pkg();

      // Set the language for the parser
      parser.setLanguage(grammar);

      return parser;
    } catch (error) {
      logger.error(
        `Failed to create parser for ${languageName}: ${error.message}`,
        {
          error: error.stack,
        }
      );
      return null;
    }
  }

  /**
   * Check if a language grammar is loaded
   * @param {string} languageName - Name of the language
   * @returns {boolean} - True if the language grammar is loaded
   */
  hasLanguage(languageName) {
    return this.loadedGrammars.has(languageName);
  }

  /**
   * Get list of loaded language grammars
   * @returns {string[]} - Array of language names that are loaded
   */
  getLoadedLanguages() {
    return Array.from(this.loadedGrammars.keys());
  }
}

export default TreeSitterManager;
