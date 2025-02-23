import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const pixels = await redis.hgetall('canvas:pixels');
    const pixelsArray = Object.values(pixels || {}).map(p => 
      typeof p === 'string' ? JSON.parse(p) : p
    );
    
    const ONE_HOUR = 60 * 60 * 1000;
    const now = Date.now();

    // Use same calculation as in pixel placement
    const userCounts = pixelsArray
      .filter(pixel => {
        const placedAt = new Date(pixel.placed_at).getTime();
        return (now - placedAt) <= ONE_HOUR;
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

    return NextResponse.json(topUsers);
  } catch (error) {
    console.error('Error fetching ticker data:', error);
    return NextResponse.json([]);
  }
} 