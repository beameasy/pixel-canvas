import Pusher from 'pusher-js';

if (!process.env.NEXT_PUBLIC_PUSHER_KEY) {
  throw new Error('NEXT_PUBLIC_PUSHER_KEY is not defined');
}

if (!process.env.NEXT_PUBLIC_PUSHER_CLUSTER) {
  throw new Error('NEXT_PUBLIC_PUSHER_CLUSTER is not defined');
}

export const pusherClient = new Pusher(
  process.env.NEXT_PUBLIC_PUSHER_KEY,
  {
    cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
    enabledTransports: ['ws', 'wss'],
    forceTLS: true,
    activityTimeout: 30000,
    pongTimeout: 15000
  }
);

// Connection state handling
pusherClient.connection.bind('connected', () => {
  console.log('Pusher: Connected successfully');
});

pusherClient.connection.bind('connecting', () => {
  console.log('Pusher: Attempting to connect...');
});

pusherClient.connection.bind('disconnected', () => {
  console.log('Pusher: Disconnected, will try to reconnect...');
});

pusherClient.connection.bind('error', (error: any) => {
  if (error.error?.data?.code === 4004) {
    console.log('Pusher: Reconnecting after limit error');
    setTimeout(() => pusherClient.connect(), 1000);
  } else {
    console.warn('Pusher: Connection warning:', error);
  }
});

// Handle failed reconnection attempts gracefully
pusherClient.connection.bind('failed', () => {
  console.log('Pusher: Connection failed, will retry in 5s...');
  setTimeout(() => pusherClient.connect(), 5000);
}); 