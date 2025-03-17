// Script to remove test keys from production Redis
require('dotenv').config({ path: '.env.local' });
const { Redis } = require('@upstash/redis');

// Initialize Redis connection to production
const prodRedis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

async function cleanupTestKeys() {
  try {
    console.log('🔎 Looking for test keys in production Redis...');
    
    // Confirm Redis connection
    await prodRedis.ping();
    console.log('✅ PROD Redis connection successful');
    
    // Find all test keys
    const testKeys = [];
    let cursor = '0';
    
    do {
      const result = await prodRedis.scan(cursor, { match: 'test:*', count: 100 });
      cursor = result[0];
      testKeys.push(...result[1]);
    } while (cursor !== '0');
    
    console.log(`Found ${testKeys.length} test keys in production Redis`);
    
    if (testKeys.length === 0) {
      console.log('No test keys to clean up.');
      process.exit(0);
    }
    
    // Prompt for confirmation before deleting keys
    const confirmation = await promptForConfirmation(`Are you sure you want to delete ${testKeys.length} test keys from production? (yes/no): `);
    
    if (confirmation.toLowerCase() !== 'yes') {
      console.log('❌ Operation cancelled by user');
      process.exit(0);
    }
    
    // Delete each test key
    console.log('🗑️ Deleting test keys...');
    let deleted = 0;
    
    for (const key of testKeys) {
      await prodRedis.del(key);
      deleted++;
      console.log(`Deleted key: ${key}`);
    }
    
    console.log(`✅ Successfully deleted ${deleted} test keys from production Redis.`);
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    process.exit(1);
  }
}

// Helper function to prompt for confirmation
function promptForConfirmation(message) {
  return new Promise((resolve) => {
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    readline.question(message, (answer) => {
      readline.close();
      resolve(answer);
    });
  });
}

// Run the cleanup
cleanupTestKeys()
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  }); 