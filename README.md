# DevContext: Project-Centric Continuous Context Server

DevContext is a state-of-the-art context management system for software development, implementing the Model Context Protocol (MCP) with advanced context retrieval techniques.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **Empower your development workflow with intelligent context awareness** - DevContext understands your codebase, conversations, and development patterns to provide relevant context exactly when you need it.

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [System Architecture](#system-architecture)
- [Technology Stack](#technology-stack)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Core Components](#core-components)
- [Development](#development)
- [License](#license)

## Overview

DevContext is a cutting-edge Model Context Protocol (MCP) server designed to provide developers with continuous, project-centric context awareness. Unlike traditional context systems, DevContext leverages sophisticated non-vector retrieval methods, focusing on keyword analysis, relationship graphs, and structured metadata to deliver highly relevant context during development.

The server operates with a database instance dedicated to a single project, eliminating cross-project complexity and ensuring performance with minimal resource requirements. DevContext builds a comprehensive understanding of your codebase - from repository structure down to individual functions - while continuously learning from and adapting to your development patterns.

## Key Features

- **Intelligent Context Retrieval**: Sophisticated non-vector search with multi-factor relevance scoring
- **Project-Level Understanding**: Comprehends project structure, code relationships, and development history
- **Continuous Learning**: Identifies and learns code patterns, development workflows, and conversation topics
- **Topic Segmentation**: Automatically detects conversation topic shifts while maintaining context continuity
- **Development Timeline**: Records significant development events and maintains milestone checkpoints
- **Purpose-Aware Responses**: Detects conversation purpose (debugging, planning, code review) to tailor context
- **Low Resource Requirements**: Optimized for performance without requiring GPU or specialized hardware
- **Single-File Deployment**: Bundled into a single executable JavaScript file for simple IDE integration

## System Architecture

DevContext follows a modular architecture internally, bundled into a single deployable file:

- **Lifecycle-Oriented Tools**: MCP tools that manage conversation phases and orchestrate context operations
- **Core Logic Modules**: Specialized components handling specific aspects of context management
- **TursoDB Backend**: SQL database storing all project-specific context, metadata, and relationships
- **Stdin/Stdout Interface**: Communication protocol adhering to the Model Context Protocol standard

## Technology Stack

- **Node.js**: Runtime environment (Node.js 18+)
- **TursoDB**: SQL database optimized for edge deployment (compatible with SQLite)
- **ESBuild**: JavaScript bundler for creating the single-file deployment package
- **Model Context Protocol SDK**: For standardized communication with IDE clients
- **Acorn**: JavaScript parser for AST-based code analysis
- **Pure JavaScript**: No external vector libraries or machine learning dependencies

## Installation

### Prerequisites

- Node.js 18.0.0 or higher
- TursoDB account or compatible SQLite database

### Install Dependencies

```bash
# Clone the repository
git clone https://github.com/yourusername/devcontext.git
cd devcontext

# Install dependencies
npm install
```

### Build the Server

```bash
# Build the bundled server
npm run build
```

## Configuration

Create a `.env` file based on `.env.example` with the following variables:

```env
# TursoDB connection details for your project database
TURSO_DATABASE_URL=libsql://your-project-db-name.turso.io
TURSO_AUTH_TOKEN=your_turso_auth_token_here

# Logging and performance settings
LOG_LEVEL=INFO
DB_LOGGING_ENABLED=false
DEFAULT_TOKEN_BUDGET=4000
CONTEXT_DECAY_RATE=0.95
```

## Usage

### Running the Server

```bash
# Start the server
npm start
```

### Setup Steps

1. **Configure Turso Database:**

```bash
# Install Turso CLI
curl -sSfL https://get.turso.tech/install.sh | bash

# Login to Turso
turso auth login

# Create a database
turso db create devcontext

# Get database URL and token
turso db show devcontext --url
turso db tokens create devcontext
```

Or you can visit [Turso](https://turso.tech/) and sign up and proceed to create the database and get proper credentials. The free plan will more than cover your project memory.

2. **Configure Cursor MCP:**

Update `.cursor/mcp.json` in your project directory with the database url and turso auth token:

```json
{
  "mcpServers": {
    "cursor10x-mcp": {
      "command": "npx",
      "args": ["-y", "devcontext"],
      "enabled": true,
      "env": {
        "TURSO_DATABASE_URL": "your-turso-database-url",
        "TURSO_AUTH_TOKEN": "your-turso-auth-token"
      }
    }
  }
}
```

## Core Components

DevContext implements a comprehensive set of logical components:

### Text Processing

- Language-aware tokenization with specialized handling for JavaScript/TypeScript, Python, Java, C#, Ruby, and Go
- Keyword extraction with language-specific weighting
- Semantic boundary respecting n-grams
- Language-specific idiom detection

### Context Management

- Code entity indexing and relationship tracking
- Conversation topic segmentation and purpose detection
- Timeline event recording and milestone snapshots
- Focus area prediction based on developer activity

### Pattern Recognition

- Code pattern identification and storage
- Automatic pattern learning from examples
- Cross-session pattern promotion
- Design pattern detection

### Intent & Relevance Analysis

- Query intent prediction
- Multi-factor context prioritization
- Token budget management
- Context integration across topic shifts

## Development

### Project Structure

The codebase is organized into modules for better maintainability:

```
devcontext/
├── dist/                # Output directory for bundled files
│   └── mcp-server.bundle.js
├── src/
│   ├── logic/           # Core business logic modules
│   ├── schemas/         # Zod schemas for tool validation
│   ├── tools/           # MCP tool implementations
│   ├── utils/           # Utility functions
│   ├── main.js          # Server entry point
│   ├── config.js        # Configuration loading
│   └── db.js            # Database client setup
├── esbuild.config.js    # Build configuration
├── package.json         # Dependencies and scripts
└── .env.example         # Example environment variables
```

### Building for Development

```bash
# Run the development build and server
npm run dev
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
