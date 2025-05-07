import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config();

const dbClient = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function checkConversationCount() {
  try {
    const result = await dbClient.execute({
      sql: "SELECT COUNT(*) as count FROM conversation_history WHERE conversation_id = ?",
      args: ["74829c9d-1c8e-4090-8d98-110144471622"],
    });
    console.log("Message count:", result.rows[0].count);
  } catch (error) {
    console.error("Error:", error.message);
  }
}

checkConversationCount();
