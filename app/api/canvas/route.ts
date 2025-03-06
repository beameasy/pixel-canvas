import { redis } from '@/lib/server/redis';
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic'; // Still need this to ensure fresh data on server

// NEW separate route for canvas state
export async function GET(request: Request) {
  try {
    // Get current timestamp for cache decisions
    const now = Date.now();
    
    // Get pixels from Redis
    const pixels = await redis.hgetall('canvas:pixels');
    if (!pixels) {
      console.error('No pixels found in Redis');
      return NextResponse.json([], {
        headers: {
          'Cache-Control': 'public, max-age=0, must-revalidate'
        }
      });
    }

    const pixelsArray = Object.entries(pixels).map(([key, value]) => {
      const [x, y] = key.split(',');
      const pixelData = typeof value === 'string' ? JSON.parse(value) : value;
      return {
        ...pixelData,
        x: parseInt(x),
        y: parseInt(y)
      };
    });

    // Generate ETag based on content
    const etag = `"${now}-${Object.keys(pixels).length}"`;
    
    // Check if client has fresh copy
    const headersList = headers();
    const ifNoneMatch = headersList.get('if-none-match');
    
    if (ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'Cache-Control': 'public, max-age=5, stale-while-revalidate=10',
          'ETag': etag
        }
      });
    }

    return NextResponse.json(pixelsArray, {
      headers: {
        'Cache-Control': 'public, max-age=5, stale-while-revalidate=10',
        'ETag': etag
      }
    });
  } catch (error) {
    console.error('Error fetching canvas:', error);
    return NextResponse.json([], {
      status: 500,
      headers: {
        'Cache-Control': 'no-store'
      }
    });
  }
} 