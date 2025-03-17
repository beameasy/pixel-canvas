import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';
import { scanHash } from '@/lib/server/redisUtils';

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
  console.log('🕒 Recent Pixels API: Request received');
  
  try {
    const { searchParams } = new URL(request.url);
    const since = searchParams.get('since');
    const limit = parseInt(searchParams.get('limit') || '10');
    
    console.log('🕒 Recent Pixels API: Checking Redis connection...');
    
    // Verify Redis connection
    try {
      await redis.ping();
      console.log('🕒 Recent Pixels API: Redis connection OK');
    } catch (redisError) {
      console.error('🚨 Recent Pixels API: Redis connection failed', redisError);
      throw new Error('Redis connection failed: ' + (redisError instanceof Error ? redisError.message : String(redisError)));
    }
    
    console.log('🕒 Recent Pixels API: Fetching current canvas state...');
    
    // Get current pixel coordinates for lookup
    const currentPixels = await redis.hkeys('canvas:pixels');
    console.log(`🕒 Recent Pixels API: Found ${currentPixels.length} pixels on canvas`);
    const currentPixelCoords = new Set(currentPixels);
    
    // Determine the time range based on "since" parameter
    let startTime = 0; // Default to all time
    
    if (since) {
      const now = Date.now();
      
      switch (since) {
        case '1h':
          startTime = now - 3600000; // 1 hour in milliseconds
          break;
        case '24h':
          startTime = now - 86400000; // 24 hours in milliseconds
          break;
        case '7d':
          startTime = now - 604800000; // 7 days in milliseconds
          break;
        default:
          // Try to parse as a timestamp
          const parsedTime = parseInt(since);
          if (!isNaN(parsedTime)) {
            startTime = parsedTime;
          }
      }
    }

    console.log(`🕒 Recent Pixels API: Getting placements since ${new Date(startTime).toISOString()}`);
    const placements = [];
    
    // Get a limited number of most recent pixel placements from history
    const recentHistory = await redis.zrange('canvas:history', 0, limit - 1, { rev: true });
    
    console.log(`🕒 Recent Pixels API: Found ${recentHistory.length} recent placements`);
    
    // Process the history entries for display
    for (const entry of recentHistory) {
      try {
        const data = safeParse(entry);
        
        // Skip invalid entries
        if (!data || typeof data !== 'object') {
          console.warn('🕒 Recent Pixels API: Invalid history entry:', entry);
          continue;
        }
        
        // Check if this placement is within the requested time range
        const placedAt = new Date(data.placed_at || 0).getTime();
        if (placedAt < startTime) {
          continue;
        }
        
        // Add the placement data to our results
        placements.push(data);
      } catch (error) {
        console.error('🚨 Recent Pixels API: Error processing history entry:', error);
      }
    }
    
    // Extract just the coordinates for the frontend
    const pixels = placements.map(p => ({ x: p.x, y: p.y }));
    
    // Fetch cooldown information if available
    let cooldownInfo = null;
    try {
      const cooldownData = await redis.get('canvas:cooldown');
      if (cooldownData) {
        cooldownInfo = safeParse(cooldownData);
      }
    } catch (error) {
      console.error('🚨 Recent Pixels API: Error fetching cooldown information:', error);
    }
    
    console.log(`🕒 Recent Pixels API: Sending response with ${placements.length} placements`);
    
    // Force no caching
    return NextResponse.json({
      pixels, 
      placements: placements.slice(0, limit),
      cooldownInfo
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Surrogate-Control': 'no-store'
      }
    });
  } catch (error) {
    console.error('🚨 Recent Pixels API: Error fetching recent pixels:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
    return NextResponse.json({ 
      error: 'Failed to fetch recent pixels',
      details: error instanceof Error ? error.message : String(error)
    }, { 
      status: 500,
      headers: {
        'Cache-Control': 'no-store'
      }
    });
  }
} 