import Pusher from 'pusher-js';

// Add a DEBUG flag to control logging (should match with pusherManager.ts)
const DEBUG = true; // Set to true temporarily for debugging

// Enable Pusher logging only in development AND when DEBUG is true
Pusher.logToConsole = DEBUG && process.env.NODE_ENV === 'development';

// Determine environment
const isDev = process.env.NODE_ENV === 'development';

// Get environment-specific credentials
const key = isDev ? process.env.NEXT_PUBLIC_PUSHER_KEY_DEV! : process.env.NEXT_PUBLIC_PUSHER_KEY_PROD!;
const cluster = isDev ? process.env.NEXT_PUBLIC_PUSHER_CLUSTER_DEV! : process.env.NEXT_PUBLIC_PUSHER_CLUSTER_PROD!;

// Log configuration
if (DEBUG) {
  console.log('🔵 Pusher Configuration:', {
    environment: isDev ? 'development' : 'production',
    key: key ? `${key.slice(0, 4)}...` : 'missing',
    cluster,
    hasDevKey: !!process.env.NEXT_PUBLIC_PUSHER_KEY_DEV,
    hasProdKey: !!process.env.NEXT_PUBLIC_PUSHER_KEY_PROD
  });
}

// Validate configuration
if (!key || !cluster) {
  console.error('❌ Missing Pusher configuration:', {
    hasKey: !!key,
    hasCluster: !!cluster,
    env: process.env.NODE_ENV
  });
  throw new Error(`Missing Pusher configuration for ${isDev ? 'development' : 'production'}`);
}

// Create a single, persistent Pusher instance with improved settings
const pusherClient = new Pusher(key, {
  cluster,
  forceTLS: true,
  enabledTransports: ['ws', 'wss'],
  activityTimeout: 120000,  // 2 minutes
  pongTimeout: 30000,      // 30 seconds
});

// Helper function for logging
function log(message: string, data?: any) {
  if (DEBUG) {
    if (data) {
      console.log(message, data);
    } else {
      console.log(message);
    }
  }
}

// Export a function to get or create a channel subscription
export function getCanvasChannel() {
  const channelName = 'canvas';
  log('🟡 Checking for existing canvas channel subscription');
  let channel = pusherClient.channel(channelName);
  
  if (!channel) {
    log('🟡 No existing subscription found, creating new one');
    channel = pusherClient.subscribe(channelName);
    log('📡 New canvas channel subscription created');
  } else {
    log('♻️ Reusing existing canvas channel, connection state:', pusherClient.connection.state);
    // If connection isn't connected, reconnect
    if (pusherClient.connection.state !== 'connected') {
      log('🟡 Connection not in connected state, attempting to reconnect');
      pusherClient.connect();
    }
  }
  
  return channel;
}

// Export the client
export { pusherClient };

// Simplified connection state management
pusherClient.connection.bind('state_change', (states: { current: string, previous: string }) => {
  log(`📡 Pusher state changed from ${states.previous} to ${states.current}`);
  
  // When disconnected, attempt to reconnect
  if (states.current === 'disconnected') {
    log('🟡 Pusher disconnected, attempting to reconnect');
    setTimeout(() => {
      pusherClient.connect();
    }, 1000);
  }
});

// Log initial state
log('🔵 Pusher client initialized:', {
  key: key.slice(0, 4) + '...',
  cluster,
  state: pusherClient.connection.state
}); 