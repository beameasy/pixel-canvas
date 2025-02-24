import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';

export async function GET() {
  try {
    const recentHistory = await redis.zrange('canvas:history', -100, -1, {
      rev: true
    });
    
    if (!recentHistory || !recentHistory.length) {
      return NextResponse.json({ users: [] });
    }

    const walletCounts = recentHistory.reduce((acc: Record<string, number>, pixel: any) => {
      acc[pixel.wallet_address] = (acc[pixel.wallet_address] || 0) + 1;
      return acc;
    }, {});

    const users = Object.entries(walletCounts)
      .map(([wallet_address, score]) => ({ wallet_address, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    return NextResponse.json({ users });
  } catch (error) {
    console.error('Failed to fetch top users:', error);
    return NextResponse.json({ users: [] });
  }
} 