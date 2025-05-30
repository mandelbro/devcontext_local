/**
 * CompressionService
 *
 * Service for managing context compression and token budget management.
 * Handles selection and truncation of candidate snippets to fit within token limits.
 */

/**
 * CompressionService class for handling context compression operations
 */
class CompressionService {
  /**
   * Constructor for CompressionService
   * @param {Object} dependencies - Service dependencies
   * @param {Object} dependencies.logger - Logger instance
   * @param {Object} dependencies.configService - Configuration service instance (optional)
   */
  constructor({ logger, configService }) {
    this.logger = logger;
    this.configService = configService;

    // Log successful initialization
    this.logger.info("CompressionService initialized successfully", {
      hasLogger: !!this.logger,
      hasConfigService: !!this.configService,
    });
  }

  /**
   * Estimates the token count for a given text using a simple heuristic
   *
   * Uses a character-based approach: average 4 characters per token
   * This is a conservative estimate suitable for most text content including code
   *
   * @param {string} text - The text to estimate token count for
   * @returns {number} Estimated token count (integer)
   * @private
   */
  _estimateTokens(text) {
    try {
      // Validate input
      if (!text || typeof text !== "string") {
        this.logger.debug("Invalid text provided for token estimation", {
          text: text,
          type: typeof text,
        });
        return 0;
      }

      // Trim whitespace for more accurate estimation
      const trimmedText = text.trim();

      if (trimmedText.length === 0) {
        return 0;
      }

      // Heuristic: Average 4 characters per token
      // This is based on common observations that:
      // - English text averages around 4-5 characters per word
      // - Code tokens can be shorter but include many symbols
      // - Conservative estimate helps avoid budget overruns
      const estimatedTokens = Math.ceil(trimmedText.length / 4);

      this.logger.debug("Token estimation completed", {
        textLength: trimmedText.length,
        estimatedTokens: estimatedTokens,
        heuristic: "4 characters per token",
      });

      return estimatedTokens;
    } catch (error) {
      this.logger.error("Error during token estimation", {
        error: error.message,
        stack: error.stack,
        textLength: text?.length || 0,
      });

      // Return a conservative fallback estimate
      return Math.ceil((text?.length || 0) / 4);
    }
  }

  /**
   * Determines if a snippet is primarily text-based and suitable for text truncation
   *
   * @param {Object} snippet - The candidate snippet to check
   * @returns {boolean} True if the snippet is text-based (documents, conversations, git commits)
   * @private
   */
  _isTextBasedSnippet(snippet) {
    const textBasedSourceTypes = [
      "project_document_fts",
      "project_document_keyword",
      "conversation_message",
      "conversation_topic",
      "git_commit",
      "git_commit_file_change",
    ];

    return textBasedSourceTypes.includes(snippet.sourceType);
  }

  /**
   * Determines if a snippet contains raw content (not AI-processed)
   *
   * @param {Object} snippet - The candidate snippet to check
   * @returns {boolean} True if the snippet is from raw content, not AI summary
   * @private
   */
  _isRawContent(snippet) {
    // Check if the snippet is from raw content (not AI summarized)
    // If aiStatus is 'completed', it means this is already AI-processed content
    return snippet.aiStatus !== "completed";
  }

  /**
   * Attempts to truncate a text-based snippet to fit within the token budget
   *
   * @param {Object} snippet - The original snippet to truncate
   * @param {number} originalTokens - The original estimated token count
   * @param {number} remainingTokenBudget - The remaining token budget
   * @returns {Object} Truncation result with success flag, truncated snippet, and token count
   * @private
   */
  _attemptTextTruncation(snippet, originalTokens, remainingTokenBudget) {
    try {
      // Calculate target token count (aim for 80% of remaining budget, but at least 50 tokens)
      const minUsefulTokens = 50;
      const maxTargetTokens = Math.max(
        Math.floor(remainingTokenBudget * 0.8),
        minUsefulTokens
      );

      // If even the minimum isn't feasible, return failure
      if (
        maxTargetTokens > remainingTokenBudget ||
        maxTargetTokens < minUsefulTokens
      ) {
        return {
          success: false,
          reason: `Target tokens (${maxTargetTokens}) not feasible with budget (${remainingTokenBudget})`,
        };
      }

      // Calculate target character length based on our token heuristic (4 chars per token)
      const targetCharLength = maxTargetTokens * 4;

      // Truncate the content snippet
      let truncatedContent = snippet.contentSnippet.substring(
        0,
        targetCharLength
      );

      // Add ellipsis if content was actually truncated
      if (truncatedContent.length < snippet.contentSnippet.length) {
        truncatedContent += "...";
      }

      // Re-estimate tokens for the truncated content
      const truncatedTokens = this._estimateTokens(truncatedContent);

      // Verify the truncated version fits and is useful
      if (truncatedTokens <= 0) {
        return {
          success: false,
          reason: "Truncated content resulted in 0 tokens",
        };
      }

      if (truncatedTokens > remainingTokenBudget) {
        return {
          success: false,
          reason: `Truncated tokens (${truncatedTokens}) still exceed budget (${remainingTokenBudget})`,
        };
      }

      if (truncatedTokens < minUsefulTokens) {
        return {
          success: false,
          reason: `Truncated tokens (${truncatedTokens}) below minimum useful threshold (${minUsefulTokens})`,
        };
      }

      // Create a copy of the snippet with truncated content
      const truncatedSnippet = {
        ...snippet,
        contentSnippet: truncatedContent,
        metadata: {
          ...snippet.metadata,
          truncated: true,
          originalLength: snippet.contentSnippet.length,
          truncatedLength: truncatedContent.length,
          originalTokens: originalTokens,
          truncatedTokens: truncatedTokens,
        },
      };

      return {
        success: true,
        truncatedSnippet: truncatedSnippet,
        tokenCount: truncatedTokens,
      };
    } catch (error) {
      this.logger.error("Error during text truncation", {
        error: error.message,
        stack: error.stack,
        snippetId: snippet.id,
        sourceType: snippet.sourceType,
        originalTokens: originalTokens,
        remainingTokenBudget: remainingTokenBudget,
      });

      return {
        success: false,
        reason: `Truncation error: ${error.message}`,
      };
    }
  }

  /**
   * Determines if a snippet is a code entity suitable for code truncation
   *
   * @param {Object} snippet - The candidate snippet to check
   * @returns {boolean} True if the snippet is a code entity
   * @private
   */
  _isCodeSnippet(snippet) {
    const codeSourceTypes = [
      "code_entity_fts",
      "code_entity_keyword",
      "code_entity_related",
    ];

    return codeSourceTypes.includes(snippet.sourceType);
  }

  /**
   * Attempts to truncate a code snippet using structural hints if available
   *
   * @param {Object} snippet - The original code snippet to truncate
   * @param {number} originalTokens - The original estimated token count
   * @param {number} remainingTokenBudget - The remaining token budget
   * @returns {Object} Truncation result with success flag, truncated snippet, token count, and strategy
   * @private
   */
  _attemptCodeTruncation(snippet, originalTokens, remainingTokenBudget) {
    try {
      // Calculate target token count (aim for 80% of remaining budget, but at least 50 tokens)
      const minUsefulTokens = 50;
      const maxTargetTokens = Math.max(
        Math.floor(remainingTokenBudget * 0.8),
        minUsefulTokens
      );

      // If even the minimum isn't feasible, return failure
      if (
        maxTargetTokens > remainingTokenBudget ||
        maxTargetTokens < minUsefulTokens
      ) {
        return {
          success: false,
          reason: `Target tokens (${maxTargetTokens}) not feasible with budget (${remainingTokenBudget})`,
        };
      }

      const entityType = snippet.entityType;
      let truncationStrategy = "line_based"; // Default strategy
      let truncatedContent = "";

      // Try structural truncation if entityType is available
      if (entityType && this._supportsStructuralTruncation(entityType)) {
        const structuralResult = this._attemptStructuralTruncation(
          snippet.contentSnippet,
          entityType,
          maxTargetTokens
        );

        if (structuralResult.success) {
          truncatedContent = structuralResult.content;
          truncationStrategy = structuralResult.strategy;
        } else {
          // Fall back to line-based truncation
          truncatedContent = this._performLineTruncation(
            snippet.contentSnippet,
            maxTargetTokens
          );
          truncationStrategy = "line_based_fallback";
        }
      } else {
        // Use simple line-based truncation
        truncatedContent = this._performLineTruncation(
          snippet.contentSnippet,
          maxTargetTokens
        );
        truncationStrategy = "line_based";
      }

      // Re-estimate tokens for the truncated code
      const truncatedTokens = this._estimateTokens(truncatedContent);

      // Verify the truncated version fits and is useful
      if (truncatedTokens <= 0) {
        return {
          success: false,
          reason: "Truncated code resulted in 0 tokens",
        };
      }

      if (truncatedTokens > remainingTokenBudget) {
        return {
          success: false,
          reason: `Truncated tokens (${truncatedTokens}) still exceed budget (${remainingTokenBudget})`,
        };
      }

      if (truncatedTokens < minUsefulTokens) {
        return {
          success: false,
          reason: `Truncated tokens (${truncatedTokens}) below minimum useful threshold (${minUsefulTokens})`,
        };
      }

      // Create a copy of the snippet with truncated content
      const truncatedSnippet = {
        ...snippet,
        contentSnippet: truncatedContent,
        metadata: {
          ...snippet.metadata,
          truncated: true,
          truncationStrategy: truncationStrategy,
          originalLength: snippet.contentSnippet.length,
          truncatedLength: truncatedContent.length,
          originalTokens: originalTokens,
          truncatedTokens: truncatedTokens,
        },
      };

      return {
        success: true,
        truncatedSnippet: truncatedSnippet,
        tokenCount: truncatedTokens,
        strategy: truncationStrategy,
      };
    } catch (error) {
      this.logger.error("Error during code truncation", {
        error: error.message,
        stack: error.stack,
        snippetId: snippet.id,
        sourceType: snippet.sourceType,
        entityType: snippet.entityType || "unknown",
        originalTokens: originalTokens,
        remainingTokenBudget: remainingTokenBudget,
      });

      return {
        success: false,
        reason: `Code truncation error: ${error.message}`,
      };
    }
  }

  /**
   * Checks if an entity type supports structural truncation
   *
   * @param {string} entityType - The entity type to check
   * @returns {boolean} True if structural truncation is supported
   * @private
   */
  _supportsStructuralTruncation(entityType) {
    const structuralEntityTypes = [
      "function_declaration",
      "method_definition",
      "class_declaration",
      "interface_declaration",
      "type_definition",
    ];

    return structuralEntityTypes.includes(entityType);
  }

  /**
   * Attempts structural truncation based on entity type
   *
   * @param {string} codeContent - The original code content
   * @param {string} entityType - The entity type for structural hints
   * @param {number} maxTargetTokens - Maximum target tokens
   * @returns {Object} Structural truncation result
   * @private
   */
  _attemptStructuralTruncation(codeContent, entityType, maxTargetTokens) {
    try {
      let truncatedContent = "";
      let strategy = "";

      switch (entityType) {
        case "function_declaration":
        case "method_definition":
          // Try to extract function signature and first few lines of body
          const funcResult = this._extractFunctionSignature(
            codeContent,
            maxTargetTokens
          );
          if (funcResult.success) {
            truncatedContent = funcResult.content;
            strategy = "function_signature_with_body";
          }
          break;

        case "class_declaration":
          // Try to extract class signature and method signatures (without bodies)
          const classResult = this._extractClassStructure(
            codeContent,
            maxTargetTokens
          );
          if (classResult.success) {
            truncatedContent = classResult.content;
            strategy = "class_structure_with_methods";
          }
          break;

        case "interface_declaration":
        case "type_definition":
          // For interfaces/types, try to keep the complete definition if small enough
          // Otherwise, truncate line-wise
          const interfaceResult = this._extractInterfaceStructure(
            codeContent,
            maxTargetTokens
          );
          if (interfaceResult.success) {
            truncatedContent = interfaceResult.content;
            strategy = "interface_definition";
          }
          break;
      }

      if (
        truncatedContent &&
        this._estimateTokens(truncatedContent) <= maxTargetTokens
      ) {
        return {
          success: true,
          content: truncatedContent,
          strategy: strategy,
        };
      } else {
        return {
          success: false,
          reason: "Structural truncation did not fit within token budget",
        };
      }
    } catch (error) {
      return {
        success: false,
        reason: `Structural truncation error: ${error.message}`,
      };
    }
  }

  /**
   * Extracts function signature and optionally first few lines of body
   *
   * @param {string} codeContent - The function code
   * @param {number} maxTargetTokens - Maximum target tokens
   * @returns {Object} Extraction result
   * @private
   */
  _extractFunctionSignature(codeContent, maxTargetTokens) {
    try {
      const lines = codeContent.split("\n");

      // Find the function signature (look for patterns like "function", "def", "const func =", etc.)
      let signatureEndIndex = -1;
      let braceCount = 0;
      let inSignature = true;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (inSignature) {
          // Count braces/parentheses to find end of signature
          const openBraces = (line.match(/[{(]/g) || []).length;
          const closeBraces = (line.match(/[})]/g) || []).length;
          braceCount += openBraces - closeBraces;

          // If we found opening brace and it's balanced (or at end of signature)
          if (line.includes("{") && braceCount >= 0) {
            signatureEndIndex = i;
            inSignature = false;
            break;
          }

          // For functions without braces (like arrow functions), check for =>
          if (line.includes("=>")) {
            signatureEndIndex = i;
            break;
          }
        }
      }

      if (signatureEndIndex === -1) {
        // Couldn't find signature end, fall back to first few lines
        signatureEndIndex = Math.min(2, lines.length - 1);
      }

      // Include signature and first few lines of body
      const maxLines = Math.min(signatureEndIndex + 3, lines.length);
      let truncatedLines = lines.slice(0, maxLines);

      // Add truncation comment if we cut off content
      if (maxLines < lines.length) {
        truncatedLines.push("  // ... (code truncated) ...");
      }

      const truncatedContent = truncatedLines.join("\n");

      // Check if this fits within token budget
      if (this._estimateTokens(truncatedContent) <= maxTargetTokens) {
        return {
          success: true,
          content: truncatedContent,
        };
      } else {
        // Try with just the signature
        const signatureOnly =
          lines.slice(0, signatureEndIndex + 1).join("\n") +
          "\n  // ... (body truncated) ...";
        if (this._estimateTokens(signatureOnly) <= maxTargetTokens) {
          return {
            success: true,
            content: signatureOnly,
          };
        } else {
          return { success: false };
        }
      }
    } catch (error) {
      return { success: false };
    }
  }

  /**
   * Extracts class structure with method signatures
   *
   * @param {string} codeContent - The class code
   * @param {number} maxTargetTokens - Maximum target tokens
   * @returns {Object} Extraction result
   * @private
   */
  _extractClassStructure(codeContent, maxTargetTokens) {
    try {
      const lines = codeContent.split("\n");
      const resultLines = [];
      let braceDepth = 0;
      let inMethod = false;
      let methodBraceDepth = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        // Count braces to track depth
        const openBraces = (line.match(/{/g) || []).length;
        const closeBraces = (line.match(/}/g) || []).length;

        braceDepth += openBraces - closeBraces;

        // Class declaration or property declarations
        if (braceDepth <= 1 && !inMethod) {
          // Include class declaration, properties, and method signatures
          if (
            trimmedLine.includes("class ") ||
            trimmedLine.includes("constructor") ||
            trimmedLine.includes("function ") ||
            trimmedLine.includes("get ") ||
            trimmedLine.includes("set ") ||
            trimmedLine.match(/^\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*[(:]/)
          ) {
            resultLines.push(line);

            // If this starts a method, track it
            if (
              openBraces > 0 &&
              (trimmedLine.includes("(") || trimmedLine.includes("{"))
            ) {
              inMethod = true;
              methodBraceDepth = braceDepth;
            }
          } else if (trimmedLine.length > 0 && !trimmedLine.startsWith("//")) {
            // Include other significant lines (properties, etc.)
            resultLines.push(line);
          }
        } else if (inMethod && braceDepth < methodBraceDepth) {
          // End of method - add closing brace and reset
          resultLines.push(line);
          inMethod = false;
          methodBraceDepth = 0;
        } else if (inMethod && resultLines.length > 0) {
          // We're inside a method body - add truncation comment instead
          const lastLine = resultLines[resultLines.length - 1];
          if (!lastLine.includes("// ... (method body truncated)")) {
            resultLines.push("    // ... (method body truncated) ...");
          }
        }

        // Check if we're approaching token limit
        const currentContent = resultLines.join("\n");
        if (this._estimateTokens(currentContent) > maxTargetTokens * 0.9) {
          resultLines.push("  // ... (class truncated) ...");
          break;
        }
      }

      const truncatedContent = resultLines.join("\n");

      return {
        success: this._estimateTokens(truncatedContent) <= maxTargetTokens,
        content: truncatedContent,
      };
    } catch (error) {
      return { success: false };
    }
  }

  /**
   * Extracts interface/type definition structure
   *
   * @param {string} codeContent - The interface/type code
   * @param {number} maxTargetTokens - Maximum target tokens
   * @returns {Object} Extraction result
   * @private
   */
  _extractInterfaceStructure(codeContent, maxTargetTokens) {
    try {
      // For interfaces and types, often the complete definition is valuable
      // Try to include the full definition if it fits
      if (this._estimateTokens(codeContent) <= maxTargetTokens) {
        return {
          success: true,
          content: codeContent,
        };
      }

      // If too large, try line-based truncation
      const lines = codeContent.split("\n");
      const targetLines = Math.floor(maxTargetTokens / 10); // Rough estimate

      if (targetLines >= lines.length) {
        return {
          success: true,
          content: codeContent,
        };
      }

      const truncatedLines = lines.slice(0, targetLines);
      truncatedLines.push("  // ... (definition truncated) ...");
      const truncatedContent = truncatedLines.join("\n");

      return {
        success: this._estimateTokens(truncatedContent) <= maxTargetTokens,
        content: truncatedContent,
      };
    } catch (error) {
      return { success: false };
    }
  }

  /**
   * Performs simple line-based truncation for code
   *
   * @param {string} codeContent - The code content to truncate
   * @param {number} maxTargetTokens - Maximum target tokens
   * @returns {string} Truncated code content
   * @private
   */
  _performLineTruncation(codeContent, maxTargetTokens) {
    try {
      const lines = codeContent.split("\n");

      // Calculate approximate lines we can include (rough estimate: 10 tokens per line)
      const estimatedLinesForBudget = Math.floor(maxTargetTokens / 10);
      const targetLines = Math.max(
        1,
        Math.min(estimatedLinesForBudget, lines.length)
      );

      if (targetLines >= lines.length) {
        return codeContent;
      }

      // Take first N lines and add truncation comment
      const truncatedLines = lines.slice(0, targetLines);
      truncatedLines.push("// ... (code truncated) ...");

      return truncatedLines.join("\n");
    } catch (error) {
      this.logger.error("Error in line-based code truncation", {
        error: error.message,
        maxTargetTokens: maxTargetTokens,
        codeLength: codeContent.length,
      });

      // Emergency fallback - just use character-based truncation
      const targetChars = maxTargetTokens * 4;
      return (
        codeContent.substring(0, targetChars) + "\n// ... (code truncated) ..."
      );
    }
  }

  /**
   * Compresses and selects candidate snippets to fit within a token budget
   *
   * Takes a ranked list of candidate snippets and applies compression/selection logic
   * to create a final list that fits within the specified token budget.
   *
   * @param {Array} rankedSnippets - Array of CandidateSnippet objects, sorted by consolidatedScore
   * @param {number} tokenBudget - Maximum desired token count for the final list of snippets
   * @returns {Object} Compression result with finalSnippets and statistics
   */
  compressSnippets(rankedSnippets, tokenBudget) {
    try {
      // Validate input parameters
      if (!Array.isArray(rankedSnippets)) {
        this.logger.error(
          "Invalid rankedSnippets provided to compressSnippets",
          {
            rankedSnippets: rankedSnippets,
            type: typeof rankedSnippets,
          }
        );
        throw new Error("rankedSnippets must be an array");
      }

      if (typeof tokenBudget !== "number" || tokenBudget <= 0) {
        this.logger.error("Invalid tokenBudget provided to compressSnippets", {
          tokenBudget: tokenBudget,
          type: typeof tokenBudget,
        });
        throw new Error("tokenBudget must be a positive number");
      }

      // Initialize arrays and budget tracking
      const finalSnippets = [];
      let remainingTokenBudget = tokenBudget;

      // Initialize counters for summary statistics
      const snippetsFoundBeforeCompression = rankedSnippets.length;
      let estimatedTokensIn = 0; // Will sum initial estimates of all snippets
      let snippetsReturnedAfterCompression = 0;
      let estimatedTokensOut = 0;

      // Log the initiation of the compression process
      this.logger.info(
        `Compression started. Snippets to process: ${rankedSnippets.length}, Token budget: ${tokenBudget}.`
      );

      this.logger.debug("Compression process initialized", {
        snippetsFoundBeforeCompression: snippetsFoundBeforeCompression,
        remainingTokenBudget: remainingTokenBudget,
        finalSnippetsLength: finalSnippets.length,
      });

      // Calculate total estimated tokens for all input snippets
      for (const snippet of rankedSnippets) {
        if (snippet.contentSnippet) {
          estimatedTokensIn += this._estimateTokens(snippet.contentSnippet);
        }
      }

      this.logger.debug("Calculated total input token estimates", {
        totalSnippets: rankedSnippets.length,
        estimatedTokensIn: estimatedTokensIn,
        tokenBudget: tokenBudget,
      });

      // Main compression loop - iterate through ranked snippets (highest score first)
      let processedSnippetCount = 0;
      const minUsefulTokens = 10; // Minimum tokens to consider a snippet useful

      for (
        let i = 0;
        i < rankedSnippets.length && remainingTokenBudget > minUsefulTokens;
        i++
      ) {
        const snippet = rankedSnippets[i];
        processedSnippetCount++;

        this.logger.debug("Processing snippet in compression loop", {
          snippetIndex: i,
          snippetId: snippet.id,
          sourceType: snippet.sourceType,
          remainingTokenBudget: remainingTokenBudget,
          processedCount: processedSnippetCount,
        });

        // Task 217: Estimate token count for current snippet
        // Get the content snippet and estimate its token count
        let currentSnippetTokens = 0;

        try {
          if (
            !snippet.contentSnippet ||
            typeof snippet.contentSnippet !== "string"
          ) {
            this.logger.warn("Snippet has invalid or missing contentSnippet", {
              snippetId: snippet.id,
              sourceType: snippet.sourceType,
              contentSnippetType: typeof snippet.contentSnippet,
              hasContentSnippet: !!snippet.contentSnippet,
            });
            // Skip this snippet as it has no valid content to process
            continue;
          }

          // Use the _estimateTokens helper method from Task 214
          currentSnippetTokens = this._estimateTokens(snippet.contentSnippet);

          // Task 224: Log considering each snippet in the specified format (after token estimation)
          this.logger.debug(
            `Considering snippet ${snippet.id} (type: ${snippet.sourceType}, est. tokens: ${currentSnippetTokens}). Budget remaining: ${remainingTokenBudget}.`
          );

          this.logger.debug("Estimated tokens for current snippet", {
            snippetId: snippet.id,
            sourceType: snippet.sourceType,
            contentLength: snippet.contentSnippet.length,
            estimatedTokens: currentSnippetTokens,
            remainingTokenBudget: remainingTokenBudget,
          });
        } catch (error) {
          this.logger.error("Error estimating tokens for snippet", {
            error: error.message,
            stack: error.stack,
            snippetId: snippet.id,
            sourceType: snippet.sourceType,
          });
          // Skip this snippet due to estimation error
          continue;
        }

        // Task 218: Add snippet to final list if it fits remaining token budget
        if (currentSnippetTokens <= remainingTokenBudget) {
          // Snippet fits within budget - add it to final snippets
          finalSnippets.push(snippet);

          // Update budget and statistics
          remainingTokenBudget -= currentSnippetTokens;
          snippetsReturnedAfterCompression++;
          estimatedTokensOut += currentSnippetTokens;

          // Log the successful addition
          this.logger.debug(
            `Added snippet ${snippet.id} (tokens: ${currentSnippetTokens}). Budget remaining: ${remainingTokenBudget}.`
          );

          this.logger.debug("Added snippet to final context", {
            snippetId: snippet.id,
            sourceType: snippet.sourceType,
            tokens: currentSnippetTokens,
            budgetRemaining: remainingTokenBudget,
            finalSnippetsCount: finalSnippets.length,
          });
        } else {
          // Snippet doesn't fit - attempt truncation for text-based content (Task 219)
          this.logger.debug("Snippet exceeds remaining token budget", {
            snippetId: snippet.id,
            sourceType: snippet.sourceType,
            requiredTokens: currentSnippetTokens,
            remainingTokenBudget: remainingTokenBudget,
            exceedsBy: currentSnippetTokens - remainingTokenBudget,
          });

          // Task 219: Implement rule-based truncation for oversized raw content snippets (non-code)
          // Check if the snippet is primarily text-based and not a structured code entity
          const isTextBasedSnippet = this._isTextBasedSnippet(snippet);
          const isRawContent = this._isRawContent(snippet);

          if (isTextBasedSnippet && isRawContent) {
            // Attempt to truncate the snippet to fit a portion of the remaining budget
            const truncationResult = this._attemptTextTruncation(
              snippet,
              currentSnippetTokens,
              remainingTokenBudget
            );

            if (truncationResult.success) {
              // Truncated snippet fits - add it to final snippets
              finalSnippets.push(truncationResult.truncatedSnippet);

              // Update budget and statistics
              remainingTokenBudget -= truncationResult.tokenCount;
              snippetsReturnedAfterCompression++;
              estimatedTokensOut += truncationResult.tokenCount;

              // Log the successful truncation and addition
              this.logger.info("Truncated snippet and added to final context", {
                snippetId: snippet.id,
                sourceType: snippet.sourceType,
                originalTokens: currentSnippetTokens,
                truncatedTokens: truncationResult.tokenCount,
                originalLength: snippet.contentSnippet.length,
                truncatedLength:
                  truncationResult.truncatedSnippet.contentSnippet.length,
                budgetRemaining: remainingTokenBudget,
              });

              this.logger.debug(
                `Truncated snippet ${snippet.id} (type: ${snippet.sourceType}) from ${currentSnippetTokens} to ${truncationResult.tokenCount} tokens and added. Budget remaining: ${remainingTokenBudget}.`
              );
            } else {
              // Even truncated version doesn't fit or isn't useful
              this.logger.debug(
                `Skipped snippet ${snippet.id} (est. tokens: ${currentSnippetTokens}) due to budget. Budget remaining: ${remainingTokenBudget}.`
              );

              this.logger.debug(
                "Skipped snippet - truncation failed or insufficient",
                {
                  snippetId: snippet.id,
                  sourceType: snippet.sourceType,
                  originalTokens: currentSnippetTokens,
                  remainingTokenBudget: remainingTokenBudget,
                  truncationAttempted: true,
                  reason: truncationResult.reason,
                }
              );
            }
          } else {
            // Task 220: Check if this is a code snippet that should be truncated
            const isCodeSnippet = this._isCodeSnippet(snippet);

            if (isCodeSnippet && isRawContent) {
              // Attempt to truncate the code snippet using structural hints
              const codeTruncationResult = this._attemptCodeTruncation(
                snippet,
                currentSnippetTokens,
                remainingTokenBudget
              );

              if (codeTruncationResult.success) {
                // Truncated code snippet fits - add it to final snippets
                finalSnippets.push(codeTruncationResult.truncatedSnippet);

                // Update budget and statistics
                remainingTokenBudget -= codeTruncationResult.tokenCount;
                snippetsReturnedAfterCompression++;
                estimatedTokensOut += codeTruncationResult.tokenCount;

                // Log the successful code truncation and addition
                this.logger.info(
                  "Truncated code snippet and added to final context",
                  {
                    snippetId: snippet.id,
                    sourceType: snippet.sourceType,
                    entityType: snippet.entityType || "unknown",
                    originalTokens: currentSnippetTokens,
                    truncatedTokens: codeTruncationResult.tokenCount,
                    originalLength: snippet.contentSnippet.length,
                    truncatedLength:
                      codeTruncationResult.truncatedSnippet.contentSnippet
                        .length,
                    truncationStrategy: codeTruncationResult.strategy,
                    budgetRemaining: remainingTokenBudget,
                  }
                );

                this.logger.debug(
                  `Truncated code snippet ${snippet.id} (type: ${
                    snippet.sourceType
                  }, entity: ${
                    snippet.entityType || "unknown"
                  }) from ${currentSnippetTokens} to ${
                    codeTruncationResult.tokenCount
                  } tokens using ${
                    codeTruncationResult.strategy
                  }. Budget remaining: ${remainingTokenBudget}.`
                );
              } else {
                // Even truncated code version doesn't fit or isn't useful
                this.logger.debug(
                  `Skipped snippet ${snippet.id} (est. tokens: ${currentSnippetTokens}) due to budget. Budget remaining: ${remainingTokenBudget}.`
                );

                this.logger.debug(
                  "Skipped code snippet - truncation failed or insufficient",
                  {
                    snippetId: snippet.id,
                    sourceType: snippet.sourceType,
                    entityType: snippet.entityType || "unknown",
                    originalTokens: currentSnippetTokens,
                    remainingTokenBudget: remainingTokenBudget,
                    truncationAttempted: true,
                    reason: codeTruncationResult.reason,
                  }
                );
              }
            } else {
              // Skip non-text and non-code snippets, or AI-summarized content
              this.logger.debug(
                `Skipped snippet ${snippet.id} (est. tokens: ${currentSnippetTokens}) due to budget. Budget remaining: ${remainingTokenBudget}.`
              );

              this.logger.debug(
                "Skipped snippet - not suitable for any truncation",
                {
                  snippetId: snippet.id,
                  sourceType: snippet.sourceType,
                  requiredTokens: currentSnippetTokens,
                  remainingTokenBudget: remainingTokenBudget,
                  isTextBased: isTextBasedSnippet,
                  isCodeSnippet: isCodeSnippet,
                  isRawContent: isRawContent,
                }
              );
            }
          }
        }

        // TODO: Implement snippet processing logic in subsequent tasks
        // - Estimate token count for current snippet (Task 217) ✓ COMPLETED
        // - Add snippet if it fits the budget (Task 218) ✓ COMPLETED
        // - Apply truncation for oversized snippets (Tasks 219-220)
      }

      this.logger.debug("Compression loop completed", {
        totalSnippetsProcessed: processedSnippetCount,
        snippetsAddedToFinal: snippetsReturnedAfterCompression,
        remainingTokenBudget: remainingTokenBudget,
      });

      // Task 224: Log final compression statistics
      this.logger.info(
        `Compression finished. Final snippets: ${snippetsReturnedAfterCompression}, Est. tokens out: ${estimatedTokensOut}. Budget remaining: ${remainingTokenBudget}.`
      );

      // TODO: Implement main compression logic in subsequent tasks
      // - Iterate through rankedSnippets (Task 216) ✓ COMPLETED
      // - Estimate token count for each snippet (Task 217)
      // - Add snippets that fit the budget (Task 218)
      // - Apply truncation for oversized snippets (Tasks 219-220)

      // Return compression results structure
      return {
        finalSnippets: finalSnippets,
        summaryStats: {
          snippetsFoundBeforeCompression: snippetsFoundBeforeCompression,
          estimatedTokensIn: estimatedTokensIn,
          snippetsReturnedAfterCompression: snippetsReturnedAfterCompression,
          estimatedTokensOut: estimatedTokensOut,
          tokenBudgetGiven: tokenBudget,
          tokenBudgetRemaining: remainingTokenBudget,
        },
      };
    } catch (error) {
      this.logger.error("Error during snippet compression", {
        error: error.message,
        stack: error.stack,
        rankedSnippetsLength: Array.isArray(rankedSnippets)
          ? rankedSnippets.length
          : 0,
        tokenBudget: tokenBudget,
      });

      // Return empty result with error indication
      return {
        finalSnippets: [],
        summaryStats: {
          snippetsFoundBeforeCompression: Array.isArray(rankedSnippets)
            ? rankedSnippets.length
            : 0,
          estimatedTokensIn: 0,
          snippetsReturnedAfterCompression: 0,
          estimatedTokensOut: 0,
          tokenBudgetGiven: tokenBudget,
          tokenBudgetRemaining: tokenBudget,
          error: error.message,
        },
      };
    }
  }
}

export default CompressionService;
