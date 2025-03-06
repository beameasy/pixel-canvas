import Pusher from 'pusher-js';

// Enable Pusher logging only in development
Pusher.logToConsole = process.env.NODE_ENV === 'development';

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
  console.log('🟡 Checking for existing canvas channel subscription');
  let channel = pusherClient.channel(channelName);
  
  if (!channel) {
    console.log('🟡 No existing subscription found, creating new one');
    channel = pusherClient.subscribe(channelName);
    console.log('📡 New canvas channel subscription created');
  } else {
    console.log('♻️ Reusing existing canvas channel, connection state:', pusherClient.connection.state);
    // If connection isn't connected, reconnect
    if (pusherClient.connection.state !== 'connected') {
      console.log('🟡 Connection not in connected state, attempting to reconnect');
      pusherClient.connect();
    }
  }
  
  return channel;
}

// Export the client
export { pusherClient };

// Simplified connection state management
pusherClient.connection.bind('state_change', (states: { current: string, previous: string }) => {
  console.log(`📡 Pusher state changed from ${states.previous} to ${states.current}`);
  
  // When disconnected, attempt to reconnect
  if (states.current === 'disconnected') {
    console.log('🟡 Pusher disconnected, attempting to reconnect');
    setTimeout(() => {
      pusherClient.connect();
    }, 1000);
  }
});

// Log configuration once
console.log('🔵 Pusher client initialized:', {
  key: process.env.NEXT_PUBLIC_PUSHER_KEY?.slice(0, 4) + '...',
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
  state: pusherClient.connection.state
}); 