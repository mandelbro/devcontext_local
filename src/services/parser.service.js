/**
 * ParserService
 *
 * This service integrates TreeSitterManager with language-specific parsers
 * to provide code entity and relationship extraction from source files.
 */

import { TreeSitterManager } from "./parsing/treeSitterManager.js";
import { parseJavaScript } from "./parsing/javascript.parser.js";
import { parsePython } from "./parsing/python.parser.js";
import { parseTypeScript } from "./parsing/typescript.parser.js";
import { parseMarkdownContent } from "./parsing/markdown.parser.js";
import logger from "../utils/logger.js";

export class ParserService {
  /**
   * Create a new ParserService instance
   */
  constructor() {
    this.treeSitterManager = new TreeSitterManager();
    this.initialized = false;
  }

  /**
   * Initialize the ParserService
   * @param {Array<string>} configuredLanguages - Language identifiers to load ('javascript', 'python', 'typescript', 'tsx')
   * @returns {Promise<void>}
   */
  async initialize(
    configuredLanguages = ["javascript", "python", "typescript", "tsx"]
  ) {
    try {
      logger.info(
        `Initializing ParserService with languages: ${configuredLanguages.join(
          ", "
        )}`
      );
      await this.treeSitterManager.initializeGrammars(configuredLanguages);
      this.initialized = true;
      logger.info("ParserService initialized successfully");
    } catch (error) {
      logger.error(`Error initializing ParserService: ${error.message}`, {
        error,
      });
      throw error;
    }
  }

  /**
   * Parse a code file and extract entities and relationships
   * @param {string} filePath - Path to the file (used for logging)
   * @param {string} fileContent - Content of the file to parse
   * @param {string} language - Language identifier ('javascript', 'python', 'typescript', 'tsx')
   * @returns {Promise<Object>} Object containing entities, relationships, and errors
   */
  async parseCodeFile(filePath, fileContent, language) {
    if (!this.initialized) {
      logger.warn("ParserService.parseCodeFile called before initialization");
      return {
        entities: [],
        relationships: [],
        errors: ["ParserService not initialized"],
      };
    }

    try {
      logger.info(`Parsing file: ${filePath} (language: ${language})`);

      // Get parser for the language
      const parser = this.treeSitterManager.getParserForLanguage(language);
      if (!parser) {
        logger.error(`No parser available for language: ${language}`);
        return {
          entities: [],
          relationships: [],
          errors: [`Unsupported language or grammar not loaded: ${language}`],
        };
      }

      // Parse the content to get the AST
      const tree = parser.parse(fileContent);
      const astRootNode = tree.rootNode;

      // Delegate to the language-specific parser
      let result;
      switch (language) {
        case "javascript":
        case "jsx":
          result = parseJavaScript(astRootNode, fileContent);
          break;
        case "typescript":
        case "tsx":
          result = parseTypeScript(astRootNode, fileContent);
          break;
        case "python":
          result = parsePython(astRootNode, fileContent);
          break;
        default:
          logger.error(`No parser implementation for language: ${language}`);
          return {
            entities: [],
            relationships: [],
            errors: [`No parser implementation for language: ${language}`],
          };
      }

      logger.info(
        `Successfully parsed ${filePath}: found ${result.entities.length} entities and ${result.relationships.length} relationships`
      );
      return { ...result, errors: [] };
    } catch (error) {
      logger.error(`Error parsing file ${filePath}: ${error.message}`, {
        error,
      });
      return { entities: [], relationships: [], errors: [error.message] };
    }
  }

  /**
   * Parse a Markdown file and extract content
   * @param {string} filePath - Path to the file (used for logging)
   * @param {string} fileContent - Content of the file to parse
   * @returns {Promise<Object>} Object containing rawContent and any errors
   */
  async parseMarkdownFile(filePath, fileContent) {
    try {
      logger.info(`Parsing Markdown file: ${filePath}`);

      // Call the parseMarkdownContent function
      const result = parseMarkdownContent(fileContent);

      // Return an object compatible with what IndexingService expects
      return {
        rawContent: result.rawContent,
        errors: result.error ? [result.error] : [],
      };
    } catch (error) {
      logger.error(
        `Error parsing Markdown file ${filePath}: ${error.message}`,
        {
          error,
        }
      );
      return {
        rawContent: fileContent, // Return the original content even if parsing fails
        errors: [error.message],
      };
    }
  }

  /**
   * Get the list of supported languages
   * @returns {Array<string>} List of supported language identifiers
   */
  getSupportedLanguages() {
    return this.treeSitterManager.getLoadedLanguages();
  }
}

// Export a singleton instance
export default new ParserService();
