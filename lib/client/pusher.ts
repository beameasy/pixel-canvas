import Pusher from 'pusher-js';

// Create a single, persistent Pusher instance
const pusherClient = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
  forceTLS: true,
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

// Basic connection logging
pusherClient.connection.bind('connected', () => {
  console.log('✅ Pusher connected');
});

pusherClient.connection.bind('disconnected', () => {
  console.log('❌ Pusher disconnected');
});

if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      console.log('🔄 Page became visible - checking Pusher connection');
      if (pusherClient.connection.state !== 'connected') {
        console.log('🔄 Reconnecting Pusher');
        pusherClient.connect();
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