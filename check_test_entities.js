/**
 * Script to check code entities in the database for our new test files
 *
 * This script queries the code_entities table and displays information about
 * all entities created from our new test files.
 */

import { executeQuery } from "./src/db.js";

// Files to check
const TEST_FILES = [
  "test_files/test_simple.js",
  "test_files/test_class.js",
  "test_files/test_complex.js",
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
      last_accessed_at,
      parent_entity_id
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

  // Group entities by type
  const fileEntities = entities.filter((e) => e.entity_type === "file");
  const classEntities = entities.filter((e) => e.entity_type === "class");
  const functionEntities = entities.filter((e) => e.entity_type === "function");
  const methodEntities = entities.filter((e) => e.entity_type === "method");
  const otherEntities = entities.filter(
    (e) => !["file", "class", "function", "method"].includes(e.entity_type)
  );

  // Display file entities
  if (fileEntities.length > 0) {
    console.log("\nFile Entities:");
    fileEntities.forEach((entity) => {
      console.log(`  ID: ${entity.entity_id}`);
      console.log(`  Name: ${entity.name}`);
      console.log(`  Importance Score: ${entity.importance_score}`);
      console.log(`  Content Hash: ${entity.content_hash}`);
      console.log(`  Summary: ${entity.summary || "N/A"}`);
      console.log(`  Last Modified: ${entity.last_modified_at}`);
    });
  }

  // Display class entities
  if (classEntities.length > 0) {
    console.log("\nClass Entities:");
    classEntities.forEach((entity, index) => {
      console.log(`\n  ${index + 1}. Class: ${entity.name}`);
      console.log(`     ID: ${entity.entity_id}`);
      console.log(`     Parent ID: ${entity.parent_entity_id || "N/A"}`);
      console.log(`     Importance Score: ${entity.importance_score}`);
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

  // Display function entities
  if (functionEntities.length > 0) {
    console.log("\nFunction Entities:");
    functionEntities.forEach((entity, index) => {
      console.log(`\n  ${index + 1}. Function: ${entity.name}`);
      console.log(`     ID: ${entity.entity_id}`);
      console.log(`     Parent ID: ${entity.parent_entity_id || "N/A"}`);
      console.log(`     Importance Score: ${entity.importance_score}`);
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

  // Display method entities
  if (methodEntities.length > 0) {
    console.log("\nMethod Entities:");
    methodEntities.forEach((entity, index) => {
      console.log(`\n  ${index + 1}. Method: ${entity.name}`);
      console.log(`     ID: ${entity.entity_id}`);
      console.log(`     Parent ID: ${entity.parent_entity_id || "N/A"}`);
      console.log(`     Importance Score: ${entity.importance_score}`);
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

  // Display other entities
  if (otherEntities.length > 0) {
    console.log("\nOther Entities:");
    otherEntities.forEach((entity, index) => {
      console.log(`\n  ${index + 1}. ${entity.entity_type}: ${entity.name}`);
      console.log(`     ID: ${entity.entity_id}`);
      console.log(`     Parent ID: ${entity.parent_entity_id || "N/A"}`);
      console.log(`     Importance Score: ${entity.importance_score}`);
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

  // Count entity types
  console.log("\nEntity Type Distribution:");
  console.log(`  Files: ${fileEntities.length}`);
  console.log(`  Classes: ${classEntities.length}`);
  console.log(`  Functions: ${functionEntities.length}`);
  console.log(`  Methods: ${methodEntities.length}`);
  console.log(`  Other: ${otherEntities.length}`);
}

/**
 * Main function to run the script
 */
async function main() {
  try {
    console.log("Checking code entities for new test files...");

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
