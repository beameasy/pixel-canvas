import Pusher from 'pusher-js';

// Enable Pusher logging
Pusher.logToConsole = true;

let pusherInstance: Pusher | null = null;

function getPusherClient() {
  if (!pusherInstance) {
    console.log('🔵 Creating new Pusher instance');

    pusherInstance = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
      forceTLS: true,
      enabledTransports: ['ws', 'wss']
    });

    // Debug connection state
    pusherInstance.connection.bind('state_change', (states: {
      previous: string;
      current: string;
    }) => {
      console.log('🔵 Pusher state changed:', states.previous, '->', states.current);
    });

    pusherInstance.connection.bind('connected', () => {
      console.log('🟢 Connected with socket ID:', pusherInstance?.connection.socket_id);
    });
  }
  return pusherInstance;
}

// Create and export a single instance
export const pusherClient = getPusherClient();

// Log configuration
console.log('🔵 Pusher client initialized:', {
  key: process.env.NEXT_PUBLIC_PUSHER_KEY?.slice(0, 4) + '...',
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
  state: pusherClient.connection.state
}); 