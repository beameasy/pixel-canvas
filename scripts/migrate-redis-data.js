// Script to replicate data from PROD Redis to DEV Redis
// This script reads data from PROD and writes to DEV without modifying PROD
require('dotenv').config({ path: '.env.local' });
const { Redis } = require('@upstash/redis');

// Initialize Redis connections
const prodRedis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

const devRedis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_DEV_URL,
  token: process.env.UPSTASH_REDIS_REST_DEV_TOKEN
});

// Main function to migrate data
async function migrateRedisData() {
  try {
    console.log('🔄 Starting Redis data migration from PROD to DEV...');
    
    // Confirm Redis connections
    console.log('📊 Testing connections...');
    await prodRedis.ping();
    console.log('✅ PROD Redis connection successful');
    await devRedis.ping();
    console.log('✅ DEV Redis connection successful');
    
    // Step 1: Get all keys from PROD Redis
    const keys = [];
    console.log('📚 Fetching all keys from PROD Redis...');
    
    // 1a. Scan for hash keys
    await scanAllKeys('*', keys);
    console.log(`📋 Found ${keys.length} keys in PROD Redis`);
    
    // Step 2: Prompt for confirmation before wiping DEV Redis
    console.log('\n⚠️ WARNING: This will overwrite data in your DEV Redis database!');
    const confirmation = await promptForConfirmation('Are you sure you want to continue? (yes/no): ');
    
    if (confirmation.toLowerCase() !== 'yes') {
      console.log('❌ Operation cancelled by user');
      process.exit(0);
    }
    
    // Step 3: Clear DEV Redis (optional, based on user confirmation)
    console.log('\n🧹 Clearing DEV Redis...');
    await devRedis.flushall();
    console.log('✅ DEV Redis cleared');
    
    // Step 4: Migrate data for each key type
    console.log('\n📤 Starting data migration...');
    
    // Batch processing to avoid memory issues
    const batchSize = 100;
    const totalKeys = keys.length;
    let processed = 0;
    
    for (let i = 0; i < totalKeys; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);
      await Promise.all(batch.map(key => migrateKey(key)));
      processed += batch.length;
      console.log(`⏳ Progress: ${processed}/${totalKeys} keys (${Math.round(processed/totalKeys*100)}%)`);
    }
    
    console.log('\n✅ Data migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Error during migration:', error);
    process.exit(1);
  }
}

// Helper function to scan all keys
async function scanAllKeys(pattern, keys) {
  let cursor = '0';
  do {
    const result = await prodRedis.scan(cursor, { match: pattern, count: 1000 });
    cursor = result[0];
    keys.push(...result[1]);
  } while (cursor !== '0');
}

// Helper function to migrate a specific key based on its type
async function migrateKey(key) {
  try {
    // Get key type
    const keyType = await prodRedis.type(key);
    
    switch (keyType) {
      case 'string':
        await migrateString(key);
        break;
      case 'hash':
        await migrateHash(key);
        break;
      case 'set':
        await migrateSet(key);
        break;
      case 'zset':
        await migrateZSet(key);
        break;
      case 'list':
        await migrateList(key);
        break;
      default:
        console.warn(`⚠️ Unsupported key type: ${keyType} for key: ${key}`);
    }
  } catch (error) {
    console.error(`❌ Error migrating key "${key}":`, error);
  }
}

// Helper function for string keys
async function migrateString(key) {
  const value = await prodRedis.get(key);
  const ttl = await prodRedis.ttl(key);
  
  if (ttl > 0) {
    await devRedis.set(key, value, { ex: ttl });
  } else {
    await devRedis.set(key, value);
  }
}

// Helper function for hash keys
async function migrateHash(key) {
  // Use hscan to get all hash fields in batches
  let cursor = '0';
  let batchCount = 0;
  
  do {
    const [nextCursor, fields] = await prodRedis.hscan(key, cursor);
    cursor = nextCursor;
    
    // Convert fields array to object for hset
    if (fields.length > 0) {
      const fieldsObj = {};
      for (let i = 0; i < fields.length; i += 2) {
        fieldsObj[fields[i]] = fields[i + 1];
      }
      
      await devRedis.hset(key, fieldsObj);
      batchCount++;
    }
  } while (cursor !== '0');
  
  // Set TTL if applicable
  const ttl = await prodRedis.ttl(key);
  if (ttl > 0) {
    await devRedis.expire(key, ttl);
  }
}

// Helper function for set keys
async function migrateSet(key) {
  // Use sscan to get set members in batches
  let cursor = '0';
  
  do {
    const [nextCursor, members] = await prodRedis.sscan(key, cursor);
    cursor = nextCursor;
    
    if (members.length > 0) {
      await devRedis.sadd(key, ...members);
    }
  } while (cursor !== '0');
  
  // Set TTL if applicable
  const ttl = await prodRedis.ttl(key);
  if (ttl > 0) {
    await devRedis.expire(key, ttl);
  }
}

// Helper function for sorted set keys
async function migrateZSet(key) {
  // Use zscan to get sorted set members in batches
  let cursor = '0';
  
  do {
    const [nextCursor, members] = await prodRedis.zscan(key, cursor);
    cursor = nextCursor;
    
    if (members.length > 0) {
      // Format for zadd: score1, member1, score2, member2, ...
      const scoreMembers = [];
      for (let i = 0; i < members.length; i += 2) {
        scoreMembers.push(members[i + 1]); // Score
        scoreMembers.push(members[i]);      // Member
      }
      
      if (scoreMembers.length > 0) {
        await devRedis.zadd(key, ...scoreMembers);
      }
    }
  } while (cursor !== '0');
  
  // Set TTL if applicable
  const ttl = await prodRedis.ttl(key);
  if (ttl > 0) {
    await devRedis.expire(key, ttl);
  }
}

// Helper function for list keys
async function migrateList(key) {
  // Get list length
  const len = await prodRedis.llen(key);
  
  if (len > 0) {
    // Get all list items
    const items = await prodRedis.lrange(key, 0, len - 1);
    
    if (items.length > 0) {
      await devRedis.rpush(key, ...items);
    }
  }
  
  // Set TTL if applicable
  const ttl = await prodRedis.ttl(key);
  if (ttl > 0) {
    await devRedis.expire(key, ttl);
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

// Run the migration
migrateRedisData()
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  }); 