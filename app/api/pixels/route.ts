import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';
import { authenticateUser } from '../_lib/authenticateUser';
import { getAdminClient } from '../_lib/supabaseAdmin';
import { alchemy } from '../_lib/alchemyServer';

// Get canvas state
export async function GET() {
  try {
    // First try to get from Redis cache
    const pixels = await redis.hgetall('canvas:pixels');
    
    if (!pixels || Object.keys(pixels).length === 0) {
      // If Redis is empty, fetch from Supabase and rebuild cache
      const supabase = getAdminClient();
      const { data: latestPixels } = await supabase
        .from('pixels')
        .select('id, x, y, color, wallet_address, placed_at')
        .order('placed_at', { ascending: false });

      if (latestPixels) {
        // Transform and cache the data
        const pixelMap: Record<string, string> = {};
        latestPixels.forEach((pixel) => {
          const key = `${pixel.x},${pixel.y}`;
          // Match Supabase schema exactly
          pixelMap[key] = JSON.stringify({
            id: pixel.id,
            color: pixel.color,
            wallet_address: pixel.wallet_address,
            placed_at: pixel.placed_at
          });
        });
        
        if (Object.keys(pixelMap).length > 0) {
          await redis.hset('canvas:pixels', pixelMap);
        }
        
        return NextResponse.json(Object.entries(pixelMap).map(([key, value]) => ({
          position: key,
          ...JSON.parse(value)
        })));
      }
    }

    // Return cached data if it exists
    return NextResponse.json(Object.entries(pixels || {}).map(([key, value]) => ({
      position: key,
      ...JSON.parse(value as string)
    })));
  } catch (error) {
    console.error('Error fetching pixels:', error);
    return NextResponse.json({ error: 'Failed to fetch pixels' }, { status: 500 });
  }
}

// Place pixel
export async function POST(request: Request) {
  try {
    const user = await authenticateUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { x, y, color } = await request.json();
    const key = `${x},${y}`;
    const timestamp = new Date().toISOString();

    // Log the user object to see its structure
    console.log('Authenticated user:', user);
    console.log('User object:', user);

    // Store in Redis for current canvas state
    const pixelData = JSON.stringify({
      color,
      wallet_address: user.walletAddress,
      placed_at: timestamp
    });
    await redis.hset('canvas:pixels', { [key]: pixelData });

    // Add to Redis queue for Supabase processing
    await redis.lpush('canvas:pixels:queue', JSON.stringify({
      x,
      y,
      color,
      wallet_address: user.walletAddress,
      placed_at: timestamp
    }));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error placing pixel:', error);
    return NextResponse.json({ error: 'Failed to place pixel' }, { status: 500 });
  }
} 