import Pusher from 'pusher';

// Verify required server-side env vars
if (!process.env.PUSHER_SECRET) {
  throw new Error('Missing PUSHER_SECRET environment variable');
}

export const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID!,
  key: process.env.PUSHER_KEY!,
  secret: process.env.PUSHER_SECRET!,
  cluster: process.env.PUSHER_CLUSTER!,
  useTLS: true,
});

// Add debug wrapper with safe logging
export async function triggerPusherEvent(channel: string, event: string, data: any) {
  console.log('🚀 SERVER: About to trigger Pusher event:', {
    channel,
    event,
    data: {
      hasPixel: !!data.pixel,
      hasTopUsers: !!data.topUsers,
      topUsersLength: data.topUsers?.length,
      sampleUser: data.topUsers?.[0]
    }
  });

  try {
    await pusher.trigger(channel, event, data);
    console.log('✅ SERVER: Pusher event triggered successfully');
    return true;
  } catch (error) {
    console.error('❌ SERVER: Pusher event failed:', error);
    return false;
  }
} 