import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';

export async function GET() {
  try {
    // Test basic Redis operations
    await redis.set('test:key', 'test:value');
    await redis.sadd('test:set', 'test:member');
    
    const value = await redis.get('test:key');
    const setMembers = await redis.smembers('test:set');
    
    return NextResponse.json({
      success: true,
      value,
      setMembers
    });
  } catch (error) {
    console.error('Redis test failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
} 