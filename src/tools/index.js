/**
 * tools/index.js
 *
 * Aggregates and exports all MCP tool definitions for registration with the MCP server.
 */

import initializeConversationContextTool from "./initializeConversationContext.tool.js";
import updateConversationContextTool from "./updateConversationContext.tool.js";
import retrieveRelevantContextTool from "./retrieveRelevantContext.tool.js";
import recordMilestoneContextTool from "./recordMilestoneContext.tool.js";
import finalizeConversationContextTool from "./finalizeConversationContext.tool.js";

const allTools = [
  initializeConversationContextTool,
  updateConversationContextTool,
  retrieveRelevantContextTool,
  recordMilestoneContextTool,
  finalizeConversationContextTool,
];

export default allTools;
