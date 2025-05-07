#!/usr/bin/env node

/**
 * index.js
 *
 * Main entry point for DevContext CLI and module.
 * This file is used when:
 * 1. The package is run directly from the command line (npx devcontext)
 * 2. The package is required/imported as a module
 */

// Load environment variables from .env file if present
import "dotenv/config";
import { fileURLToPath } from "url";

// Export the public API for when the package is imported as a module
export { startServer } from "./dist/mcp-server.bundle.js";
export { default as tools } from "./src/tools/index.js";

// Determine if this is being run directly or imported as a module
const isMainModule =
  import.meta.url ===
  (typeof process !== "undefined" &&
    process.argv[1] &&
    new URL(`file://${process.argv[1]}`).href);

if (isMainModule) {
  // This is the CLI entry point - run the bundled server
  import("./dist/mcp-server.bundle.js").catch((err) => {
    console.error("Failed to start DevContext server:", err);
    process.exit(1);
  });
}
