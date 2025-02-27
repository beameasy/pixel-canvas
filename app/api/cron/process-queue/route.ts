import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';
import { getAdminClient } from '../../_lib/supabaseAdmin';
import { v4 as uuidv4 } from 'uuid';
import { SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

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
    
    // Process in reasonable batches
    const BATCH_SIZE = 1000;
    for (let i = 0; i < allKeys.length; i += BATCH_SIZE) {
      const batch = allKeys.slice(i, i + BATCH_SIZE);
      const pipeline = redis.pipeline();
      
      for (const key of batch) {
        pipeline.get(key);
      }
      
      const results = await pipeline.exec();
      
      // Queue the pixels for processing
      for (let j = 0; j < results.length; j++) {
        try {
          const result = results[j];
          if (typeof result === 'string') {
            const pixel = JSON.parse(result);
            await redis.rpush('supabase:pixels:queue', JSON.stringify(pixel));
            stats.pixels++;
          }
        } catch (e) {
          console.error('❌ Failed to parse pixel:', results[j], e);
        }
      }
    }
    
    // 2. Ensure all banned wallets are in the queue
    console.log('🚫 Backing up banned wallets...');
    const bannedWallets = await redis.smembers('banned:wallets:permanent');
    
    for (const wallet of bannedWallets) {
      // Check if this wallet is already in the queue
      const isQueued = await redis.lrange('supabase:bans:queue', 0, -1).then(
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
        
        await redis.rpush('supabase:bans:queue', JSON.stringify(banData));
        stats.banned_wallets++;
      }
    }
    
    // Record backup timestamp
    await redis.set('last_backup_time', Date.now().toString());
    console.log(`✅ Backup preparation complete in ${Date.now() - startTime}ms`);
    
    // Track this backup in Supabase
    await supabase
      .from('backup_logs')
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
    console.error('❌ Backup preparation failed:', error);
    throw error;
  }
}

export async function GET(request: Request) {
  // Add security check
  const secret = request.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    console.log('❌ Unauthorized queue processing attempt');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check if this is a backup request
  const isBackup = request.url.includes('backup=true');
  
  console.log(`🔄 Queue processor triggered via: ${request.method}${isBackup ? ' (FULL BACKUP)' : ''}`);
  
  try {
    const supabase = getAdminClient();
    
    // STEP 1: Process users queue FIRST
    console.log('🔄 Processing users queue FIRST...');
    const users = await redis.lrange('supabase:users:queue', 0, -1) || [];
    console.log('📋 Found users in queue:', users.length);
    
    if (users.length > 0) {
      // Deduplicate users by wallet address
      const uniqueUsers = Object.values(
        users.reduce<Record<string, any>>((acc, user) => {
          const parsed = typeof user === 'string' ? JSON.parse(user) : user;
          acc[parsed.wallet_address] = parsed;
          return acc;
        }, {})
      );
      
      console.log('📋 Processing unique users:', uniqueUsers.length);
      
      const { error: userError } = await supabase
        .from('users')
        .upsert(uniqueUsers, { 
          onConflict: 'wallet_address'
        });

      if (userError) {
        console.error('❌ Error upserting users:', userError);
      } else {
        await redis.del('supabase:users:queue');
        console.log('✅ Processed users:', uniqueUsers.length);
      }
    }

    // STEP 2: Extract unique wallets from pixel queue and ensure they exist
    console.log('🔄 Ensuring all pixel wallets exist in users table...');
    const pixels = await redis.lrange('supabase:pixels:queue', 0, -1) || [];
    if (pixels.length > 0) {
      const parsedPixels = pixels.map(p => typeof p === 'string' ? JSON.parse(p) : p);
      
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
          .from('users')
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
    console.log(`📋 Found ${pixels.length} pixels to process`);

    if (pixels.length > 0) {
      const parsedPixels = pixels.map(p => typeof p === 'string' ? JSON.parse(p) : p);
      let successCount = 0;
      
      // Process in reasonable batches
      const BATCH_SIZE = 500;
      for (let i = 0; i < parsedPixels.length; i += BATCH_SIZE) {
        const batch = parsedPixels.slice(i, i + BATCH_SIZE);
        console.log(`📋 Processing pixel batch ${i}-${i+batch.length-1} of ${parsedPixels.length}...`);
        
        // Clean the batch - remove id field to let Supabase generate it
        const processedBatch = batch.map(pixel => {
          const { id, ...pixelWithoutId } = pixel;
          return {
            ...pixelWithoutId,
            wallet_address: pixelWithoutId.wallet_address?.toLowerCase() // Ensure lowercase
          };
        });
        
        const { error: pixelError } = await supabase
          .from('pixels')
          .insert(processedBatch);
        
        if (pixelError) {
          console.error('❌ Error inserting pixels batch:', pixelError);
        } else {
          successCount += batch.length;
          
          // Remove processed pixels from the queue
          // Get the original JSON strings for these pixels
          const processedJsonStrings = batch.map(p => 
            pixels.find(jsonStr => {
              const parsed = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
              return parsed.x === p.x && parsed.y === p.y && 
                     parsed.wallet_address === p.wallet_address && 
                     parsed.placed_at === p.placed_at;
            })
          );
          
          // Remove each processed pixel from the queue
          for (const jsonStr of processedJsonStrings) {
            if (jsonStr) {
              await redis.lrem('supabase:pixels:queue', 0, jsonStr);
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
    const pendingBans = await redis.lrange('supabase:bans:queue', 0, -1);
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
          .from('banned_wallets')
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
        const removeCount = await redis.lrem('supabase:bans:queue', 0, banJson);
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
          .from('backup_logs')
          .update({
            status: 'completed',
            duration_ms: Date.now() - Number(await redis.get('last_backup_time') || 0)
          })
          .eq('id', backupId);
        
        await redis.del('current_backup_id');
      }
    }

    // Verify final state
    const remainingBans = await redis.lrange('supabase:bans:queue', 0, -1);
    const bannedWallets = await redis.smembers('banned:wallets:permanent');
    console.log('🔄 Final queue state:', { 
      remainingBans: remainingBans.length,
      permanentBans: bannedWallets.length 
    });

    // Clear processing flag at the end
    await redis.del('queue_processing_active');
    console.log('🔄 Cleared processing flag');

    return NextResponse.json({ 
      processed: { 
        pixels: pixels.length, 
        users: users.length, 
        bans: pendingBans.length 
      },
      backup: isBackup ? backupStats : null
    });
  } catch (error) {
    console.error('Error processing queues:', error);
    // Clear flag even on error
    await redis.del('queue_processing_active');
    console.log('🔄 Cleared processing flag after error');
    return NextResponse.json({ error: 'Failed to process queues' }, { status: 500 });
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