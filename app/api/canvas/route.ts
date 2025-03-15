import { redis } from '@/lib/server/redis';
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { scanHash, getPixelRegion } from '@/lib/server/redisUtils';

export const dynamic = 'force-dynamic'; // Ensure fresh data on server

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
  try {
    // Get current timestamp for cache decisions
    const now = Date.now();
    
    // Get URL params for chunking support
    const { searchParams } = new URL(request.url);
    const x1 = parseInt(searchParams.get('x1') || '0');
    const y1 = parseInt(searchParams.get('y1') || '0');
    const x2 = parseInt(searchParams.get('x2') || '1000');
    const y2 = parseInt(searchParams.get('y2') || '1000');
    
    // Add debug logging
    console.log('Canvas API: Fetching pixels', { x1, y1, x2, y2 });
    
    // Check if we want the full canvas or a region
    let pixels: Record<string, any>;
    if (searchParams.has('x1') || searchParams.has('y1') || searchParams.has('x2') || searchParams.has('y2')) {
      // Get specific region
      pixels = await getPixelRegion(x1, y1, x2, y2);
      console.log(`Canvas API: Retrieved ${Object.keys(pixels).length} pixels for region`);
    } else {
      // Get all pixels using the cursor-based approach
      pixels = await scanHash('canvas:pixels');
      console.log(`Canvas API: Retrieved ${Object.keys(pixels).length} total pixels`);
    }
    
    if (!pixels || Object.keys(pixels).length === 0) {
      console.warn('No pixels found in Redis for the requested region');
      return NextResponse.json([], {
        headers: {
          'Cache-Control': 'public, max-age=0, must-revalidate'
        }
      });
    }

    // Debug the first pixel to verify format
    const firstKey = Object.keys(pixels)[0];
    const firstValue = pixels[firstKey];
    console.log('Canvas API: First pixel data sample:', {
      key: firstKey,
      value: firstValue,
      valueType: typeof firstValue,
      isObject: typeof firstValue === 'object' && firstValue !== null
    });

    const pixelsArray = Object.entries(pixels).map(([key, value]) => {
      try {
        const [x, y] = key.split(',');
        
        // Handle the case where Redis returns an object directly
        let pixelData;
        if (typeof value === 'object' && value !== null) {
          pixelData = value;
        } else {
          pixelData = safeParse(value);
        }
        
        // Make sure pixelData is an object
        const pixelDataObj = typeof pixelData === 'object' && pixelData !== null ? 
                             pixelData : {};
        
        // Ensure we at least have a default color if missing
        if (!pixelDataObj.color) {
          pixelDataObj.color = "#ffffff"; // Default white color
        }
        
        // Make sure we return the complete pixel data
        return {
          ...pixelDataObj,
          x: parseInt(x),
          y: parseInt(y)
        };
      } catch (error) {
        console.error(`Error processing pixel data for ${key}:`, error);
        // Return a minimal valid object if processing fails
        const [x, y] = key.split(',');
        return {
          x: parseInt(x),
          y: parseInt(y),
          color: '#ffffff', // Default white
          placed_at: 0
        };
      }
    });
    
    // Log a sample of the final output
    console.log('Canvas API: Sample output pixel:', pixelsArray[0]);

    // Generate ETag based on content
    const etag = `"${now}-${Object.keys(pixels).length}-${x1},${y1}-${x2},${y2}"`;
    
    // Check if client has fresh copy
    const headersList = headers();
    const ifNoneMatch = headersList.get('if-none-match');
    
    if (ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'Cache-Control': 'public, max-age=5, stale-while-revalidate=10',
          'ETag': etag
        }
      });
    }

    return NextResponse.json(pixelsArray, {
      headers: {
        'Cache-Control': 'public, max-age=5, stale-while-revalidate=10',
        'ETag': etag
      }
    });
  } catch (error) {
    console.error('Error fetching canvas:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, {
      status: 500,
      headers: {
        'Cache-Control': 'no-store'
      }
    });
  }
} 