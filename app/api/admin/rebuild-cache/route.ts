import { NextResponse } from 'next/server';
import { redis, getQueueName } from '@/lib/server/redis';
import { getAdminClient, getTableName } from '../../_lib/supabaseAdmin';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const BATCH_SIZE = 1000;

export async function POST(request: Request) {
  console.log('🔄 Cache rebuild triggered');
  
  // Auth check
  const cronSecret = request.headers.get('x-admin-secret');
  if (cronSecret !== process.env.CRON_SECRET) {
    console.log('❌ Invalid admin secret');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('🔄 Starting cache rebuild. Purging existing cache...');
    
    // Clear queue data
    const pixelsQueue = getQueueName('supabase:pixels:queue');
    const usersQueue = getQueueName('supabase:users:queue');
    const bansQueue = getQueueName('supabase:bans:queue');
    
    await Promise.all([
      redis.del('canvas:pixels'),
      redis.del('canvas:pixels:metadata'),
      redis.del(pixelsQueue),
      redis.del(usersQueue),
      redis.del(bansQueue),
      redis.del('canvas:history')
    ]);
    
    // Get admin client
    const supabase = getAdminClient();
    
    // Load pixels from Supabase
    console.log('📥 Loading pixels from Supabase...');
    const { data: pixels, error: pixelError } = await supabase
      .from(getTableName('pixels'))
      .select('*')
      .order('placed_at', { ascending: false });
      
    if (pixelError) {
      throw new Error(`Failed to load pixels: ${pixelError.message}`);
    }
    
    // Handle case with no pixels
    if (!pixels || pixels.length === 0) {
      return NextResponse.json({ 
        success: true, 
        message: 'Cache rebuild complete - no pixels found in database' 
      });
    }
    
    console.log(`📊 Found ${pixels.length} pixels in database`);
    
    // Get user data
    console.log('👤 Loading user data from Supabase...');
    const { data: users, error: userError } = await supabase
      .from(getTableName('users'))
      .select('*');
      
    if (userError) {
      throw new Error(`Failed to load users: ${userError.message}`);
    }
    
    // Load banned wallets
    console.log('🚫 Loading banned wallets from Supabase...');
    const { data: bannedWallets, error: bannedError } = await supabase
      .from(getTableName('banned_wallets'))
      .select('*');
      
    if (bannedError) {
      throw new Error(`Failed to load banned wallets: ${bannedError.message}`);
    }

    // 1. Get total pixel count
    const { count: totalPixels, error: countError } = await supabase
      .from(getTableName('pixels'))
      .select('*', { count: 'exact', head: true });

    if (countError) throw countError;
    
    console.log(`📊 Total pixels to process: ${totalPixels}`);
    
    // 2. Process pixels in batches
    const canvasPixels: Record<string, any> = {};
    const historyEntries: Array<{score: number, member: string}> = [];
    
    for (let i = 0; i < totalPixels!; i += BATCH_SIZE) {
      console.log(`🔄 Processing pixels batch ${i / BATCH_SIZE + 1}/${Math.ceil(totalPixels! / BATCH_SIZE)}`);
      
      const { data: pixelsBatch, error: pixelsBatchError } = await supabase
        .from(getTableName('pixels'))
        .select('*')
        .order('placed_at', { ascending: true })
        .range(i, i + BATCH_SIZE - 1);
        
      if (pixelsBatchError) throw pixelsBatchError;

      pixelsBatch?.forEach(pixel => {
        const key = `${pixel.x},${pixel.y}`;
        canvasPixels[key] = JSON.stringify(pixel);
        historyEntries.push({
          score: new Date(pixel.placed_at).getTime(),
          member: JSON.stringify(pixel)
        });
      });
    }

    // 3. Rebuild users cache
    const usersCache: Record<string, any> = {};
    const usersFarcasterCache: Record<string, any> = {};
    users?.forEach(user => {
      usersCache[user.wallet_address] = JSON.stringify(user);
      if (user.farcaster_username) {
        usersFarcasterCache[user.wallet_address] = JSON.stringify({
          farcaster_username: user.farcaster_username,
          farcaster_pfp: user.farcaster_pfp
        });
      }
    });

    // 4. Rebuild banned wallets cache
    await redis.del('banned:wallets:permanent');
    if (bannedWallets?.length > 0) {
      await redis.sadd('banned:wallets:permanent', 
        bannedWallets.map(b => b.wallet_address.toLowerCase())
      );
    }

    // 5. Update Redis caches in batches
    console.log('💾 Updating Redis caches...');
    
    // Update canvas pixels in batches
    const pixelEntries = Object.entries(canvasPixels);
    for (let i = 0; i < pixelEntries.length; i += BATCH_SIZE) {
      const batch = Object.fromEntries(pixelEntries.slice(i, i + BATCH_SIZE));
      // Format pixels for Redis
      const formattedPixels = Object.entries(batch).map(([key, value]) => {
        const pixel = JSON.parse(value as string);
        // Ensure all pixels have a version field
        if (!pixel.version) {
          pixel.version = 1; // Default to version 1 for historical pixels
        }
        return [key, JSON.stringify(pixel)];
      }).flat();
      
      // Update Redis batch
      const redisBatch: Record<string, string> = {};
      for (let i = 0; i < formattedPixels.length; i += 2) {
        const key = formattedPixels[i] as string;
        const value = formattedPixels[i + 1] as string;
        redisBatch[key] = value;
      }
      
      // Update canvas pixels in batches
      console.log(`🔄 Updating Redis cache with ${Object.keys(redisBatch).length} pixels`);
      await redis.hset('canvas:pixels', redisBatch);
    }

    // Update history in much smaller batches to avoid size limit
    const HISTORY_BATCH_SIZE = 250; // Much smaller batch for history entries
    for (let i = 0; i < historyEntries.length; i += HISTORY_BATCH_SIZE) {
      const batch = historyEntries.slice(i, i + HISTORY_BATCH_SIZE);
      console.log(`🔄 Processing history batch ${i / HISTORY_BATCH_SIZE + 1}/${Math.ceil(historyEntries.length / HISTORY_BATCH_SIZE)}`);
      
      // Process each entry individually to avoid large batch requests
      for (const entry of batch) {
        await redis.zadd('canvas:history', { score: entry.score, member: entry.member });
      }
    }

    // Update user caches
    await redis.hset('users', usersCache);
    await redis.hset('users:farcaster', usersFarcasterCache);
    
    console.log('✅ Cache rebuild complete:', {
      pixels: totalPixels,
      users: users?.length,
      farcasterUsers: Object.keys(usersFarcasterCache).length,
      bannedWallets: bannedWallets?.length
    });

    return NextResponse.json({ 
      success: true, 
      pixelsProcessed: totalPixels,
      usersProcessed: users?.length,
      farcasterUsersProcessed: Object.keys(usersFarcasterCache).length
    });

  } catch (error) {
    console.error('❌ Cache rebuild failed:', error);
    return NextResponse.json({ error: 'Cache rebuild failed' }, { status: 500 });
  }
} 