import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const startTime = performance.now();
    
    // Check Redis cache first
    const cached = await redis.get('ticker:top_users');
    if (cached && typeof cached === 'string') {
      console.log('✅ Ticker cache hit:', {
        timeMs: performance.now() - startTime
      });
      return NextResponse.json(JSON.parse(cached), {
        headers: {
          'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=30'
        }
      });
    }

    // Get last hour's timestamp
    const hourAgo = Date.now() - (60 * 60 * 1000);
    
    // Get pixels placed in the last hour
    const recentPixels = await redis.zrange(
      'canvas:history',
      hourAgo,
      '+inf',
      { byScore: true }
    );

    // Count pixels per user
    const userCounts: Record<string, number> = {};
    const userDetails: Record<string, any> = {};

    for (const pixelStr of recentPixels) {
      const pixel = typeof pixelStr === 'string' ? JSON.parse(pixelStr) : pixelStr;
      const { wallet_address, farcaster_username, farcaster_pfp } = pixel;
      
      userCounts[wallet_address] = (userCounts[wallet_address] || 0) + 1;
      
      if (!userDetails[wallet_address]) {
        userDetails[wallet_address] = {
          wallet_address,
          farcaster_username,
          farcaster_pfp
        };
      }
    }

    // Convert to array and sort by count
    const topUsers = Object.entries(userCounts)
      .map(([wallet_address, count]) => ({
        ...userDetails[wallet_address],
        count
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Cache for 5 seconds
    await redis.set('ticker:top_users', JSON.stringify(topUsers), {
      ex: 5 // 5 second expiration
    });

    console.log('📊 Fresh ticker data:', {
      users: topUsers.length,
      timeMs: performance.now() - startTime
    });

    return NextResponse.json(topUsers, {
      headers: {
        'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=30'
      }
    });
  } catch (error) {
    console.error('❌ Ticker error:', error);
    return NextResponse.json([], { status: 500 });
  }
} 