import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';
import { pusher } from '@/lib/server/pusher';
import { v4 as uuidv4 } from 'uuid';

const TEST_SECRET = process.env.TEST_SECRET;

export async function POST(request: Request) {
  // Add test environment check
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Test endpoint not available in production' }, { status: 403 });
  }

  // Add secret key validation
  const authHeader = request.headers.get('x-test-secret');
  if (authHeader !== TEST_SECRET) {
    return NextResponse.json({ error: 'Invalid test secret' }, { status: 401 });
  }

  console.log('🔵 Test endpoint hit - Checking Redis connection');
  try {
    // Test Redis connection first
    const isConnected = await redis.ping();
    console.log('🔵 Redis connection test:', isConnected);

    const { x, y, color, wallet_address } = await request.json();
    
    const pixelData = {
      id: uuidv4(),
      x,
      y,
      color,
      wallet_address: wallet_address || '0xTEST',
      placed_at: new Date().toISOString(),
      token_balance: 1000,
      farcaster_username: null,
      farcaster_pfp: null
    };

    // Log before Redis operation
    console.log('🔵 Attempting to store pixel:', pixelData);

    // Store pixel in Redis with explicit error handling
    const setResult = await redis.hset('canvas:pixels', {
      [`${x},${y}`]: JSON.stringify(pixelData)
    });

    console.log('🔵 Redis set result:', setResult);

    // Queue pixel data for Supabase
    await redis.rpush('supabase:pixels:queue', JSON.stringify(pixelData));

    // Log queue length
    console.log('🔵 Queue length:', await redis.llen('supabase:pixels:queue'));

    // Trigger queue processing
    const processingSet = await redis.set('queue_processing_active', 'true', { 
      nx: true,
      ex: 300
    });

    if (processingSet) {
      console.log('🔵 Triggering queue processing');
    }

    // Emit through Pusher
    await pusher.trigger('canvas', 'pixel-placed', {
      pixel: pixelData,
      topUsers: []
    });

    console.log('🔵 Emitted through Pusher');

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('❌ Error in test endpoint:', error);
    return NextResponse.json({ error: 'Failed to place pixel' }, { status: 500 });
  }
} 