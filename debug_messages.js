import { createClient } from "@libsql/client";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";
import * as ConversationIntelligence from "./src/logic/ConversationIntelligence.js";
import * as ContextIndexerLogic from "./src/logic/ContextIndexerLogic.js";

dotenv.config();

const dbClient = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function debugMessageStorage() {
  try {
    // Generate a test conversation ID
    const conversationId = "3fc33b41-d8e9-4a4c-b061-26e36435cf77"; // Reuse the existing conversation ID

    // Test direct message storage
    const userMessageId = uuidv4();
    await ConversationIntelligence.recordMessage(
      "This is a test user message",
      "user",
      conversationId,
      [],
      null
    );

    const assistantMessageId = uuidv4();
    await ConversationIntelligence.recordMessage(
      "This is a test assistant response",
      "assistant",
      conversationId,
      [],
      null
    );

    console.log("Messages recorded successfully");

    // Check if the messages were stored correctly
    const result = await dbClient.execute({
      sql: `SELECT role, content FROM conversation_history 
            WHERE conversation_id = ? 
            ORDER BY timestamp DESC LIMIT 5`,
      args: [conversationId],
    });

    console.log("Recent messages in the database:");
    result.rows.forEach((msg) => {
      console.log(
        `- [${msg.role}]: ${msg.content.substring(0, 50)}${
          msg.content.length > 50 ? "..." : ""
        }`
      );
    });
  } catch (error) {
    console.error("Error:", error);
  }
}

debugMessageStorage();
