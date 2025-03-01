import { headers } from 'next/headers';
import { redis } from '@/lib/server/redis';

interface User {
  wallet_address: string;
  farcaster_username?: string | null;
  farcaster_pfp?: string | null;
  privy_id?: string;
}

export async function authenticateUser(request: Request): Promise<User | null> {
  try {
    // Get pre-validated Privy ID from middleware
    const privyId = request.headers.get('x-privy-id');
    const claimedWalletAddress = request.headers.get('x-wallet-address')?.toLowerCase();

    if (!privyId || !claimedWalletAddress) {
      return null;
    }

    // Check only the claimed wallet
    const userData = await redis.hget('users', claimedWalletAddress);
    if (!userData) {
      return null;
    }

    const parsedData = typeof userData === 'string' ? JSON.parse(userData) : userData;
    
    // Verify this wallet belongs to the authenticated Privy ID
    if (parsedData.privy_id !== privyId) {
      console.log('🚨 Wallet ownership mismatch', {
        wallet: claimedWalletAddress,
        claimed_privy_id: privyId,
        stored_privy_id: parsedData.privy_id
      });
      return null;
    }

    // Don't need to check banned status - middleware already did

    return {
      wallet_address: claimedWalletAddress,
      privy_id: privyId,
      farcaster_username: parsedData.farcaster_username || null,
      farcaster_pfp: parsedData.farcaster_pfp || null
    };

  } catch (error) {
    console.error('Auth error occurred');
    return null;
  }
}