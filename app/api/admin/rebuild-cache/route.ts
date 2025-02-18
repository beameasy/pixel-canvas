import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';
import { getAdminClient } from '../../_lib/supabaseAdmin';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

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
    
    // 1. Rebuild canvas pixels
    const { data: pixels, error: pixelsError } = await supabase
      .from('pixels')
      .select('*')
      .order('placed_at', { ascending: true });
      
    if (pixelsError) throw pixelsError;

    const canvasPixels: Record<string, any> = {};
    const canvasHistory: Array<[number, string]> = [];
    pixels?.forEach(pixel => {
      const key = `${pixel.x},${pixel.y}`;
      canvasPixels[key] = JSON.stringify(pixel);
      // Convert placed_at to timestamp for score
      const score = new Date(pixel.placed_at).getTime();
      canvasHistory.push([score, JSON.stringify(pixel)]);
    });

    // Build history entries
    const historyEntries = pixels?.map(pixel => ({
      score: new Date(pixel.placed_at).getTime(),
      member: JSON.stringify(pixel)
    })) || [];

    // 2. Rebuild users cache
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('*');

    if (usersError) throw usersError;

    const usersCache: Record<string, any> = {};
    const usersFarcasterCache: Record<string, any> = {};
    users?.forEach(user => {
      // Main users cache with wallet address as key
      usersCache[user.wallet_address] = JSON.stringify(user);
      
      // Farcaster cache with wallet_address as key
      if (user.farcaster_username) {
        usersFarcasterCache[user.wallet_address] = JSON.stringify({
          farcaster_username: user.farcaster_username,
          farcaster_pfp: user.farcaster_pfp
        });
      }
    });

    // 3. Rebuild banned wallets cache
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

    // 4. Update all Redis caches
    console.log('💾 Updating Redis caches...');
    await Promise.all([
      // Canvas pixels hash
      redis.del('canvas:pixels'),
      redis.hset('canvas:pixels', canvasPixels),
      // Canvas history
      redis.del('canvas:history'),
      // Add each history entry individually
      ...historyEntries.map(entry => 
        redis.zadd('canvas:history', { score: entry.score, member: entry.member })
      ),
      // Users caches
      redis.hset('users', usersCache),
      redis.hset('users:farcaster', usersFarcasterCache),
      // Clear any processing flags
      redis.del('queue_processing_active'),
      // Clear queues
      redis.del('supabase:pixels:queue'),
      redis.del('supabase:users:queue'),
      redis.del('canvas:pixels:queue'),
      redis.del('users:queue'),
      redis.del('pending:bans')
    ]);
    
    console.log('✅ Cache rebuild complete:', {
      pixels: pixels?.length,
      users: users?.length,
      farcasterUsers: Object.keys(usersFarcasterCache).length,
      bannedWallets: bannedWallets?.length
    });

    return NextResponse.json({ 
      success: true, 
      pixelsProcessed: pixels?.length,
      usersProcessed: users?.length,
      farcasterUsersProcessed: Object.keys(usersFarcasterCache).length
    });

  } catch (error) {
    console.error('❌ Cache rebuild failed:', error);
    return NextResponse.json({ error: 'Cache rebuild failed' }, { status: 500 });
  }
} 