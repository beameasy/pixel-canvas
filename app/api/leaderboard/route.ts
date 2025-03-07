import { redis } from '@/lib/server/redis';
import { NextResponse } from 'next/server';

// Force this route to be dynamic and never cached
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET() {
  console.log('🏆 Leaderboard API: Request received');
  
  try {
    console.log('🏆 Leaderboard API: Checking Redis connection...');
    
    // Perform a simple ping to verify Redis connection
    try {
      await redis.ping();
      console.log('🏆 Leaderboard API: Redis connection OK');
    } catch (redisError) {
      console.error('🚨 Leaderboard API: Redis connection failed', redisError);
      throw new Error('Redis connection failed: ' + (redisError instanceof Error ? redisError.message : String(redisError)));
    }
    
    console.log('🏆 Leaderboard API: Fetching canvas pixels...');
    // Get current canvas state from Redis
    const pixels = await redis.hgetall('canvas:pixels');
    console.log(`🏆 Leaderboard API: Retrieved ${pixels ? Object.keys(pixels).length : 0} pixels`);
    
    console.log('🏆 Leaderboard API: Fetching pixel history...');
    // Get all pixel history to calculate total pixels placed
    const allPixelHistory = await redis.zrange('canvas:history', 0, -1);
    console.log(`🏆 Leaderboard API: Retrieved ${allPixelHistory ? allPixelHistory.length : 0} pixel history entries`);
    
    const pixelHistory24h = await redis.zrange('canvas:history', Date.now() - 86400000, Date.now(), { byScore: true });
    console.log(`🏆 Leaderboard API: Retrieved ${pixelHistory24h ? pixelHistory24h.length : 0} pixel history entries (24h)`);
    
    const pixelHistory1h = await redis.zrange('canvas:history', Date.now() - 3600000, Date.now(), { byScore: true });
    console.log(`🏆 Leaderboard API: Retrieved ${pixelHistory1h ? pixelHistory1h.length : 0} pixel history entries (1h)`);
    
    console.log('🏆 Leaderboard API: Fetching user data...');
    const farcasterData = await redis.hgetall('users');
    console.log(`🏆 Leaderboard API: Retrieved ${farcasterData ? Object.keys(farcasterData).length : 0} user entries`);

    console.log('🏆 Leaderboard API: Processing data...');
    const userStats = new Map();

    // Process all pixel history for total counts
    if (allPixelHistory && allPixelHistory.length > 0) {
      console.log('🏆 Leaderboard API: Processing all pixel history...');
      allPixelHistory.forEach(entry => {
        try {
          const data = typeof entry === 'string' ? JSON.parse(entry) : entry;
          const { wallet_address, color } = data;
          
          if (!wallet_address) {
            console.warn('🏆 Leaderboard API: Found entry without wallet_address', data);
            return;
          }
          
          const stats = userStats.get(wallet_address) || {
            wallet_address,
            total_pixels: 0,
            current_pixels: 0,
            pixels_24h: 0,
            pixels_1h: 0,
            colors: new Map(),
            farcaster_username: null,
            farcaster_pfp: null
          };
          
          stats.total_pixels++;
          stats.colors.set(color, (stats.colors.get(color) || 0) + 1);
          userStats.set(wallet_address, stats);
        } catch (parseError) {
          console.error('🚨 Leaderboard API: Error parsing pixel history entry', parseError, entry);
        }
      });
    } else {
      console.warn('🏆 Leaderboard API: No pixel history found or empty array');
    }

    // Process current pixels on canvas
    if (pixels && Object.keys(pixels).length > 0) {
      console.log('🏆 Leaderboard API: Processing current pixels...');
      Object.entries(pixels).forEach(([key, value]) => {
        try {
          const data = typeof value === 'string' ? JSON.parse(value) : value;
          const { wallet_address } = data;
          
          if (!wallet_address) {
            console.warn(`🏆 Leaderboard API: Pixel at ${key} has no wallet_address`, data);
            return;
          }
          
          const stats = userStats.get(wallet_address);
          if (stats) {
            stats.current_pixels++;
          }
        } catch (err) {
          console.error(`🚨 Leaderboard API: Error processing pixel data at ${key}:`, err);
        }
      });
    } else {
      console.warn('🏆 Leaderboard API: No pixels found on canvas or empty object');
    }

    // Process recent activity
    if (pixelHistory24h && pixelHistory24h.length > 0) {
      console.log('🏆 Leaderboard API: Processing 24h pixel history...');
      pixelHistory24h.forEach(entry => {
        try {
          const data = typeof entry === 'string' ? JSON.parse(entry) : entry;
          const { wallet_address } = data;
          const stats = userStats.get(wallet_address);
          if (stats) stats.pixels_24h++;
        } catch (parseError) {
          console.error('🚨 Leaderboard API: Error parsing 24h pixel history entry', parseError);
        }
      });
    }

    if (pixelHistory1h && pixelHistory1h.length > 0) {
      console.log('🏆 Leaderboard API: Processing 1h pixel history...');
      pixelHistory1h.forEach(entry => {
        try {
          const data = typeof entry === 'string' ? JSON.parse(entry) : entry;
          const { wallet_address } = data;
          const stats = userStats.get(wallet_address);
          if (stats) stats.pixels_1h++;
        } catch (parseError) {
          console.error('🚨 Leaderboard API: Error parsing 1h pixel history entry', parseError);
        }
      });
    }

    // Add Farcaster data and token balances
    if (farcasterData && Object.keys(farcasterData).length > 0) {
      console.log('🏆 Leaderboard API: Processing user data...');
      Object.entries(farcasterData).forEach(([wallet_address, data]) => {
        try {
          const userData = typeof data === 'string' ? JSON.parse(data) : data;
          const { farcaster_username: username, farcaster_pfp: pfp_url, token_balance } = userData;
          const stats = userStats.get(wallet_address);
          if (stats) {
            stats.farcaster_username = username;
            stats.farcaster_pfp = pfp_url;
            stats.token_balance = Number(token_balance) || 0;
          }
        } catch (err) {
          console.error(`🚨 Leaderboard API: Error processing user data for ${wallet_address}:`, err);
        }
      });
    } else {
      console.warn('🏆 Leaderboard API: No farcaster data found or empty object');
    }

    console.log('🏆 Leaderboard API: Preparing final response...');
    const leaderboard = Array.from(userStats.values())
      .map(stats => ({
        wallet_address: stats.wallet_address,
        farcaster_username: stats.farcaster_username,
        farcaster_pfp: stats.farcaster_pfp,
        total_pixels: stats.total_pixels || 0,
        current_pixels: stats.current_pixels || 0,
        pixels_24h: stats.pixels_24h || 0,
        pixels_1h: stats.pixels_1h || 0,
        favorite_color: Array.from(stats.colors.entries() as [string, number][])
          .sort((a, b) => b[1] - a[1])[0]?.[0] || '#000000',
        token_balance: stats.token_balance || 0
      }))
      .filter(user => user.total_pixels > 0);

    console.log(`🏆 Leaderboard API: Sending response with ${leaderboard.length} entries`);
    
    // Force no caching
    return NextResponse.json(leaderboard, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Surrogate-Control': 'no-store'
      }
    });
  } catch (error) {
    console.error('🚨 Leaderboard API: Error fetching leaderboard:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
    return NextResponse.json({ 
      error: 'Failed to fetch leaderboard',
      details: error instanceof Error ? error.message : String(error)
    }, { 
      status: 500,
      headers: {
        'Cache-Control': 'no-store'
      }
    });
  }
} 