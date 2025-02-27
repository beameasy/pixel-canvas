import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';

export async function GET() {
  try {
    // For Canvas - current state
    const pixels = await redis.hgetall('canvas:pixels') || {};
    const pixelArray = Object.entries(pixels).map(([key, value]) => {
      const [x, y] = key.split(',');
      return {
        x: parseInt(x),
        y: parseInt(y),
        ...JSON.parse(value as string)
      };
    });

    // For PixelFeed - recent history
    const recentHistory = await redis.zrange('canvas:history', -10, -1, {
      rev: true
    }) || [];

    return NextResponse.json({
      pixels: pixelArray,
      placements: recentHistory, // Add placements for PixelFeed
      cooldownInfo: null
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30'
      }
    });
  } catch (error) {
    console.error('Failed to fetch pixels:', error);
    return NextResponse.json({ 
      pixels: [],
      placements: [], // Empty placements array
      cooldownInfo: null
    });
  }
} 