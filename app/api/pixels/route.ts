import { NextResponse } from 'next/server';
import { redis, getQueueName } from '@/lib/server/redis';
import { getAccessToken } from '@privy-io/react-auth';
import { getAdminClient } from '../_lib/supabaseAdmin';
import { authenticateUser } from '../_lib/authenticateUser';
import { getFarcasterUser } from '../../../components/farcaster/api/getFarcasterUser';
import { getBillboardBalance, getTokensNeededForUsdAmount } from '@/app/api/_lib/subgraphClient';
import { pusher } from '@/lib/server/pusher';
import { v4 as uuidv4 } from 'uuid';
import { getUserTier, canOverwritePixel, canPlacePixel, getCooldownInfo, updateCooldownTimestamp, checkAndUpdateCooldown } from '@/lib/server/tokenTiers';
import { DEFAULT_TIER } from '@/lib/server/tiers.config';
import { queueDatabaseWrite, triggerQueueProcessing as queueProcessor } from '@/lib/queue';

const ONE_HOUR = 60 * 60 * 1000; // 1 hour in milliseconds

// Increase cache time for initial load
export const revalidate = 30; // 30 seconds instead of 5

const isDev = process.env.NODE_ENV === 'development';

const GRID_SIZE = 400; // Match client-side GRID_SIZE
const VALID_COLORS = [
  '#000000', // Black
  '#ff4500', // Red
  '#be0039', // Dark Red
  '#ff3881', // Pink
  '#ff99aa', // Light Pink
  '#ffa800', // Orange
  '#ffd635', // Yellow
  '#fff8b8', // Cream
  '#00cc78', // Green
  '#7eed56', // Light Green
  '#00ccc0', // Teal
  '#3690ea', // Blue
  '#0052FF', // Coinbase Blue
  '#51e9f4', // Light Blue
  '#493ac1', // Purple
  '#811e9f', // Deep Purple
  '#b44ac0', // Magenta
  '#6d482f', // Brown
  '#515252', // Dark Gray
  '#ffffff'  // White
];

// Get canvas state
export async function GET() {
  try {
    const pixels = await redis.hgetall('canvas:pixels');
    
    // Ensure we return an empty array if no pixels found
    if (!pixels) return NextResponse.json([], {
      headers: {
        'Cache-Control': 'public, max-age=5, stale-while-revalidate=10'
      }
    });
    
    // Convert hash to array format
    const pixelsArray = Object.entries(pixels).map(([key, value]) => {
      const [x, y] = key.split(',').map(Number);
      const data = typeof value === 'string' ? JSON.parse(value) : value;
      return { x, y, ...data };
    });

    return NextResponse.json(pixelsArray, {
      headers: {
        'Cache-Control': 'public, max-age=5, stale-while-revalidate=10'
      }
    });
  } catch (error) {
    console.error('Error fetching pixels:', error);
    return NextResponse.json([], {
      headers: {
        'Cache-Control': 'no-store'
      }
    });
  }
}

// Add these interfaces
interface PixelMetadata {
  wallet_address: string;
  token_balance: number;
  locked_until?: number;
  placed_at: number;
  version: number;  // Change version to required field for concurrency control
}

// Add price calculation functions
async function getBillboardPrice(): Promise<number> {
  const query = `{
    token(id: "${process.env.TOKEN_ADDRESS!.toLowerCase()}") {
      derivedETH
    }
    bundle(id: "1") {
      ethPrice
    }
  }`;

  const response = await fetch(process.env.SUBGRAPH_URL!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });

  const { data } = await response.json();
  const billboardPriceInEth = parseFloat(data.token.derivedETH);
  const ethPriceInUsd = parseFloat(data.bundle.ethPrice);
  return billboardPriceInEth * ethPriceInUsd;
}

async function getTokensForUsdAmount(usdAmount: number): Promise<number> {
  const billboardPriceInUsd = await getBillboardPrice();
  return usdAmount / billboardPriceInUsd;
}

// Add pixel metadata functions
async function getPixelMetadata(x: number, y: number): Promise<PixelMetadata | null> {
  const key = `${x},${y}`;
  const data = await redis.hget('canvas:pixels:metadata', key);
  if (!data) return null;
  
  // Parse the data and ensure it matches the PixelMetadata interface
  const parsed = typeof data === 'string' ? JSON.parse(data) : data;
  
  // Validate that the parsed data has all required fields
  if (
    typeof parsed.wallet_address === 'string' &&
    typeof parsed.token_balance === 'number' &&
    typeof parsed.placed_at === 'number' &&
    typeof parsed.version === 'number'
  ) {
    return {
      wallet_address: parsed.wallet_address,
      token_balance: parsed.token_balance,
      placed_at: parsed.placed_at,
      version: parsed.version,
      locked_until: parsed.locked_until
    };
  }
  
  // If validation fails, return null
  return null;
}

async function setPixelMetadata(x: number, y: number, metadata: PixelMetadata): Promise<void> {
  const key = `${x},${y}`;
  await redis.hset('canvas:pixels:metadata', {
    [key]: JSON.stringify(metadata)
  });
}

// Add balance caching helper
async function getTokenBalance(walletAddress: string, session: any): Promise<number> {
  try {
    const userData = await redis.hget('users', walletAddress);
    if (userData) {
      const parsedUserData = typeof userData === 'string' ? JSON.parse(userData) : userData;
      // Keep existing Privy ID if present
      if (session?.privy_id && !parsedUserData.privy_id) {
        const updatedUserData = {
          ...parsedUserData,
          privy_id: session.privy_id,
          updated_at: new Date().toISOString()
        };
        
        await redis.hset('users', {
          [walletAddress]: JSON.stringify(updatedUserData)
        });
        
        // Queue updated user data for Supabase
        const usersQueue = getQueueName('supabase:users:queue');
        await redis.rpush(usersQueue, JSON.stringify(updatedUserData));
      }
      return parsedUserData.token_balance || 0;
    }
  
    // If no cached data, fetch from chain and update user record
    const balance = Number(await getBillboardBalance(walletAddress));
    const farcasterUser = await getFarcasterUser(walletAddress);
    
    const userDataToStore = {
      wallet_address: walletAddress,
      token_balance: balance,
      farcaster_username: farcasterUser?.farcaster_username || null,
      farcaster_pfp: farcasterUser?.farcaster_pfp || null,
      updated_at: new Date().toISOString(),
      privy_id: session?.privy_id
    };
    
    await redis.hset('users', {
      [walletAddress]: JSON.stringify(userDataToStore)
    });
    
    // Queue new user data for Supabase
    const usersQueue = getQueueName('supabase:users:queue');
    await redis.rpush(usersQueue, JSON.stringify(userDataToStore));

    return balance;
  } catch (error) {
    console.error('Error in getTokenBalance:', error);
    return 0;
  }
}

// Add locking functionality
async function lockPixel(x: number, y: number, wallet: string, duration: number): Promise<boolean> {
  const existingPixel = await redis.hget('canvas:pixels', `${x},${y}`);
  if (!existingPixel) return false;
  
  const pixel = JSON.parse(existingPixel as string);
  pixel.locked_until = Date.now() + duration;
  
  await redis.hset('canvas:pixels', {
    [`${x},${y}`]: JSON.stringify(pixel)
  });
  
  return true;
}

// Initialize empty lists if they don't exist
async function initializeRedisKeys() {
  try {
    const pixelsQueue = getQueueName('supabase:pixels:queue');
    const usersQueue = getQueueName('supabase:users:queue');
    
    const pixelsExists = await redis.exists(pixelsQueue)
    const usersExists = await redis.exists(usersQueue)
    
    // Just create empty lists - don't push empty arrays
    if (!pixelsExists) await redis.del(pixelsQueue)
    if (!usersExists) await redis.del(usersQueue)
  } catch (error) {
    console.error('Failed to initialize Redis keys:', error)
  }
}

// Helper function to get environment-specific processing flag key
function getProcessingFlagKey() {
  const isDev = process.env.NODE_ENV === 'development';
  const prefix = isDev ? 'dev:' : '';
  return `${prefix}queue_processing_active`;
}

// Helper function with retries
async function legacyTriggerQueueProcessing(retries = 3) {
  try {
    // For serverless environments, we can directly call the cron API without making a fetch request
    // This avoids the issue with localhost URLs in serverless environments
    
    // Call the queue processing directly instead of making a fetch request
    // Import the process-queue GET handler and call it directly
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    
    // Only make a network request if we're NOT in a serverless environment (determined by checking for localhost)
    // In production serverless environments, we'll skip this fetch
    if (appUrl.includes('localhost') || appUrl.includes('127.0.0.1')) {
      // Local development - use fetch
      const response = await fetch(`${appUrl}/api/cron/process-queue`, {
        method: 'POST',
        headers: {
          'x-cron-secret': process.env.CRON_SECRET || '',
          'origin': appUrl
        }
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    } else {
      // In production - use the queue flag method instead of fetch
      // Just set a flag that the vercel cron job will pick up
      // This avoids the need to make a self-request which doesn't work in serverless
      console.log('Using queue flag method for serverless environment');
      const queueReady = (await redis.llen(getQueueName('supabase:pixels:queue'))) > 0;
      
      if (queueReady) {
        // No need to make a network request - just ensure the processing flag is not set
        // so the cron job will process it on next run
        const processingFlagKey = getProcessingFlagKey();
        const processingActive = await redis.get(processingFlagKey);
        
        if (!processingActive) {
          console.log('Queue ready, cron job will process on next run');
        } else {
          console.log('Queue processing already active');
        }
      } else {
        console.log('No items in queue');
      }
    }
  } catch (error) {
    console.error('Queue trigger failed:', error);
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      return legacyTriggerQueueProcessing(retries - 1);
    }
  }
}

export async function POST(request: Request) {
  try {
    const session = await authenticateUser(request);
    if (!session || !session.wallet_address) {
      return NextResponse.json({ error: 'Please connect a wallet to place pixels' }, { status: 401 });
    }

    const walletAddress = session.wallet_address.toLowerCase();
    const isAdmin = request.headers.get('x-is-admin') === 'true';

    // Ban check
    const isBanned = await redis.sismember('banned:wallets:permanent', walletAddress);
    if (isBanned) {
      return NextResponse.json({ error: 'Account banned, you probably deserved it.' }, { status: 403 });
    }

    // Get cached user data
    const userData = await redis.hget('users', walletAddress);
    const user = userData ? (typeof userData === 'string' ? JSON.parse(userData) : userData) : null;
    
    // If balance is null, refresh it
    let balance = user?.token_balance;
    if (balance === null) {
      balance = Number(await getBillboardBalance(walletAddress));
      const updatedUserData = {
        ...user,
        token_balance: balance,
        updated_at: new Date().toISOString()
      };
      
      await redis.hset('users', {
        [walletAddress]: JSON.stringify(updatedUserData)
      });
      
      // Queue updated user data for Supabase
      const usersQueue = getQueueName('supabase:users:queue');
      await redis.rpush(usersQueue, JSON.stringify(updatedUserData));
    }

    // Atomic cooldown check and update (skip for admins)
    if (!isAdmin) {
      // Use our new atomic function to check and update cooldown in one operation
      const cooldownInfo = await checkAndUpdateCooldown(walletAddress);
      
      if (!cooldownInfo.canPlace) {
        return NextResponse.json({ 
          error: `Please wait ${cooldownInfo.remainingSeconds} seconds`,
          cooldownInfo: {
            tier: cooldownInfo.tier.name,
            cooldownSeconds: cooldownInfo.cooldownSeconds,
            remainingSeconds: cooldownInfo.remainingSeconds,
            nextPlacementTime: cooldownInfo.nextPlacementTime
          }
        }, { status: 429 });
      }
      
      console.log(`🔵 User ${walletAddress} with balance ${balance} has tier: ${cooldownInfo.tier.name} with cooldown: ${cooldownInfo.cooldownSeconds}s`);
    }

    const { x, y, color, version } = await request.json();

    // Validate coordinates
    if (!Number.isInteger(x) || !Number.isInteger(y) || 
        x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) {
      return NextResponse.json({ 
        error: 'Invalid coordinates' 
      }, { status: 400 });
    }

    // Validate color
    if (!VALID_COLORS.includes(color)) {
      return NextResponse.json({ 
        error: 'Invalid color' 
      }, { status: 400 });
    }

    // Get existing pixel data for version check
    const existingPixel = await redis.hget('canvas:pixels', `${x},${y}`);
    const existingPixelData = existingPixel ? 
      (typeof existingPixel === 'string' ? JSON.parse(existingPixel) : existingPixel) 
      : null;
    
    // Enhanced version conflict check
    if (existingPixelData?.version) {
      // If client version is undefined or doesn't match the current version
      if (version === undefined || version !== existingPixelData.version) {
        console.log(`🔄 Version conflict detected: Client version ${version}, Server version ${existingPixelData.version}`);
        return NextResponse.json({ 
          error: 'Pixel has been modified since you last viewed it', 
          currentVersion: existingPixelData.version,
          currentPixel: existingPixelData
        }, { status: 409 });  // 409 Conflict
      }
    }

    // Check if can overwrite
    const overwriteCheck = await canOverwritePixel(walletAddress, existingPixelData);
    if (!overwriteCheck.canOverwrite) {
      return NextResponse.json({ 
        error: overwriteCheck.message || 'Cannot overwrite this pixel',
        hasLink: overwriteCheck.hasLink || false
      }, { status: 403 });
    }

    // Current timestamp for consistency
    const now = Date.now();
    const isoNow = new Date().toISOString();
    
    // Calculate new version - increment if exists, otherwise start at 1
    const newVersion = existingPixelData?.version ? existingPixelData.version + 1 : 1;

    const pixelData = {
      id: `${x}-${y}-${now}`,
      x,
      y,
      color,
      wallet_address: walletAddress,
      placed_at: isoNow,
      farcaster_username: user?.farcaster_username,
      farcaster_pfp: user?.farcaster_pfp,
      version: newVersion  // Add version number for concurrency control
    };

    // Use environment-specific queue names
    const pixelsQueue = getQueueName('supabase:pixels:queue');
    
    // Queue the pixel data for Supabase storage
    const multi = redis.multi();
    multi.hset('canvas:pixels', {
      [`${x},${y}`]: JSON.stringify(pixelData)
    });
    
    multi.zadd('canvas:history', {
      score: now,
      member: JSON.stringify(pixelData)
    });
    
    // No need to update cooldown timestamp here anymore - it's already updated atomically
    // if user is allowed to place a pixel
    
    multi.rpush(pixelsQueue, JSON.stringify(pixelData));
    
    multi.set(`user:${walletAddress}:balance_changed`, "true", {ex: 60});
    
    await multi.exec();

    console.log('📊 Queue stats:', {
      pixelQueueLength: await redis.llen(pixelsQueue),
      userQueueLength: await redis.llen(getQueueName('supabase:users:queue')),
      hasCronSecret: !!process.env.CRON_SECRET
    });

    // Check queue length and trigger processing if necessary
    const userQueueLength = await redis.llen(getQueueName('supabase:users:queue'));
    const pixelQueueLength = await redis.llen(pixelsQueue);
    
    // Log queue stats
    console.log('📊 Queue stats:', {
      pixelQueueLength,
      userQueueLength,
      hasCronSecret: !!process.env.CRON_SECRET
    });
    
    // If queue has many items, trigger processing immediately instead of waiting for cron
    if ((pixelQueueLength >= 100 || userQueueLength >= 50) && process.env.CRON_SECRET) {
      console.log('📊 Queue threshold reached, triggering immediate processing');
      queueProcessor().catch(err => {
        console.error('Failed to trigger queue processing:', err);
      });
    }

    // Get recent history for top users calculation - using zrange for sorted set
    const pixelHistory = await redis.zrange('canvas:history', 0, -1);
    
    // Remove the JSON.parse since the data is already parsed
    const pixelsArray = pixelHistory.map(p => 
      typeof p === 'string' ? JSON.parse(p) : p
    );
    
    // Calculate top users from history
    const topUsers = calculateTopUsers(pixelsArray);

    console.log('📤 Sending Pusher event with topUsers:', topUsers.length);

    // Calculate activity data and include it in Pusher event
    const activitySpikes = await calculateActivitySpikes();

    // Implement retry logic for Pusher events
    let retries = 0;
    const maxRetries = 3;

    async function triggerPusherEventWithRetry() {
      try {
        // Main pixel-placed event
        await pusher.trigger('canvas', 'pixel-placed', { 
          pixel: pixelData,
          topUsers: topUsers,
          activitySpikes: activitySpikes
        });

        // Also trigger a dedicated leaderboard-update event to ensure leaderboard catches it
        await pusher.trigger('canvas', 'leaderboard-update', { 
          triggerTime: Date.now(),
          pixelId: pixelData.id
        });

        console.log('✅ Pusher events sent successfully');
      } catch (error) {
        console.error(`❌ Failed to send Pusher event (attempt ${retries + 1}/${maxRetries}):`, error);
        if (retries < maxRetries) {
          retries++;
          await new Promise(resolve => setTimeout(resolve, 1000 * retries));
          return triggerPusherEventWithRetry();
        } else {
          console.error('❌ All Pusher event retry attempts failed');
        }
      }
    }

    await triggerPusherEventWithRetry();

    // No need to manually trigger processing in production anymore
    // The Vercel cron job will automatically process the queue
    
    // Let the client know if queue processing is active
    const processingFlagKey = getProcessingFlagKey();
    const processingActive = await redis.get(processingFlagKey);
    const queueLength = await redis.llen(pixelsQueue);
    
    // Just log the queue status
    console.log(`📊 Queue status: ${queueLength} items, processing: ${processingActive ? 'active' : 'inactive'}`);

    return NextResponse.json({ 
      success: true, 
      pixel: pixelData,
      queue: {
        items: queueLength,
        processing: !!processingActive
      }
    }, {
      headers: {
        'Cache-Control': 'no-store, max-age=0'
      }
    });

  } catch (error) {
    console.error('Error placing pixel:', error);
    return NextResponse.json({ error: 'Failed to place pixel' }, { 
      status: 500,
      headers: {
        'Cache-Control': 'no-store'
      }
    });
  }
}

function calculateTopUsers(pixels: any[]) {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;

  // Filter pixels from last hour and count by user
  const userCounts = pixels
    .filter(pixel => {
      const placedAt = new Date(pixel.placed_at).getTime();
      return (now - placedAt) <= ONE_HOUR;
    })
    .reduce<Record<string, any>>((acc, pixel) => {
      const { wallet_address, farcaster_username, farcaster_pfp } = pixel;
      if (!acc[wallet_address]) {
        acc[wallet_address] = {
          wallet_address,
          count: 0,
          farcaster_username,
          farcaster_pfp
        };
      }
      acc[wallet_address].count++;
      return acc;
    }, {});

  return Object.values(userCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

async function calculateLockCost(duration: number): Promise<number> {
  const hours = duration / (60 * 60 * 1000);
  const baseUsdCost = 0.10; // 10 cents per hour
  const usdCost = baseUsdCost * hours * (1 + hours/4); // Quadratic increase
  return getTokensNeededForUsdAmount(usdCost);
}

// Add this function to calculate activity spikes
async function calculateActivitySpikes() {
  try {
    // Define our activity windows
    const windows = [
      { minutes: 1, threshold: 10, intensity: 1 },
      { minutes: 3, threshold: 30, intensity: 2 },
      { minutes: 5, threshold: 60, intensity: 3 },
      { minutes: 10, threshold: 100, intensity: 4 },
      { minutes: 15, threshold: 200, intensity: 5 }
    ];
    
    const now = Date.now();
    const fifteenMinsAgo = now - (15 * 60 * 1000);
    
    // Get pixel history
    const pixelHistory = await redis.zrange(
      'canvas:history',
      fifteenMinsAgo,
      now,
      { byScore: true }
    );

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
      
      if (count >= window.threshold) {
        return {
          count,
          timeWindow: window.minutes,
          intensity: window.intensity
        };
      }
      return null;
    }).filter(Boolean);
    
    // Sort by intensity
    const nonNullSpikes = activitySpikes as NonNullable<typeof activitySpikes[0]>[];
    nonNullSpikes.sort((a, b) => b.intensity - a.intensity);
    
    return nonNullSpikes.length > 0 ? [nonNullSpikes[0]] : [];
  } catch (error) {
    console.error('Error calculating activity spikes:', error);
    return [];
  }
}
