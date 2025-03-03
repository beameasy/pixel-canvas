import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';
import { getAccessToken } from '@privy-io/react-auth';
import { getAdminClient } from '../_lib/supabaseAdmin';
import { authenticateUser } from '../_lib/authenticateUser';
import { getFarcasterUser } from '../../../components/farcaster/api/getFarcasterUser';
import { getBillboardBalance, getTokensNeededForUsdAmount } from '@/app/api/_lib/subgraphClient';
import { pusher } from '@/lib/server/pusher';
import { v4 as uuidv4 } from 'uuid';
import { canPlacePixel, canOverwritePixel, getUserTier } from '@/lib/server/tokenTiers';

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
        'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30'
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
        'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30'
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
async function getTokenBalance(walletAddress: string, session: any): Promise<number> {
  try {
    const userData = await redis.hget('users', walletAddress);
    if (userData) {
      const parsedUserData = typeof userData === 'string' ? JSON.parse(userData) : userData;
      // Keep existing Privy ID if present
      if (session?.privy_id && !parsedUserData.privy_id) {
        await redis.hset('users', {
          [walletAddress]: JSON.stringify({
            ...parsedUserData,
            privy_id: session.privy_id,
            updated_at: new Date().toISOString()
          })
        });
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
      await redis.hset('users', {
        [walletAddress]: JSON.stringify({
          ...user,
          token_balance: balance,
          updated_at: new Date().toISOString()
        })
      });
      console.log('💰 Refreshed balance:', balance);
    }

    // Balance-based cooldown check (skip for admins)
    if (balance === 0 && !isAdmin) {
      return NextResponse.json({ 
        error: 'Please wait 60 seconds between pixels (0 balance)'
      }, { status: 429 });
    }

    // Regular tier-based cooldown check (skip for admins)
    if (!isAdmin) {
      const tier = await getUserTier(balance);
      console.log(`🔵 User ${walletAddress} with balance ${balance} has tier: ${tier.name} with cooldown: ${tier.cooldownSeconds}s`);

      const lastPlaced = (await redis.hget('pixel:cooldowns', walletAddress) || '0').toString();
      if (lastPlaced) {
        const timeSinceLastPlaced = Date.now() - parseInt(lastPlaced);
        if (timeSinceLastPlaced < tier.cooldownSeconds * 1000) {
          return NextResponse.json({ 
            error: `Please wait ${Math.ceil((tier.cooldownSeconds * 1000 - timeSinceLastPlaced) / 1000)} seconds`
          }, { status: 429 });
        }
      }
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
        error: overwriteCheck.message || 'Cannot overwrite this pixel'
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

    // Use Redis transaction to ensure atomic operations
    const multi = redis.multi();
    
    // Prepare all operations
    multi.hset('canvas:pixels', {
      [`${x},${y}`]: JSON.stringify(pixelData)
    });
    
    multi.zadd('canvas:history', {
      score: now,
      member: JSON.stringify(pixelData)
    });
    
    multi.hset('pixel:cooldowns', {
      [walletAddress]: now.toString()
    });
    
    multi.rpush('supabase:pixels:queue', JSON.stringify(pixelData));
    
    multi.set(`user:${walletAddress}:balance_changed`, "true", {ex: 60});
    
    // Execute all operations atomically
    await multi.exec();

    // Trigger queue processing if queue has enough items
    const queueLength = await redis.llen('supabase:pixels:queue');
    if (queueLength >= 10) { // Process in batches of 50 or more
      // Check if processing is already active
      const processingActive = await redis.get('queue_processing_active');
      if (!processingActive) {
        // Set processing flag with 5 minute expiry
        await redis.set('queue_processing_active', '1', {ex: 300});
        
        // Trigger processing in background
        if (process.env.NEXT_PUBLIC_APP_URL && process.env.CRON_SECRET) {
          fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/cron/process-queue`, {
            method: 'POST',
            headers: { 
              'x-cron-secret': process.env.CRON_SECRET,
              'origin': process.env.NEXT_PUBLIC_APP_URL 
            }
          }).catch(error => {
            console.error('Failed to trigger queue processing:', error);
          });
        }
      }
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
    await pusher.trigger('canvas', 'pixel-placed', { 
      pixel: pixelData,
      topUsers: topUsers,
      activitySpikes: activitySpikes
    }).then(() => {
      console.log('✅ Pusher event sent successfully');
    }).catch((error) => {
      console.error('❌ Failed to send Pusher event:', error);
    });

    return NextResponse.json({ success: true, pixel: pixelData }, {
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
