import { NeynarAPIClient } from '@neynar/nodejs-sdk';
import { createClient } from '@supabase/supabase-js';

// Initialize Neynar client
const neynar = new NeynarAPIClient({ 
  apiKey: process.env.NEYNAR_API_KEY || '' 
});

// Initialize Supabase admin client for Farcaster data
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function getFarcasterUser(address: string) {
  if (!address) return null;
  
  try {
    const response = await neynar.fetchBulkUsersByEthOrSolAddress({ 
      addresses: [address] 
    });
    const users = response[address.toLowerCase()];
    
    if (!users?.length) return null;

    const user = users[0];
    
    // Store user data in Supabase
    await supabase
      .from('farcaster_users')
      .upsert({
        wallet_address: address.toLowerCase(),
        username: user.username,
        display_name: user.display_name,
        pfp_url: user.pfp_url,
        fid: user.fid,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'wallet_address'
      });

    return {
      farcaster_username: user.username,
      farcaster_pfp: user.pfp_url,
      display_name: user.display_name
    };
  } catch (error) {
    console.error('Error fetching Farcaster user:', error);
    return null;
  }
} 