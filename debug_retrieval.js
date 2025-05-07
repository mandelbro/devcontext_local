/**
 * debug_retrieval.js
 *
 * A script to debug the context retrieval mechanism.
 */

import { executeQuery } from "./src/db.js";
import * as ConversationIntelligence from "./src/logic/ConversationIntelligence.js";
import * as SmartSearchServiceLogic from "./src/logic/SmartSearchServiceLogic.js";
import * as InsightEngine from "./src/logic/InsightEngine.js";

const CONVERSATION_ID =
  process.argv[2] || "3cedd960-2c0e-41e3-b2d1-cac23123b1ea";
const QUERY = "Testing database operations after adding debugging";

// Run the debug tests
async function runDebug() {
  console.log("=".repeat(80));
  console.log(`DEBUGGING RETRIEVAL FOR CONVERSATION: ${CONVERSATION_ID}`);
  console.log("=".repeat(80));

  try {
    // 1. Check if the conversation exists
    console.log("\n1. CHECKING CONVERSATION EXISTENCE");
    const conversationQuery = `
      SELECT * FROM conversation_history 
      WHERE conversation_id = ?
    `;

    const conversationResults = await executeQuery(conversationQuery, [
      CONVERSATION_ID,
    ]);
    console.log(`Found ${conversationResults?.rows?.length || 0} messages`);

    if (conversationResults?.rows?.length > 0) {
      console.log("Sample messages:");
      conversationResults.rows.slice(0, 3).forEach((msg) => {
        console.log(`- [${msg.role}]: ${msg.content?.substring(0, 50)}...`);
      });
    } else {
      console.log("No messages found for this conversation ID!");
    }

    // 2. Check conversation history API
    console.log("\n2. CHECKING CONVERSATION HISTORY API");
    const historyResults =
      await ConversationIntelligence.getConversationHistory(
        CONVERSATION_ID,
        20
      );
    console.log(`API returned ${historyResults?.length || 0} messages`);

    if (historyResults?.length > 0) {
      console.log("Sample messages from API:");
      historyResults.slice(0, 3).forEach((msg) => {
        console.log(`- [${msg.role}]: ${msg.content?.substring(0, 50)}...`);
      });
    }

    // 3. Check getRelevantConversationContext
    console.log("\n3. CHECKING RELEVANT CONVERSATION CONTEXT API");
    const relevantContext =
      await ConversationIntelligence.getRelevantConversationContext(
        QUERY,
        CONVERSATION_ID,
        { purposeFilter: true, topicFilter: false, limit: 5 }
      );

    console.log(
      `API returned ${relevantContext?.length || 0} relevant messages`
    );

    if (relevantContext?.length > 0) {
      console.log("Relevant messages:");
      relevantContext.forEach((msg) => {
        console.log(
          `- [${msg.role}] Relevance: ${
            msg.relevance?.toFixed(2) || "N/A"
          }: ${msg.content?.substring(0, 50)}...`
        );
      });
    }

    // 4. Check orchestrated retrieval
    console.log("\n4. CHECKING ORCHESTRATED RETRIEVAL");
    const conversationHistory =
      await ConversationIntelligence.getConversationHistory(CONVERSATION_ID, 5);
    const retrievedSnippets = await InsightEngine.orchestrateRetrieval(
      QUERY,
      conversationHistory,
      null,
      2000,
      {}
    );

    console.log(
      `Orchestrated retrieval returned ${
        retrievedSnippets?.length || 0
      } snippets`
    );

    if (retrievedSnippets?.length > 0) {
      console.log("Sample snippets:");
      retrievedSnippets.slice(0, 3).forEach((snippet) => {
        console.log(
          `- Type: ${snippet.type}, Score: ${
            snippet.originalScore?.toFixed(2) || "N/A"
          }`
        );
        console.log(
          `  Content preview: ${snippet.summarizedContent?.substring(0, 50)}...`
        );
      });
    }

    console.log("\nDEBUGGING COMPLETE");
  } catch (error) {
    console.error("Error during debugging:", error);
  }
}

// Execute the debug process
runDebug().catch((err) => {
  console.error("Fatal error:", err);
});
