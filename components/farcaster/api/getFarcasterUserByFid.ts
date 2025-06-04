import { NeynarAPIClient } from '@neynar/nodejs-sdk';
import { createClient } from '@supabase/supabase-js';

const neynar = new NeynarAPIClient({
  apiKey: process.env.NEYNAR_API_KEY || ''
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function getFarcasterUserByFid(fid: number) {
  if (!fid) return null;
  try {
    const response = await neynar.fetchBulkUsers({ fids: [fid] });
    const user = response.users?.[0];
    if (!user) return null;

    await supabase
      .from('farcaster_users')
      .upsert({
        fid: user.fid,
        username: user.username,
        display_name: user.display_name,
        pfp_url: user.pfp_url,
        wallet_address: user.custody_address.toLowerCase(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'fid' });

    return {
      fid: user.fid,
      username: user.username,
      display_name: user.display_name,
      pfp_url: user.pfp_url,
      custody_address: user.custody_address
    };
  } catch (error) {
    console.error('Error fetching Farcaster user by fid:', error);
    return null;
  }
}
