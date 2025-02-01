import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const walletAddress = searchParams.get('address');

  if (!walletAddress) {
    return NextResponse.json({ error: 'Wallet address is required' }, { status: 400 });
  }

  try {
    const response = await fetch(
      `https://api.neynar.com/v2/farcaster/user/bulk?addresses=${walletAddress}`,
      {
        headers: {
          'api_key': process.env.NEYNAR_API_KEY!,
          'Content-Type': 'application/json',
        },
      }
    );
    
    const data = await response.json();
    return NextResponse.json(data.users[0] || null);
  } catch (error) {
    console.error('Error fetching Farcaster user:', error);
    return NextResponse.json({ error: 'Failed to fetch Farcaster user' }, { status: 500 });
  }
} 