# Integrating DevContext with Cursor IDE

DevContext can be easily integrated with Cursor IDE to provide enhanced context awareness for AI assistants.

## Setup Steps

1. Install DevContext globally or in your project:

```bash
# Global installation
npm install -g devcontext

# Project installation
npm install --save-dev devcontext
```

2. Configure TursoDB:

```bash
# Install Turso CLI (if you haven't already)
curl -sSfL https://get.turso.tech/install.sh | bash

# Login to Turso
turso auth login

# Create a database
turso db create my-project-context

# Get database URL
turso db show my-project-context --url

# Create an auth token
turso db tokens create my-project-context
```

3. Configure Cursor's MCP integration by creating or editing `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "devcontext": {
      "command": "npx",
      "args": ["-y", "devcontext"],
      "enabled": true,
      "env": {
        "TURSO_DATABASE_URL": "your-turso-database-url-here",
        "TURSO_AUTH_TOKEN": "your-turso-auth-token-here"
      }
    }
  }
}
```

## Using with Global Installation

If you've installed DevContext globally, you can simplify the configuration:

```json
{
  "mcpServers": {
    "devcontext": {
      "command": "devcontext",
      "enabled": true,
      "env": {
        "TURSO_DATABASE_URL": "your-turso-database-url-here",
        "TURSO_AUTH_TOKEN": "your-turso-auth-token-here"
      }
    }
  }
}
```

## Usage in Cursor

Once you've set up the integration, DevContext will automatically:

1. Index your codebase for smarter context retrieval
2. Track conversation topics and purposes
3. Record development milestones and events
4. Learn from common patterns and code structures

You can interact with DevContext through the Cursor chat interface, which will use the MCP protocol to retrieve relevant context and enhance the AI assistant's responses.

## Available Tools

DevContext provides several MCP tools that enhance Cursor's AI capabilities:

- **initialize_conversation_context**: Starts a new conversation with comprehensive context
- **update_conversation_context**: Updates the conversation with new code and messages
- **retrieve_relevant_context**: Gets specific context based on queries
- **record_milestone_context**: Creates development milestones with impact assessment
- **finalize_conversation_context**: Ends conversations with learning extraction and insights
