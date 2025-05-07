/**
 * debug_db.js
 *
 * A debugging script to examine the format of results returned by executeQuery
 */

import { executeQuery } from "./src/db.js";

async function debugDatabase() {
  console.log("=".repeat(80));
  console.log("DEBUGGING DATABASE QUERY RESULTS FORMAT");
  console.log("=".repeat(80));

  try {
    // Execute a simple query
    const simpleQuery = `SELECT * FROM conversation_history LIMIT 1`;
    const result = await executeQuery(simpleQuery);

    console.log("\nExecuteQuery raw result format:");
    console.log(JSON.stringify(result, null, 2));

    // Check rows property
    console.log("\nRows property exists?", result.rows !== undefined);

    if (result.rows) {
      console.log("Rows is an array?", Array.isArray(result.rows));
      console.log("Rows length:", result.rows.length);

      if (result.rows.length > 0) {
        console.log("\nSample row structure:");
        console.log(JSON.stringify(result.rows[0], null, 2));
      }
    } else {
      console.log("\nResult itself is an array?", Array.isArray(result));
      console.log("Result length:", result.length);

      if (result.length > 0) {
        console.log("\nSample result item structure:");
        console.log(JSON.stringify(result[0], null, 2));
      }
    }

    // Test with map to see what happens
    console.log("\nTrying to map over result vs result.rows:");
    try {
      const mapped = result.map((item) => item.message_id);
      console.log("Mapping result directly succeeded:", mapped.length);
    } catch (err) {
      console.log("Mapping result directly failed:", err.message);
    }

    try {
      if (result.rows) {
        const mapped = result.rows.map((item) => item.message_id);
        console.log("Mapping result.rows succeeded:", mapped.length);
      } else {
        console.log("result.rows doesn't exist, cannot map");
      }
    } catch (err) {
      console.log("Mapping result.rows failed:", err.message);
    }
  } catch (error) {
    console.error("Error during database debugging:", error);
  }
}

debugDatabase().catch((err) => {
  console.error("Fatal error:", err);
});
