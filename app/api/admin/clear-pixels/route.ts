import { NextResponse } from 'next/server';
import { redis, getQueueName } from '@/lib/server/redis';
import { v4 as uuidv4 } from 'uuid';
import { isAdmin } from '@/components/admin/utils';
import { pusher } from '@/lib/server/pusher';

interface PixelData {
  id: string;
  x: number;
  y: number;
  color: string;
  wallet_address: string;
  placed_at: string;
  is_void?: boolean;
}

// Helper function to get environment-specific processing flag key
function getProcessingFlagKey() {
  const isDev = process.env.NODE_ENV === 'development';
  const prefix = isDev ? 'dev:' : '';
  return `${prefix}queue_processing_active`;
}

export async function POST(request: Request) {
  try {
    const ADMIN_CLEAR_ADDRESS = '0x0000000000000000000000000000000000000000';
    const BATCH_SIZE = 25; // Small batch size for Pusher
    const QUEUE_BATCH_SIZE = 100; // Batch size for queue processing
    
    // Verify admin wallet
    const adminWallet = request.headers.get('x-wallet-address')?.toLowerCase();
    if (!isAdmin(adminWallet)) {
      console.warn('⚠️ Unauthorized clear attempt from:', adminWallet);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { coordinates } = await request.json();
    console.log('🧹 Clearing pixels:', coordinates.length);

    const clearedPixels = [];

    // Process Redis operations in queue batches
    for (let i = 0; i < coordinates.length; i += QUEUE_BATCH_SIZE) {
      const batch = coordinates.slice(i, i + QUEUE_BATCH_SIZE);
      console.log(`🧹 Processing batch ${i / QUEUE_BATCH_SIZE + 1}/${Math.ceil(coordinates.length / QUEUE_BATCH_SIZE)}`);
      
      // Process batch
      for (const coord of batch) {
        const pixelKey = `${coord.x},${coord.y}`;
        const clearPixel = {
          id: uuidv4(),
          x: coord.x,
          y: coord.y,
          color: '#ffffff',
          wallet_address: ADMIN_CLEAR_ADDRESS,
          placed_at: new Date().toISOString()
        };

        await redis.hset('canvas:pixels', {
          [pixelKey]: JSON.stringify(clearPixel)
        });
        
        const pixelsQueue = getQueueName('supabase:pixels:queue');
        await redis.rpush(pixelsQueue, JSON.stringify(clearPixel));
        clearedPixels.push(clearPixel);
      }

      // Set processing flag
      const processingFlagKey = getProcessingFlagKey();
      const processingSet = await redis.set(processingFlagKey, 'true', {
        ex: 300 // Expire in 5 minutes
      });

      // Vercel cron job will handle queue processing
      // Remove manual trigger for consistency
      /*
      if (processingSet) {
        await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/cron/process-queue`, {
          method: 'POST',
          headers: { 
            'x-cron-secret': process.env.CRON_SECRET || '',
            'origin': process.env.NEXT_PUBLIC_APP_URL || ''
          }
        });
      }
      */
    }

    // Send Pusher notifications in smaller batches
    for (let i = 0; i < clearedPixels.length; i += BATCH_SIZE) {
      const batch = clearedPixels.slice(i, i + BATCH_SIZE);
      const minimalBatch = batch.map(pixel => ({
        x: pixel.x,
        y: pixel.y,
        color: pixel.color
      }));
      
      await pusher.trigger('canvas', 'pixels-cleared', {
        pixels: minimalBatch
      });
    }

    return NextResponse.json({ 
      success: true, 
      cleared: clearedPixels.length 
    });
  } catch (error) {
    console.error('Error clearing pixels:', error);
    return NextResponse.json({ error: 'Failed to clear pixels' }, { status: 500 });
  }
} 