/**
 * Test script for code entity processing in the MCP server
 *
 * This script tests the code entity processing system by sending code changes
 * to the update_conversation_context tool and analyzing the results.
 */

import fs from "fs";
import path from "path";
import { executeQuery } from "./src/db.js";
import updateConversationContextTool from "./src/tools/updateConversationContext.tool.js";

// Get the handler from the tool's default export
const updateConversationContextHandler = updateConversationContextTool.handler;

// Create a mock conversation ID for testing
const TEST_CONVERSATION_ID = "test-conversation-" + Date.now();

// Test files to process
const TEST_FILES = [
  "test_files/simple_function.js",
  "test_files/complex_class.js",
  "test_files/refactored_file.js",
  "test_files/edge_case.js",
];

/**
 * Read the content of a file
 *
 * @param {string} filePath - Path to the file
 * @returns {string} File content
 */
function readFileContent(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

/**
 * Get code entities from database for a specific file
 *
 * @param {string} filePath - Path to the file
 * @returns {Promise<Array>} Code entities
 */
async function getCodeEntitiesForFile(filePath) {
  const query = `
    SELECT entity_id, file_path, entity_type, name, content_hash, 
           summary, importance_score, start_line, end_line 
    FROM code_entities 
    WHERE file_path = ?
    ORDER BY entity_type, name
  `;

  const result = await executeQuery(query, [filePath]);
  return result.rows || [];
}

/**
 * Process a file through the update_conversation_context tool
 *
 * @param {string} filePath - Path to the file to process
 * @returns {Promise<object>} Processing result
 */
async function processFile(filePath) {
  const fileContent = readFileContent(filePath);
  const codeChange = {
    filePath,
    newContent: fileContent,
    languageHint: "javascript",
  };

  const input = {
    conversationId: TEST_CONVERSATION_ID,
    codeChanges: [codeChange],
    preserveContextOnTopicShift: true,
    contextIntegrationLevel: "balanced",
    trackIntentTransitions: true,
  };

  console.log(`\n=== Processing ${filePath} ===`);

  // Get database state before processing
  console.log("Getting entities before processing...");
  const entitiesBefore = await getCodeEntitiesForFile(filePath);

  // Call the handler directly (bypassing API layer)
  console.log("Calling update_conversation_context handler...");
  const result = await updateConversationContextHandler(input, {});

  // Get database state after processing
  console.log("Getting entities after processing...");
  const entitiesAfter = await getCodeEntitiesForFile(filePath);

  return {
    filePath,
    result,
    entitiesBefore,
    entitiesAfter,
  };
}

/**
 * Display the results of processing a file
 *
 * @param {object} processResult - Result of processing
 */
function displayResults(processResult) {
  const { filePath, entitiesBefore, entitiesAfter } = processResult;

  console.log(`\n=== Results for ${filePath} ===`);

  // Show entity counts
  console.log(`Entities before: ${entitiesBefore.length}`);
  console.log(`Entities after: ${entitiesAfter.length}`);

  // Show all entities after processing
  console.log("\nEntities after processing:");
  entitiesAfter.forEach((entity) => {
    console.log(`  • ${entity.entity_type}: ${entity.name || "[unnamed]"}`);
    console.log(`    - Importance score: ${entity.importance_score}`);
    console.log(
      `    - Content hash: ${entity.content_hash?.substring(0, 10)}...`
    );
    console.log(
      `    - Summary: ${
        entity.summary
          ? entity.summary.length > 50
            ? entity.summary.substring(0, 50) + "..."
            : entity.summary
          : "[none]"
      }`
    );
    console.log("");
  });

  // Show importance score statistics for this file
  if (entitiesAfter.length > 0) {
    const scores = entitiesAfter.map(
      (e) => parseFloat(e.importance_score) || 0
    );
    const avg = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const max = Math.max(...scores);
    const min = Math.min(...scores);

    console.log("\nImportance score statistics:");
    console.log(`  Average: ${avg.toFixed(2)}`);
    console.log(`  Maximum: ${max.toFixed(2)}`);
    console.log(`  Minimum: ${min.toFixed(2)}`);
  }
}

/**
 * Run the test
 */
async function runTest() {
  try {
    console.log("Starting code entity processing test");

    // Process each test file
    for (const filePath of TEST_FILES) {
      try {
        const result = await processFile(filePath);
        displayResults(result);
      } catch (error) {
        console.error(`Error processing ${filePath}:`, error);
      }
    }

    console.log("\nTest completed successfully");
  } catch (error) {
    console.error("Test failed:", error);
  }
}

// Run the test
runTest().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
