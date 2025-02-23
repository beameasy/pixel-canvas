import { redis } from '@/lib/server/redis';
import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const start = (page - 1) * limit;
    const end = start + limit - 1;

    // Get items from newest to oldest using ZRANGE with REV option
    const pixels = await redis.zrange('canvas:history', start, end, { 
      rev: true 
    });
    
    return NextResponse.json(pixels);
  } catch (error) {
    console.error('Failed to fetch pixel history:', error);
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
  }
} 