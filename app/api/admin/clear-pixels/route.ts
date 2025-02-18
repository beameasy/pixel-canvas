import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';
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
        
        await redis.rpush('supabase:pixels:queue', JSON.stringify(clearPixel));
        clearedPixels.push(clearPixel);
      }

      // Trigger queue processing after each batch
      const processingSet = await redis.set('queue_processing_active', 'true', { 
        nx: true,
        ex: 300
      });

      if (processingSet) {
        await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/cron/process-queue`, {
          method: 'POST',
          headers: { 
            'x-cron-secret': process.env.CRON_SECRET || '',
            'origin': process.env.NEXT_PUBLIC_APP_URL || ''
          }
        });
      }
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