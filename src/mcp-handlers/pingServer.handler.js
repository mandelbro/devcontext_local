/**
 * Ping Server MCP Tool Handler
 *
 * Simple handler that responds with a pong message and current timestamp.
 * Used to verify that the server is running and responding to MCP tools.
 */

/**
 * Handler for the ping_server MCP tool
 * This function is not used directly but serves as a reference for the implementation.
 * The actual implementation is now inline in src/main.js
 * @returns {Object} Response object with properly formatted MCP content
 */
export async function pingServerHandler() {
  // Create the response payload
  const responsePayload = {
    response: "pong",
    timestamp: new Date().toISOString(),
  };

  // Return formatted as MCP content
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(responsePayload),
      },
    ],
  };
}

export default pingServerHandler;
