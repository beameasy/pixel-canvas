import Pusher from 'pusher';

// Enable debug logging
const DEBUG = true;

// Determine environment
const isDev = process.env.NODE_ENV === 'development';

// Get environment-specific credentials
const appId = isDev ? process.env.NEXT_PUBLIC_PUSHER_APP_ID_DEV! : process.env.NEXT_PUBLIC_PUSHER_APP_ID_PROD!;
const key = isDev ? process.env.NEXT_PUBLIC_PUSHER_KEY_DEV! : process.env.NEXT_PUBLIC_PUSHER_KEY_PROD!;
const secret = isDev ? process.env.PUSHER_SECRET_DEV! : process.env.PUSHER_SECRET_PROD!;
const cluster = isDev ? process.env.NEXT_PUBLIC_PUSHER_CLUSTER_DEV! : process.env.NEXT_PUBLIC_PUSHER_CLUSTER_PROD!;

// Log configuration
if (DEBUG) {
  console.log('🔵 SERVER: Pusher Configuration:', {
    environment: isDev ? 'development' : 'production',
    appId: appId ? `${appId.slice(0, 4)}...` : 'missing',
    key: key ? `${key.slice(0, 4)}...` : 'missing',
    hasSecret: !!secret,
    cluster,
    hasDevSecret: !!process.env.PUSHER_SECRET_DEV,
    hasProdSecret: !!process.env.PUSHER_SECRET_PROD
  });
}

// Verify required server-side env vars
if (!secret) {
  throw new Error(`Missing PUSHER_SECRET_${isDev ? 'DEV' : 'PROD'} environment variable`);
}

if (!appId || !key || !cluster) {
  throw new Error(`Missing required Pusher configuration for ${isDev ? 'development' : 'production'}`);
}

export const pusher = new Pusher({
  appId,
  key,
  secret,
  cluster,
  useTLS: true,
});

// Add debug wrapper with safe logging
export async function triggerPusherEvent(channel: string, event: string, data: any) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 🚀 SERVER: Triggering Pusher event:`, {
    channel,
    event,
    data: {
      hasPixel: !!data.pixel,
      pixelCoords: data.pixel ? `${data.pixel.x},${data.pixel.y}` : null,
      hasTopUsers: !!data.topUsers,
      topUsersLength: data.topUsers?.length,
      sampleUser: data.topUsers?.[0] ? {
        wallet: data.topUsers[0].wallet_address?.slice(0, 6),
        count: data.topUsers[0].count
      } : null
    }
  });

  try {
    // Add socket_id if provided to exclude sender
    const socketId = data.socket_id;
    const options = socketId ? { socket_id: socketId } : undefined;
    
    // Trigger with retry logic
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      try {
        await pusher.trigger(channel, event, data, options);
        console.log(`[${timestamp}] ✅ SERVER: Pusher event triggered successfully`);
        return true;
      } catch (error) {
        attempts++;
        if (attempts === maxAttempts) {
          throw error;
        }
        console.warn(`[${timestamp}] ⚠️ SERVER: Pusher trigger attempt ${attempts} failed, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
      }
    }
  } catch (error) {
    console.error(`[${timestamp}] ❌ SERVER: Pusher event failed:`, error);
    // Log additional error details if available
    if (error instanceof Error) {
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
    }
    return false;
  }
} 