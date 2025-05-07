# Changelog

All notable changes to the DevContext project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.7 - 2024-05-10

### Fixed

- Critical bug: Resolved issue with client closing during tool calls when processing multiple code changes
- Added robust error handling and retry logic in database connection code with exponential backoff
- Fixed column name mismatch in KnowledgeProcessor.js where the query was using "path" instead of "file_path"
- Improved getEntitiesFromChangedFiles function to process files one at a time instead of using complex IN queries
- Enhanced processCodeChanges function to use Promise.allSettled for better error handling
- Modified migrateProjectPatternsTable function to use direct PRAGMA queries for better reliability
- Updated handler function to be more resilient to errors and return partial success instead of failing completely

## 1.0.4 - 2024-05-08

### Enhanced

- Completely refactored message processing logic in `updateConversationContext.tool.js` with a message-first approach
- Improved topic segmentation flow: messages are now recorded first, then topics are created with the correct start message ID
- Messages are now properly associated with their topics through database updates
- Enhanced purpose detection and tracking with support for trigger message IDs
- Implemented user-by-user message processing to properly handle topic shifts on a per-message basis
- Added proper active topic lookup and association for non-shift messages

### Fixed

- Topic continuity issue where messages weren't properly linked to their topic segments
- Purpose transition tracking now properly stores the message that triggered the transition
- Improved error handling throughout the message processing pipeline

## 1.0.3 - 2024-05-07

### Enhanced

- Improved topic handling: `recordMessage` function now properly accepts and stores `topicSegmentId`
- Added user intent support: Messages can now be tagged with user intent information
- Refactored `updateConversationContext.tool.js` to properly detect topic shifts and create topic segments
- Enhanced topic shift detection before message processing

### Fixed

- Topic continuity during conversation shifts is now properly maintained
- User intent is correctly linked to messages for better context awareness

## 1.0.2 - 2024-05-07

### Fixed

- Bug fix: Initial user queries are now properly stored with 'user' role in conversation_history when initializing conversation context
- Added additional logging for conversation message tracking

## 1.0.1 - 2024-05-06

### Added

- Automated background tasks for context decay and pattern consolidation
- Scheduled maintenance to clean up unused context

### Changed

- Improved error handling in database operations
- Updated dependencies to latest stable versions

## 1.0.0 - 2024-05-05

### Added

- Initial release of DevContext
- Core functionality for context-aware AI coding assistance
- MCP server implementation for Cursor integration
- Conversation intelligence tracking
- Code entity indexing and relationship mapping
- Global pattern repository
- Context prioritization engine

### Fixed

- Milestone persistence in context_states table
- Finalization status tracking in conversation_purposes table

### Known Issues

- Limited test coverage
- No built-in SQLite database option (requires TursoDB)
