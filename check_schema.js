import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config();

const dbClient = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function checkTableSchema() {
  try {
    const conversationHistoryResult = await dbClient.execute({
      sql: `PRAGMA table_info(conversation_history)`,
      args: [],
    });
    console.log("Conversation history table schema:");
    conversationHistoryResult.rows.forEach((row) => {
      console.log(`- ${row.name} (${row.type})`);
    });

    // Check timeline_events table schema
    console.log("\nTimeline events table schema:");
    const timelineEventsResult = await dbClient.execute({
      sql: `PRAGMA table_info(timeline_events)`,
      args: [],
    });
    timelineEventsResult.rows.forEach((row) => {
      console.log(`- ${row.name} (${row.type})`);
    });
  } catch (error) {
    console.error("Error:", error.message);
  }
}

checkTableSchema();
