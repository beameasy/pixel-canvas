import { NextResponse } from 'next/server';
import { getFarcasterUser } from '@/components/farcaster/api/getFarcasterUser';
import { redis } from '@/lib/server/redis';
import { authenticateUser } from '@/app/api/_lib/authenticateUser';

export async function GET(request: Request) {
  try {
    // Use the same authentication pattern as other endpoints
    const session = await authenticateUser(request);
    if (!session?.wallet_address) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const walletAddress = session.wallet_address.toLowerCase();
    
    // Get query params
    const { searchParams } = new URL(request.url);
    const queryAddress = searchParams.get('address')?.toLowerCase();
    
    // Only allow users to query their own verified wallet
    if (queryAddress && queryAddress !== walletAddress) {
      return NextResponse.json({ 
        error: 'You can only query Farcaster data for your own wallet'
      }, { status: 403 });
    }
    
    // Fetch Farcaster data for the verified wallet
    const farcasterData = await getFarcasterUser(walletAddress);
    
    // Format the response to match what the hook expects
    if (farcasterData?.farcaster_username) {
      return NextResponse.json({
        success: true,
        data: {
          username: farcasterData.farcaster_username,
          pfpUrl: farcasterData.farcaster_pfp,
          displayName: farcasterData.display_name
        }
      });
    }
    
    return NextResponse.json({
      success: false,
      data: null
    });
  } catch (error) {
    console.error('Error fetching Farcaster data:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch Farcaster data'
    }, { status: 500 });
  }
}