import { redis } from '@/lib/server/redis';
import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';

export async function GET(request: Request) {
  try {
    const startTime = performance.now();
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '6');
    
    // Check Redis cache first
    const cacheKey = `pixels:history:${limit}`;
    const cached = await redis.get(cacheKey);
    if (cached && typeof cached === 'string') {
      console.log('✅ History cache hit:', {
        limit,
        timeMs: performance.now() - startTime
      });
      return NextResponse.json(JSON.parse(cached), {
        headers: {
          'Cache-Control': 'public, s-maxage=2, stale-while-revalidate=8'
        }
      });
    }

    // Get fresh data
    const recentPixels = await redis.zrange(
      'canvas:history',
      0,
      limit - 1,
      { rev: true }
    );

    const pixels = recentPixels.map(p => 
      typeof p === 'string' ? JSON.parse(p) : p
    );

    // Cache for 2 seconds
    await redis.set(cacheKey, JSON.stringify(pixels), {
      ex: 2
    });

    console.log('📊 Fresh history data:', {
      count: pixels.length,
      timeMs: performance.now() - startTime
    });

    return NextResponse.json(pixels, {
      headers: {
        'Cache-Control': 'public, s-maxage=2, stale-while-revalidate=8'
      }
    });
  } catch (error) {
    console.error('❌ History fetch error:', error);
    return NextResponse.json([], { status: 500 });
  }
} 