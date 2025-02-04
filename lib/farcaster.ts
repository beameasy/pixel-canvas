import { supabase } from './supabase';

interface FarcasterUser {
  username: string;
  displayName?: string;
  pfp?: string;
}

export async function getFarcasterUserFromAddress(address: string): Promise<FarcasterUser | null> {
  try {
    const { data } = await supabase
      .from('farcaster_users')
      .select('username, display_name, pfp')
      .eq('wallet_address', address.toLowerCase())
      .single();

    if (data) {
      return {
        username: data.username,
        displayName: data.display_name,
        pfp: data.pfp
      };
    }
    return null;
  } catch (error) {
    console.error('Error fetching Farcaster user:', error);
    return null;
  }
} 