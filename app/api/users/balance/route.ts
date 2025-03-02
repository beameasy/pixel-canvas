import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';
import { authenticateUser } from '@/app/api/_lib/authenticateUser';
import { getBillboardBalance } from '@/app/api/_lib/subgraphClient';
import { getUserTier } from '@/lib/server/tokenTiers';

export async function GET(request: Request) {
  try {
    const session = await authenticateUser(request);
    if (!session?.wallet_address) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const walletAddress = session.wallet_address.toLowerCase();
    const forceRefresh = Boolean(
      request.url.includes('?t=') || // Check for cache-busting parameter 
      await redis.exists(`user:${walletAddress}:balance_changed`) // Check if balance recently changed
    );

    // If we need to force a refresh, get it from the blockchain
    if (forceRefresh) {
      // Clear the flag
      await redis.del(`user:${walletAddress}:balance_changed`);
      // Also clear the tokenTiers cache
      await redis.del(`balance:${walletAddress}`);
      
      // Get fresh balance from blockchain
      const balance = await getBillboardBalance(walletAddress);
      
      // Update the cached user data
      const userData = await redis.hget('users', walletAddress);
      if (userData) {
        const parsedUserData = typeof userData === 'string' ? JSON.parse(userData) : userData;
        await redis.hset('users', {
          [walletAddress]: JSON.stringify({
            ...parsedUserData,
            token_balance: Number(balance),
            updated_at: new Date().toISOString()
          })
        });
      }
      
      return NextResponse.json({ balance }, {
        headers: { 'Cache-Control': 'no-store' }
      });
    }

    // Get cached balance
    const userData = await redis.hget('users', walletAddress);
    if (!userData) {
      // If no cached data, get from blockchain
      const balance = await getBillboardBalance(walletAddress);
      return NextResponse.json({ balance }, {
        headers: { 'Cache-Control': 'no-store' }
      });
    }

    const parsedUserData = typeof userData === 'string' ? JSON.parse(userData) : userData;
    return NextResponse.json({ balance: parsedUserData.token_balance || 0 });
  } catch (error) {
    console.error('Error in balance endpoint:', error);
    return NextResponse.json({ error: 'Failed to get balance' }, { status: 500 });
  }
} 