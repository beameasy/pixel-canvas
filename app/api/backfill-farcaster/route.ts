import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { NeynarAPIClient } from '@neynar/nodejs-sdk';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const neynar = new NeynarAPIClient({
  apiKey: process.env.NEYNAR_API_KEY || ''
});

export async function POST() {
  try {
    // Get all messages without Farcaster data
    const { data: messages, error } = await supabase
      .from('terminal_messages')
      .select('*')
      .is('farcaster_username', null)
      .order('created_at', { ascending: false })
      .limit(10); // Reduced batch size to avoid rate limits

    if (error) throw error;
    if (!messages?.length) {
      return NextResponse.json({ 
        success: true, 
        processed: 0,
        message: 'No messages to process' 
      });
    }

    let processed = 0;
    const uniqueAddresses = [...new Set(messages.map(m => m.wallet_address.toLowerCase()))];

    // Fetch Farcaster data for all unique addresses
    const addressResponses = await neynar.fetchBulkUsersByEthOrSolAddress({
      addresses: uniqueAddresses
    });

    // Update messages with Farcaster data
    for (const message of messages) {
      try {
        const users = addressResponses[message.wallet_address.toLowerCase()];
        if (users?.length) {
          const user = users[0];
          const { error: updateError } = await supabase
            .from('terminal_messages')
            .update({
              farcaster_username: user.username,
              farcaster_pfp: user.pfp_url
            })
            .eq('id', message.id);

          if (!updateError) processed++;
        }
      } catch (e) {
        console.error(`Error processing message ${message.id}:`, e);
      }
    }

    return NextResponse.json({ 
      success: true, 
      processed,
      total: messages.length
    });
  } catch (error) {
    console.error('Backfill error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}

export async function GET() {
  // Your implementation here
  return new Response('OK');
} 