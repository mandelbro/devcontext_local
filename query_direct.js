import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config();

const dbClient = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function queryConversationHistoryDirectly() {
  try {
    const result = await dbClient.execute({
      sql: "SELECT * FROM conversation_history WHERE conversation_id = ?",
      args: ["74829c9d-1c8e-4090-8d98-110144471622"],
    });
    console.log("Raw query results:", JSON.stringify(result.rows, null, 2));
  } catch (error) {
    console.error("Error:", error.message);
  }
}

queryConversationHistoryDirectly();
