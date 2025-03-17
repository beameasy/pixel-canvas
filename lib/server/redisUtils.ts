import { redis } from './redis';

/**
 * Scans a Redis hash and returns all fields and values
 * Uses cursor-based approach to avoid memory issues with large hashes
 */
export async function scanHash(key: string): Promise<Record<string, any>> {
  let cursor = '0';
  const results: Record<string, any> = {};
  const CHUNK_SIZE = 1000;

  do {
    const [nextCursor, chunk] = await redis.hscan(key, cursor, {
      count: CHUNK_SIZE
    });
    
    cursor = nextCursor;
    
    for (let i = 0; i < chunk.length; i += 2) {
      const field = chunk[i];
      const value = chunk[i + 1];
      results[field] = value;
    }
    
  } while (cursor !== '0');
  
  return results;
}

/**
 * Scans a Redis hash with a pattern match
 * Useful for finding specific keys in a large hash
 */
export async function scanHashWithPattern(key: string, pattern: string): Promise<Record<string, any>> {
  let cursor = '0';
  const results: Record<string, any> = {};
  const CHUNK_SIZE = 100;

  do {
    const [nextCursor, chunk] = await redis.hscan(key, cursor, {
      count: CHUNK_SIZE,
      match: pattern
    });
    
    cursor = nextCursor;
    
    for (let i = 0; i < chunk.length; i += 2) {
      const field = chunk[i];
      const value = chunk[i + 1];
      results[field] = value;
    }
    
  } while (cursor !== '0');
  
  return results;
}

/**
 * Gets a region of pixels from the canvas
 * Useful for retrieving only a specific area
 */
export async function getPixelRegion(x1: number, y1: number, x2: number, y2: number): Promise<Record<string, any>> {
  // Efficient implementation for region querying
  // Instead of scanning the entire hash, we can scan with a pattern
  // For example, if we want region x=100-200, y=100-200, we can scan with pattern "1*,1*"
  
  // Calculate pattern prefixes for more efficient pattern matching
  const xPrefix = getCommonPrefix(x1, x2);
  const yPrefix = getCommonPrefix(y1, y2);
  
  // If we have useful prefixes, use them for pattern matching
  let pixels: Record<string, any> = {};
  
  if (xPrefix.length > 0 || yPrefix.length > 0) {
    const pattern = buildPatternFromPrefixes(xPrefix, yPrefix);
    pixels = await scanHashWithPattern('canvas:pixels', pattern);
  } else {
    // Fall back to scanning everything if no useful pattern
    pixels = await scanHash('canvas:pixels');
  }
  
  // Filter to exact region
  const regionPixels: Record<string, any> = {};
  
  Object.entries(pixels).forEach(([key, value]) => {
    const [x, y] = key.split(',').map(Number);
    if (x >= x1 && x <= x2 && y >= y1 && y <= y2) {
      regionPixels[key] = value;
    }
  });
  
  return regionPixels;
}

/**
 * Helper to find a common prefix for coordinates
 * For example, if x1=100 and x2=199, the common prefix is "1"
 */
function getCommonPrefix(start: number, end: number): string {
  const startStr = start.toString();
  const endStr = end.toString();
  let prefix = '';
  
  for (let i = 0; i < Math.min(startStr.length, endStr.length); i++) {
    if (startStr[i] === endStr[i]) {
      prefix += startStr[i];
    } else {
      break;
    }
  }
  
  return prefix;
}

/**
 * Build a Redis pattern for matching coordinates with common prefixes
 */
function buildPatternFromPrefixes(xPrefix: string, yPrefix: string): string {
  if (xPrefix && yPrefix) {
    return `${xPrefix}*,${yPrefix}*`;
  } else if (xPrefix) {
    return `${xPrefix}*,*`;
  } else if (yPrefix) {
    return `*,${yPrefix}*`;
  }
  return '*';
}

/**
 * Gets a specific user from the users hash
 * Optimized approach to avoid scanning the entire hash
 */
export async function getUserData(walletAddress: string): Promise<Record<string, any> | null> {
  let userData = null;
  let cursor = '0';
  
  do {
    const [nextCursor, results] = await redis.hscan('users', cursor, {
      count: 10,
      match: walletAddress
    });
    
    cursor = nextCursor;
    
    for (let i = 0; i < results.length; i += 2) {
      const key = results[i];
      if (key === walletAddress) {
        userData = results[i + 1];
        break;
      }
    }
    
    if (userData) break;
    
  } while (cursor !== '0');
  
  if (userData) {
    return typeof userData === 'string' ? JSON.parse(userData) : userData;
  }
  
  return null;
}

/**
 * Process a set of historical data in chunks to avoid memory issues
 */
export async function processHistoryInChunks(callback: (chunk: any[]) => void): Promise<number> {
  const historyCount = await redis.zcount('canvas:history', '-inf', '+inf');
  const CHUNK_SIZE = 10000;
  let processed = 0;
  
  while (processed < historyCount) {
    const chunk = await redis.zrange(
      'canvas:history', 
      processed, 
      processed + CHUNK_SIZE - 1
    );
    
    callback(chunk);
    
    processed += chunk.length;
    
    if (chunk.length < CHUNK_SIZE) break;
  }
  
  return processed;
} 