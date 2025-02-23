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

// Export the client
export { pusherClient };

// Simplified connection state management
pusherClient.connection.bind('state_change', (states: { current: string, previous: string }) => {
  console.log(`📡 Pusher state changed from ${states.previous} to ${states.current}`);
});

// Log configuration once
console.log('🔵 Pusher client initialized:', {
  key: process.env.NEXT_PUBLIC_PUSHER_KEY?.slice(0, 4) + '...',
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
  state: pusherClient.connection.state
}); 