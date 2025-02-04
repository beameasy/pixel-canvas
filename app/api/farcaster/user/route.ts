import { NextResponse } from 'next/server';

// Mark this as an edge function
export const runtime = 'edge';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');

    if (!address) {
      return NextResponse.json({ error: 'Address is required' }, { status: 400 });
    }

    // Using the correct v2 endpoint for looking up users by address
    const neynarResponse = await fetch(
      `https://api.neynar.com/v2/farcaster/lookup/addresses?addresses=${address}`,
      {
        headers: {
          'accept': 'application/json',
          'api_key': process.env.NEYNAR_API_KEY || ''
        }
      }
    );

    if (!neynarResponse.ok) {
      const errorData = await neynarResponse.json();
      console.error('Neynar API error:', errorData);
      return NextResponse.json(
        { error: `Neynar API error: ${errorData.message || 'Unknown error'}` },
        { status: neynarResponse.status }
      );
    }

    const data = await neynarResponse.json();
    
    if (!data.users || data.users.length === 0) {
      return NextResponse.json({ error: 'No Farcaster user found' }, { status: 404 });
    }

    return NextResponse.json(data.users[0]);

  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' }, 
      { status: 500 }
    );
  }
} 