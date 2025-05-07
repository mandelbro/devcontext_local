import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config();

const dbClient = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function checkNewMessageStatus() {
  try {
    // 1. Count records by role
    const roleCountResult = await dbClient.execute({
      sql: `SELECT role, COUNT(*) as count FROM conversation_history 
            WHERE conversation_id = ? GROUP BY role`,
      args: ["74829c9d-1c8e-4090-8d98-110144471622"],
    });

    console.log("Message counts by role:");
    roleCountResult.rows.forEach((row) => {
      console.log(`- ${row.role}: ${row.count}`);
    });

    // 2. Check update_conversation_context messages
    console.log("\nMost recent messages:");
    const recentMessagesResult = await dbClient.execute({
      sql: `SELECT message_id, role, content, timestamp 
            FROM conversation_history 
            WHERE conversation_id = ? 
            ORDER BY timestamp DESC LIMIT 5`,
      args: ["74829c9d-1c8e-4090-8d98-110144471622"],
    });

    recentMessagesResult.rows.forEach((msg) => {
      console.log(
        `- ${msg.timestamp} [${msg.role}]: ${msg.content.substring(0, 50)}${
          msg.content.length > 50 ? "..." : ""
        }`
      );
    });
  } catch (error) {
    console.error("Error:", error.message);
  }
}

checkNewMessageStatus();
