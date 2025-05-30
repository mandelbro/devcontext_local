// scripts/test-gemini-api.js
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

// Get directory name in ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Colors for console output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
};

/**
 * Test Gemini API for code entity enrichment
 */
async function testCodeEntityEnrichment() {
  console.log(`${colors.blue}Testing Code Entity Enrichment${colors.reset}`);

  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    console.error(
      `${colors.red}No API key provided. Set GOOGLE_GEMINI_API_KEY in .env${colors.reset}`
    );
    return false;
  }

  // Initialize Gemini with new API
  const ai = new GoogleGenAI({ apiKey: apiKey });

  // Sample code content - create a test file if it doesn't exist
  const sampleFilePath = path.join(
    __dirname,
    "../test/fixtures/sample-code.js"
  );
  let codeContent;

  try {
    codeContent = fs.readFileSync(sampleFilePath, "utf8");
  } catch (error) {
    // Create sample file if it doesn't exist
    const sampleCode = `
/**
 * Sample function for testing AI enrichment
 * This calculates the fibonacci sequence up to n
 */
function fibonacci(n) {
  if (n <= 1) return n;

  let a = 0, b = 1;
  for (let i = 2; i <= n; i++) {
    const temp = a + b;
    a = b;
    b = temp;
  }

  return b;
}

module.exports = { fibonacci };
`;

    // Ensure directory exists
    fs.mkdirSync(path.dirname(sampleFilePath), { recursive: true });
    fs.writeFileSync(sampleFilePath, sampleCode, "utf8");
    codeContent = sampleCode;
    console.log(
      `${colors.yellow}Created sample code file at ${sampleFilePath}${colors.reset}`
    );
  }

  // Construct prompt (matching our AIService implementation)
  const prompt = `You are an expert code analyst. Below is a code snippet from a JavaScript file.
Provide a concise technical summary (1-2 sentences) of what this code does.
Also, provide a list of 3-5 relevant technical keywords or phrases, comma-separated.
Focus on the core functionality, important identifiers, and algorithms if apparent.

Code Snippet:
\`\`\`javascript
${codeContent}
\`\`\`

Output format should be:
Summary: [Your summary]
Keywords: [keyword1, keyword2, keyword3]`;

  try {
    console.log("Calling Gemini API...");
    const response = await ai.models.generateContent({
      model: process.env.AI_MODEL_NAME || "gemini-2.5-flash-preview-05-20",
      contents: prompt,
      config: {
        temperature: 0.2,
        maxOutputTokens: 4000,
        topP: 0.8,
        topK: 40,
      },
    });

    console.log("Raw response:", response); // Debug output

    // Extract text from the new API response structure
    const responseText =
      response.candidates?.[0]?.content?.parts?.[0]?.text ||
      response.text ||
      response.response?.text ||
      "";

    if (!responseText) {
      console.error(`${colors.red}Empty response from API${colors.reset}`);
      return false;
    }

    console.log("\nResponse:");
    console.log(responseText);

    // Test our parsing logic
    console.log("\nTesting parsing logic:");

    // Extract summary
    const summaryMatch = responseText.match(/Summary:\s*(.*?)(?=\n|$)/i);
    const summary = summaryMatch?.[1]?.trim() || "";
    console.log(`${colors.blue}Extracted summary:${colors.reset} ${summary}`);

    if (!summary) {
      console.error(`${colors.red}Failed to extract summary${colors.reset}`);
    }

    // Extract keywords
    const keywordsMatch = responseText.match(/Keywords:\s*(.*?)(?=\n|$)/i);
    const keywords =
      keywordsMatch?.[1]
        ?.split(",")
        .map((k) => k.trim())
        .filter(Boolean) || [];
    console.log(
      `${colors.blue}Extracted keywords:${colors.reset} ${keywords.join(", ")}`
    );

    if (keywords.length === 0) {
      console.error(`${colors.red}Failed to extract keywords${colors.reset}`);
    }

    const success = summary && keywords.length > 0;
    console.log(
      `\n${
        success ? colors.green + "SUCCESS" : colors.red + "FAILURE"
      } - Code Entity Enrichment Test${colors.reset}`
    );
    return success;
  } catch (error) {
    console.error(`${colors.red}API Error:${colors.reset}`, error);

    // Check for rate limit
    if (
      error.status === 429 ||
      (error.message && error.message.toLowerCase().includes("rate limit"))
    ) {
      console.error(`${colors.red}Rate limit detected!${colors.reset}`);
    }

    return false;
  }
}

/**
 * Test Gemini API for document enrichment
 */
async function testDocumentEnrichment() {
  console.log(`${colors.blue}Testing Document Enrichment${colors.reset}`);

  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    console.error(
      `${colors.red}No API key provided. Set GOOGLE_GEMINI_API_KEY in .env${colors.reset}`
    );
    return false;
  }

  // Initialize Gemini with new API
  const ai = new GoogleGenAI({ apiKey: apiKey });

  // Sample document content - create a test file if it doesn't exist
  const sampleFilePath = path.join(
    __dirname,
    "../test/fixtures/sample-document.md"
  );
  let documentContent;

  try {
    documentContent = fs.readFileSync(sampleFilePath, "utf8");
  } catch (error) {
    // Create sample file if it doesn't exist
    const sampleDoc = `# DevContext Documentation

## Overview

DevContext is a cutting-edge Model Context Protocol (MCP) server designed to provide developers with continuous, project-centric context awareness. It indexes code, documentation, and conversations to create an enriched context model.

## Key Features

- Code entity analysis with AI enrichment
- Document indexing and summarization
- Conversation topic extraction
- Background job processing system

This documentation provides an overview of DevContext's capabilities and setup instructions.
`;

    // Ensure directory exists
    fs.mkdirSync(path.dirname(sampleFilePath), { recursive: true });
    fs.writeFileSync(sampleFilePath, sampleDoc, "utf8");
    documentContent = sampleDoc;
    console.log(
      `${colors.yellow}Created sample document file at ${sampleFilePath}${colors.reset}`
    );
  }

  // Construct prompt (matching our AIService implementation)
  const prompt = `You are an expert technical writer and analyst. Below is the content of a Markdown document.
Provide a concise summary (2-3 sentences) of what this document is about.
Also, provide a list of 3-5 relevant keywords or phrases, comma-separated.
Focus on the main topics, key information, and purpose of the document.

Document Content:
${documentContent}

Output format should be:
Summary: [Your summary]
Keywords: [keyword1, keyword2, keyword3]`;

  try {
    console.log("Calling Gemini API...");
    const response = await ai.models.generateContent({
      model: process.env.AI_MODEL_NAME || "gemini-2.5-flash-preview-05-20",
      contents: prompt,
      config: {
        temperature: 0.2,
        maxOutputTokens: 4000,
        topP: 0.8,
        topK: 40,
      },
    });

    console.log("Raw response:", response); // Debug output

    // Extract text from the new API response structure
    const responseText =
      response.candidates?.[0]?.content?.parts?.[0]?.text ||
      response.text ||
      response.response?.text ||
      "";

    if (!responseText) {
      console.error(`${colors.red}Empty response from API${colors.reset}`);
      return false;
    }

    console.log("\nResponse:");
    console.log(responseText);

    // Test our parsing logic
    console.log("\nTesting parsing logic:");

    // Extract summary
    const summaryMatch = responseText.match(/Summary:\s*(.*?)(?=\n|$)/i);
    const summary = summaryMatch?.[1]?.trim() || "";
    console.log(`${colors.blue}Extracted summary:${colors.reset} ${summary}`);

    if (!summary) {
      console.error(`${colors.red}Failed to extract summary${colors.reset}`);
    }

    // Extract keywords
    const keywordsMatch = responseText.match(/Keywords:\s*(.*?)(?=\n|$)/i);
    const keywords =
      keywordsMatch?.[1]
        ?.split(",")
        .map((k) => k.trim())
        .filter(Boolean) || [];
    console.log(
      `${colors.blue}Extracted keywords:${colors.reset} ${keywords.join(", ")}`
    );

    if (keywords.length === 0) {
      console.error(`${colors.red}Failed to extract keywords${colors.reset}`);
    }

    const success = summary && keywords.length > 0;
    console.log(
      `\n${
        success ? colors.green + "SUCCESS" : colors.red + "FAILURE"
      } - Document Enrichment Test${colors.reset}`
    );
    return success;
  } catch (error) {
    console.error(`${colors.red}API Error:${colors.reset}`, error);
    return false;
  }
}

/**
 * Test Gemini API for conversation topic extraction
 */
async function testConversationTopics() {
  console.log(
    `${colors.blue}Testing Conversation Topic Extraction${colors.reset}`
  );

  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    console.error(
      `${colors.red}No API key provided. Set GOOGLE_GEMINI_API_KEY in .env${colors.reset}`
    );
    return false;
  }

  // Initialize Gemini with new API
  const ai = new GoogleGenAI({ apiKey: apiKey });

  // Sample conversation
  const conversation = `
User: I'm having trouble implementing the fibonacci sequence efficiently. Can you help?
Assistant: Of course! Here's a simple implementation of the fibonacci sequence:
\`\`\`javascript
function fibonacci(n) {
  if (n <= 1) return n;
  let a = 0, b = 1;
  for (let i = 2; i <= n; i++) {
    const temp = a + b;
    a = b;
    b = temp;
  }
  return b;
}
\`\`\`
This uses an iterative approach which is more efficient than recursion.

User: That's helpful! What's the time complexity of this implementation?
`;

  // Construct prompt for conversation topic extraction
  const prompt = `You are an expert conversation analyst. Below is a conversation between a user and an assistant.
Analyze this conversation and identify the main topics discussed.
For each topic, provide a summary, keywords, and purpose tag.

Conversation Content:
${conversation}

Output format should be:
Topic 1:
Summary: [Brief summary of what this topic covers]
Keywords: [keyword1, keyword2, keyword3]
Purpose Tag: [code_implementation, debugging, problem_solving, discussion, etc.]
Range: [Message range, e.g., Messages 1-2]

Topic 2:
Summary: [Brief summary of what this topic covers]
Keywords: [keyword1, keyword2, keyword3]
Purpose Tag: [code_implementation, debugging, problem_solving, discussion, etc.]
Range: [Message range, e.g., Messages 3-4]`;

  try {
    console.log("Calling Gemini API...");
    const response = await ai.models.generateContent({
      model: process.env.AI_MODEL_NAME || "gemini-2.5-flash-preview-05-20",
      contents: prompt,
      config: {
        temperature: 0.2,
        maxOutputTokens: 4000,
        topP: 0.8,
        topK: 40,
      },
    });

    console.log("Raw response:", response); // Debug output

    // Extract text from the new API response structure
    const responseText =
      response.candidates?.[0]?.content?.parts?.[0]?.text ||
      response.text ||
      response.response?.text ||
      "";

    if (!responseText) {
      console.error(`${colors.red}Empty response from API${colors.reset}`);
      return false;
    }

    console.log("\nResponse:");
    console.log(responseText);

    // Test our parsing logic
    console.log("\nTesting parsing logic:");

    // Extract topics (look for Topic 1:, Topic 2:, etc.)
    const topicMatches = responseText.match(/Topic \d+:/g);
    const topicCount = topicMatches ? topicMatches.length : 0;
    console.log(
      `${colors.blue}Extracted topics count:${colors.reset} ${topicCount}`
    );

    // Try to extract a summary from first topic
    const firstTopicMatch = responseText.match(
      /Topic 1:\s*\n*Summary:\s*(.*?)(?=\n|Keywords:|$)/is
    );
    const summary = firstTopicMatch?.[1]?.trim() || "";
    console.log(
      `${colors.blue}Extracted summary (Topic 1):${colors.reset} ${summary}`
    );

    if (!summary) {
      console.error(`${colors.red}Failed to extract summary${colors.reset}`);
    }

    // Extract keywords from first topic
    const firstTopicKeywordsMatch = responseText.match(
      /Topic 1:.*?Keywords:\s*(.*?)(?=\n|Purpose Tag:|Topic 2:|$)/is
    );
    const keywords =
      firstTopicKeywordsMatch?.[1]
        ?.split(",")
        .map((k) => k.trim())
        .filter(Boolean) || [];
    console.log(
      `${colors.blue}Extracted keywords (Topic 1):${
        colors.reset
      } ${keywords.join(", ")}`
    );

    if (keywords.length === 0) {
      console.error(`${colors.red}Failed to extract keywords${colors.reset}`);
    }

    const success = topicCount > 0 && summary && keywords.length > 0;
    console.log(
      `\n${
        success ? colors.green + "SUCCESS" : colors.red + "FAILURE"
      } - Conversation Topic Extraction Test${colors.reset}`
    );
    return success;
  } catch (error) {
    console.error(`${colors.red}API Error:${colors.reset}`, error);
    return false;
  }
}

// Run the test when this script is executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    try {
      const testType = process.argv[2] || "code";
      let success = false;

      switch (testType) {
        case "code":
          success = await testCodeEntityEnrichment();
          break;
        case "document":
          success = await testDocumentEnrichment();
          break;
        case "conversation":
          success = await testConversationTopics();
          break;
        case "all":
          console.log(`${colors.blue}Running all tests...${colors.reset}\n`);
          const codeSuccess = await testCodeEntityEnrichment();
          console.log("\n" + "=".repeat(80) + "\n");
          const docSuccess = await testDocumentEnrichment();
          console.log("\n" + "=".repeat(80) + "\n");
          const convSuccess = await testConversationTopics();

          success = codeSuccess && docSuccess && convSuccess;
          console.log("\n" + "=".repeat(80));
          console.log(
            `${colors.blue}OVERALL RESULT:${colors.reset} ${
              success
                ? colors.green + "ALL TESTS PASSED"
                : colors.red + "SOME TESTS FAILED"
            }${colors.reset}`
          );
          break;
        default:
          console.log(
            `${colors.yellow}Unknown test type. Use: code, document, conversation, or all${colors.reset}`
          );
          break;
      }

      process.exit(success ? 0 : 1);
    } catch (error) {
      console.error(`${colors.red}Unhandled error:${colors.reset}`, error);
      process.exit(1);
    }
  })();
}

export {
  testCodeEntityEnrichment,
  testDocumentEnrichment,
  testConversationTopics,
};
