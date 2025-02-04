import { NextResponse } from 'next/server';
import { NeynarAPIClient } from '@neynar/nodejs-sdk';
import { createClient } from '@supabase/supabase-js';

const neynar = new NeynarAPIClient({ apiKey: process.env.NEYNAR_API_KEY || '' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get('address');

  if (!address) {
    return NextResponse.json({ success: false, error: 'Address is required' }, { status: 200 });
  }

  try {
    const response = await neynar.fetchBulkUsersByEthOrSolAddress({ addresses: [address] });
    const users = response[address.toLowerCase()];
    
    if (!users?.length) {
      // No Farcaster account found - this is normal, return success with null data
      return NextResponse.json({ 
        success: true, 
        data: null 
      }, { status: 200 });
    }

    const user = users[0];
    console.log('Found Farcaster user:', user.username);
    
    // Store user data in Supabase
    const { error: upsertError } = await supabase
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

    if (upsertError) {
      console.error('Error storing Farcaster user:', upsertError);
    } else {
      console.log('Successfully stored Farcaster user in database:', user.username);
    }

    return NextResponse.json({
      success: true,
      data: {
        username: user.username,
        pfpUrl: user.pfp_url,
        displayName: user.display_name
      }
    });
  } catch (error) {
    // Don't log the error, just return null data
    return NextResponse.json({ 
      success: true, 
      data: null 
    }, { status: 200 });
  }
}