import { NextResponse } from 'next/server';
import { getFarcasterUser } from '@/components/farcaster/api/getFarcasterUser';
import { redis } from '@/lib/server/redis';

export async function GET(request: Request) {
  try {
    const startTime = performance.now();
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address')?.toLowerCase();
    
    if (!address) {
      return NextResponse.json({ error: 'Address is required' }, { status: 400 });
    }

    // Check users hash first
    const userData = await redis.hget('users', address);
    console.log('Redis check:', {
      address,
      userData,
      type: typeof userData,
      hasFarcaster: userData && (
        typeof userData === 'string' 
          ? JSON.parse(userData).farcaster_username
          : (userData as any).farcaster_username
      )
    });

    if (userData) {
      const user = typeof userData === 'string' ? JSON.parse(userData) : userData;
      if (user.farcaster_username) {
        console.log('✅ User cache hit:', {
          address,
          username: user.farcaster_username,
          timeMs: performance.now() - startTime
        });
        return NextResponse.json({
          farcaster_username: user.farcaster_username,
          farcaster_pfp: user.farcaster_pfp
        }, {
          headers: {
            'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300'
          }
        });
      }
    }

    // Only reach here for truly new users
    console.log('🆕 New user, fetching Farcaster:', address);
    const farcasterData = await getFarcasterUser(address);
    
    // Cache the result
    if (farcasterData?.farcaster_username) {
      await redis.hset('users', {
        [address]: JSON.stringify({
          wallet_address: address,
          farcaster_username: farcasterData.farcaster_username,
          farcaster_pfp: farcasterData.farcaster_pfp,
          updated_at: new Date().toISOString()
        })
      });
    }

    return NextResponse.json(farcasterData, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300'
      }
    });
  } catch (error) {
    console.error('Error fetching Farcaster data:', error);
    return NextResponse.json({ error: 'Failed to fetch Farcaster data' }, { status: 500 });
  }
}