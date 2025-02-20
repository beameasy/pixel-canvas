import { redis } from '@/lib/server/redis';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    console.log('🔍 Fetching pixel history...');
    
    // Get most recent pixels (last 10)
    const recentPixels = await redis.zrange(
      'canvas:history',
      0,
      9,
      { rev: true }
    );
    
    console.log('📊 Found pixels:', {
      count: recentPixels.length,
      sample: recentPixels.slice(0, 1)
    });
    
    // Return in reverse order to show newest first
    return NextResponse.json(recentPixels.reverse());
  } catch (error) {
    console.error('❌ Failed to fetch pixel history:', error);
    return NextResponse.json([], { status: 500 });
  }
} 