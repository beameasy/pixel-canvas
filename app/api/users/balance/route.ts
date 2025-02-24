import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';
import { authenticateUser } from '../../_lib/authenticateUser';

export async function GET(request: Request) {
  try {
    const session = await authenticateUser(request);
    if (!session?.wallet_address) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const userData = await redis.hget('users', session.wallet_address.toLowerCase());
    if (!userData) {
      return NextResponse.json({ balance: 0 });
    }

    const user = typeof userData === 'string' ? JSON.parse(userData) : userData;
    return NextResponse.json({ balance: user.token_balance || 0 });
  } catch (error) {
    console.error('Error fetching balance:', error);
    return NextResponse.json({ error: 'Failed to fetch balance' }, { status: 500 });
  }
} 