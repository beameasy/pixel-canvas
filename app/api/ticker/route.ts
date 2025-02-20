import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Get last hour's timestamp
    const hourAgo = Date.now() - (60 * 60 * 1000);
    console.log('🕒 Fetching pixels since:', new Date(hourAgo));
    
    // Get pixels placed in the last hour
    const recentPixels = await redis.zrange(
      'canvas:history',
      hourAgo,
      '+inf',
      { byScore: true }
    );
    console.log('📊 Found pixels:', recentPixels.length);

    // Count pixels per user
    const userCounts: Record<string, number> = {};
    const userDetails: Record<string, any> = {};

    for (const pixelStr of recentPixels) {
      // Parse the JSON string into an object
      const pixel = typeof pixelStr === 'string' ? JSON.parse(pixelStr) : pixelStr;
      const { wallet_address, farcaster_username, farcaster_pfp } = pixel;
      
      userCounts[wallet_address] = (userCounts[wallet_address] || 0) + 1;
      
      // Store user details if we haven't already
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

    console.log('📊 Returning top users:', topUsers);
    return NextResponse.json(topUsers);
    
  } catch (error) {
    console.error('❌ Ticker error:', error);
    return NextResponse.json([], { status: 500 });
  }
} 