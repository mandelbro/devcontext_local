/**
 * MCP Handlers Index
 *
 * Centralizes all MCP tool handler exports for easy import into main.js
 * This file will import and re-export all MCP handlers as they are added
 */

import { pingServerHandler } from "./pingServer.handler.js";
import { initializeConversationContextHandler } from "./initializeConversationContext.handler.js";
import { retrieveRelevantContextHandler } from "./retrieveRelevantContext.handler.js";

// Export individual handlers
export {
  pingServerHandler,
  initializeConversationContextHandler,
  retrieveRelevantContextHandler,
};

// Export default object with all handlers for convenient import
export default {
  pingServerHandler,
  initializeConversationContextHandler,
  retrieveRelevantContextHandler,
};
