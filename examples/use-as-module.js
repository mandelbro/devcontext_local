/**
 * Example of using DevContext as a module in your own Node.js application
 */

import { startServer, tools } from "devcontext";

// Print available tools
console.log("Available DevContext tools:");
tools.forEach((tool) => {
  console.log(`- ${tool.name}: ${tool.description}`);
});

// Start the server programmatically
// Make sure to set environment variables for TURSO_DATABASE_URL and TURSO_AUTH_TOKEN
async function run() {
  try {
    console.log("Starting DevContext server programmatically...");
    await startServer();
  } catch (error) {
    console.error("Failed to start DevContext server:", error);
    process.exit(1);
  }
}

// Only run the server if this file is executed directly
if (
  import.meta.url ===
  (typeof process !== "undefined" &&
    process.argv[1] &&
    new URL(`file://${process.argv[1]}`).href)
) {
  run();
}
