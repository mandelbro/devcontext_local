// Test direct parameter passing for MCP tools
import { createClient } from "@libsql/client";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

// Function to get DB client
function getDbClient() {
  if (!TURSO_DATABASE_URL) {
    throw new Error(
      "TURSO_DATABASE_URL is not defined in environment variables"
    );
  }

  if (!TURSO_AUTH_TOKEN) {
    throw new Error("TURSO_AUTH_TOKEN is not defined in environment variables");
  }

  return createClient({
    url: TURSO_DATABASE_URL,
    authToken: TURSO_AUTH_TOKEN,
  });
}

// The conversation ID we want to test - using the most recent one
const testConversationId = "71a02e89-ae95-4e90-b30a-b1e65d02a9c8";

// Function to query the database
async function checkConversation(conversationId) {
  try {
    const client = getDbClient();
    console.log("Database client created");

    // Query the conversation_history table for our conversation ID
    const result = await client.execute({
      sql: "SELECT * FROM conversation_history WHERE conversation_id = ?",
      args: [conversationId],
    });

    console.log(
      `Found ${
        result.rows?.length || 0
      } messages for conversation ID: ${conversationId}`
    );

    if (result.rows && result.rows.length > 0) {
      // Display the messages
      result.rows.forEach((row, i) => {
        console.log(`\nMessage ${i + 1}:`);
        console.log(`  Role: ${row.role}`);
        console.log(`  Content: ${row.content}`);
        console.log(`  Timestamp: ${row.timestamp}`);

        // Try to parse related_context_entity_ids if it exists
        if (row.related_context_entity_ids) {
          try {
            const entities = JSON.parse(row.related_context_entity_ids);
            console.log(`  Related Entities: ${entities.length}`);
          } catch (e) {
            console.log(`  Related Entities: Could not parse`);
          }
        }
      });
    } else {
      console.log("No messages found for this conversation ID");
    }

    // Also check if any query parameters were stored in the system_logs table
    console.log("\nChecking system logs for parameter information:");
    const logsResult = await client.execute({
      sql: "SELECT * FROM system_logs WHERE data LIKE ? ORDER BY timestamp DESC LIMIT 10",
      args: [`%${conversationId}%`],
    });

    if (logsResult.rows && logsResult.rows.length > 0) {
      logsResult.rows.forEach((log, i) => {
        console.log(`\nLog ${i + 1}:`);
        console.log(`  Level: ${log.level}`);
        console.log(`  Message: ${log.message}`);
        console.log(`  Timestamp: ${log.timestamp}`);
        console.log(`  Data: ${log.data}`);
      });
    } else {
      console.log("No relevant logs found");
    }
  } catch (error) {
    console.error("Database query error:", error);
  }
}

// Check the conversation
console.log(`\nChecking conversation: ${testConversationId}`);
checkConversation(testConversationId).catch(console.error);
