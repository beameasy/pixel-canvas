import { redis } from '@/lib/server/redis';
import { NextResponse } from 'next/server';
import { scanHash, processHistoryInChunks } from '@/lib/server/redisUtils';

// Force this route to be dynamic and never cached
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Cache duration in seconds
const CACHE_TTL = 300; // 5 minutes
const CACHE_KEY = 'cached:leaderboard';

interface ColorCount {
  [color: string]: number;
}

interface UserStats {
  wallet_address: string;
  total_pixels: number;
  current_pixels: number;
  pixels_24h: number;
  pixels_1h: number;
  colors: Map<string, number>;
  farcaster_username: string | null;
  farcaster_pfp: string | null;
  token_balance?: number;
}

/**
 * Helper function to safely parse JSON or return the original value if it's already an object
 */
function safeParse(value: any) {
  // If it's already an object, just return it
  if (value === null || value === undefined) {
    return null;
  }
  
  // If it's already an object or array, return as is
  if (typeof value === 'object' || Array.isArray(value)) {
    return value;
  }
  
  // Handle any non-string types
  if (typeof value !== 'string') {
    return value;
  }
  
  // Handle '[object Object]' string which sometimes appears due to .toString() calls
  if (value === '[object Object]') {
    return {};
  }
  
  // Try to parse JSON strings
  try {
    // Only attempt to parse if it looks like JSON
    if (
      (value.startsWith('{') && value.endsWith('}')) || 
      (value.startsWith('[') && value.endsWith(']')) ||
      value.startsWith('"')
    ) {
      return JSON.parse(value);
    }
    
    // Not valid JSON, return original value
    return value;
  } catch (error) {
    console.error('Error parsing JSON:', error);
    // If there was a parsing error, just return an empty object 
    // rather than bad data or null which might cause issues downstream
    return {};
  }
}

export async function GET(request: Request) {
  console.log('🏆 Leaderboard API: Request received');
  
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '100');
    const page = parseInt(searchParams.get('page') || '1');
    const offset = (page - 1) * limit;
    const forceFresh = searchParams.get('fresh') === 'true';
    
    console.log('🏆 Leaderboard API: Checking Redis connection...');
    
    // Perform a simple ping to verify Redis connection
    try {
      await redis.ping();
      console.log('🏆 Leaderboard API: Redis connection OK');
    } catch (redisError) {
      console.error('🚨 Leaderboard API: Redis connection failed', redisError);
      throw new Error('Redis connection failed: ' + (redisError instanceof Error ? redisError.message : String(redisError)));
    }
    
    // Try to get cached leaderboard data first (unless force fresh is requested)
    if (!forceFresh) {
      try {
        const cachedData = await redis.get(CACHE_KEY);
        if (cachedData) {
          console.log('🏆 Leaderboard API: Using cached data');
          const parsedData = safeParse(cachedData);
          
          if (parsedData && typeof parsedData === 'object') {
            let users = [];
            
            // Check if this is a compressed format cache and expand it
            if (parsedData.compressed && Array.isArray(parsedData.users)) {
              console.log('🏆 Leaderboard API: Expanding compressed cache data');
              users = parsedData.users.map((user: any) => ({
                wallet_address: user.w || '',
                farcaster_username: user.u || null,
                farcaster_pfp: user.p || null,
                total_pixels: user.t || 0,
                current_pixels: user.c || 0,
                pixels_24h: user.d || 0,
                pixels_1h: user.h || 0,
                favorite_color: user.f || '#000000',
                token_balance: user.b || 0
              }));
            } else if (Array.isArray(parsedData.users)) {
              users = parsedData.users;
            }
            
            // Apply pagination to the cached data
            const totalUsers = users.length;
            const paginatedUsers = users.slice(offset, offset + limit);
            
            console.log(`🏆 Leaderboard API: Sending cached response with ${paginatedUsers.length} entries (page ${page} of ${Math.ceil(totalUsers/limit)})`);
            
            return NextResponse.json({
              users: paginatedUsers,
              pagination: {
                total: totalUsers,
                page,
                limit,
                pages: Math.ceil(totalUsers / limit)
              },
              cached: true,
              cache_time: parsedData.timestamp
            }, {
              headers: {
                'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
              }
            });
          }
        }
      } catch (cacheError) {
        console.warn('🏆 Leaderboard API: Cache retrieval failed, generating fresh data', cacheError);
      }
    } else {
      console.log('🏆 Leaderboard API: Bypassing cache as requested');
    }
    
    // Processing from raw data since cache miss or force fresh
    console.log('🏆 Leaderboard API: Generating fresh leaderboard data');
    
    // Initialize user stats map
    const userStats = new Map<string, UserStats>();
    
    // Process in more memory-efficient steps
    // 1. First, process current pixels on canvas in chunks
    console.log('🏆 Leaderboard API: Processing current canvas pixels...');
    let cursor = '0';
    const chunkSize = 1000; // Process in smaller chunks to avoid memory issues
    
    do {
      try {
        const [nextCursor, chunk] = await redis.hscan('canvas:pixels', cursor, { count: chunkSize });
        cursor = nextCursor;
        
        for (let i = 0; i < chunk.length; i += 2) {
          const key = chunk[i];
          const value = chunk[i + 1];
          
          try {
            const data = safeParse(value);
            
            if (!data || typeof data !== 'object' || !data.wallet_address) {
              continue;
            }
            
            const { wallet_address, color } = data;
            const stats = userStats.get(wallet_address) || {
              wallet_address,
              total_pixels: 0,
              current_pixels: 0,
              pixels_24h: 0,
              pixels_1h: 0,
              colors: new Map<string, number>(),
              farcaster_username: null,
              farcaster_pfp: null
            };
            
            stats.current_pixels++;
            if (color) {
              stats.colors.set(color, (stats.colors.get(color) || 0) + 1);
            }
            userStats.set(wallet_address, stats);
          } catch (err) {
            console.error(`🚨 Leaderboard API: Error processing pixel data at ${key}:`, err);
          }
        }
      } catch (error) {
        console.error('🚨 Leaderboard API: Error processing canvas pixels chunk:', error);
        break;
      }
    } while (cursor !== '0');
    
    // 2. Process total pixels and recent activity in smaller chunks
    // This is a more efficient approach than trying to process all history at once
    console.log('🏆 Leaderboard API: Processing canvas history in small ranges...');
    
    // Get total count of history entries
    const totalHistory = await redis.zcard('canvas:history');
    console.log(`🏆 Leaderboard API: Total history entries: ${totalHistory}`);
    
    // Process history in manageable chunks to avoid request size limits
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    const oneDayAgo = now - 86400000;
    
    // Calculate a reasonable chunk size
    const CHUNK_SIZE = 100;
    let processed = 0;
    
    while (processed < totalHistory) {
      try {
        // Get a chunk of history entries with their scores (timestamps)
        const entries = await redis.zrange('canvas:history', processed, processed + CHUNK_SIZE - 1, { withScores: true });
        
        // Process each entry
        for (let i = 0; i < entries.length; i += 2) {
          const entry = entries[i];
          const score = Number(entries[i + 1]); // Score is the timestamp
          
          try {
            const data = safeParse(entry);
            if (data && typeof data === 'object' && data.wallet_address) {
              const wallet_address = data.wallet_address;
              const stats = userStats.get(wallet_address) || {
                wallet_address,
                total_pixels: 0,
                current_pixels: 0,
                pixels_24h: 0,
                pixels_1h: 0,
                colors: new Map<string, number>(),
                farcaster_username: null,
                farcaster_pfp: null
              };
              
              // Increment total pixel count for this user
              stats.total_pixels += 1;
              
              // Check if this pixel was placed in the last 24 hours
              if (score >= oneDayAgo) {
                stats.pixels_24h += 1;
                
                // Also check if it was placed in the last hour
                if (score >= oneHourAgo) {
                  stats.pixels_1h += 1;
                }
              }
              
              userStats.set(wallet_address, stats);
            }
          } catch (err) {
            console.error('🚨 Leaderboard API: Error processing history entry:', err);
          }
        }
        
        processed += CHUNK_SIZE;
        if (entries.length < CHUNK_SIZE * 2) { // entries includes scores, so twice the entries
          break;
        }
        
        if (processed % 1000 === 0) {
          console.log(`🏆 Leaderboard API: Processed ${processed}/${totalHistory} history entries`);
        }
      } catch (error) {
        console.error(`🚨 Leaderboard API: Error processing history chunk at position ${processed}:`, error);
        // Skip this chunk and move to the next to avoid getting stuck
        processed += CHUNK_SIZE;
      }
    }
    
    console.log(`🏆 Leaderboard API: Completed processing ${processed} history entries`);
    
    // 3. Process user profiles for Farcaster data and token balances
    console.log('🏆 Leaderboard API: Processing user profiles...');
    cursor = '0';
    
    do {
      try {
        const [nextCursor, chunk] = await redis.hscan('users', cursor, { count: chunkSize });
        cursor = nextCursor;
        
        for (let i = 0; i < chunk.length; i += 2) {
          const wallet_address = chunk[i] as string; // Explicitly cast to string to fix the linter error
          const data = chunk[i + 1];
          
          try {
            const userData = safeParse(data);
            if (!userData || typeof userData !== 'object') {
              continue;
            }
            
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
        }
      } catch (error) {
        console.error('🚨 Leaderboard API: Error processing user profiles chunk:', error);
        break;
      }
    } while (cursor !== '0');
    
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
        favorite_color: Array.from(stats.colors.entries())
          .sort((a, b) => b[1] - a[1])[0]?.[0] || '#000000',
        token_balance: stats.token_balance || 0
      }))
      .filter(user => user.total_pixels > 0);
    
    // Sort by total_pixels (descending)
    leaderboard.sort((a, b) => b.total_pixels - a.total_pixels);
    
    // Cache the full leaderboard to avoid regenerating frequently
    const cacheData = {
      users: leaderboard,
      timestamp: new Date().toISOString()
    };
    
    // Store in cache with expiration
    try {
      // Generate a smaller, compressed version to stay within size limits
      const compressedData = {
        users: leaderboard.map(user => ({
          w: user.wallet_address,
          u: user.farcaster_username,
          p: user.farcaster_pfp,
          t: user.total_pixels,
          c: user.current_pixels,
          d: user.pixels_24h,
          h: user.pixels_1h,
          f: user.favorite_color,
          b: user.token_balance
        })),
        timestamp: new Date().toISOString(),
        compressed: true
      };
      
      // Store with fixed expiration time
      await redis.set("cached:leaderboard", JSON.stringify(compressedData), { ex: CACHE_TTL });
      
      console.log(`🏆 Leaderboard API: Cached leaderboard (${leaderboard.length} entries) for ${CACHE_TTL} seconds`);
    } catch (cacheError) {
      console.error('🚨 Leaderboard API: Failed to cache leaderboard:', cacheError);
    }
    
    // Apply pagination for the response
    const paginatedLeaderboard = leaderboard.slice(offset, offset + limit);
    const totalUsers = leaderboard.length;

    console.log(`🏆 Leaderboard API: Sending response with ${paginatedLeaderboard.length} entries (page ${page} of ${Math.ceil(totalUsers/limit)})`);
    
    return NextResponse.json({
      users: paginatedLeaderboard,
      pagination: {
        total: totalUsers,
        page,
        limit,
        pages: Math.ceil(totalUsers / limit)
      },
      cached: false
    }, {
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300'
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