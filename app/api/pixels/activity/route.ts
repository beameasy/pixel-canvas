import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';

export const revalidate = 10; // More frequent revalidation for real-time activity

export async function GET() {
  try {
    // Define our activity windows
    const windows = [
      { minutes: 1, threshold: 10, intensity: 1 },     // 10+ pixels in 1 minute
      { minutes: 3, threshold: 30, intensity: 2 },     // 30+ pixels in 3 minutes  
      { minutes: 5, threshold: 60, intensity: 3 },     // 60+ pixels in 5 minutes
      { minutes: 10, threshold: 100, intensity: 4 },   // 100+ pixels in 10 minutes
      { minutes: 15, threshold: 200, intensity: 5 }    // 200+ pixels in 15 minutes
    ];
    
    const now = Date.now();
    const fifteenMinsAgo = now - (15 * 60 * 1000); // For our largest window
    
    // Get all pixel placements in the last 15 minutes
    const pixelHistory = await redis.zrange(
      'canvas:history',
      fifteenMinsAgo,
      now,
      { byScore: true }
    );

    // Parse the JSON strings
    const pixels = pixelHistory.map(p => 
      typeof p === 'string' ? JSON.parse(p) : p
    );
    
    // Calculate counts for each time window
    const activitySpikes = windows.map(window => {
      const windowStart = now - (window.minutes * 60 * 1000);
      const count = pixels.filter(pixel => {
        const pixelTime = new Date(pixel.placed_at).getTime();
        return pixelTime >= windowStart;
      }).length;
      
      // Only include windows that exceed the threshold
      if (count >= window.threshold) {
        return {
          count: count,
          timeWindow: window.minutes,
          intensity: window.intensity
        };
      }
      return null;
    }).filter(Boolean);
    
    // Sort by intensity (highest first)
    // Use non-null assertion or type guard
    const nonNullSpikes = activitySpikes as NonNullable<typeof activitySpikes[0]>[];
    nonNullSpikes.sort((a, b) => b.intensity - a.intensity);
    
    // Only return the most significant spike
    const significantSpikes = nonNullSpikes.length > 0 ? [nonNullSpikes[0]] : [];
    
    return NextResponse.json(significantSpikes, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
  } catch (error) {
    console.error('Error fetching activity data:', error);
    return NextResponse.json([], {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
  }
} 