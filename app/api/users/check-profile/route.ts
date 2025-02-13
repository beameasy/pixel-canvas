import { NextResponse } from 'next/server';
import { getTokenBalance } from '../../_lib/alchemyServer';
import { redis } from '@/lib/server/redis';

async function getFarcasterProfile(walletAddress: string) {
  const neynarKey = process.env.NEYNAR_API_KEY;
  try {
    const response = await fetch(
      `https://api.neynar.com/v2/farcaster/lookup/addresses?blockchain_addresses=${walletAddress}`,
      {
        headers: { api_key: neynarKey! }
      }
    );
    const data = await response.json();
    if (data.users && data.users.length > 0) {
      return {
        farcaster_username: data.users[0].username,
        farcaster_pfp: data.users[0].pfp_url
      };
    }
    return null;
  } catch (error) {
    console.error('Farcaster lookup error:', error);
    return null;
  }
}

export async function POST(request: Request) {
  console.log('🔵 API route hit');
  
  try {
    const { walletAddress, privyId } = await request.json();
    console.log('🔵 Request data:', { walletAddress, privyId });
    
    // Check Redis cache first
    const cachedUser = await redis.hget('users', walletAddress);
    console.log('🔵 Redis cache result:', cachedUser);

    // Force refresh if token balance is 0
    const parsedCache = typeof cachedUser === 'string' ? JSON.parse(cachedUser) : cachedUser;
    if (parsedCache && parsedCache.token_balance === '0') {
      console.log('🔄 Forcing refresh due to zero balance');
    } else if (cachedUser) {
      return NextResponse.json(parsedCache);
    }

    // Build new user profile
    try {
      console.log('🟡 Getting token balance for:', walletAddress);
      const [tokenBalance, farcasterProfile] = await Promise.all([
        getTokenBalance(
          walletAddress.toLowerCase(), 
          process.env.TOKEN_ADDRESS!
        ).then(result => {
          console.log('🟢 Token balance result:', result);
          return result;
        }).catch(error => {
          console.error('🔴 Token balance error:', error);
          return { tokenBalances: [{ tokenBalance: '0' }] };
        }),
        getFarcasterProfile(walletAddress)
      ]);

      const userData = {
        wallet_address: walletAddress,
        privy_id: privyId,
        token_balance: tokenBalance.tokenBalances?.[0]?.tokenBalance || '0',
        updated_at: new Date().toISOString(),
        last_active: new Date().toISOString(),
        ...(farcasterProfile || {})
      };

      // Cache in Redis
      await redis.hset('users', { [walletAddress]: JSON.stringify(userData) });
      await redis.lpush('users:queue', JSON.stringify(userData));

      return NextResponse.json(userData);
    } catch (error) {
      console.error('Profile building error:', error);
      throw error;
    }
  } catch (error) {
    console.error('Profile check error:', error);
    return NextResponse.json({ error: 'Failed to check profile' }, { status: 500 });
  }
} 