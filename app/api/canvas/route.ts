import { redis } from '@/lib/server/redis';
import { NextResponse } from 'next/server';

// NEW separate route for canvas state
export async function GET(request: Request) {
  try {
    const pixels = await redis.hgetall('canvas:pixels');
    const pixelsArray = Object.entries(pixels || {}).map(([key, value]) => {
      const [x, y] = key.split(',');
      const pixelData = typeof value === 'string' ? JSON.parse(value) : value;
      return {
        ...pixelData,
        x: parseInt(x),
        y: parseInt(y)
      };
    });

    // Add stronger caching
    return NextResponse.json(pixelsArray, {
      headers: { 
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        'ETag': String(Object.keys(pixels || {}).length),
        'Vary': 'x-wallet-address'
      }
    });
  } catch (error) {
    console.error('Error fetching canvas:', error);
    return NextResponse.json([]);
  }
} 