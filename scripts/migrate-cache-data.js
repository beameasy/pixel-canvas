// Script to fully replicate PROD Redis data to DEV Redis
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
    console.log('🔄 Starting FULL Redis data migration from PROD to DEV...');
    
    // Confirm Redis connections
    console.log('📊 Testing connections...');
    await prodRedis.ping();
    console.log('✅ PROD Redis connection successful');
    await devRedis.ping();
    console.log('✅ DEV Redis connection successful');
    
    // Step 1: Get all keys from PROD Redis
    const keys = [];
    console.log('📚 Fetching all keys from PROD Redis...');
    
    // 1a. Scan for all keys
    await scanAllKeys('*', keys);
    console.log(`📋 Found ${keys.length} keys in PROD Redis`);
    
    // Log keys that appear to be test keys
    const testKeys = keys.filter(key => key.startsWith('test:'));
    if (testKeys.length > 0) {
      console.log('⚠️ Found test keys in PROD Redis:', testKeys);
    }
    
    // Step 2: Prompt for confirmation before wiping DEV Redis
    console.log('\n⚠️ WARNING: This will overwrite all data in your DEV Redis database!');
    const confirmation = await promptForConfirmation('Are you sure you want to continue? (yes/no): ');
    
    if (confirmation.toLowerCase() !== 'yes') {
      console.log('❌ Operation cancelled by user');
      process.exit(0);
    }
    
    // Step 3: Clear DEV Redis
    console.log('\n🧹 Clearing DEV Redis...');
    await devRedis.flushall();
    console.log('✅ DEV Redis cleared');
    
    // Step 4: Migrate data for each key
    console.log('\n📤 Starting data migration...');
    
    // Batch processing to avoid memory issues
    const batchSize = 20;
    const totalKeys = keys.length;
    let processed = 0;
    let errored = 0;
    
    for (let i = 0; i < totalKeys; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);
      
      // Process each key in the batch sequentially to reduce load
      for (const key of batch) {
        try {
          await migrateKey(key);
          processed++;
        } catch (error) {
          console.error(`❌ Failed to migrate key "${key}":`, error);
          errored++;
        }
        
        if ((processed + errored) % 20 === 0 || (processed + errored) === totalKeys) {
          console.log(`⏳ Progress: ${processed + errored}/${totalKeys} keys (${Math.round((processed + errored)/totalKeys*100)}%) - Success: ${processed}, Failed: ${errored}`);
        }
      }
    }
    
    if (errored > 0) {
      console.log(`\n⚠️ Migration completed with ${errored} errors. Some keys may not have been migrated correctly.`);
    } else {
      console.log('\n✅ Data migration completed successfully!');
    }
    
  } catch (error) {
    console.error('❌ Error during migration:', error);
    process.exit(1);
  }
}

// Helper function to scan all keys
async function scanAllKeys(pattern, keys) {
  let cursor = '0';
  do {
    const result = await prodRedis.scan(cursor, { match: pattern, count: 500 });
    cursor = result[0];
    keys.push(...result[1]);
  } while (cursor !== '0');
}

// Helper function to migrate a specific key based on its type
async function migrateKey(key) {
  // Special handling for canvas:history
  if (key === 'canvas:history') {
    console.log(`Special handling for canvas:history`);
    await migrateCanvasHistory();
    return;
  }
  
  // Get key type
  const keyType = await prodRedis.type(key);
  
  // Log key and type for debugging
  console.log(`Migrating key: ${key} (${keyType})`);
  
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
}

// Special function to handle canvas:history
async function migrateCanvasHistory() {
  try {
    console.log('Migrating canvas:history with special handling...');
    
    // Get size of the zset
    const size = await prodRedis.zcard('canvas:history');
    console.log(`canvas:history has ${size} entries`);
    
    // Process in batches
    const batchSize = 100;
    let processed = 0;
    
    for (let start = 0; start < size; start += batchSize) {
      // Get a batch of entries with scores
      const entries = await prodRedis.zrange('canvas:history', start, start + batchSize - 1, { 
        withScores: true 
      });
      
      console.log(`Processing batch ${start} to ${start + batchSize - 1}`);
      
      // Process each entry
      for (let i = 0; i < entries.length; i += 2) {
        const entry = entries[i];
        const score = parseFloat(entries[i + 1]);
        
        try {
          // Parse the member if it's a JSON string
          let pixelData;
          try {
            pixelData = JSON.parse(entry);
          } catch (e) {
            // If it's not JSON, use as is
            pixelData = entry;
          }
          
          // Add to dev Redis with the same score
          await devRedis.zadd('canvas:history', {
            score,
            member: typeof pixelData === 'object' ? JSON.stringify(pixelData) : pixelData
          });
          
          processed++;
        } catch (err) {
          console.error(`Error processing canvas:history entry: ${err.message}`);
          console.error('Entry:', entry);
        }
      }
      
      console.log(`Processed ${processed}/${size} entries in canvas:history`);
    }
    
    // Set TTL if applicable
    const ttl = await prodRedis.ttl('canvas:history');
    if (ttl > 0) {
      await devRedis.expire('canvas:history', ttl);
    }
    
    console.log(`✅ canvas:history migration complete`);
  } catch (error) {
    console.error('Failed to migrate canvas:history:', error);
    throw error;
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
  try {
    // Try to use hscan for all hashes as it's more reliable
    await migrateHashByScanning(key);
    
    // Set TTL if applicable
    const ttl = await prodRedis.ttl(key);
    if (ttl > 0) {
      await devRedis.expire(key, ttl);
    }
  } catch (error) {
    throw new Error(`Failed to migrate hash "${key}": ${error.message}`);
  }
}

// Helper function for large hash keys using scanning
async function migrateHashByScanning(key) {
  let cursor = '0';
  let batchCount = 0;
  const batchSize = 50; // Smaller batch size for more reliability
  
  do {
    try {
      const result = await prodRedis.hscan(key, cursor, { count: batchSize });
      cursor = result[0];
      const fields = result[1] || [];
      
      // Convert fields array to object for hset
      if (fields.length > 0) {
        const fieldsObj = {};
        for (let i = 0; i < fields.length; i += 2) {
          fieldsObj[fields[i]] = fields[i + 1];
        }
        
        // Process in even smaller batches if large
        const entries = Object.entries(fieldsObj);
        const entriesBatchSize = 20;
        
        for (let i = 0; i < entries.length; i += entriesBatchSize) {
          const entriesBatch = entries.slice(i, i + entriesBatchSize);
          const batchObj = Object.fromEntries(entriesBatch);
          
          await devRedis.hset(key, batchObj);
        }
        
        batchCount++;
      }
    } catch (error) {
      console.error(`Error scanning hash ${key} at cursor ${cursor}:`, error);
      // Attempt to continue with the next cursor
      cursor = '0';
      throw error;
    }
  } while (cursor !== '0');
}

// Helper function for set keys
async function migrateSet(key) {
  // Use sscan to get set members in batches
  let cursor = '0';
  const batchSize = 50; // Smaller batch size for more reliability
  
  do {
    try {
      const result = await prodRedis.sscan(key, cursor, { count: batchSize });
      cursor = result[0] || '0';
      const members = result[1] || [];
      
      if (members.length > 0) {
        // Add in smaller batches to avoid errors with large sets
        for (let i = 0; i < members.length; i += 20) {
          const batch = members.slice(i, i + 20);
          await devRedis.sadd(key, ...batch);
        }
      }
    } catch (error) {
      console.error(`Error scanning set ${key} at cursor ${cursor}:`, error);
      cursor = '0';
      throw error;
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
  try {
    // Use zscan for all zsets as it's more reliable
    await migrateZSetByScanning(key);
    
    // Set TTL if applicable
    const ttl = await prodRedis.ttl(key);
    if (ttl > 0) {
      await devRedis.expire(key, ttl);
    }
  } catch (error) {
    throw new Error(`Failed to migrate zset "${key}": ${error.message}`);
  }
}

// Helper function for large zset keys using scanning
async function migrateZSetByScanning(key) {
  let cursor = '0';
  const batchSize = 50; // Smaller batch size for more reliability
  
  do {
    try {
      const result = await prodRedis.zscan(key, cursor, { count: batchSize });
      cursor = result[0] || '0';
      const membersWithScores = result[1] || [];
      
      if (membersWithScores && membersWithScores.length > 0) {
        // Add in smaller batches to avoid errors with large zsets
        // Format is [member1, score1, member2, score2, ...]
        for (let i = 0; i < membersWithScores.length; i += 40) { // Process 20 member-score pairs at a time
          const batchArgs = [];
          
          for (let j = i; j < i + 40 && j < membersWithScores.length; j += 2) {
            if (j + 1 < membersWithScores.length) {
              const member = membersWithScores[j];
              const score = membersWithScores[j + 1];
              
              // Make sure score is a valid number and not a complex object
              if (typeof score === 'number' || !isNaN(parseFloat(score))) {
                // Adding as score, member (order is important for Upstash)
                batchArgs.push({ score: parseFloat(score), member: String(member) });
              } else {
                console.warn(`Skipping invalid score for member ${member}: ${score}`);
              }
            }
          }
          
          if (batchArgs.length > 0) {
            await devRedis.zadd(key, ...batchArgs);
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning zset ${key} at cursor ${cursor}:`, error);
      cursor = '0';
      throw error;
    }
  } while (cursor !== '0');
}

// Helper function for list keys
async function migrateList(key) {
  // Get list length
  const len = await prodRedis.llen(key);
  
  if (len > 0) {
    // Process in batches for large lists
    const batchSize = 100;
    for (let start = 0; start < len; start += batchSize) {
      const end = Math.min(start + batchSize - 1, len - 1);
      const items = await prodRedis.lrange(key, start, end);
      
      if (items && items.length > 0) {
        await devRedis.rpush(key, ...items);
      }
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