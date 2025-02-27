import { redis } from '@/lib/server/redis';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Get current canvas state from Redis
    const pixels = await redis.hgetall('canvas:pixels');

    if (!pixels) {
      return NextResponse.json([], {
        headers: {
          'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30'
        }
      });
    }

    const pixelHistory24h = await redis.zrange('canvas:history', Date.now() - 86400000, Date.now(), { byScore: true });
    const pixelHistory1h = await redis.zrange('canvas:history', Date.now() - 3600000, Date.now(), { byScore: true });
    const farcasterData = await redis.hgetall('users');

    const userStats = new Map();

    // Process current pixels
    if (pixels) {
      Object.entries(pixels).forEach(([key, value]) => {
        const [x, y] = key.split(',');
        const data = typeof value === 'string' ? JSON.parse(value) : value;
        const { wallet_address, color } = data;
        
        const stats = userStats.get(wallet_address) || {
          wallet_address,
          total_pixels: 0,
          pixels_24h: 0,
          pixels_1h: 0,
          colors: new Map(),
          farcaster_username: null,
          farcaster_pfp: null
        };
        
        stats.total_pixels++;
        stats.colors.set(color, (stats.colors.get(color) || 0) + 1);
        userStats.set(wallet_address, stats);
      });
    }

    // Process recent activity
    pixelHistory24h.forEach(entry => {
      const { wallet_address } = typeof entry === 'string' ? JSON.parse(entry) : entry;
      const stats = userStats.get(wallet_address);
      if (stats) stats.pixels_24h++;
    });

    pixelHistory1h.forEach(entry => {
      const { wallet_address } = typeof entry === 'string' ? JSON.parse(entry) : entry;
      const stats = userStats.get(wallet_address);
      if (stats) stats.pixels_1h++;
    });

    // Add Farcaster data and token balances
    if (farcasterData) {
      Object.entries(farcasterData).forEach(([wallet_address, data]) => {
        const userData = typeof data === 'string' ? JSON.parse(data) : data;
        const { farcaster_username: username, farcaster_pfp: pfp_url, token_balance } = userData;
        const stats = userStats.get(wallet_address);
        if (stats) {
          stats.farcaster_username = username;
          stats.farcaster_pfp = pfp_url;
          stats.token_balance = Number(token_balance) || 0;  // Add token balance from user data
        }
      });
    }

    const leaderboard = Array.from(userStats.values())
      .map(stats => ({
        wallet_address: stats.wallet_address,
        farcaster_username: stats.farcaster_username,
        farcaster_pfp: stats.farcaster_pfp,
        total_pixels: stats.total_pixels || 0,
        pixels_24h: stats.pixels_24h || 0,
        pixels_1h: stats.pixels_1h || 0,
        favorite_color: Array.from(stats.colors.entries() as [string, number][])
          .sort((a, b) => b[1] - a[1])[0]?.[0] || '#000000',
        token_balance: stats.token_balance || 0  // Include in output
      }))
      .filter(user => user.total_pixels > 0); // Only show users who have placed pixels

    return NextResponse.json(leaderboard, {
      headers: {
        'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30'
      }
    });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    return NextResponse.json({ error: 'Failed to fetch leaderboard' }, { 
      status: 500,
      headers: {
        'Cache-Control': 'no-store'
      }
    });
  }
} 