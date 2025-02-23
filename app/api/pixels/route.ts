import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';
import { getAccessToken } from '@privy-io/react-auth';
import { getAdminClient } from '../_lib/supabaseAdmin';
import { authenticateUser } from '../_lib/authenticateUser';
import { getFarcasterUser } from '@/lib/farcaster';
import { getBillboardBalance, getTokensNeededForUsdAmount } from '@/app/api/_lib/subgraphClient';
import { pusher } from '@/lib/server/pusher';
import { v4 as uuidv4 } from 'uuid';
import { canPlacePixel, canOverwritePixel, getUserTier } from '@/lib/server/tokenTiers';

const ONE_HOUR = 60 * 60 * 1000; // 1 hour in milliseconds

// Increase cache time for initial load
export const revalidate = 30; // 30 seconds instead of 5

const isDev = process.env.NODE_ENV === 'development';

// Get canvas state
export async function GET(request: Request) {
  try {
    const session = await authenticateUser(request);
    
    const exists = await redis.exists('canvas:pixels');
    
    const pixels = exists ? await redis.hgetall('canvas:pixels') : {};
    
    const pixelsArray = Object.entries(pixels || {}).map(([key, value]) => {
      const [x, y] = key.split(',');
      const pixelData = typeof value === 'string' ? JSON.parse(value) : value;
      return {
        ...pixelData,
        x: parseInt(x),
        y: parseInt(y)
      };
    });

    // Increase cache times
    return NextResponse.json(pixelsArray, {
      headers: { 
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60'
      }
    });
  } catch (error) {
    console.error('❌ Error fetching pixels:', error);
    return NextResponse.json([], { status: 200 });
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
      if (isDev) {
        console.log('🔵 Found cached user data:', userData);
      }
      return (typeof userData === 'string' ? JSON.parse(userData) : userData).token_balance || 0;
    }
  
    // If no cached data, fetch from chain and update user record
    const balance = Number(await getBillboardBalance(walletAddress));
    const farcasterUser = await getFarcasterUser(walletAddress);
    
    if (isDev) {
      console.log('🔵 Raw Farcaster user data:', farcasterUser);
    }
    
    // Match the FarcasterUser interface field names
    const userDataToStore = {
      wallet_address: walletAddress,
      token_balance: balance,
      farcaster_username: farcasterUser?.farcaster_username || null,
      farcaster_pfp: farcasterUser?.farcaster_pfp || null,
      updated_at: new Date().toISOString()
    };

    if (isDev) {
      console.log('🔵 Storing user data:', userDataToStore);
    }
    
    await redis.hset('users', {
      [walletAddress]: JSON.stringify(userDataToStore)
    });

    return balance;
  } catch (error) {
    console.error('❌ Error in getTokenBalance:', error);
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
    const session = await authenticateUser(request);
    if (!session || !session.wallet_address) {
      return NextResponse.json({ 
        error: 'Please connect a wallet to place pixels'
      }, { status: 401 });
    }

    const walletAddress = session.wallet_address.toLowerCase();

    // Ban check
    const allBanned = await redis.smembers('banned:wallets:permanent');
    const bannedWallets = allBanned.flat();
    const isBanned = bannedWallets.includes(walletAddress);
    if (isBanned) {
      return NextResponse.json({ error: 'Account banned' }, { status: 403 });
    }

    const { x, y, color } = await request.json();

    // Get existing pixel data
    const existingPixel = await redis.hget('canvas:pixels', `${x},${y}`);
    const existingPixelData = existingPixel ? 
      (typeof existingPixel === 'string' ? JSON.parse(existingPixel) : existingPixel) 
      : null;

    // Check if can overwrite
    const overwriteCheck = await canOverwritePixel(walletAddress, existingPixelData);
    if (!overwriteCheck.canOverwrite) {
      return NextResponse.json({ 
        error: overwriteCheck.message || 'Cannot overwrite this pixel'
      }, { status: 403 });
    }

    // Check cooldown
    const lastPlaced = (await redis.hget('pixel:cooldowns', walletAddress) || '0').toString();
    if (lastPlaced) {
      const timeSinceLastPlaced = Date.now() - parseInt(lastPlaced);
      const balance = Number(await getTokenBalance(walletAddress));
      const tier = await getUserTier(balance);
      
      if (timeSinceLastPlaced < tier.cooldownSeconds * 1000) {
        return NextResponse.json({ 
          error: `Please wait ${Math.ceil((tier.cooldownSeconds * 1000 - timeSinceLastPlaced) / 1000)} seconds`
        }, { status: 429 });
      }
    }

    // Get user data safely
    const userData = await redis.hget('users', walletAddress);
    const userInfo = userData ? 
      (typeof userData === 'string' ? JSON.parse(userData) : userData) : 
      {};

    const balance = await getTokenBalance(walletAddress);
    
    const pixelData = {
      id: `${x}-${y}-${Date.now()}`,
      x,
      y,
      color,
      wallet_address: walletAddress,
      placed_at: new Date().toISOString(),
      farcaster_username: userInfo.farcaster_username,
      farcaster_pfp: userInfo.farcaster_pfp,
      token_balance: balance
    };

    // Store both current state and history
    await Promise.all([
      // Current state
      redis.hset('canvas:pixels', {
        [`${x},${y}`]: JSON.stringify(pixelData)
      }),
      // History for leaderboard - fix zadd syntax
      redis.zadd('canvas:history', {
        score: Date.now(),
        member: JSON.stringify(pixelData)
      }),
      // Cooldown
      redis.hset('pixel:cooldowns', {
        [walletAddress]: Date.now().toString()
      })
    ]);

    // Calculate top users
    const pixels = await redis.hgetall('canvas:pixels');
    const topUsers = calculateTopUsers(Object.values(pixels || {}));

    // Send both pixel and topUsers data in Pusher event
    await pusher.trigger('canvas', 'pixel-placed', { 
      pixel: pixelData,
      topUsers 
    });

    return NextResponse.json({ success: true, pixel: pixelData });

  } catch (error) {
    console.error('Error placing pixel:', error);
    return NextResponse.json({ error: 'Failed to place pixel' }, { status: 500 });
  }
}

function calculateTopUsers(pixels: any[]) {
  const now = Date.now();

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
