import { redis } from '@/lib/server/redis';
import { NextResponse } from 'next/server';

// NEW separate route for canvas state
export async function GET(request: Request) {
  try {
    // Get current timestamp for cache decisions
    const now = Date.now();
    
    // Get pixels from Redis
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

    // Generate ETag based on content
    const etag = `"${now}-${Object.keys(pixels || {}).length}"`;
    
    // Check if client has fresh copy
    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
          'ETag': etag
        }
      });
    }

    return NextResponse.json(pixelsArray, {
      headers: {
        'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
        'ETag': etag
      }
    });
  } catch (error) {
    console.error('Error fetching canvas:', error);
    return NextResponse.json([], {
      headers: {
        'Cache-Control': 'no-store'
      }
    });
  }
} 