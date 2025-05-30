/**
 * Markdown Parser
 *
 * This module handles the parsing of Markdown files using the 'marked' library.
 * For V2, the primary requirement is to make the raw_content available for
 * storage and AI summarization.
 */

import { marked } from "marked";

/**
 * Parse Markdown content
 *
 * @param {string} fileContentString - The raw Markdown text to parse
 * @returns {Object} An object containing the raw content and optionally parsed HTML
 */
export function parseMarkdownContent(fileContentString) {
  if (!fileContentString) {
    return { rawContent: "" };
  }

  try {
    // For V2, we primarily need the raw content for storage and AI summarization
    // The HTML rendition is optional but included for potential future use
    const htmlContent = marked.parse(fileContentString);

    return {
      rawContent: fileContentString,
      htmlContent: htmlContent,
    };
  } catch (error) {
    // Handle any errors from the marked.parse() call
    console.error("Error parsing markdown content:", error);

    // Even if HTML parsing fails, still return the raw content
    return {
      rawContent: fileContentString,
      error: error.message,
    };
  }
}

export default {
  parseMarkdownContent,
};
