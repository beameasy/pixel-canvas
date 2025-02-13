import { NextResponse } from 'next/server';
import { getFarcasterUser } from '@/components/farcaster/api/getFarcasterUser';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get('address');

  if (!address) {
    return NextResponse.json({ 
      success: false, 
      error: 'Address is required' 
    }, { status: 400 });
  }

  try {
    const userData = await getFarcasterUser(address);
    return NextResponse.json({
      success: true,
      data: userData
    });
  } catch (error) {
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}