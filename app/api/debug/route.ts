import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';

type PixelDebugInfo = {
  rawValue: any;
  parsedValue: any;
  valueType: string;
  stringified?: string;
};

export async function GET(request: Request) {
  try {
    // Get a raw entry from Redis to inspect the data format
    const sampleKeys = await redis.hkeys('canvas:pixels');
    
    if (!sampleKeys || sampleKeys.length === 0) {
      return NextResponse.json({ 
        error: 'No pixel keys found in Redis',
        status: 'error' 
      });
    }
    
    // Get the first 5 keys to examine
    const keysToCheck = sampleKeys.slice(0, 5);
    const rawResults: Record<string, PixelDebugInfo> = {};
    
    for (const key of keysToCheck) {
      const rawValue = await redis.hget('canvas:pixels', key);
      
      // Try to stringify if it's an object
      let stringified = undefined;
      if (typeof rawValue === 'object' && rawValue !== null) {
        try {
          stringified = JSON.stringify(rawValue);
        } catch (e) {
          stringified = `Error stringifying: ${e}`;
        }
      }
      
      rawResults[key] = {
        rawValue,
        parsedValue: typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue,
        valueType: typeof rawValue,
        stringified
      };
    }
    
    // Get some stats about the database
    const pixelCount = await redis.hlen('canvas:pixels');
    const historyCount = await redis.zcount('canvas:history', '-inf', '+inf');
    
    // Get a specific key for detailed analysis
    const specificKey = '183,110'; // Known to exist from previous tests
    const specificValue = await redis.hget('canvas:pixels', specificKey);
    
    return NextResponse.json({
      samplePixels: rawResults,
      specificPixel: {
        key: specificKey,
        rawValue: specificValue,
        valueType: typeof specificValue,
        isString: typeof specificValue === 'string',
        stringified: typeof specificValue === 'object' ? JSON.stringify(specificValue) : undefined,
        parsed: typeof specificValue === 'string' ? JSON.parse(specificValue) : specificValue
      },
      stats: {
        pixelCount,
        historyCount
      }
    });
  } catch (error) {
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : String(error),
      status: 'error'
    }, { status: 500 });
  }
} 