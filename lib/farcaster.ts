import { NeynarAPIClient } from '@neynar/nodejs-sdk';
import { alchemy } from '@/lib/alchemy';

// Initialize Neynar client
const neynar = new NeynarAPIClient({ 
  apiKey: process.env.NEYNAR_API_KEY || '' 
});

const CONTRACT_ADDRESS = process.env.TOKEN_ADDRESS || '';

export interface FarcasterUser {
  wallet_address: string;
  farcaster_username: string | null;
  farcaster_pfp: string | null;
  updated_at: string;
  last_active: string;
  token_balance?: string | null;
  privy_id?: string | null;
}

export async function getFarcasterUser(address: string): Promise<FarcasterUser | null> {
  if (!address) return null;
  
  try {
    console.log('🔍 Fetching Farcaster data for:', address);
    
    const response = await neynar.fetchBulkUsersByEthOrSolAddress({ 
      addresses: [address] 
    });
    console.log('🦜 Neynar response:', response);
    
    const users = response[address.toLowerCase()];
    if (!users?.length) return null;

    const user = users[0];
    const now = new Date().toISOString();
    
    const farcasterUser = {
      wallet_address: address.toLowerCase(),
      farcaster_username: user.username || null,
      farcaster_pfp: user.pfp_url || null,
      updated_at: now,
      last_active: now
    };
    console.log('🦜 Processed Farcaster user:', farcasterUser);
    
    return farcasterUser;
  } catch (error) {
    console.error('❌ Error fetching Farcaster user:', error);
    return null;
  }
} 