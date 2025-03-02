import { NextResponse } from 'next/server';
import { getFarcasterUser } from '@/components/farcaster/api/getFarcasterUser';
import { redis } from '@/lib/server/redis';

export async function GET(request: Request) {
  try {
    // Get verified wallet address from middleware headers
    const verifiedWallet = request.headers.get('x-verified-wallet');
    
    if (!verifiedWallet) {
      return NextResponse.json({ 
        error: 'Authentication required to access Farcaster data'
      }, { status: 401 });
    }
    
    // Get query params
    const { searchParams } = new URL(request.url);
    const queryAddress = searchParams.get('address')?.toLowerCase();
    
    // Only allow users to query their own verified wallet
    if (queryAddress && queryAddress !== verifiedWallet) {
      return NextResponse.json({ 
        error: 'You can only query Farcaster data for your own wallet'
      }, { status: 403 });
    }
    
    // Fetch Farcaster data for the verified wallet
    const farcasterData = await getFarcasterUser(verifiedWallet);
    
    return NextResponse.json({ 
      success: true, 
      data: farcasterData 
    });
  } catch (error) {
    console.error('Error fetching Farcaster data:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch Farcaster data'
    }, { status: 500 });
  }
}