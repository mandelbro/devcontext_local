## Summary (tasks-1.md)

- **Tasks in this file**: 10
- **Task IDs**: 001 - 010

## Tasks

### Task ID: 001

- **Title**: Add local SQLite configuration options to config.js
- **File**: src/config.js
- **Complete**: [x]

#### Prompt:

```markdown
**Objective:** Add configuration options to support local SQLite database connections as an alternative to Turso cloud database.

**File to Create/Modify:** src/config.js

**User Story Context:** As a developer, I want to use DevContext without requiring a Turso cloud account, so I can run the MCP server with a local SQLite database file.

**Detailed Instructions:**
1. Add new environment variables:
   - `DATABASE_MODE`: Can be 'turso' (default) or 'local'
   - `LOCAL_SQLITE_PATH`: Path to local SQLite database file (default: './devcontext.db')
2. Add validation function for DATABASE_MODE similar to validateLogLevel
3. Add configuration properties to the config object
4. Update the configuration logging to show database mode
5. Ensure backward compatibility - if DATABASE_MODE is not set, default to 'turso' mode

**Acceptance Criteria (for this task):**
- [ ] DATABASE_MODE environment variable is parsed and validated
- [ ] LOCAL_SQLITE_PATH environment variable is parsed with default value
- [ ] Configuration object includes new database mode properties
- [ ] Logging shows current database mode
- [ ] Backward compatibility maintained for existing Turso users
```

### Task ID: 002

- **Title**: Create database connection factory for multi-mode support
- **File**: src/db/connectionFactory.js
- **Complete**: [x]

#### Prompt:

```markdown
**Objective:** Create a factory module that can create either Turso or local SQLite connections based on configuration.

**File to Create/Modify:** src/db/connectionFactory.js (new file)

**User Story Context:** The system needs to abstract the database connection creation to support both Turso cloud and local SQLite modes seamlessly.

**Detailed Instructions:**
1. Create a new file `src/db/connectionFactory.js`
2. Import necessary dependencies:
   - @libsql/client for both connection types
   - config from ../config.js
   - logger from ../utils/logger.js
3. Create a factory function `createDatabaseClient()` that:
   - Checks DATABASE_MODE from config
   - For 'turso' mode: Uses existing logic from client.js
   - For 'local' mode: Creates a local SQLite connection using file:// URL
4. Handle connection validation for both modes
5. Export the factory function

**Acceptance Criteria (for this task):**
- [ ] Factory function correctly identifies database mode
- [ ] Turso mode creates cloud connection with URL and auth token
- [ ] Local mode creates file-based connection
- [ ] Proper error handling for both modes
- [ ] Logging indicates which mode is being used
```

### Task ID: 003

- **Title**: Refactor client.js to use connection factory
- **File**: src/db/client.js
- **Complete**: [ ]

#### Prompt:

```markdown
**Objective:** Refactor the existing database client module to use the new connection factory.

**File to Create/Modify:** src/db/client.js

**User Story Context:** The existing client module needs to be updated to support both database modes through the factory pattern.

**Detailed Instructions:**
1. Import the createDatabaseClient function from ./connectionFactory.js
2. Refactor initializeDbClient to:
   - Use createDatabaseClient() instead of direct createClient() call
   - Remove Turso-specific validation (moved to factory)
   - Maintain the same export interface for backward compatibility
3. Update error messages to be mode-agnostic
4. Ensure all existing functionality is preserved

**Acceptance Criteria (for this task):**
- [ ] Client uses connection factory
- [ ] Existing API remains unchanged
- [ ] Error handling works for both modes
- [ ] No breaking changes for existing code
```

### Task ID: 004

- **Title**: Update main.js database initialization for local mode
- **File**: src/main.js
- **Complete**: [ ]

#### Prompt:

```markdown
**Objective:** Update the server startup process to handle local SQLite database initialization.

**File to Create/Modify:** src/main.js

**User Story Context:** The server needs to handle database initialization differently for local SQLite files, including creating the file if it doesn't exist.

**Detailed Instructions:**
1. Update the database connection verification section to:
   - Check DATABASE_MODE from config
   - For local mode: Create database file if it doesn't exist
   - Update error messages to be mode-specific
2. Modify the connection verification:
   - Keep existing "SELECT 1" test
   - Add local file existence check for local mode
3. Update error logging to indicate which mode failed

**Acceptance Criteria (for this task):**
- [ ] Server starts successfully in both modes
- [ ] Local database file is created if missing
- [ ] Connection verification works for both modes
- [ ] Error messages clearly indicate the mode and issue
```

### Task ID: 005

- **Title**: Add local database file management utilities
- **File**: src/db/localDbUtils.js
- **Complete**: [ ]

#### Prompt:

```markdown
**Objective:** Create utility functions for managing local SQLite database files.

**File to Create/Modify:** src/db/localDbUtils.js (new file)

**User Story Context:** Local SQLite databases need additional management capabilities like backup, file validation, and cleanup.

**Detailed Instructions:**
1. Create utility functions:
   - `ensureDbFileExists(dbPath)`: Creates database file and directory if needed
   - `validateDbFile(dbPath)`: Checks if file exists and is accessible
   - `getDbFileInfo(dbPath)`: Returns file stats (size, modified date)
   - `createBackup(dbPath)`: Creates timestamped backup of database
2. Use Node.js fs module for file operations
3. Add proper error handling and logging
4. Export all utility functions

**Acceptance Criteria (for this task):**
- [ ] Database file and directory creation works
- [ ] File validation detects missing or inaccessible files
- [ ] File info retrieval provides accurate stats
- [ ] Backup creation generates timestamped copies
- [ ] All functions have proper error handling
```

### Task ID: 006

- **Title**: Update .env.example with new configuration options
- **File**: .env.example
- **Complete**: [ ]

#### Prompt:

```markdown
**Objective:** Document the new database configuration options in the example environment file.

**File to Create/Modify:** .env.example (create if doesn't exist)

**User Story Context:** Developers need clear documentation on how to configure the database mode.

**Detailed Instructions:**
1. Create or update .env.example file
2. Add new database configuration section:
   - DATABASE_MODE with explanation of options (turso/local)
   - LOCAL_SQLITE_PATH with default value and explanation
3. Keep existing Turso configuration with notes about when it's required
4. Add comments explaining the mutual exclusivity of modes
5. Include examples for both configurations

**Acceptance Criteria (for this task):**
- [ ] DATABASE_MODE is documented with both options
- [ ] LOCAL_SQLITE_PATH is documented with default
- [ ] Clear explanation of when each mode is used
- [ ] Examples for both Turso and local configurations
- [ ] Existing Turso config remains documented
```

### Task ID: 007

- **Title**: Update README.md with local SQLite setup instructions
- **File**: README.md
- **Complete**: [ ]

#### Prompt:

```markdown
**Objective:** Update the documentation to include instructions for using local SQLite mode.

**File to Create/Modify:** README.md

**User Story Context:** Users need clear instructions on how to set up DevContext with local SQLite instead of Turso.

**Detailed Instructions:**
1. Update the "Prerequisites" section:
   - Make TursoDB account optional
   - Add note about local SQLite option
2. Add new section "Option A: Local SQLite Setup" before Turso setup
   - Explain DATABASE_MODE=local configuration
   - Show example .env configuration
   - Mention automatic database file creation
3. Rename existing Turso section to "Option B: Turso Cloud Setup"
4. Update the MCP configuration example to show both options
5. Add troubleshooting section for common local database issues

**Acceptance Criteria (for this task):**
- [ ] Prerequisites correctly show Turso as optional
- [ ] Local SQLite setup instructions are clear and complete
- [ ] Both setup options are clearly distinguished
- [ ] MCP configuration examples cover both modes
- [ ] Troubleshooting section addresses common issues
```

### Task ID: 008

- **Title**: Add database mode validation and helpful error messages
- **File**: src/db/connectionFactory.js
- **Complete**: [ ]

#### Prompt:

```markdown
**Objective:** Enhance the connection factory with better validation and user-friendly error messages.

**File to Create/Modify:** src/db/connectionFactory.js

**User Story Context:** Users need clear feedback when database configuration is incorrect or incomplete.

**Detailed Instructions:**
1. Add validation for DATABASE_MODE:
   - Check for valid values ('turso', 'local')
   - Provide helpful error if invalid mode specified
2. For Turso mode:
   - Check if TURSO_DATABASE_URL is provided
   - Suggest switching to local mode if Turso credentials missing
3. For local mode:
   - Validate LOCAL_SQLITE_PATH format
   - Check write permissions for database directory
4. Add informative error messages with remediation steps

**Acceptance Criteria (for this task):**
- [ ] Invalid DATABASE_MODE shows helpful error
- [ ] Missing Turso credentials suggest local mode
- [ ] Local path validation catches common issues
- [ ] Error messages include remediation steps
- [ ] All errors are logged appropriately
```

### Task ID: 009

- **Title**: Create integration tests for dual-mode database support
- **File**: __tests__/db/connectionFactory.test.js
- **Complete**: [ ]

#### Prompt:

```markdown
**Objective:** Create comprehensive tests for the database connection factory and dual-mode support.

**File to Create/Modify:** __tests__/db/connectionFactory.test.js (new file)

**User Story Context:** The dual-mode database support needs thorough testing to ensure reliability.

**Detailed Instructions:**
1. Create test file with test suites for:
   - Turso mode connection creation
   - Local mode connection creation
   - Mode validation and error handling
   - Environment variable handling
2. Mock @libsql/client and file system operations
3. Test error scenarios:
   - Invalid database mode
   - Missing Turso credentials
   - Invalid local path
   - File permission issues
4. Test successful connection creation for both modes

**Acceptance Criteria (for this task):**
- [ ] Tests cover both database modes
- [ ] Error scenarios are thoroughly tested
- [ ] Mocking is properly implemented
- [ ] Tests are isolated and repeatable
- [ ] All tests pass successfully
```

### Task ID: 010

- **Title**: Add database migration support for local SQLite
- **File**: src/db/migrationManager.js
- **Complete**: [ ]

#### Prompt:

```markdown
**Objective:** Implement database migration support that works with both Turso and local SQLite databases.

**File to Create/Modify:** src/db/migrationManager.js (new file)

**User Story Context:** Both database modes need consistent schema management and migration capabilities.

**Detailed Instructions:**
1. Create migration manager that:
   - Tracks applied migrations in a migrations table
   - Supports both Turso and local SQLite
   - Runs migrations in order
   - Handles rollbacks safely
2. Create initial migration for existing schema
3. Add migration execution to server startup
4. Include logging for migration status
5. Handle migration failures gracefully

**Acceptance Criteria (for this task):**
- [ ] Migration tracking table is created
- [ ] Migrations run in correct order
- [ ] Both database modes are supported
- [ ] Failed migrations don't corrupt database
- [ ] Migration status is clearly logged
```
