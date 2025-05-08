/**
 * Script to check code entities in the database
 *
 * This script queries the code_entities table and displays information about
 * the importance scores, summaries, and content hashes for specific test files.
 */

import { executeQuery } from "./src/db.js";

// Files to check
const TEST_FILES = [
  "test_files/simple_function.js",
  "test_files/complex_class.js",
  "test_files/refactored_file.js",
  "test_files/edge_case.js",
];

/**
 * Get code entities for a file path
 *
 * @param {string} filePath - Path to the file
 * @returns {Promise<Array>} - Array of code entities
 */
async function getCodeEntities(filePath) {
  const query = `
    SELECT 
      entity_id, 
      entity_type, 
      name, 
      importance_score, 
      content_hash, 
      summary,
      last_modified_at,
      last_accessed_at
    FROM code_entities 
    WHERE file_path = ?
    ORDER BY entity_type, name
  `;

  const result = await executeQuery(query, [filePath]);
  return result.rows || [];
}

/**
 * Display entity information in a formatted way
 *
 * @param {Array} entities - Array of code entities
 * @param {string} filePath - Path to the file
 */
function displayEntities(entities, filePath) {
  console.log(`\n=== Entities for ${filePath} ===`);

  if (entities.length === 0) {
    console.log("No entities found for this file");
    return;
  }

  console.log(`Found ${entities.length} entities:`);

  // Get file entity
  const fileEntity = entities.find((e) => e.entity_type === "file");
  if (fileEntity) {
    console.log("\nFile Entity:");
    console.log(`  ID: ${fileEntity.entity_id}`);
    console.log(`  Name: ${fileEntity.name}`);
    console.log(`  Importance Score: ${fileEntity.importance_score}`);
    console.log(`  Content Hash: ${fileEntity.content_hash}`);
    console.log(`  Summary: ${fileEntity.summary || "N/A"}`);
    console.log(`  Last Modified: ${fileEntity.last_modified_at}`);
    console.log(`  Last Accessed: ${fileEntity.last_accessed_at || "N/A"}`);
  }

  // Get non-file entities
  const otherEntities = entities.filter((e) => e.entity_type !== "file");

  if (otherEntities.length > 0) {
    console.log("\nOther Entities:");
    otherEntities.forEach((entity, index) => {
      console.log(`\n  ${index + 1}. ${entity.entity_type}: ${entity.name}`);
      console.log(`     Importance Score: ${entity.importance_score}`);
      console.log(
        `     Content Hash: ${
          entity.content_hash
            ? entity.content_hash.substring(0, 16) + "..."
            : "N/A"
        }`
      );
      console.log(
        `     Summary: ${
          entity.summary
            ? entity.summary.length > 60
              ? entity.summary.substring(0, 60) + "..."
              : entity.summary
            : "N/A"
        }`
      );
    });
  }

  // Calculate importance score statistics
  if (entities.length > 0) {
    const scores = entities.map((e) => parseFloat(e.importance_score) || 0);
    const avg = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const max = Math.max(...scores);
    const min = Math.min(...scores);

    console.log("\nImportance Score Statistics:");
    console.log(`  Average: ${avg.toFixed(2)}`);
    console.log(`  Maximum: ${max.toFixed(2)}`);
    console.log(`  Minimum: ${min.toFixed(2)}`);
  }
}

/**
 * Main function to run the script
 */
async function main() {
  try {
    console.log("Checking code entities for test files...");

    for (const filePath of TEST_FILES) {
      try {
        const entities = await getCodeEntities(filePath);
        displayEntities(entities, filePath);
      } catch (error) {
        console.error(`Error checking entities for ${filePath}:`, error);
      }
    }

    console.log("\nCheck completed.");
  } catch (error) {
    console.error("Error running the check:", error);
  }
}

// Run the script
main().catch((error) => {
  console.error("Unhandled error:", error);
});
