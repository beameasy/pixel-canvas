import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';

const CACHE_DURATION = 300; // Increase cache to 5 minutes
const STALE_DURATION = 600; // Allow stale data for up to 10 minutes
const CACHE_KEY_PREFIX = 'ticker:cache:';
const LOCK_KEY_PREFIX = 'ticker:lock:';

interface TickerUser {
  wallet_address: string;
  count: number;
  farcaster_username: string | null;
  farcaster_pfp: string | null;
}

async function acquireLock(key: string, duration: number): Promise<boolean> {
  const lockKey = `${LOCK_KEY_PREFIX}${key}`;
  const acquired = await redis.set(lockKey, '1', {
    nx: true,
    ex: duration
  });
  return acquired === 'OK';
}

async function releaseLock(key: string) {
  const lockKey = `${LOCK_KEY_PREFIX}${key}`;
  await redis.del(lockKey);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period');
    const cacheKey = `${CACHE_KEY_PREFIX}${period || '1h'}`;
    
    // Try to get cached data first
    const [cachedData, cachedTimestamp] = await Promise.all([
      redis.get<string | null>(cacheKey),
      redis.get<string | null>(`${cacheKey}:timestamp`)
    ]);

    const now = Date.now();
    const timestamp = cachedTimestamp ? parseInt(cachedTimestamp) : 0;
    const age = now - timestamp;

    // If we have fresh cached data, return it immediately
    if (cachedData && age < CACHE_DURATION * 1000) {
      try {
        // Ensure cached data is a string
        const jsonData = typeof cachedData === 'string' ? cachedData : JSON.stringify(cachedData);
        return new NextResponse(jsonData, {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `public, max-age=${CACHE_DURATION}, stale-while-revalidate=${STALE_DURATION}`,
            'X-Cache': 'HIT',
            'X-Cache-Age': age.toString()
          }
        });
      } catch (e) {
        console.error('Invalid cached data:', e);
        // Continue to fetch fresh data
      }
    }

    // If we have stale data but can't acquire lock, return stale data
    if (cachedData && !(await acquireLock(cacheKey, 30))) {
      try {
        // Ensure stale data is a string
        const jsonData = typeof cachedData === 'string' ? cachedData : JSON.stringify(cachedData);
        return new NextResponse(jsonData, {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `public, max-age=0, stale-while-revalidate=${STALE_DURATION}`,
            'X-Cache': 'STALE',
            'X-Cache-Age': age.toString()
          }
        });
      } catch (e) {
        console.error('Invalid stale data:', e);
        // Continue to fetch fresh data
      }
    }

    try {
      let startTime: number;
      
      // Set time window based on period
      if (period === '24h') {
        startTime = now - (24 * 60 * 60 * 1000); // 24 hours
      } else {
        startTime = now - (60 * 60 * 1000); // 1 hour default
      }

      // Get pixel history for the specified time window using scores
      const pixelHistory = await redis.zrange(
        'canvas:history',
        startTime,
        now,
        { byScore: true }
      );

      console.log('Found pixel history entries:', pixelHistory?.length || 0);

      // Process pixels to count user activity
      const userCounts = new Map<string, TickerUser>();

      // Process each pixel placement
      for (const entry of pixelHistory || []) {
        try {
          // Parse the entry if it's a string, or use it directly if it's an object
          let pixel: any;
          if (typeof entry === 'string') {
            try {
              pixel = JSON.parse(entry);
            } catch (e) {
              // If parsing fails, try to parse the stringified version of the entry
              try {
                pixel = JSON.parse(JSON.stringify(entry));
              } catch (e2) {
                console.error('Failed to parse pixel entry:', entry);
                continue;
              }
            }
          } else {
            // If it's not a string, try to use it directly
            try {
              pixel = JSON.parse(JSON.stringify(entry));
            } catch (e) {
              console.error('Failed to process non-string entry:', entry);
              continue;
            }
          }

          // Skip invalid entries
          if (!pixel || typeof pixel !== 'object' || !pixel.wallet_address) {
            console.warn('Invalid pixel entry:', pixel);
            continue;
          }

          const { wallet_address, farcaster_username, farcaster_pfp } = pixel;
          const key = wallet_address.toLowerCase();
          const existing = userCounts.get(key);
          
          if (existing) {
            existing.count++;
            // Update Farcaster info if available
            if (farcaster_username && !existing.farcaster_username) {
              existing.farcaster_username = farcaster_username;
            }
            if (farcaster_pfp && !existing.farcaster_pfp) {
              existing.farcaster_pfp = farcaster_pfp;
            }
          } else {
            userCounts.set(key, {
              wallet_address,
              count: 1,
              farcaster_username: farcaster_username || null,
              farcaster_pfp: farcaster_pfp || null
            });
          }
        } catch (e) {
          console.error('Failed to process pixel entry:', e);
          continue;
        }
      }

      // Convert to array and sort by count
      const sortedUsers = Array.from(userCounts.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      console.log('Processed users:', sortedUsers.length);

      // Convert to JSON string
      const jsonResponse = JSON.stringify(sortedUsers);

      // Cache the results with expiration using pipeline
      const pipeline = redis.pipeline();
      pipeline.setex(cacheKey, STALE_DURATION, jsonResponse);
      pipeline.setex(`${cacheKey}:timestamp`, STALE_DURATION, now.toString());
      await pipeline.exec();

      // Return the response
      return new NextResponse(jsonResponse, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${CACHE_DURATION}, stale-while-revalidate=${STALE_DURATION}`,
          'X-Cache': 'MISS',
          'X-Cache-Age': '0'
        }
      });
    } finally {
      // Always release the lock
      await releaseLock(cacheKey);
    }
  } catch (error) {
    console.error('Error fetching ticker data:', error);
    return new NextResponse(JSON.stringify([]), { 
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Cache': 'ERROR'
      }
    });
  }
} 