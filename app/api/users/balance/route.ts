import { NextResponse } from 'next/server';
import { redis, getQueueName } from '@/lib/server/redis';
import { authenticateUser } from '@/app/api/_lib/authenticateUser';
import { getBillboardBalance } from '@/app/api/_lib/subgraphClient';
import { getUserTier } from '@/lib/server/tokenTiers';

// Helper function to get environment-specific processing flag key
function getProcessingFlagKey() {
  const isDev = process.env.NODE_ENV === 'development';
  const prefix = isDev ? 'dev:' : '';
  return `${prefix}queue_processing_active`;
}

// Deprecated: manual queue trigger replaced by Vercel cron job
async function _deprecated_triggerQueueProcessing() {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/cron/process-queue`, {
      method: 'POST',
      headers: {
        'x-cron-secret': process.env.CRON_SECRET || '',
        'origin': process.env.NEXT_PUBLIC_APP_URL || ''
      }
    });
    
    if (!response.ok) {
      console.error(`Error triggering queue: ${response.status}`);
    }
  } catch (error) {
    console.error('Failed to trigger queue processing:', error);
  }
}

// Function to filter out fields that don't exist in the database schema
function filterForDatabaseSchema(userData: any) {
  // Create a new object with only the fields that exist in the database
  const filtered = { ...userData };
  
  // Remove fields that don't exist in the dev_users table
  if ('farcaster_display_name' in filtered) {
    delete filtered.farcaster_display_name;
  }
  
  // Also remove farcaster_updated_at field if it exists
  if ('farcaster_updated_at' in filtered) {
    delete filtered.farcaster_updated_at;
  }
  
  return filtered;
}

export async function GET(request: Request) {
  try {
    const session = await authenticateUser(request);
    if (!session?.wallet_address) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const walletAddress = session.wallet_address.toLowerCase();
    const forceRefresh = Boolean(
      request.url.includes('?t=') || // Check for cache-busting parameter 
      await redis.exists(`user:${walletAddress}:balance_changed`) // Check if balance recently changed
    );

    // If we need to force a refresh, get it from the blockchain
    if (forceRefresh) {
      // Clear the flag
      await redis.del(`user:${walletAddress}:balance_changed`);
      // Also clear the tokenTiers cache
      await redis.del(`balance:${walletAddress}`);
      
      // Get fresh balance from blockchain
      const balance = await getBillboardBalance(walletAddress);
      
      // Update the cached user data
      const userData = await redis.hget('users', walletAddress);
      if (userData) {
        const parsedUserData = typeof userData === 'string' ? JSON.parse(userData) : userData;
        
        // Create updated user data with proper fields
        const updatedUserData = filterForDatabaseSchema({
          ...parsedUserData,
          token_balance: balance.toString(),
          updated_at: new Date().toISOString(),
        });
        
        await redis.hset('users', {
          [walletAddress]: JSON.stringify(updatedUserData)
        });

        // Queue updated user data for Supabase
        const usersQueue = getQueueName('supabase:users:queue');
        await redis.rpush(usersQueue, JSON.stringify(updatedUserData));

        // Check if we should trigger queue processing
        const userQueueLength = await redis.llen(usersQueue);
        if (userQueueLength >= 5) { // Use a lower threshold for users
          // Check if processing is already active
          const processingFlagKey = getProcessingFlagKey();
          const processingActive = await redis.get(processingFlagKey);
          
          if (!processingActive) {
            // Set processing flag with 5 minute expiry
            await redis.set(processingFlagKey, '1', {ex: 300});
            
            console.log('🔄 Triggering queue processing for users update, queue length:', userQueueLength);
            // _deprecated_triggerQueueProcessing();
          }
        }
      }
      
      return NextResponse.json({ balance }, {
        headers: { 'Cache-Control': 'no-store' }
      });
    }

    // Get cached balance
    const userData = await redis.hget('users', walletAddress);
    if (!userData) {
      // If no cached data, get from blockchain
      const balance = await getBillboardBalance(walletAddress);
      return NextResponse.json({ balance }, {
        headers: { 'Cache-Control': 'no-store' }
      });
    }

    const parsedUserData = typeof userData === 'string' ? JSON.parse(userData) : userData;
    return NextResponse.json({ balance: parsedUserData.token_balance || 0 });
  } catch (error) {
    console.error('Error in balance endpoint:', error);
    return NextResponse.json({ error: 'Failed to get balance' }, { status: 500 });
  }
}

// Default export for API route
export async function POST(request: Request) {
  // Original code continues here...
  // Manual queue processing has been removed in favor of Vercel cron jobs
} 