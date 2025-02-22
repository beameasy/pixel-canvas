import Pusher from 'pusher-js';

// Create a single, persistent Pusher instance with improved settings
const pusherClient = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
  forceTLS: true,
  enabledTransports: ['ws', 'wss'],
  activityTimeout: 120000,  // 2 minutes
  pongTimeout: 30000,      // 30 seconds
});

// Export a function to get or create a channel subscription
export function getCanvasChannel() {
  const channelName = 'canvas';
  let channel = pusherClient.channel(channelName);
  
  if (!channel) {
    channel = pusherClient.subscribe(channelName);
    console.log('📡 New canvas channel subscription');
  } else {
    console.log('♻️ Reusing existing canvas channel');
  }
  
  return channel;
}

// Export the client as well in case we need it elsewhere
export { pusherClient };

// Enhanced connection state management
pusherClient.connection.bind('state_change', (states: { current: string, previous: string }) => {
  console.log(`📡 Pusher state changed from ${states.previous} to ${states.current}`);
  
  if (states.current === 'disconnected' || states.current === 'failed') {
    console.log('🔄 Scheduling reconnection attempt...');
    setTimeout(() => {
      console.log('🔄 Attempting to reconnect...');
      pusherClient.connect();
    }, 5000);
  }
});

pusherClient.connection.bind('connected', () => {
  console.log('✅ Pusher connected');
});

pusherClient.connection.bind('disconnected', () => {
  console.log('❌ Pusher disconnected');
});

// Enhanced visibility change handler
if (typeof window !== 'undefined') {
  let reconnectTimeout: NodeJS.Timeout;
  
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      console.log('🔄 Page became visible - checking Pusher connection');
      
      // Clear any existing reconnect timeout
      clearTimeout(reconnectTimeout);
      
      if (pusherClient.connection.state !== 'connected') {
        console.log('🔄 Reconnecting Pusher');
        // Add a small delay to avoid immediate reconnection
        reconnectTimeout = setTimeout(() => {
          pusherClient.connect();
        }, 1000);
      }
    }
  });
}

// Log configuration
console.log('🔵 Pusher client initialized:', {
  key: process.env.NEXT_PUBLIC_PUSHER_KEY?.slice(0, 4) + '...',
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
  state: pusherClient.connection.state
}); 