import { redis } from '@/lib/server/redis';
import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';

export async function GET(request: Request) {
  try {
    const pixels = await redis.hgetall('canvas:pixels');
    const pixelsArray = Object.values(pixels || {})
      .map(p => typeof p === 'string' ? JSON.parse(p) : p)
      .sort((a, b) => new Date(b.placed_at).getTime() - new Date(a.placed_at).getTime())
      .slice(0, 6)
      .map(pixel => ({
        ...pixel,
        id: `${pixel.x}-${pixel.y}-${pixel.placed_at}`
      }));

    return NextResponse.json(pixelsArray);
  } catch (error) {
    console.error('Error fetching pixel history:', error);
    return NextResponse.json([]);
  }
} 