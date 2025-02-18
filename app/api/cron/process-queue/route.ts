import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';
import { getAdminClient } from '../../_lib/supabaseAdmin';
import { v4 as uuidv4 } from 'uuid';

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  console.log('🔄 Queue processor triggered via:', request.method);
  try {
    const supabase = getAdminClient();
    
    // Process pixels queue
    const pixels = await redis.lrange('supabase:pixels:queue', 0, -1) || [];
    if (pixels.length > 0) {
      console.log('📋 Processing pixels:', pixels.length);
      const parsedPixels = pixels.map(p => typeof p === 'string' ? JSON.parse(p) : p);
      
      // Log the actual data being sent to Supabase
      console.log('📋 Inserting pixels:', parsedPixels);
      
      const { error: pixelError } = await supabase
        .from('pixels')
        .insert(parsedPixels);
      
      if (pixelError) {
        console.error('❌ Error inserting pixels:', pixelError);
      } else {
        await redis.del('supabase:pixels:queue');
        console.log('✅ Processed pixels:', pixels.length);
      }
    }

    // Process users queue
    console.log('🔄 Checking users queue...');
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
        .upsert(uniqueUsers.map(user => ({
          wallet_address: user.wallet_address,
          farcaster_username: user.farcaster_username,
          farcaster_pfp: user.farcaster_pfp,
          last_active: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          token_balance: user.token_balance,
          privy_id: user.privy_id
        })), { 
          onConflict: 'wallet_address'
        });

      if (userError) {
        console.error('❌ Error upserting users:', userError);
      } else {
        await redis.del('supabase:users:queue');
        console.log('✅ Processed users:', uniqueUsers.length);
      }
    }

    // Process pending bans
    console.log('🔄 Processing ban queue...');
    const pendingBans = await redis.lrange('supabase:bans:queue', 0, -1);
    console.log('📋 Found pending bans:', pendingBans);

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
          .insert([banRecord])
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
      } 
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
  return GET(request); // Reuse the GET handler for POST requests
} 