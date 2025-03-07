import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';

export const revalidate = 10; // More frequent revalidation for real-time activity

export async function GET() {
  try {
    // Define our activity windows with tripled thresholds to match /api/pixels/route.ts
    const windows = [
      { minutes: 1, threshold: 30, intensity: 1 },     // Was 10
      { minutes: 3, threshold: 90, intensity: 2 },     // Was 30
      { minutes: 5, threshold: 180, intensity: 3 },    // Was 60
      { minutes: 10, threshold: 300, intensity: 4 },   // Was 100
      { minutes: 15, threshold: 600, intensity: 5 }    // Was 200
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
    
    return NextResponse.json(significantSpikes);
  } catch (error) {
    console.error('Error fetching activity data:', error);
    return NextResponse.json([]);
  }
} 