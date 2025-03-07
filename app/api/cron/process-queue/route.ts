import { NextResponse } from 'next/server';
import { redis, getQueueName } from '@/lib/server/redis';
import { getAdminClient, getTableName } from '../../_lib/supabaseAdmin';
import { v4 as uuidv4 } from 'uuid';
import { SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'edge'
export const dynamic = 'force-dynamic'
export const maxDuration = 300; // 5 minutes max duration

// Function to get environment-specific processing flag key
const getProcessingFlagKey = () => {
  const isDev = process.env.NODE_ENV === 'development';
  const prefix = isDev ? 'dev:' : '';
  return `${prefix}queue_processing_active`;
};

// New handler for full backups
async function handleFullBackup(supabase: SupabaseClient) {
  console.log('📸 Starting full Redis backup to Supabase...');
  const startTime = Date.now();
  const stats = { pixels: 0, banned_wallets: 0 };
  
  try {
    // 1. Backup all canvas pixels
    console.log('🖼️ Capturing full canvas state...');
    const allKeys = await redis.keys('canvas:pixel:*');
    console.log(`📊 Found ${allKeys.length} pixels to back up`);
    
    for (const key of allKeys) {
      const value = await redis.get(key);
      if (!value) continue;
      
      try {
        // Ensure value is a string before parsing
        const pixel = JSON.parse(typeof value === 'string' ? value : String(value));
        const pixelsQueue = getQueueName('supabase:pixels:queue');
        await redis.rpush(pixelsQueue, JSON.stringify(pixel));
        stats.pixels++;
      } catch (e) {
        console.error(`Failed to process pixel ${key}:`, e);
      }
    }
    
    // 2. Ensure all banned wallets are in the queue
    console.log('🚫 Backing up banned wallets...');
    const bannedWallets = await redis.smembers('banned:wallets:permanent');
    
    for (const wallet of bannedWallets) {
      // Check if this wallet is already in the queue
      const isQueued = await redis.lrange(getQueueName('supabase:bans:queue'), 0, -1).then(
        queue => queue.some(item => {
          try {
            const parsed = JSON.parse(item);
            return parsed.wallet_address.toLowerCase() === wallet.toLowerCase();
          } catch {
            return false;
          }
        })
      );
      
      if (!isQueued) {
        // Get reason data if available
        let reasonData = null;
        try {
          const reasonJson = await redis.get(`banned:wallet:reason:${wallet.toLowerCase()}`);
          if (reasonJson && typeof reasonJson === 'string') {
            reasonData = JSON.parse(reasonJson);
          }
        } catch (e) {
          console.error('❌ Error parsing ban reason:', e);
        }
        
        // Create ban record
        const banData = {
          wallet_address: wallet.toLowerCase(),
          banned_at: reasonData?.banned_at || new Date().toISOString(),
          banned_by: reasonData?.banned_by || 'system_backup',
          reason: reasonData?.reason || 'Backup-created record',
          active: true
        };
        
        await redis.rpush(getQueueName('supabase:bans:queue'), JSON.stringify(banData));
        stats.banned_wallets++;
      }
    }
    
    // Record backup timestamp
    await redis.set('last_backup_time', Date.now().toString());
    console.log(`✅ Backup preparation complete in ${Date.now() - startTime}ms`);
    
    // Track this backup in Supabase
    await supabase
      .from(getTableName('backup_logs'))
      .insert([{
        backup_time: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        pixels_count: stats.pixels,
        banned_wallets_count: stats.banned_wallets,
        status: 'queued_for_processing'
      }])
      .select()
      .single()
      .then(({data}) => {
        if (data?.id) {
          // Store the backup ID in Redis for updating after processing
          redis.set('current_backup_id', data.id);
        }
      });
    
    return stats;
  } catch (error) {
    console.error('❌ Full backup failed:', error);
    return { success: false, error: String(error) };
  }
  
  return { success: true, stats };
}

export async function GET(request: Request) {
  const startTime = Date.now();
  
  try {
    // Check for valid cron secret
    const cronSecret = request.headers.get('x-cron-secret');
    if (cronSecret !== process.env.CRON_SECRET) {
      console.error('❌ Unauthorized cron job attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Get queue stats for monitoring
    const pixelsQueue = getQueueName('supabase:pixels:queue');
    const usersQueue = getQueueName('supabase:users:queue');
    
    const queueStats = {
      pixelsQueueLength: await redis.llen(pixelsQueue),
      usersQueueLength: await redis.llen(usersQueue),
      processingActive: await redis.get(getProcessingFlagKey())
    };
    
    console.log(`🔄 Queue processor triggered by Vercel cron job. Stats:`, queueStats);
    
    // If no items in queue, return early
    if (queueStats.pixelsQueueLength === 0 && queueStats.usersQueueLength === 0) {
      return NextResponse.json({ 
        message: 'No items in queue', 
        stats: queueStats 
      });
    }
    
    // Check if another process is already running
    // Use Redis SETNX which only sets if key doesn't exist
    const lockAcquired = await redis.set(
      getProcessingFlagKey(),
      'true',
      { 
        nx: true,  // Only set if key doesn't exist
        ex: 300    // Expire after 5 minutes (safety measure)
      }
    );
    
    if (!lockAcquired) {
      console.log('⏳ Another queue process is already running');
      return NextResponse.json({ 
        message: 'Another process is already running', 
        stats: queueStats 
      });
    }
    
    // Initialize Supabase client
    const supabase = getAdminClient();
    
    console.log('Processing user queue...');
    
    // Get users from the queue
    const usersList = await redis.lrange(usersQueue, 0, 49);
    
    if (usersList.length > 0) {
      // Deduplicate users by wallet address
      const uniqueUsers = Object.values(
        usersList.reduce<Record<string, any>>((acc, user) => {
          const parsed = typeof user === 'string' ? JSON.parse(user) : user;
          
          // Remove fields that don't exist in the database schema
          if (parsed.farcaster_display_name) {
            delete parsed.farcaster_display_name;
          }
          
          // Also remove farcaster_updated_at field
          if (parsed.farcaster_updated_at) {
            delete parsed.farcaster_updated_at;
          }
          
          acc[parsed.wallet_address] = parsed;
          return acc;
        }, {})
      );
      
      console.log('📋 Processing unique users:', uniqueUsers.length);
      
      const { error: userError } = await supabase
        .from(getTableName('users'))
        .upsert(uniqueUsers, { 
          onConflict: 'wallet_address',
          ignoreDuplicates: false 
        });
        
      if (userError) {
        console.error('❌ Error upserting users:', userError);
      } else {
        await redis.del(usersQueue);
        console.log('✅ Processed users:', uniqueUsers.length);
      }
    }

    // STEP 2: Extract unique wallets from pixel queue and ensure they exist
    console.log('🔄 Ensuring all pixel wallets exist in users table...');
    const pixelsList = await redis.lrange(pixelsQueue, 0, -1) || [];
    if (pixelsList.length > 0) {
      const parsedPixels = pixelsList.map(p => typeof p === 'string' ? JSON.parse(p) : p);
      
      // Get unique wallet addresses from pixels
      const uniqueWallets = [...new Set(parsedPixels.map(pixel => 
        pixel.wallet_address?.toLowerCase()
      ).filter(Boolean))];
      
      console.log(`📋 Found ${uniqueWallets.length} unique wallets from pixels`);
      
      // Create basic user records for any wallets not yet in the system
      const walletsToAdd = uniqueWallets.map(wallet => ({
        wallet_address: wallet,
        last_active: new Date().toISOString()
      }));
      
      if (walletsToAdd.length > 0) {
        const { error: missingUserError } = await supabase
          .from(getTableName('users'))
          .upsert(walletsToAdd, { 
            onConflict: 'wallet_address',
            ignoreDuplicates: true // Only add if not exists
          });
        
        if (missingUserError) {
          console.error('❌ Error ensuring pixel users exist:', missingUserError);
        } else {
          console.log(`✅ Added ${walletsToAdd.length} missing user records`);
        }
      }
    }

    // STEP 3: Process pixels queue
    console.log('🔄 Processing pixels queue...');
    console.log(`📋 Found ${pixelsList.length} pixels to process`);

    if (pixelsList.length > 0) {
      const parsedPixels = pixelsList.map(p => typeof p === 'string' ? JSON.parse(p) : p);
      let successCount = 0;
      
      // Process in reasonable batches
      const BATCH_SIZE = 500;
      for (let i = 0; i < parsedPixels.length; i += BATCH_SIZE) {
        const batch = parsedPixels.slice(i, i + BATCH_SIZE);
        console.log(`📋 Processing pixel batch ${i}-${i+batch.length-1} of ${parsedPixels.length}...`);
        
        // Clean the batch - properly handle the version field
        const processedBatch = batch.map(pixel => {
          const { id, ...pixelWithoutId } = pixel;
          return {
            ...pixelWithoutId,
            wallet_address: pixelWithoutId.wallet_address?.toLowerCase(), // Ensure lowercase
            // Ensure version field is included and is a number
            version: typeof pixelWithoutId.version === 'number' ? pixelWithoutId.version : 1
          };
        });
        
        const { error: pixelError } = await supabase
          .from(getTableName('pixels'))
          .insert(processedBatch);
        
        if (pixelError) {
          console.error('❌ Error inserting pixels batch:', pixelError);
        } else {
          successCount += batch.length;
          
          // Remove processed pixels from the queue
          // Get the original JSON strings for these pixels
          const processedJsonStrings = batch.map(p => 
            pixelsList.find(jsonStr => {
              const parsed = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
              return parsed.x === p.x && parsed.y === p.y && 
                     parsed.wallet_address === p.wallet_address && 
                     parsed.placed_at === p.placed_at;
            })
          );
          
          // Remove each processed pixel from the queue
          for (const jsonStr of processedJsonStrings) {
            if (jsonStr) {
              await redis.lrem(pixelsQueue, 0, jsonStr);
            }
          }
        }
      }
      
      console.log(`✅ Processed ${successCount} pixels successfully`);
    }

    // STEP 4: Process bans last
    // [Your existing ban processing code]

    // Initialize backup stats if needed
    let backupStats = null;
    
    // Create backup tables if they don't exist
    const isBackup = false; // Assuming isBackup is false as per the original code
    if (isBackup) {
      try {
        await supabase.rpc('create_backup_tables', {}, {
          count: 'exact'
        });
      } catch (tableError) {
        console.warn('Note: Could not create backup_logs table, may already exist:', tableError);
      }
      
      // Perform full backup preparation
      backupStats = await handleFullBackup(supabase);
    }

    // Process pending bans
    console.log('🔄 Processing ban queue...');
    const pendingBans = await redis.lrange(getQueueName('supabase:bans:queue'), 0, -1);
    console.log('📋 Found pending bans:', pendingBans.length);

    for (const banJson of pendingBans) {
      try {
        // Handle both string and object cases
        const ban = typeof banJson === 'string' ? JSON.parse(banJson) : banJson;
        console.log('🚫 Processing ban:', ban);
        
        // Add UUID for the id field
        const banRecord = {
          id: uuidv4(),
          wallet_address: ban.wallet_address.toLowerCase(),
          banned_at: ban.banned_at,
          banned_by: ban.banned_by,
          reason: ban.reason,
          active: true
        };

        console.log('🚫 Inserting ban record:', banRecord);
        
        const { data, error } = await supabase
          .from(getTableName('banned_wallets'))
          .upsert([banRecord], {
            onConflict: 'wallet_address',
            ignoreDuplicates: false  // Update existing records
          })
          .select();

        if (error) {
          console.error('❌ Supabase error:', error);
          continue;
        }

        console.log('✅ Supabase insert successful:', data);

        // Remove from queue using the exact same JSON string
        const removeCount = await redis.lrem(getQueueName('supabase:bans:queue'), 0, banJson);
        console.log('🗑️ Removed from queue:', removeCount);

        console.log(`✅ Processed ban for wallet: ${ban.wallet_address}`);
      } catch (error) {
        console.error('❌ Processing error:', error);
      }
    }

    // Update backup record if applicable
    if (isBackup) {
      const backupId = await redis.get('current_backup_id');
      if (backupId) {
        await supabase
          .from(getTableName('backup_logs'))
          .update({
            status: 'completed',
            duration_ms: Date.now() - Number(await redis.get('last_backup_time') || 0)
          })
          .eq('id', backupId);
        
        await redis.del('current_backup_id');
      }
    }

    // Verify final state
    const remainingBans = await redis.lrange(getQueueName('supabase:bans:queue'), 0, -1);
    const bannedWallets = await redis.smembers('banned:wallets:permanent');
    console.log('🔄 Final queue state:', { 
      remainingBans: remainingBans.length,
      permanentBans: bannedWallets.length 
    });

    // Clear processing flag at the end
    await redis.del(getProcessingFlagKey());
    
    const duration = Date.now() - startTime;
    console.log(`✅ Queue processing completed in ${duration}ms`);

    return NextResponse.json({ 
      processed: { 
        pixels: pixelsList.length, 
        users: usersList.length,
        bans: pendingBans.length
      },
      remainingItems: {
        pixels: await redis.llen(pixelsQueue),
        users: await redis.llen(usersQueue),
        bans: remainingBans.length
      },
      duration_ms: duration,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Fatal error in queue processing:', error);
    
    // Always release the lock in case of errors
    try {
      await redis.del(getProcessingFlagKey());
      console.log('🔄 Released processing lock after error');
    } catch (redisError) {
      console.error('❌ Could not release Redis lock:', redisError);
    }
    
    return NextResponse.json({ 
      error: `Queue processing failed: ${error}`,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}

export async function POST(request: Request) {
  // Also secure the POST endpoint
  const secret = request.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    console.log('❌ Unauthorized queue processing attempt');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  return GET(request); // Reuse the GET handler for POST requests
} 