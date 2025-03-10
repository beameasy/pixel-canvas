import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    // Check if we want data for the last hour (default) or 24 hours
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period');
    const is24Hour = period === '24h';
    
    const pixels = await redis.hgetall('canvas:pixels');
    const pixelsArray = Object.values(pixels || {}).map(p => 
      typeof p === 'string' ? JSON.parse(p) : p
    );
    
    const ONE_HOUR = 60 * 60 * 1000;
    const TWENTY_FOUR_HOURS = 24 * ONE_HOUR;
    const now = Date.now();
    const timeFrame = is24Hour ? TWENTY_FOUR_HOURS : ONE_HOUR;

    // Use same calculation as in pixel placement but with variable timeframe
    const userCounts = pixelsArray
      .filter(pixel => {
        const placedAt = new Date(pixel.placed_at).getTime();
        return (now - placedAt) <= timeFrame;
      })
      .reduce<Record<string, any>>((acc, pixel) => {
        const { wallet_address, farcaster_username, farcaster_pfp } = pixel;
        if (!acc[wallet_address]) {
          acc[wallet_address] = {
            wallet_address,
            count: 0,
            farcaster_username,
            farcaster_pfp
          };
        }
        acc[wallet_address].count++;
        return acc;
      }, {});

    const topUsers = Object.values(userCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const pixelHistory = await redis.zrange('canvas:history', 0, -1);

    return NextResponse.json(topUsers, {
      headers: {
        'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=10'
      }
    });
  } catch (error) {
    console.error('Error fetching ticker data:', error);
    return NextResponse.json([], {
      headers: {
        'Cache-Control': 'no-store'
      }
    });
  }
} 