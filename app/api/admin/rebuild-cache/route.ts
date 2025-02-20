import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';
import { getAdminClient } from '../../_lib/supabaseAdmin';

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
    const supabase = getAdminClient();
    
    // 1. Get total pixel count
    const { count: totalPixels, error: countError } = await supabase
      .from('pixels')
      .select('*', { count: 'exact', head: true });

    if (countError) throw countError;
    
    console.log(`📊 Total pixels to process: ${totalPixels}`);
    
    // 2. Process pixels in batches
    const canvasPixels: Record<string, any> = {};
    const historyEntries: Array<{score: number, member: string}> = [];
    
    for (let i = 0; i < totalPixels!; i += BATCH_SIZE) {
      console.log(`🔄 Processing pixels batch ${i / BATCH_SIZE + 1}/${Math.ceil(totalPixels! / BATCH_SIZE)}`);
      
      const { data: pixels, error: pixelsError } = await supabase
        .from('pixels')
        .select('*')
        .order('placed_at', { ascending: true })
        .range(i, i + BATCH_SIZE - 1);
        
      if (pixelsError) throw pixelsError;

      pixels?.forEach(pixel => {
        const key = `${pixel.x},${pixel.y}`;
        canvasPixels[key] = JSON.stringify(pixel);
        historyEntries.push({
          score: new Date(pixel.placed_at).getTime(),
          member: JSON.stringify(pixel)
        });
      });
    }

    // 3. Rebuild users cache
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('*');

    if (usersError) throw usersError;

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
    const { data: bannedWallets, error: bannedError } = await supabase
      .from('banned_wallets')
      .select('wallet_address')
      .eq('active', true);

    if (bannedError) throw bannedError;

    // Clear and rebuild banned wallets cache
    await redis.del('banned:wallets:permanent');
    if (bannedWallets?.length > 0) {
      await redis.sadd('banned:wallets:permanent', 
        bannedWallets.map(b => b.wallet_address.toLowerCase())
      );
    }

    // 5. Update Redis caches in batches
    console.log('💾 Updating Redis caches...');
    
    // Clear existing caches
    await Promise.all([
      redis.del('canvas:pixels'),
      redis.del('canvas:history'),
      redis.del('queue_processing_active'),
      redis.del('supabase:pixels:queue'),
      redis.del('supabase:users:queue'),
      redis.del('canvas:pixels:queue'),
      redis.del('users:queue'),
      redis.del('pending:bans')
    ]);

    // Update canvas pixels in batches
    const pixelEntries = Object.entries(canvasPixels);
    for (let i = 0; i < pixelEntries.length; i += BATCH_SIZE) {
      const batch = Object.fromEntries(pixelEntries.slice(i, i + BATCH_SIZE));
      await redis.hset('canvas:pixels', batch);
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