import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';
import { getBillboardBalance } from '@/app/api/_lib/subgraphClient';

// This endpoint returns the user profile for a given wallet address
// It's used by the canvas to display token balances in the tooltip
export async function GET(
  request: Request,
  { params }: { params: { address: string } }
) {
  try {
    const walletAddress = params.address.toLowerCase();
    
    // Check if forcing refresh (useful for debugging or manual refresh)
    const forceRefresh = request.url.includes('?refresh=true');
    const balanceChanged = await redis.exists(`user:${walletAddress}:balance_changed`);
    
    // If forcing refresh or balance changed flag is set, get fresh data
    if (forceRefresh || balanceChanged) {
      // Clear the flag if it exists
      if (balanceChanged) {
        await redis.del(`user:${walletAddress}:balance_changed`);
      }
      
      // Also clear the tokenTiers cache
      await redis.del(`balance:${walletAddress}`);
      
      // Get fresh balance from blockchain
      const balance = await getBillboardBalance(walletAddress);
      
      // Update the cached user data
      const userData = await redis.hget('users', walletAddress);
      if (userData) {
        const parsedUserData = typeof userData === 'string' ? JSON.parse(userData) : userData;
        const updatedData = {
          ...parsedUserData,
          token_balance: Number(balance),
          updated_at: new Date().toISOString()
        };
        
        await redis.hset('users', {
          [walletAddress]: JSON.stringify(updatedData)
        });
        
        return NextResponse.json(updatedData, {
          headers: { 'Cache-Control': 'no-store' }
        });
      } else {
        // No existing profile - create minimal one with just balance
        const newData = {
          wallet_address: walletAddress,
          token_balance: Number(balance),
          farcaster_username: null,
          farcaster_pfp: null,
          updated_at: new Date().toISOString()
        };
        
        await redis.hset('users', {
          [walletAddress]: JSON.stringify(newData)
        });
        
        return NextResponse.json(newData, {
          headers: { 'Cache-Control': 'no-store' }
        });
      }
    }

    // Get cached user data
    const userData = await redis.hget('users', walletAddress);
    if (!userData) {
      // If no cached data, get balance from blockchain
      const balance = await getBillboardBalance(walletAddress);
      
      // Create minimal profile
      const newData = {
        wallet_address: walletAddress,
        token_balance: Number(balance),
        farcaster_username: null,
        farcaster_pfp: null,
        updated_at: new Date().toISOString()
      };
      
      // Cache it
      await redis.hset('users', {
        [walletAddress]: JSON.stringify(newData)
      });
      
      return NextResponse.json(newData);
    }

    // Return cached data
    return NextResponse.json(
      typeof userData === 'string' ? JSON.parse(userData) : userData
    );
  } catch (error) {
    console.error('Error fetching user profile:', error);
    return NextResponse.json({ error: 'Failed to get user profile' }, { status: 500 });
  }
} 