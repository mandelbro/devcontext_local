/**
 * Manual test for database connection factory
 * Run this test manually to verify connection factory functionality
 *
 * Usage:
 * - For Turso mode: Ensure TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are set
 * - For local mode: Set DATABASE_MODE=local
 *
 * Run: node __tests__/db/connectionFactory.manual.test.js
 */

import { createDatabaseClient, validateConnection } from '../../src/db/connectionFactory.js';
import config from '../../src/config.js';
import logger from '../../src/utils/logger.js';

async function testConnectionFactory() {
  console.log('\n=== Database Connection Factory Test ===\n');
  console.log(`Current DATABASE_MODE: ${config.DATABASE_MODE}`);

  try {
    // Test 1: Create database client
    console.log('\n1. Creating database client...');
    const client = createDatabaseClient();
    console.log('✓ Database client created successfully');

    // Test 2: Validate connection
    console.log('\n2. Validating database connection...');
    await validateConnection(client);
    console.log('✓ Database connection validated successfully');

    // Test 3: Execute a simple query
    console.log('\n3. Executing test query...');
    const result = await client.execute('SELECT 1 as test, datetime() as current_time');
    console.log('✓ Test query executed successfully');
    console.log(`   Result: ${JSON.stringify(result.rows[0])}`);

    // Test 4: Mode-specific information
    console.log('\n4. Connection details:');
    if (config.DATABASE_MODE === 'turso') {
      console.log(`   Mode: Turso Cloud`);
      console.log(`   URL: ${config.TURSO_DATABASE_URL}`);
      console.log(`   Auth Token: ${config.TURSO_AUTH_TOKEN ? 'Provided' : 'Not provided'}`);
    } else if (config.DATABASE_MODE === 'local') {
      console.log(`   Mode: Local SQLite`);
      console.log(`   Path: ${config.LOCAL_SQLITE_PATH}`);
    }

    console.log('\n✅ All tests passed!\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run the test
testConnectionFactory().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
