import { NextResponse } from 'next/server';
import { getFarcasterUser } from '@/components/farcaster/api/getFarcasterUser';
import { redis } from '@/lib/server/redis';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address')?.toLowerCase();
    
    if (!address) {
      return NextResponse.json({ error: 'Address is required' }, { status: 400 });
    }

    const farcasterData = await getFarcasterUser(address);
    
    // Store in Redis if we got data
    if (farcasterData?.farcaster_username) {
      await redis.hset('users:farcaster', {
        [address]: JSON.stringify({
          farcaster_username: farcasterData.farcaster_username,
          farcaster_pfp: farcasterData.farcaster_pfp
        })
      });
    }

    return NextResponse.json(farcasterData);
  } catch (error) {
    console.error('Error fetching Farcaster data:', error);
    return NextResponse.json({ error: 'Failed to fetch Farcaster data' }, { status: 500 });
  }
}