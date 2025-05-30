/**
 * AIService - Service for interacting with Google's Gemini API
 *
 * This service initializes the Gemini API client and provides methods
 * for AI-powered operations on code entities and other content.
 */

import { GoogleGenAI } from "@google/genai";
import config from "../config.js";
import logger from "../utils/logger.js";
import { RateLimitError, AIProviderError } from "../utils/errors.js";
import * as dbQueries from "../db/queries.js";
import { v4 as uuidv4 } from "uuid";

/**
 * Service for AI operations using Google's Gemini API
 */
class AIService {
  /**
   * Creates a new AIService instance
   * @param {Object} dbClient - The database client for TursoDB
   */
  constructor(dbClient) {
    this.logger = logger;
    this.configService = config;
    this.dbClient = dbClient;
    this.isFunctional = false;

    this.initialize();
  }

  /**
   * Initializes the Google Gemini API client
   */
  initialize() {
    try {
      const apiKey = this.configService.GOOGLE_GEMINI_API_KEY;
      const modelName = this.configService.AI_MODEL_NAME;

      if (!apiKey) {
        this.logger.error(
          "GOOGLE_GEMINI_API_KEY is missing or invalid. AIService will not function."
        );
        this.isFunctional = false;
        return;
      }

      // Initialize the Google Gemini API client
      const genAI = new GoogleGenAI(apiKey);
      this.model = genAI.getGenerativeModel({
        model: modelName || "gemini-2.0-flash",
      });
      this.isFunctional = true;
      this.logger.info(
        "AIService successfully initialized with Google Gemini API"
      );
    } catch (error) {
      this.logger.error("Failed to initialize AIService", {
        error: error.message,
        stack: error.stack,
      });
      this.isFunctional = false;
    }
  }

  /**
   * Enriches a code entity with AI-generated summary and keywords
   * @param {string} codeEntityId - The ID of the code entity to enrich
   * @param {Object} jobPayload - Optional payload with job parameters
   * @returns {Promise<Object>} - The enrichment result containing summary and keywords
   */
  async enrichCodeEntity(codeEntityId, jobPayload) {
    this.logger.debug(
      `enrichCodeEntity started for codeEntityId: ${codeEntityId}`
    );

    if (!this.isFunctional) {
      this.logger.error(
        `Service not functional for code entity ${codeEntityId}. Missing API key or model name.`
      );
      throw new AIProviderError(
        "AIService is not properly configured. Missing API key or model name."
      );
    }

    try {
      // Fetch the code entity from the database
      this.logger.debug(`Fetching code entity data for ${codeEntityId}`);
      const entity = await dbQueries.getCodeEntityById(
        this.dbClient,
        codeEntityId
      );

      // Check if entity exists
      if (!entity) {
        this.logger.error(
          `Code entity not found for ID: ${codeEntityId}. Cannot enrich.`
        );
        throw new AIProviderError(
          `Code entity with ID ${codeEntityId} not found.`
        );
      }

      // Extract the necessary data from the entity
      const { raw_content, language } = entity;
      this.logger.debug(
        `Entity data fetched for ${codeEntityId}. Language: ${language}, Raw content length: ${raw_content.length}`
      );

      // Determine the thinking budget for the API call
      const defaultThinkingBudget = this.configService.AI_THINKING_BUDGET;
      const thinkingBudget =
        jobPayload?.thinkingBudgetOverride > 0
          ? jobPayload.thinkingBudgetOverride
          : defaultThinkingBudget;

      this.logger.debug(
        `Using thinkingBudget: ${thinkingBudget} for ${codeEntityId}`
      );

      // Construct the prompt for Gemini API
      const prompt = `You are an expert code analyst. Below is a code snippet from a ${language} file.
Provide a concise technical summary (1-2 sentences) of what this code does.
Also, provide a list of 3-5 relevant technical keywords or phrases, comma-separated.
Focus on the core functionality, important identifiers, and algorithms if apparent.

Code Snippet:
\`\`\`${language}
${raw_content}
\`\`\`

Output format should be:
Summary: [Your summary]
Keywords: [keyword1, keyword2, keyword3]`;

      this.logger.debug(
        `Gemini prompt constructed for ${codeEntityId}. Prompt length: ${prompt.length}`
      );

      // Call the Gemini API with the prompt
      const generationConfig = {
        temperature: 0.2, // Lower temperature for more deterministic, focused responses
        maxOutputTokens: Math.min(thinkingBudget || 500, 512), // Set token limit appropriate for summaries
        topP: 0.8,
        topK: 40,
      };

      // Define safety settings as per Story 2.2
      const safetySettings = [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_NONE", // Allow code that might trigger this in benign ways
        },
      ];

      this.logger.info(
        `Calling Gemini API for code entity ${codeEntityId} with budget ${thinkingBudget}`
      );
      const result = await this.model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig,
        safetySettings,
      });

      const response = result.response;
      const responseText = response.text();

      this.logger.debug(
        `Received Gemini response for ${codeEntityId}. Text length: ${responseText.length}`
      );

      // Parse the response to extract summary
      let summary = "";

      // More robust summary extraction with better error handling
      try {
        // Look for the Summary pattern in the response
        const summaryMatch = responseText.match(/Summary:\s*(.*?)(?=\n|$)/i);
        if (summaryMatch && summaryMatch[1]) {
          summary = summaryMatch[1].trim();
          const summarySnippet =
            summary.length > 50 ? `${summary.substring(0, 50)}...` : summary;
          this.logger.debug(
            `Parsed summary for ${codeEntityId}: '${summarySnippet}'`
          );
        } else {
          // Try alternative pattern if the primary one fails
          const altSummaryMatch = responseText.match(/^(.*?)(?=\n|$)/);
          if (
            altSummaryMatch &&
            altSummaryMatch[0] &&
            !altSummaryMatch[0].toLowerCase().includes("keyword")
          ) {
            // Use first line as summary if it doesn't contain "keyword"
            summary = altSummaryMatch[0].trim();
            this.logger.warn(
              `Summary format not found in response for entity ${codeEntityId}, using first line as summary.`
            );
          } else {
            this.logger.warn(
              `Failed to extract summary from response for entity ${codeEntityId}. Response format unexpected.`
            );
          }
        }
      } catch (parseError) {
        this.logger.warn(
          `Error parsing summary from response for entity ${codeEntityId}: ${parseError.message}`
        );
      }

      // Parse the response to extract keywords with robust error handling
      let extractedKeywordsArray = [];

      try {
        // Look for the Keywords pattern in the response
        const keywordsMatch = responseText.match(/Keywords:\s*(.*?)(?=\n|$)/i);
        if (keywordsMatch && keywordsMatch[1]) {
          // Split by comma, trim each keyword, and filter out empty strings
          extractedKeywordsArray = keywordsMatch[1]
            .split(",")
            .map((keyword) => keyword.trim())
            .filter((keyword) => keyword.length > 0);

          this.logger.debug(
            `Parsed keywords for ${codeEntityId}: [${extractedKeywordsArray.join(
              ", "
            )}]`
          );
        } else {
          // Try alternative extraction if the primary pattern fails
          // Look for any comma-separated list in the response that might be keywords
          const altKeywordsMatch = responseText.match(/(\w+(?:,\s*\w+){2,})/);
          if (altKeywordsMatch && altKeywordsMatch[0]) {
            extractedKeywordsArray = altKeywordsMatch[0]
              .split(",")
              .map((keyword) => keyword.trim())
              .filter((keyword) => keyword.length > 0);

            this.logger.warn(
              `Keywords format not found in response for entity ${codeEntityId}, using alternative extraction. Found: ${extractedKeywordsArray.join(
                ", "
              )}`
            );
          } else {
            this.logger.warn(
              `Failed to extract keywords from response for entity ${codeEntityId}. Keywords array will be empty.`
            );
          }
        }
      } catch (parseError) {
        this.logger.warn(
          `Error parsing keywords from response for entity ${codeEntityId}: ${parseError.message}`
        );
        // Keep keywords as empty array in case of error
      }

      // Store the extracted keywords in the database
      if (extractedKeywordsArray.length > 0) {
        try {
          this.logger.debug(
            `Storing/updating keywords for code entity ${codeEntityId}`
          );
          await dbQueries.addEntityKeywords(
            this.dbClient,
            codeEntityId,
            extractedKeywordsArray,
            "ai_explicit"
          );

          this.logger.debug(
            `Successfully stored ${extractedKeywordsArray.length} keywords for code entity ${codeEntityId} in database`
          );
        } catch (dbError) {
          this.logger.error(
            `Error storing keywords for code entity ${codeEntityId} in database`,
            {
              error: dbError.message,
              stack: dbError.stack,
              entityId: codeEntityId,
            }
          );
          // We don't throw here as we still want to continue with updating the entity and returning the enrichment result
        }
      } else {
        this.logger.debug(
          `No keywords to store for code entity ${codeEntityId}`
        );
      }

      // Update the code entity in the database with the new summary and 'completed' status
      try {
        this.logger.debug(
          `Updating code entity ${codeEntityId} with AI insights (summary, status 'completed')`
        );
        await dbQueries.updateCodeEntityAiStatus(
          this.dbClient,
          codeEntityId,
          "completed",
          summary,
          new Date()
        );

        this.logger.debug(
          `Successfully updated code entity ${codeEntityId} in database with summary and 'completed' status`
        );
      } catch (dbError) {
        this.logger.error(
          `Error updating code entity ${codeEntityId} in database`,
          {
            error: dbError.message,
            stack: dbError.stack,
            entityId: codeEntityId,
          }
        );
        // We don't throw here as we still want to return the enrichment result,
        // but we'll include the error in the AIProviderError if needed elsewhere
      }

      this.logger.info(`Successfully enriched code entity ${codeEntityId}`);
      this.logger.debug(
        `Enrichment result for ${codeEntityId} - Summary: ${summary.substring(
          0,
          50
        )}${
          summary.length > 50 ? "..." : ""
        }, Keywords: ${extractedKeywordsArray.join(", ")}`
      );

      return {
        success: true,
        summary,
        keywords: extractedKeywordsArray,
        rawResponse: responseText,
      };
    } catch (error) {
      // Log the original error for diagnostic purposes
      this.logger.error(`Error enriching code entity ${codeEntityId}`, {
        error: error.message,
        stack: error.stack,
        errorObject: error,
        entityId: codeEntityId,
      });

      // Robustly detect rate limit errors
      const isRateLimitError = (error) => {
        // Check for explicit status code 429
        if (error.status === 429) return true;

        // Check for Google API specific error structure
        if (error.code === 8 || error.code === "RESOURCE_EXHAUSTED")
          return true;

        // Check various error message patterns that could indicate rate limiting
        const rateLimitKeywords = [
          "rate limit",
          "ratelimit",
          "resource exhausted",
          "quota exceeded",
          "too many requests",
          "resource_exhausted",
          "429",
        ];

        // Check error message for rate limit indicators
        const errorMessage = (error.message || "").toLowerCase();
        if (
          rateLimitKeywords.some((keyword) => errorMessage.includes(keyword))
        ) {
          return true;
        }

        // Check error name
        if (error.name === "RateLimitError") {
          return true;
        }

        return false;
      };

      if (isRateLimitError(error)) {
        // Try to extract retry-after information if available
        // Default to a sensible value if not extractable
        let retryAfterSeconds = 60; // Default value

        try {
          // Extract retry-after from headers if present
          if (error.headers && error.headers["retry-after"]) {
            const retryAfter = error.headers["retry-after"];
            // Handle both seconds format and date format
            if (!isNaN(retryAfter)) {
              retryAfterSeconds = parseInt(retryAfter, 10);
            } else {
              // If it's a date, calculate seconds from now
              const retryDate = new Date(retryAfter);
              retryAfterSeconds = Math.ceil((retryDate - new Date()) / 1000);
              // Ensure it's positive and reasonable
              retryAfterSeconds = Math.max(
                1,
                Math.min(retryAfterSeconds, 3600)
              );
            }
          }

          // Look for retry information in error body
          if (error.body && error.body.details) {
            const retryInfo = error.body.details.find(
              (detail) => detail.retryInfo || detail.retry_info
            );
            if (retryInfo && (retryInfo.retryDelay || retryInfo.retry_delay)) {
              const delay = retryInfo.retryDelay || retryInfo.retry_delay;
              if (delay.seconds) {
                retryAfterSeconds = parseInt(delay.seconds, 10);
              }
            }
          }
        } catch (extractError) {
          this.logger.warn(
            `Failed to extract retry-after information for entity ${codeEntityId}: ${extractError.message}`
          );
          // Keep using the default value
        }

        // Log detailed information about the rate limit
        this.logger.warn(
          `Rate limit detected for entity ${codeEntityId}. RetryAfter: ${retryAfterSeconds}s. Original error: ${error.message}`
        );

        this.logger.warn(
          `Throwing RateLimitError for entity ${codeEntityId}: ${error.message}`
        );

        // Throw the appropriate RateLimitError with retry information
        throw new RateLimitError(
          `Gemini API rate limit for entity ${codeEntityId}: ${error.message}`,
          retryAfterSeconds
        );
      }

      // Handle other API errors (non-rate-limit) - Task 108 implementation
      this.logger.error(
        `AI Provider Error for entity ${codeEntityId}. Original error: ${error.message}`,
        {
          entityId: codeEntityId,
          errorDetails: error,
        }
      );

      this.logger.error(
        `Throwing AIProviderError for entity ${codeEntityId}: ${error.message}`
      );

      // Throw AIProviderError with a descriptive message
      throw new AIProviderError(
        `Gemini API provider error for entity ${codeEntityId}: ${error.message}`
      );
    }
  }

  /**
   * Enriches a document with AI-generated summary and keywords
   * @param {string} documentId - The ID of the document to enrich
   * @param {Object} jobPayload - Optional payload with job parameters
   * @returns {Promise<Object>} - The enrichment result
   */
  async enrichDocument(documentId, jobPayload) {
    this.logger.debug(`enrichDocument started for documentId: ${documentId}`);

    if (!this.isFunctional) {
      this.logger.error(
        `Service not functional for document ${documentId}. Missing API key or model name.`
      );
      throw new AIProviderError(
        "AIService is not properly configured. Missing API key or model name."
      );
    }

    try {
      // Fetch the project document from the database
      this.logger.debug(`Fetching project document data for ${documentId}`);
      const document = await dbQueries.getProjectDocumentById(
        this.dbClient,
        documentId
      );

      // Check if document exists
      if (!document) {
        this.logger.error(
          `Project document not found for ID: ${documentId}. Cannot enrich.`
        );
        throw new AIProviderError(
          `Project document with ID ${documentId} not found.`
        );
      }

      // Extract the necessary data from the document
      const { raw_content, file_type, file_path } = document;
      this.logger.debug(
        `Document data fetched for ${documentId}. Type: ${file_type}, Path: ${file_path}, Raw content length: ${
          raw_content ? raw_content.length : 0
        }`
      );

      // Determine the thinking budget for the API call
      const defaultThinkingBudget = this.configService.AI_THINKING_BUDGET;
      const thinkingBudget =
        jobPayload?.thinkingBudgetOverride > 0
          ? jobPayload.thinkingBudgetOverride
          : defaultThinkingBudget;

      this.logger.debug(
        `Using thinkingBudget: ${thinkingBudget} for document ${documentId}`
      );

      // Construct the prompt for Gemini API
      const prompt = `You are an expert technical writer and analyst. Below is the content of a ${file_type} document.
Provide a concise summary (2-3 sentences) of what this document is about.
Also, provide a list of 3-5 relevant keywords or phrases, comma-separated.
Focus on the main topics, key information, and purpose of the document.

Document Content:
${raw_content}

Output format should be:
Summary: [Your summary]
Keywords: [keyword1, keyword2, keyword3]`;

      this.logger.debug(
        `Gemini prompt constructed for ${documentId}. Prompt length: ${prompt.length}`
      );

      // Define generation configuration for the API call
      const generationConfig = {
        temperature: 0.2, // Lower temperature for more deterministic, focused responses
        maxOutputTokens: Math.min(thinkingBudget || 500, 512), // Set token limit appropriate for summaries
        topP: 0.8,
        topK: 40,
      };

      // Define safety settings for document analysis
      const safetySettings = [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE", // More restrictive for documents than code
        },
      ];

      this.logger.info(
        `Calling Gemini API for document ${documentId} with budget ${thinkingBudget}`
      );

      // Make the API call to Gemini
      const result = await this.model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig,
        safetySettings,
      });

      const response = result.response;
      const responseText = response.text();

      this.logger.debug(
        `Received Gemini response for document ${documentId}. Text length: ${responseText.length}`
      );

      // Parse the response to extract summary
      let extractedSummary = "";

      // More robust summary extraction with better error handling
      try {
        // Look for the Summary pattern in the response
        const summaryMatch = responseText.match(/Summary:\s*(.*?)(?=\n|$)/i);
        if (summaryMatch && summaryMatch[1]) {
          extractedSummary = summaryMatch[1].trim();
          const summarySnippet =
            extractedSummary.length > 50
              ? `${extractedSummary.substring(0, 50)}...`
              : extractedSummary;
          this.logger.debug(
            `Parsed summary for document ${documentId}: '${summarySnippet}'`
          );
        } else {
          // Try alternative pattern if the primary one fails
          const altSummaryMatch = responseText.match(/^(.*?)(?=\n|$)/);
          if (
            altSummaryMatch &&
            altSummaryMatch[0] &&
            !altSummaryMatch[0].toLowerCase().includes("keyword")
          ) {
            // Use first line as summary if it doesn't contain "keyword"
            extractedSummary = altSummaryMatch[0].trim();
            this.logger.warn(
              `Summary format not found in response for document ${documentId}, using first line as summary.`
            );
          } else {
            this.logger.warn(
              `Failed to extract summary from response for document ${documentId}. Response format unexpected.`
            );
          }
        }
      } catch (parseError) {
        this.logger.warn(
          `Error parsing summary from response for document ${documentId}: ${parseError.message}`
        );
      }

      // Parse the response to extract keywords with robust error handling
      let extractedKeywordsArray = [];

      try {
        // Look for the Keywords pattern in the response
        const keywordsMatch = responseText.match(/Keywords:\s*(.*?)(?=\n|$)/i);
        if (keywordsMatch && keywordsMatch[1]) {
          // Split by comma, trim each keyword, and filter out empty strings
          extractedKeywordsArray = keywordsMatch[1]
            .split(",")
            .map((keyword) => keyword.trim())
            .filter((keyword) => keyword.length > 0);

          this.logger.debug(
            `Parsed keywords for document ${documentId}: [${extractedKeywordsArray.join(
              ", "
            )}]`
          );
        } else {
          // Try alternative extraction if the primary pattern fails
          // Look for any comma-separated list in the response that might be keywords
          const altKeywordsMatch = responseText.match(/(\w+(?:,\s*\w+){2,})/);
          if (altKeywordsMatch && altKeywordsMatch[0]) {
            extractedKeywordsArray = altKeywordsMatch[0]
              .split(",")
              .map((keyword) => keyword.trim())
              .filter((keyword) => keyword.length > 0);

            this.logger.warn(
              `Keywords format not found in response for document ${documentId}, using alternative extraction. Found: ${extractedKeywordsArray.join(
                ", "
              )}`
            );
          } else {
            this.logger.warn(
              `Failed to extract keywords from response for document ${documentId}. Keywords array will be empty.`
            );
          }
        }
      } catch (parseError) {
        this.logger.warn(
          `Error parsing keywords from response for document ${documentId}: ${parseError.message}`
        );
        // Keep keywords as empty array in case of error
      }

      // Store the extracted keywords in the database
      if (extractedKeywordsArray.length > 0) {
        try {
          this.logger.debug(
            `Storing/updating keywords for document ${documentId}`
          );
          await dbQueries.addEntityKeywords(
            this.dbClient,
            documentId,
            extractedKeywordsArray,
            "ai_explicit"
          );

          this.logger.debug(
            `Successfully stored ${extractedKeywordsArray.length} keywords for document ${documentId} in database`
          );
        } catch (dbError) {
          this.logger.error(
            `Error storing keywords for document ${documentId} in database`,
            {
              error: dbError.message,
              stack: dbError.stack,
              documentId: documentId,
            }
          );
          // We don't throw here as we still want to continue with updating the entity and returning the enrichment result
        }
      } else {
        this.logger.debug(`No keywords to store for document ${documentId}`);
      }

      // Update the project document in the database with the new summary and 'completed' status
      try {
        this.logger.debug(
          `Updating project document ${documentId} with AI insights (summary, status 'completed')`
        );
        await dbQueries.updateProjectDocumentAiStatus(
          this.dbClient,
          documentId,
          "completed",
          extractedSummary,
          new Date()
        );

        this.logger.debug(
          `Successfully updated project document ${documentId} in database with summary and 'completed' status`
        );
      } catch (dbError) {
        this.logger.error(
          `Error updating project document ${documentId} in database`,
          {
            error: dbError.message,
            stack: dbError.stack,
            documentId: documentId,
          }
        );
        // We don't throw here as we still want to return the enrichment result,
        // but we'll include the error in the AIProviderError if needed elsewhere
      }

      // Log successful completion with summary information
      this.logger.info(`Successfully enriched document ${documentId}`);
      this.logger.debug(
        `Enrichment result for ${documentId} - Summary: ${extractedSummary.substring(
          0,
          50
        )}${
          extractedSummary.length > 50 ? "..." : ""
        }, Keywords: ${extractedKeywordsArray.join(", ")}`
      );

      // Implementation will be expanded in future tasks
      return {
        success: true,
        summary: extractedSummary,
        keywords: extractedKeywordsArray,
        rawResponse: responseText,
      };
    } catch (error) {
      // Log the original error for diagnostic purposes
      this.logger.error(`Error enriching document ${documentId}`, {
        error: error.message,
        stack: error.stack,
        errorObject: error,
        documentId: documentId,
      });

      // Robustly detect rate limit errors
      const isRateLimitError = (error) => {
        // Check for explicit status code 429
        if (error.status === 429) return true;

        // Check for Google API specific error structure
        if (error.code === 8 || error.code === "RESOURCE_EXHAUSTED")
          return true;

        // Check various error message patterns that could indicate rate limiting
        const rateLimitKeywords = [
          "rate limit",
          "ratelimit",
          "resource exhausted",
          "quota exceeded",
          "too many requests",
          "resource_exhausted",
          "429",
        ];

        // Check error message for rate limit indicators
        const errorMessage = (error.message || "").toLowerCase();
        if (
          rateLimitKeywords.some((keyword) => errorMessage.includes(keyword))
        ) {
          return true;
        }

        // Check error name
        if (error.name === "RateLimitError") {
          return true;
        }

        return false;
      };

      if (isRateLimitError(error)) {
        // Try to extract retry-after information if available
        // Default to a sensible value if not extractable
        let retryAfterSeconds = 60; // Default value

        try {
          // Extract retry-after from headers if present
          if (error.headers && error.headers["retry-after"]) {
            const retryAfter = error.headers["retry-after"];
            // Handle both seconds format and date format
            if (!isNaN(retryAfter)) {
              retryAfterSeconds = parseInt(retryAfter, 10);
            } else {
              // If it's a date, calculate seconds from now
              const retryDate = new Date(retryAfter);
              retryAfterSeconds = Math.ceil((retryDate - new Date()) / 1000);
              // Ensure it's positive and reasonable
              retryAfterSeconds = Math.max(
                1,
                Math.min(retryAfterSeconds, 3600)
              );
            }
          }

          // Look for retry information in error body
          if (error.body && error.body.details) {
            const retryInfo = error.body.details.find(
              (detail) => detail.retryInfo || detail.retry_info
            );
            if (retryInfo && (retryInfo.retryDelay || retryInfo.retry_delay)) {
              const delay = retryInfo.retryDelay || retryInfo.retry_delay;
              if (delay.seconds) {
                retryAfterSeconds = parseInt(delay.seconds, 10);
              }
            }
          }
        } catch (extractError) {
          this.logger.warn(
            `Failed to extract retry-after information for document ${documentId}: ${extractError.message}`
          );
          // Keep using the default value
        }

        // Log detailed information about the rate limit
        this.logger.warn(
          `Rate limit detected for document ${documentId}. RetryAfter: ${retryAfterSeconds}s. Original error: ${error.message}`
        );

        this.logger.warn(
          `Throwing RateLimitError for document ${documentId}: ${error.message}`
        );

        // Throw the appropriate RateLimitError with retry information
        throw new RateLimitError(
          `Gemini API rate limit for document ${documentId}: ${error.message}`,
          retryAfterSeconds
        );
      }

      // Handle other API errors (non-rate-limit) - Task 121 implementation
      this.logger.error(
        `AI Provider Error for document ${documentId}. Original error: ${error.message}`,
        {
          documentId: documentId,
          errorDetails: error,
        }
      );

      this.logger.error(
        `Throwing AIProviderError for document ${documentId}: ${error.message}`
      );

      // Throw AIProviderError with a descriptive message
      throw new AIProviderError(
        `Gemini API provider error for document ${documentId}: ${error.message}`
      );
    }
  }

  /**
   * Generates conversation topics based on conversation history
   * @param {string} conversationId - The ID of the conversation for which to generate topics
   * @param {Object} jobPayload - Optional payload with job parameters and overrides
   * @returns {Promise<Object>} - The topic generation result
   */
  async generateConversationTopics(conversationId, jobPayload) {
    this.logger.debug(
      `generateConversationTopics started for conversationId: ${conversationId}`
    );

    if (!this.isFunctional) {
      this.logger.error(
        `Service not functional for conversation ${conversationId}. Missing API key or model name.`
      );
      throw new AIProviderError(
        "AIService is not properly configured. Missing API key or model name."
      );
    }

    try {
      // Retrieve conversation history from database
      this.logger.debug(
        `Retrieving conversation history for ${conversationId}`
      );
      const messages = await dbQueries.getFullConversationHistory(
        this.dbClient,
        conversationId
      );

      // Check if conversation history exists
      if (!messages || messages.length === 0) {
        this.logger.warn(
          `No conversation history found for conversationId ${conversationId}. Skipping topic generation.`
        );
        return {
          status: "no_history",
          topics: [],
          success: true,
        };
      }

      // Log message count
      this.logger.debug(
        `Retrieved ${messages.length} messages for conversation ${conversationId}`
      );

      // Format conversation history by prefixing each message with its role
      this.logger.debug(
        `Formatting conversation history for ${conversationId}`
      );
      const formattedHistory = messages
        .map((msg) => `${msg.role}: ${msg.content}`)
        .join("\n");

      this.logger.debug(
        `Conversation history formatted for prompt. Formatted length: ${formattedHistory.length} chars`
      );

      // Construct the prompt for Gemini API with template from Story 2.4
      this.logger.debug(
        `Constructing topic generation prompt for ${conversationId}`
      );

      const constructedTopicPrompt = `You are an expert conversation analyst. Below is a transcript of a conversation between a user and an AI assistant.
Analyze the conversation and identify up to 3 main distinct topics discussed.
For each topic, provide:
1. A concise summary (1-2 sentences).
2. A list of 3-5 relevant keywords (comma-separated).
3. A purpose tag (e.g., "Debugging Issue", "New Feature Planning", "Code Refactoring", "General Question").
4. (Optional) The starting and ending phrase or message index that best represents this topic.

Conversation Transcript:
${formattedHistory}

Output format should be structured, for example:
Topic 1:
Summary: [Summary of topic 1]
Keywords: [keywordA, keywordB]
Purpose Tag: [Tag for topic 1]
Range: [Optional start/end hint]

Topic 2:
Summary: [Summary of topic 2]
Keywords: [keywordC, keywordD]
Purpose Tag: [Tag for topic 2]
Range: [Optional start/end hint]`;

      this.logger.debug(
        `Gemini prompt for topic generation constructed for ${conversationId}. Prompt length: ${constructedTopicPrompt.length}`
      );

      // Determine the thinking budget for the API call
      const defaultThinkingBudget = this.configService.AI_THINKING_BUDGET;
      const thinkingBudget =
        jobPayload?.thinkingBudgetOverride > 0
          ? jobPayload.thinkingBudgetOverride
          : defaultThinkingBudget;

      this.logger.debug(
        `Using thinkingBudget: ${thinkingBudget} for topic generation for ${conversationId}`
      );

      // Define generation configuration for the API call
      const generationConfig = {
        temperature: 0.5, // Slightly higher for more creative topic discernment
        maxOutputTokens: Math.min(thinkingBudget || 500, 800), // Higher limit for multiple topic descriptions
        topP: 0.8,
        topK: 40,
      };

      // Define safety settings for conversation analysis
      const safetySettings = [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
      ];

      this.logger.info(
        `Calling Gemini API for topic generation for conversation ${conversationId}`
      );

      // Make the API call to Gemini
      const result = await this.model.generateContent({
        contents: [{ role: "user", parts: [{ text: constructedTopicPrompt }] }],
        generationConfig,
        safetySettings,
      });

      const response = result.response;
      const responseText = response.text();

      this.logger.debug(
        `Received Gemini response for topics for ${conversationId}. Text length: ${responseText.length}`
      );

      // Parse the response to extract topic information
      let parsedTopics = [];

      try {
        // Split the response into topic blocks
        // Look for patterns like "Topic 1:", "Topic 2:", etc.
        const topicBlocks = responseText.split(/Topic\s+\d+:/i).filter(Boolean);

        this.logger.debug(
          `Found ${topicBlocks.length} potential topic blocks in response for ${conversationId}`
        );

        // Process each topic block
        topicBlocks.forEach((block, index) => {
          try {
            // Extract summary
            const summaryMatch = block.match(
              /Summary:\s*(.*?)(?=(?:Keywords:|$))/is
            );
            const summary = summaryMatch?.[1]?.trim() || "";

            // Extract keywords
            const keywordsMatch = block.match(
              /Keywords:\s*(.*?)(?=(?:Purpose Tag:|$))/is
            );
            let keywordsArray = [];
            if (keywordsMatch && keywordsMatch[1]) {
              keywordsArray = keywordsMatch[1]
                .split(",")
                .map((keyword) => keyword.trim())
                .filter((keyword) => keyword.length > 0);
            }

            // Extract purpose tag
            const purposeTagMatch = block.match(
              /Purpose Tag:\s*(.*?)(?=(?:Range:|$))/is
            );
            const purposeTag = purposeTagMatch?.[1]?.trim() || "";

            // Extract range (optional)
            const rangeMatch = block.match(/Range:\s*(.*?)(?=$)/is);
            const rangeHint = rangeMatch?.[1]?.trim() || "";

            // Only add topics that have at least a summary or purpose tag
            if (summary || purposeTag) {
              parsedTopics.push({
                summary,
                keywordsArray,
                purposeTag,
                rangeHint,
              });

              // Log a snippet of the extracted data for debugging
              this.logger.debug(
                `Parsed Topic ${
                  index + 1
                } for ${conversationId}: Summary: "${summary.substring(0, 40)}${
                  summary.length > 40 ? "..." : ""
                }", Keywords: [${keywordsArray.join(
                  ", "
                )}], Purpose: "${purposeTag}"`
              );
            }
          } catch (blockParseError) {
            this.logger.warn(
              `Error parsing topic block ${index + 1} for ${conversationId}: ${
                blockParseError.message
              }`,
              { conversationId, blockIndex: index }
            );
            // Continue with next block despite error in this one
          }
        });

        // Fallback approach if no topics were parsed with the primary method
        if (parsedTopics.length === 0) {
          this.logger.warn(
            `Failed to parse topics with primary method for conversation ${conversationId}. Attempting fallback parsing.`,
            { conversationId }
          );

          // Try to extract topics using a more lenient approach
          // Look for any paragraphs that might be summaries followed by keywords
          const paragraphs = responseText.split(/\n\n+/);
          paragraphs.forEach((paragraph, index) => {
            if (paragraph.trim().length === 0) return;

            // Check if this paragraph contains any meaningful content
            if (
              paragraph.includes(":") &&
              !paragraph.toLowerCase().includes("transcript")
            ) {
              try {
                // Try to extract a summary and keywords
                const lines = paragraph.split(/\n/);
                let topicSummary = "";
                let topicKeywords = [];
                let topicPurpose = "";

                lines.forEach((line) => {
                  if (line.toLowerCase().includes("summary:")) {
                    topicSummary = line.split(/summary:/i)[1]?.trim() || "";
                  } else if (line.toLowerCase().includes("keywords:")) {
                    const keywordsText =
                      line.split(/keywords:/i)[1]?.trim() || "";
                    topicKeywords = keywordsText
                      .split(",")
                      .map((k) => k.trim())
                      .filter(Boolean);
                  } else if (
                    line.toLowerCase().includes("purpose:") ||
                    line.toLowerCase().includes("purpose tag:") ||
                    line.toLowerCase().includes("tag:")
                  ) {
                    const purposeParts = line.split(/(?:purpose|tag):/i);
                    topicPurpose =
                      purposeParts[purposeParts.length - 1]?.trim() || "";
                  }
                });

                if (topicSummary || topicKeywords.length > 0) {
                  parsedTopics.push({
                    summary: topicSummary,
                    keywordsArray: topicKeywords,
                    purposeTag: topicPurpose,
                    rangeHint: "",
                  });

                  this.logger.debug(
                    `Fallback parsing - extracted topic ${
                      index + 1
                    } for ${conversationId}: Summary: "${topicSummary.substring(
                      0,
                      40
                    )}${topicSummary.length > 40 ? "..." : ""}"`,
                    { conversationId, topicIndex: index }
                  );
                }
              } catch (fallbackError) {
                this.logger.warn(
                  `Error in fallback parsing for paragraph ${
                    index + 1
                  } for ${conversationId}: ${fallbackError.message}`,
                  { conversationId, paragraphIndex: index }
                );
              }
            }
          });
        }
      } catch (parseError) {
        this.logger.warn(
          `Error parsing topics from response for conversation ${conversationId}: ${parseError.message}`,
          { conversationId, error: parseError }
        );
        // Keep parsedTopics as empty array in case of error
      }

      this.logger.debug(
        `${parsedTopics.length} topics parsed for ${conversationId}. ${
          parsedTopics.length > 0
            ? `Example topic summary: '${parsedTopics[0].summary.substring(
                0,
                50
              )}...'`
            : "No topics found."
        }`
      );

      // Store the parsed topics in the database
      if (parsedTopics.length > 0) {
        try {
          this.logger.debug(
            `Storing ${parsedTopics.length} topics for conversation ${conversationId} in database`,
            { conversationId, topicCount: parsedTopics.length }
          );

          // Loop through each topic and store it
          for (const topic of parsedTopics) {
            // Generate a unique ID for this topic
            const topicId = uuidv4();

            // Prepare the topic data for storage
            const topicData = {
              topic_id: topicId,
              conversation_id: conversationId,
              summary: topic.summary,
              keywords: JSON.stringify(topic.keywordsArray || []),
              purpose_tag: topic.purposeTag,
              // For v2, we set these to null as the range hint implementation is a stretch goal
              start_message_id: null,
              end_message_id: null,
              start_timestamp: null,
              end_timestamp: null,
            };

            this.logger.debug(
              `Storing topic ${topicId} for conversation ${conversationId}`,
              { conversationId, topicId }
            );

            // Store the topic in the database
            await dbQueries.addConversationTopic(this.dbClient, topicData);

            this.logger.debug(
              `Stored topic ${topicId} for conversation ${conversationId}: "${topic.summary.substring(
                0,
                40
              )}${topic.summary.length > 40 ? "..." : ""}"`,
              { conversationId, topicId }
            );
          }

          this.logger.info(
            `Successfully generated ${parsedTopics.length} topics for conversation ${conversationId}`,
            { conversationId, topicCount: parsedTopics.length }
          );
        } catch (dbError) {
          this.logger.error(
            `Error storing conversation topics for ${conversationId}`,
            {
              error: dbError.message,
              stack: dbError.stack,
              conversationId: conversationId,
            }
          );
          // We don't throw here as we still want to return the parsing results
        }
      } else {
        this.logger.info(
          `No topics were identified for conversation ${conversationId}. Nothing to store.`,
          { conversationId }
        );
      }

      // Return the parsing results
      return {
        success: true,
        topics: parsedTopics,
        rawResponse: responseText,
      };
    } catch (error) {
      this.logger.error(
        `Error generating conversation topics for ${conversationId}`,
        {
          error: error.message,
          stack: error.stack,
          errorObject: error,
          conversationId: conversationId,
        }
      );

      // Robustly detect rate limit errors
      const isRateLimitError = (error) => {
        // Check for explicit status code 429
        if (error.status === 429) return true;

        // Check for Google API specific error structure
        if (error.code === 8 || error.code === "RESOURCE_EXHAUSTED")
          return true;

        // Check various error message patterns that could indicate rate limiting
        const rateLimitKeywords = [
          "rate limit",
          "ratelimit",
          "resource exhausted",
          "quota exceeded",
          "too many requests",
          "resource_exhausted",
          "429",
        ];

        // Check error message for rate limit indicators
        const errorMessage = (error.message || "").toLowerCase();
        if (
          rateLimitKeywords.some((keyword) => errorMessage.includes(keyword))
        ) {
          return true;
        }

        // Check error name
        if (error.name === "RateLimitError") {
          return true;
        }

        return false;
      };

      if (isRateLimitError(error)) {
        // Try to extract retry-after information if available
        // Default to a sensible value if not extractable
        let retryAfterSeconds = 60; // Default value

        try {
          // Extract retry-after from headers if present
          if (error.headers && error.headers["retry-after"]) {
            const retryAfter = error.headers["retry-after"];
            // Handle both seconds format and date format
            if (!isNaN(retryAfter)) {
              retryAfterSeconds = parseInt(retryAfter, 10);
            } else {
              // If it's a date, calculate seconds from now
              const retryDate = new Date(retryAfter);
              retryAfterSeconds = Math.ceil((retryDate - new Date()) / 1000);
              // Ensure it's positive and reasonable
              retryAfterSeconds = Math.max(
                1,
                Math.min(retryAfterSeconds, 3600)
              );
            }
          }

          // Look for retry information in error body
          if (error.body && error.body.details) {
            const retryInfo = error.body.details.find(
              (detail) => detail.retryInfo || detail.retry_info
            );
            if (retryInfo && (retryInfo.retryDelay || retryInfo.retry_delay)) {
              const delay = retryInfo.retryDelay || retryInfo.retry_delay;
              if (delay.seconds) {
                retryAfterSeconds = parseInt(delay.seconds, 10);
              }
            }
          }
        } catch (extractError) {
          this.logger.warn(
            `Failed to extract retry-after information for conversation topic generation ${conversationId}: ${extractError.message}`
          );
          // Keep using the default value
        }

        // Log detailed information about the rate limit
        this.logger.warn(
          `Rate limit detected for conversation topic generation (conversationId: ${conversationId}). RetryAfter: ${retryAfterSeconds}s. Original error: ${error.message}`
        );

        this.logger.warn(
          `Throwing RateLimitError for conversation topic generation ${conversationId}: ${error.message}`
        );

        // Throw the appropriate RateLimitError with retry information
        throw new RateLimitError(
          `Gemini API rate limit for conversation topic generation ${conversationId}: ${error.message}`,
          retryAfterSeconds
        );
      }

      // Handle other API errors (non-rate-limit)
      this.logger.error(
        `AI Provider Error for conversation topic generation (conversationId: ${conversationId}). Original error: ${error.message}`,
        {
          conversationId: conversationId,
          errorDetails: error,
        }
      );

      this.logger.error(
        `Throwing AIProviderError for conversation topic generation ${conversationId}: ${error.message}`
      );

      // Throw AIProviderError with a descriptive message
      throw new AIProviderError(
        `Gemini API provider error for conversation topic generation ${conversationId}: ${error.message}`
      );
    }
  }
}

export { AIService };
