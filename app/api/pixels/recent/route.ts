import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sinceParam = searchParams.get('since');
    
    // Convert since parameter to timestamp (in milliseconds)
    const since = sinceParam ? parseInt(sinceParam) * 1000 : 0; // Convert seconds to milliseconds
    
    // For Canvas - current state
    const pixels = await redis.hgetall('canvas:pixels') || {};
    const pixelArray = Object.entries(pixels).map(([key, value]) => {
      try {
        const [x, y] = key.split(',');
        // Ensure value is a string before parsing to avoid errors
        const pixelData = typeof value === 'string' 
          ? JSON.parse(value) 
          : (value && typeof value === 'object' ? value : {});
          
        return {
          x: parseInt(x),
          y: parseInt(y),
          ...pixelData
        };
      } catch (e) {
        console.error(`Error parsing pixel data for ${key}:`, e);
        // Return a minimal valid object if parsing fails
        const [x, y] = key.split(',');
        return {
          x: parseInt(x),
          y: parseInt(y),
          color: '#ffffff', // Default white
          placed_at: 0
        };
      }
    });
    
    // If since parameter is provided, filter pixels by placed_at timestamp
    const filteredPixels = since > 0 
      ? pixelArray.filter(pixel => pixel.placed_at && pixel.placed_at >= since)
      : pixelArray;
    
    // For PixelFeed - recent history
    const recentHistory = await redis.zrange('canvas:history', -10, -1, {
      rev: true
    }) || [];

    // Parse the history items if needed
    const parsedHistory = recentHistory.map(item => {
      try {
        return typeof item === 'string' ? JSON.parse(item) : item;
      } catch (e) {
        console.error('Error parsing history item:', e);
        return null;
      }
    }).filter(Boolean); // Remove any null entries

    return NextResponse.json({
      pixels: filteredPixels,
      placements: parsedHistory, // Use parsed history
      cooldownInfo: null
    }, {
      headers: {
        'Cache-Control': 'public, max-age=5, stale-while-revalidate=10'
      }
    });
  } catch (error) {
    console.error('Failed to fetch pixels:', error);
    return NextResponse.json({ 
      pixels: [],
      placements: [], // Empty placements array
      cooldownInfo: null
    });
  }
} 