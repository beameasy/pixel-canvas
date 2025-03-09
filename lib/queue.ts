import { redis, getQueueName } from '@/lib/server/redis';

interface PixelData {
  x: number;
  y: number;
  color: string;
  wallet_address: string;
  placed_at?: number;
  version?: number;
}

// Helper function to get the processing flag key name
function getProcessingFlagKey() {
  const isDev = process.env.NODE_ENV === 'development';
  const prefix = isDev ? 'dev:' : '';
  return `${prefix}queue_processing_active`;
}

/**
 * Queue a pixel for database write
 * This will be processed by the Vercel cron job that runs every 5 minutes
 */
export async function queueDatabaseWrite(pixel: PixelData) {
  try {
    // Ensure the pixel has all required fields
    const pixelWithMetadata = {
      ...pixel,
      placed_at: pixel.placed_at || Date.now(),
      version: pixel.version || 1
    };

    // Add to the queue for the cron job to process
    const pixelsQueue = getQueueName('supabase:pixels:queue');
    await redis.rpush(pixelsQueue, JSON.stringify(pixelWithMetadata));
    
    console.log(`Queued pixel at (${pixel.x}, ${pixel.y}) for database write`);
    return { success: true };
  } catch (error) {
    console.error('Failed to queue pixel:', error);
    return { success: false, error };
  }
}

/**
 * Manually trigger queue processing
 * This is useful when you want to process the queue immediately rather than waiting for the cron job
 */
export async function triggerQueueProcessing(): Promise<boolean> {
  try {
    // Check if we have the required env vars
    if (!process.env.CRON_SECRET) {
      console.error('Missing required CRON_SECRET environment variable');
      return false;
    }
    
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    
    // Only make a network request if we're in a development environment
    // In production serverless environments, we'll just check/set flags
    if (appUrl.includes('localhost') || appUrl.includes('127.0.0.1')) {
      // Local development - use fetch
      const response = await fetch(`${appUrl}/api/cron/process-queue`, {
        method: 'GET',
        headers: {
          'x-cron-secret': process.env.CRON_SECRET,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        console.error(`Failed to trigger queue processing: ${response.status} ${response.statusText}`);
        return false;
      }
      
      const data = await response.json();
      console.log('Queue processing triggered:', data);
      return true;
    } else {
      // In production - just check if there are items in the queue
      console.log('Using queue flag method for serverless environment');
      const pixelsQueue = getQueueName('supabase:pixels:queue');
      const queueLength = await redis.llen(pixelsQueue);
      
      if (queueLength > 0) {
        // Just ensure the processing flag is not set so the cron job will process it
        const processingFlagKey = getProcessingFlagKey();
        const processingActive = await redis.get(processingFlagKey);
        
        if (!processingActive) {
          console.log(`Queue has ${queueLength} items, cron job will process on next run`);
          return true;
        } else {
          console.log('Queue processing already active');
          return true; // Still return true since it will be processed
        }
      } else {
        console.log('No items in queue to process');
        return true; // Nothing to do, so technically succeeded
      }
    }
  } catch (error) {
    console.error('Error triggering queue processing:', error);
    return false;
  }
} 