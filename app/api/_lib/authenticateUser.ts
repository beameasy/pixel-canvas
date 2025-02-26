import { headers } from 'next/headers';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { redis } from '@/lib/server/redis';

interface User {
  wallet_address: string;
  farcaster_username?: string | null;
  farcaster_pfp?: string | null;
  privy_id?: string;
}

const JWKS = createRemoteJWKSet(
  new URL('https://auth.privy.io/api/v1/apps/cm619rgk5006nbotrbkyoanze/jwks.json')
);

export async function authenticateUser(request: Request): Promise<User | null> {
  try {
    const privyToken = request.headers.get('x-privy-token');
    let walletAddress = request.headers.get('x-wallet-address')?.toLowerCase();

    // If we have a Privy token but no wallet address, try to get it from the token
    if (privyToken && !walletAddress) {
      try {
        // Verify the token
        const { payload } = await jwtVerify(privyToken, JWKS);
        const privyId = payload.sub as string;
        
        // Try to find wallet address for this Privy ID in Redis
        const allUsers = await redis.hgetall('users');
        for (const [addr, userData] of Object.entries(allUsers || {})) {
          const data = typeof userData === 'string' ? JSON.parse(userData) : userData;
          if (data.privy_id === privyId) {
            walletAddress = addr.toLowerCase();
            break;
          }
        }
      } catch (error) {
        console.error('Privy token verification error:', error);
      }
    }

    // If we still don't have a wallet address, authentication fails
    if (!walletAddress) {
      return null;
    }

    // Check if this wallet is banned
    const isBanned = await redis.sismember('banned:wallets:permanent', walletAddress);
    if (isBanned) {
      console.log('🚫 Blocked banned wallet:', walletAddress);
      return null;
    }

    // Get user data from Redis if available
    const userData = await redis.hget('users', walletAddress);
    let privyId = null;
    
    if (userData) {
      const parsedData = typeof userData === 'string' ? JSON.parse(userData) : userData;
      privyId = parsedData.privy_id;
    } else if (privyToken) {
      // Extract Privy ID from token if we have it
      try {
        const { payload } = await jwtVerify(privyToken, JWKS);
        privyId = payload.sub as string;
      } catch (error) {
        console.error('Failed to extract Privy ID from token:', error);
      }
    }

    return {
      wallet_address: walletAddress,
      privy_id: privyId
    };
  } catch (error) {
    console.error('Auth error:', error);
    return null;
  }
}