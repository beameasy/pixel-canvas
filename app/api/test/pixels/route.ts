import { NextResponse } from 'next/server';
import { redis, getQueueName } from '@/lib/server/redis';
import { pusher } from '@/lib/server/pusher';
import { v4 as uuidv4 } from 'uuid';

const TEST_SECRET = process.env.TEST_SECRET;

// Helper function to get environment-specific processing flag key
function getProcessingFlagKey() {
  const isDev = process.env.NODE_ENV === 'development';
  const prefix = isDev ? 'dev:' : '';
  return `${prefix}queue_processing_active`;
}

export async function POST(request: Request) {
  // Current check is good but ensure the TEST_SECRET is strong
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

    // Queue the pixel for storage in Supabase
    const pixelsQueue = getQueueName('supabase:pixels:queue');
    await redis.rpush(pixelsQueue, JSON.stringify(pixelData));

    console.log('🔵 Queue length:', await redis.llen(pixelsQueue));

    // Set processing flag
    const processingFlagKey = getProcessingFlagKey();
    const processingSet = await redis.set(processingFlagKey, 'true', {
      ex: 300 // Expire in 5 minutes
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