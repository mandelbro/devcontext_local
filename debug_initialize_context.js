/**
 * debug_initialize_context.js
 *
 * A script to debug the initialize_conversation_context tool
 */

import * as mcpToolsModule from "./src/tools/mcpDevContextTools.js";
import * as initializeConversationContext from "./src/tools/initializeConversationContext.tool.js";
import * as SmartSearchServiceLogic from "./src/logic/SmartSearchServiceLogic.js";
import { executeQuery } from "./src/db.js";
import { v4 as uuidv4 } from "uuid";
import { logMessage } from "./src/utils/logger.js";

// Enable verbose debugging
process.env.DEBUG_LEVEL = "verbose";

async function debugInitializeContext() {
  console.log("=".repeat(80));
  console.log("DEBUGGING INITIALIZE_CONVERSATION_CONTEXT TOOL");
  console.log("=".repeat(80));

  try {
    // 1. Extract the tool function
    const toolFunction = initializeConversationContext.default.handler;
    console.log("\n1. OBTAINED TOOL HANDLER:", !!toolFunction);

    // 2. Create test parameters
    const conversationId = uuidv4();
    const params = {
      contextDepth: "standard",
      initialQuery: "Test debugging the initialize_conversation_context tool",
      includeArchitecture: true,
      includeRecentConversations: true,
      maxCodeContextItems: 5,
      tokenBudget: 4000,
    };

    console.log("\n2. TEST PARAMETERS:");
    console.log(JSON.stringify(params, null, 2));
    console.log("Conversation ID:", conversationId);

    // 3. Create a mock SDK context
    const mockSdkContext = {
      signal: {},
      requestId: "debug_" + Date.now(),
    };

    // 4. Add conversation ID to global store (if the tool expects it there)
    if (mcpToolsModule.setGlobalConversationId) {
      mcpToolsModule.setGlobalConversationId(conversationId);
      console.log("\n3. SET GLOBAL CONVERSATION ID:", conversationId);
    } else {
      console.log("\n3. WARNING: setGlobalConversationId function not found");
    }

    // 5. Check database connection
    console.log("\n4. CHECKING DATABASE CONNECTION:");
    try {
      const dbTest = await executeQuery("SELECT 1 as test");
      console.log("Database connection successful:", !!dbTest);
    } catch (dbError) {
      console.error("Database connection failed:", dbError.message);
    }

    // 6. Test SmartSearchServiceLogic directly
    console.log("\n5. TESTING SMARTSEARCHSERVICELOGIC DIRECTLY:");
    try {
      console.log(
        "A. Checking if code_entities and code_entities_fts tables exist:"
      );
      const tablesQuery = `
        SELECT name FROM sqlite_master 
        WHERE type='table' AND (name='code_entities' OR name='code_entities_fts' OR name='entity_keywords')
      `;
      const tablesResult = await executeQuery(tablesQuery);
      console.log(
        "Tables found:",
        tablesResult && tablesResult.rows
          ? tablesResult.rows.map((row) => row.name).join(", ")
          : "None"
      );

      // Check if tables are empty
      console.log("\nB. Checking if code_entities table has any data:");
      const countQuery = "SELECT COUNT(*) as count FROM code_entities";
      try {
        const countResult = await executeQuery(countQuery);
        const count =
          countResult && countResult.rows && countResult.rows[0]
            ? countResult.rows[0].count
            : 0;
        console.log(`code_entities table has ${count} rows`);
      } catch (err) {
        console.log("Error checking code_entities count:", err.message);
      }

      // Test direct keyword search
      console.log("\nC. Testing searchByKeywords directly:");
      const searchTerms = ["README", "main", "index", "config"];
      console.log(`Searching for keywords: ${searchTerms.join(", ")}`);

      try {
        const searchResults = await SmartSearchServiceLogic.searchByKeywords(
          searchTerms,
          { limit: 5 }
        );

        console.log(
          `Search returned ${searchResults ? searchResults.length : 0} results`
        );

        if (searchResults && searchResults.length > 0) {
          console.log("First result:", {
            entity_id: searchResults[0].entity.entity_id,
            entity_type: searchResults[0].entity.entity_type,
            file_path: searchResults[0].entity.file_path,
            name: searchResults[0].entity.name,
            relevanceScore: searchResults[0].relevanceScore,
          });
        }
      } catch (searchError) {
        console.error("Search error:", searchError.message);
        console.error(searchError.stack);
      }

      // Check the structure of the searchUsingFTS SQL query
      console.log("\nD. Testing searchUsingFTS SQL query directly:");
      try {
        // Do a direct query to test the FTS table
        const testFtsQuery = `
          SELECT
            e.*,
            fts.rank as relevance_score
          FROM
            code_entities_fts fts
          JOIN
            code_entities e ON fts.rowid = e.rowid
          WHERE
            fts.code_entities_fts MATCH ?
          LIMIT 5
        `;

        const ftsResult = await executeQuery(testFtsQuery, [
          "README OR main OR index OR config",
        ]);
        console.log(
          `Direct FTS query returned ${
            ftsResult && ftsResult.rows ? ftsResult.rows.length : 0
          } results`
        );
      } catch (ftsError) {
        console.error("FTS query error:", ftsError.message);
      }

      // Test alternate query to see if entities exist
      console.log("\nE. Testing alternative direct SQL query:");
      try {
        const simpleQuery = "SELECT * FROM code_entities LIMIT 5";
        const simpleResult = await executeQuery(simpleQuery);
        console.log(
          `Simple query returned ${
            simpleResult && simpleResult.rows ? simpleResult.rows.length : 0
          } results`
        );

        if (simpleResult && simpleResult.rows && simpleResult.rows.length > 0) {
          console.log("Sample entity:", {
            entity_id: simpleResult.rows[0].entity_id,
            entity_type: simpleResult.rows[0].entity_type,
            name: simpleResult.rows[0].name,
          });
        }
      } catch (simpleError) {
        console.error("Simple query error:", simpleError.message);
      }
    } catch (searchLogicError) {
      console.error(
        "Error testing SmartSearchServiceLogic:",
        searchLogicError.message
      );
      console.error(searchLogicError.stack);
    }

    // 7. Execute the tool function
    console.log("\n6. EXECUTING TOOL FUNCTION:");
    const startTime = Date.now();
    try {
      const result = await toolFunction(params, mockSdkContext);
      const endTime = Date.now();

      console.log(`Tool execution completed in ${endTime - startTime}ms`);
      console.log("\n7. TOOL RESULT:");
      console.log(JSON.stringify(result, null, 2));

      // 8. Parse and analyze the result
      console.log("\n8. ANALYZING RESULT:");
      if (
        result &&
        result.content &&
        result.content[0] &&
        result.content[0].text
      ) {
        try {
          const parsed = JSON.parse(result.content[0].text);
          console.log("Result structure valid: true");

          // Check if context is missing
          const hasCodeContext =
            parsed.comprehensiveContext &&
            Array.isArray(parsed.comprehensiveContext.codeContext) &&
            parsed.comprehensiveContext.codeContext.length > 0;

          console.log("Has code context:", hasCodeContext);

          const hasOtherContext =
            parsed.comprehensiveContext &&
            (parsed.comprehensiveContext.architectureContext ||
              parsed.comprehensiveContext.projectStructure ||
              parsed.comprehensiveContext.recentConversations?.length > 0 ||
              parsed.comprehensiveContext.recentChanges?.length > 0 ||
              parsed.comprehensiveContext.activeWorkflows?.length > 0 ||
              parsed.comprehensiveContext.globalPatterns?.length > 0);

          console.log("Has other context types:", hasOtherContext);

          // Check for specific failures
          if (!hasCodeContext && !hasOtherContext) {
            console.log("\nPROBLEM DETECTED: No context returned");
            console.log(
              "This may indicate issues with context retrieval functions"
            );
          }
        } catch (parseError) {
          console.error("Result structure invalid:", parseError.message);
        }
      } else {
        console.error("Result missing expected properties");
      }
    } catch (toolError) {
      console.error("Tool execution failed:", toolError);
      console.error(toolError.stack);
    }

    console.log("\nDEBUGGING COMPLETE");
  } catch (error) {
    console.error("Fatal error during debugging:", error);
    console.error(error.stack);
  }
}

// Execute the debug process
debugInitializeContext().catch(console.error);
