import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';
import { getAccessToken } from '@privy-io/react-auth';
import { getAdminClient } from '../_lib/supabaseAdmin';
import { authenticateUser } from '../_lib/authenticateUser';
import { getFarcasterUser } from '@/lib/farcaster';
import { getBillboardBalance, getTokensNeededForUsdAmount } from '@/app/api/_lib/subgraphClient';
import { pusher } from '@/lib/server/pusher';
import { v4 as uuidv4 } from 'uuid';

const ONE_HOUR = 60 * 60 * 1000; // 1 hour in milliseconds

// Get canvas state
export async function GET() {
  try {
    console.log('🔵 Fetching canvas state');
    
    // Check Redis connection
    const isConnected = await redis.ping();
    console.log('🔵 Redis connection:', isConnected);
    
    // Check if key exists first
    const exists = await redis.exists('canvas:pixels');
    console.log('🔵 Canvas pixels exists:', exists);
    
    // Get pixels from Redis with explicit type check
    const pixels = exists ? await redis.hgetall('canvas:pixels') : {};
    console.log('🔵 Raw Redis response:', pixels);
    
    // Convert to array safely
    const pixelsArray = Object.entries(pixels || {}).map(([key, value]) => {
      const [x, y] = key.split(',');
      const pixelData = typeof value === 'string' ? JSON.parse(value) : value;
      return {
        ...pixelData,
        x: parseInt(x),
        y: parseInt(y)
      };
    });

    return NextResponse.json(pixelsArray);
  } catch (error) {
    console.error('❌ Error fetching pixels:', error);
    return NextResponse.json([], { status: 200 }); // Return empty array with 200
  }
}

// Add these interfaces
interface PixelMetadata {
  wallet_address: string;
  token_balance: number;
  locked_until?: number;
  placed_at: number;
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
  
  // If it's a string, parse it, otherwise return as is
  return typeof data === 'string' ? JSON.parse(data) : data;
}

async function setPixelMetadata(x: number, y: number, metadata: PixelMetadata): Promise<void> {
  const key = `${x},${y}`;
  await redis.hset('canvas:pixels:metadata', {
    [key]: JSON.stringify(metadata)
  });
}

// Add balance caching helper
async function getTokenBalance(walletAddress: string): Promise<number> {
  try {
    const userData = await redis.hget('users', walletAddress);
    if (userData) {
      console.log('🔵 Found cached user data:', userData);
      return (typeof userData === 'string' ? JSON.parse(userData) : userData).token_balance || 0;
    }
  
    // If no cached data, fetch from chain and update user record
    const balance = Number(await getBillboardBalance(walletAddress));
    const farcasterUser = await getFarcasterUser(walletAddress);
    
    console.log('🔵 Raw Farcaster user data:', farcasterUser);
    
    // Match the FarcasterUser interface field names
    const userDataToStore = {
      wallet_address: walletAddress,
      token_balance: balance,
      farcaster_username: farcasterUser?.farcaster_username || null,
      farcaster_pfp: farcasterUser?.farcaster_pfp || null,
      updated_at: new Date().toISOString()
    };

    console.log('🔵 Storing user data:', userDataToStore);
    
    await redis.hset('users', {
      [walletAddress]: JSON.stringify(userDataToStore)
    });

    return balance;
  } catch (error) {
    console.error('❌ Error in getTokenBalance:', error);
    return 0;
  }
}

// Add pixel placement rules
async function canOverwritePixel(x: number, y: number, newWallet: string): Promise<boolean> {
  const existingPixel = await redis.hget('canvas:pixels', `${x},${y}`);
  if (!existingPixel) return true;
  
  const now = Date.now();
  
  // Check lock status
  if ((existingPixel as any).locked_until && (existingPixel as any).locked_until > now) {
    return false;
  }
  
  // After 4 hours, anyone can overwrite
  if (now - Date.parse((existingPixel as any).placed_at) > 4 * 60 * 60 * 1000) {
    return true;
  }
  
  // Check token balance using cache
  const newBalance = await getTokenBalance(newWallet);
  return newBalance >= (existingPixel as any).token_balance;
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
    const pixelsExists = await redis.exists('supabase:pixels:queue')
    const usersExists = await redis.exists('supabase:users:queue')
    
    // Just create empty lists - don't push empty arrays
    if (!pixelsExists) await redis.del('supabase:pixels:queue')
    if (!usersExists) await redis.del('supabase:users:queue')
  } catch (error) {
    console.error('Failed to initialize Redis keys:', error)
  }
}

// Helper function with retries
async function triggerQueueProcessing(retries = 3) {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/cron/process-queue`, {
      method: 'POST',
      headers: { 
        'x-cron-secret': process.env.CRON_SECRET || '',
        'origin': process.env.NEXT_PUBLIC_APP_URL || ''
      }
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  } catch (error) {
    console.error('Queue trigger failed:', error);
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      return triggerQueueProcessing(retries - 1);
    }
  }
}

// Modify POST endpoint
export async function POST(request: Request) {
  try {
    await initializeRedisKeys()

    const session = await authenticateUser(request);
    if (!session) {
      return NextResponse.json({ error: 'Please connect your wallet to place pixels' }, { status: 401 });
    }

    const { x, y, color, lockDuration } = await request.json();
    const walletAddress = session.wallet_address.toLowerCase();
    
    // Check if wallet is banned
    const isBanned = await redis.sismember('banned:wallets:permanent', walletAddress);
    if (isBanned) {
      console.log(`🚫 Blocked attempt from banned wallet: ${walletAddress}`);
      return NextResponse.json({ error: 'Wallet is banned' }, { status: 403 });
    }

    // Get cached user data with proper type checking
    const cachedUserData = await redis.hget('users', walletAddress);
    let userInfo = typeof cachedUserData === 'string' ? 
      JSON.parse(cachedUserData) : 
      (cachedUserData || null);

    console.log('🔵 User data from Redis:', {
      raw: cachedUserData,
      type: typeof cachedUserData,
      parsed: userInfo
    });

    // Only fetch new balance if last update was > 5 minutes ago
    const FIVE_MINUTES = 5 * 60 * 1000;
    
    // Add null check and default to current time if no previous update
    const lastUpdated = userInfo?.updated_at 
      ? new Date(userInfo.updated_at).getTime()
      : Date.now() - FIVE_MINUTES - 1; // Force an update if no previous data
    
    const shouldUpdateBalance = Date.now() - lastUpdated > FIVE_MINUTES;

    if (shouldUpdateBalance) {
      const balance = Number(await getBillboardBalance(walletAddress));
      
      // Update user data in Redis without JSON.stringify
      await redis.hset('users', {
        [walletAddress]: JSON.stringify({
          ...userInfo,
          wallet_address: walletAddress,
          token_balance: balance,
          updated_at: new Date().toISOString()
        })
      });
      
      userInfo.token_balance = balance;
    }

    // Create pixel data using cached user info
    const pixelData = {
      id: uuidv4(),
      x,
      y,
      color,
      wallet_address: walletAddress,
      placed_at: new Date().toISOString(),
      farcaster_username: userInfo.farcaster_username || null,
      farcaster_pfp: userInfo.farcaster_pfp || null,
      token_balance: userInfo.token_balance,
      locked_until: lockDuration ? Date.now() + Math.min(lockDuration, 4 * 60 * 60 * 1000) : undefined
    };

    console.log('🔵 Storing pixel data:', pixelData);

    // Store pixel in Redis
    await redis.hset('canvas:pixels', {
      [`${x},${y}`]: JSON.stringify(pixelData)
    });

    // Add to history with timestamp score
    await redis.zadd('canvas:history', {
      score: Date.now(),
      member: JSON.stringify(pixelData)
    });

    // Get pixels from the last hour
    const recentPixels = await redis.zrange(
      'canvas:history',
      Date.now() - ONE_HOUR,
      Date.now(),
      {
        byScore: true
      }
    );

    // Count pixels per user in the last hour
    const recentCounts = recentPixels.reduce<Record<string, number>>((acc, pixelJson) => {
      const pixel = typeof pixelJson === 'string' ? JSON.parse(pixelJson) : pixelJson;
      const address = pixel.wallet_address;
      acc[address] = (acc[address] || 0) + 1;
      return acc;
    }, {});

    // Get user data for recent participants
    const users = await redis.hgetall('users') || {};

    // Calculate top users from recent activity
    const topUsers = Object.entries(recentCounts)
      .map(([address, count]) => {
        const userData = users[address];
        const parsedUserData = typeof userData === 'string' ? 
          JSON.parse(userData) : 
          (userData || {});
        
        return {
          wallet_address: address,
          count,
          farcaster_username: parsedUserData.farcaster_username || null,
          farcaster_pfp: parsedUserData.farcaster_pfp || null
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    console.log('🔵 Emitting top users (last hour):', topUsers);

    // Emit through Pusher with complete data
    await pusher.trigger('canvas', 'pixel-placed', {
      pixel: pixelData,
      topUsers
    });

    // Queue pixel data
    await redis.rpush('supabase:pixels:queue', JSON.stringify(pixelData))

    // Before queueing user data
    const userQueueType = await redis.type('supabase:users:queue')
    if (userQueueType !== 'list') {
      await redis.del('supabase:users:queue')
    }

    // Now queue the user data
    await redis.rpush('supabase:users:queue', JSON.stringify(userInfo))

    // Log queue lengths
    console.log('🔵 Queue lengths:', {
      pixels: await redis.llen('supabase:pixels:queue'),
      users: await redis.llen('supabase:users:queue')
    })

    // In your pixel placement handler
    // Use SETNX for atomic operation
    const processingSet = await redis.set('queue_processing_active', 'true', { 
      nx: true,  // Only set if not exists
      ex: 300    // Safety expiry
    });

    if (processingSet) {
      await triggerQueueProcessing();
    }

    return NextResponse.json({ 
      success: true,
      lockCost: lockDuration ? await calculateLockCost(lockDuration) : undefined
    });
  } catch (error) {
    console.error('Error placing pixel:', error);
    return NextResponse.json({ error: 'Failed to place pixel' }, { status: 500 });
  }
}

function calculateTopUsers(pixels: any[]) {
  console.log('Server: Starting calculateTopUsers with', pixels.length, 'pixels');
  
  const userCounts = pixels.reduce<Record<string, any>>((acc, pixel) => {
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

  const topUsers = Object.values(userCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  console.log('Server: Calculated topUsers:', JSON.stringify(topUsers, null, 2));
  return topUsers;
}

async function calculateLockCost(duration: number): Promise<number> {
  const hours = duration / (60 * 60 * 1000);
  const baseUsdCost = 0.10; // 10 cents per hour
  const usdCost = baseUsdCost * hours * (1 + hours/4); // Quadratic increase
  return getTokensNeededForUsdAmount(usdCost);
} 