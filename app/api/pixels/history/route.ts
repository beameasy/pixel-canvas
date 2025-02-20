import { redis } from '@/lib/server/redis';
import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '10');
    
    console.log('🔍 Fetching pixel history...', { limit });
    
    const pixels = await redis.zrange(
      'canvas:history',
      0,
      limit - 1,
      { rev: true }
    );
    
    console.log('📊 Found pixels:', {
      count: pixels.length,
      sample: pixels.slice(0, 1)
    });
    
    return NextResponse.json(pixels);
  } catch (error) {
    console.error('❌ Failed to fetch pixel history:', error);
    return NextResponse.json([], { status: 500 });
  }
} 