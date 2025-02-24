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
    if (!privyToken) {
      return null;
    }

    // Verify the token with Privy JWKS
    const { payload } = await jwtVerify(privyToken, JWKS);
    console.log('JWT payload:', payload);
    if (!payload.sub) {
      return null;
    }

    // Get the wallet address
    const walletAddress = request.headers.get('x-wallet-address')?.toLowerCase();
    if (!walletAddress) {
      return null;
    }

    // For now, if we have a valid Privy token and wallet address, consider it authenticated
    // We can add additional checks later if needed
    return {
      wallet_address: walletAddress,
      privy_id: payload.sub
    };
  } catch (error) {
    console.error('Auth error:', error);
    return null;
  }
}