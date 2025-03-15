import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';

export async function GET() {
  try {
    const isProd = process.env.NODE_ENV === 'production';
    
    if (isProd) {
      return NextResponse.json({
        success: false,
        message: 'Redis test endpoint is disabled in production environment',
        environment: process.env.NODE_ENV
      }, { status: 403 });
    }
    
    // Test basic Redis operations - only runs in development
    await redis.set('test:key', 'test:value');
    await redis.sadd('test:set', 'test:member');
    
    const value = await redis.get('test:key');
    const setMembers = await redis.smembers('test:set');
    
    return NextResponse.json({
      success: true,
      value,
      setMembers,
      environment: process.env.NODE_ENV
    });
  } catch (error) {
    console.error('Redis test failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
} 