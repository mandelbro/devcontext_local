/**
 * message-verification.js
 *
 * This example demonstrates how to verify that user messages are being properly
 * stored in the conversation_history table when initializing a conversation context.
 */

import { executeQuery } from "../../src/db.js";
import { v4 as uuidv4 } from "uuid";
import * as ConversationIntelligence from "../../src/logic/ConversationIntelligence.js";

// Helper to print messages in a table-like format
function printMessages(messages) {
  console.log(
    "\n=================== CONVERSATION MESSAGES ==================="
  );
  console.log("ID".padEnd(10) + "| " + "ROLE".padEnd(10) + "| " + "CONTENT");
  console.log("-----------------------------------------------------------");

  messages.forEach((msg) => {
    console.log(
      msg.messageId.substring(0, 8).padEnd(10) +
        "| " +
        msg.role.padEnd(10) +
        "| " +
        (msg.content?.substring(0, 50) +
          (msg.content?.length > 50 ? "..." : ""))
    );
  });
  console.log(
    "==============================================================\n"
  );
}

async function main() {
  try {
    // Create a test conversation ID
    const conversationId = uuidv4();
    console.log(`Created test conversation ID: ${conversationId}`);

    // Test initializing a conversation with a user query
    const initialQuery = "How do I implement background tasks in Node.js?";
    console.log(`Initializing conversation with query: "${initialQuery}"`);

    await ConversationIntelligence.initializeConversation(
      conversationId,
      initialQuery
    );
    console.log("Conversation initialized");

    // Get and print the messages in the conversation
    const messages = await ConversationIntelligence.getConversationHistory(
      conversationId
    );
    printMessages(messages);

    // Verify the user's query was stored as a "user" message
    const userMessages = messages.filter((msg) => msg.role === "user");
    if (
      userMessages.length > 0 &&
      userMessages.some((msg) => msg.content === initialQuery)
    ) {
      console.log(
        '✅ SUCCESS: User message was correctly stored with "user" role'
      );
    } else {
      console.log('❌ ERROR: User message was not found with "user" role');
    }

    // Add another test message using recordMessage
    console.log("\nAdding a new test message...");
    await ConversationIntelligence.recordMessage(
      "This is a test assistant response",
      "assistant",
      conversationId,
      [],
      null
    );

    // Get and print the updated messages
    const updatedMessages =
      await ConversationIntelligence.getConversationHistory(conversationId);
    printMessages(updatedMessages);

    process.exit(0);
  } catch (error) {
    console.error("Error in verification script:", error);
    process.exit(1);
  }
}

// Initialize database and run the test
import { initializeDatabaseSchema } from "../../src/db.js";

console.log("Initializing database schema...");
initializeDatabaseSchema()
  .then(() => main())
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });
