// Script to check system logs
import { executeQuery } from "./src/db.js";

async function checkLogs() {
  try {
    // Query recent system logs
    const result = await executeQuery(
      "SELECT * FROM system_logs ORDER BY timestamp DESC LIMIT 20"
    );

    if (result && result.rows && result.rows.length > 0) {
      result.rows.forEach((log, i) => {
        console.log(`\nLog ${i + 1}:`);
        console.log(`  Level: ${log.level}`);
        console.log(`  Message: ${log.message}`);
        console.log(`  Timestamp: ${log.timestamp}`);
        if (log.data) console.log(`  Data: ${log.data}`);
      });
    } else {
      console.log("No logs found");
    }
  } catch (error) {
    console.error("Error querying logs:", error);
  }
}

// Check tool parameters in conversation history
async function checkToolParameters() {
  try {
    console.log("\nCHECKING TOOL PARAMETERS:");
    // Get the last 5 conversation IDs
    const convResult = await executeQuery(
      `SELECT DISTINCT conversation_id 
       FROM conversation_history 
       ORDER BY timestamp DESC 
       LIMIT 5`
    );

    if (convResult && convResult.rows && convResult.rows.length > 0) {
      for (const row of convResult.rows) {
        console.log(`\nConversation: ${row.conversation_id}`);

        // Get system message for this conversation
        const msgResult = await executeQuery(
          `SELECT * FROM conversation_history 
           WHERE conversation_id = ? AND role = 'system' 
           ORDER BY timestamp ASC LIMIT 1`,
          [row.conversation_id]
        );

        if (msgResult && msgResult.rows && msgResult.rows.length > 0) {
          const msg = msgResult.rows[0];
          console.log(`  Initial message: ${msg.content}`);
        } else {
          console.log("  No system message found");
        }
      }
    } else {
      console.log("No conversations found");
    }
  } catch (error) {
    console.error("Error checking tool parameters:", error);
  }
}

// Run both checks
async function main() {
  await checkLogs();
  await checkToolParameters();
}

main().catch(console.error);
