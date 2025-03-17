import { redis } from '@/lib/server/redis';
import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';

type UserDataMap = Record<string, any>;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const start = (page - 1) * limit;
    const end = start + limit - 1;

    // Get items from newest to oldest using ZRANGE with REV option
    const pixels = await redis.zrange('canvas:history', start, end, { 
      rev: true 
    });

    // Get all cached user data from the correct hash
    const usersData = (await redis.hgetall('users')) as UserDataMap;

    // Parse pixels and add token balances from cached user data
    const pixelsWithBalances = pixels.map((pixel) => {
      const parsed = typeof pixel === 'string' ? JSON.parse(pixel) : pixel;
      const walletAddress = parsed.wallet_address;
      
      // Get user data from cache
      const userData = usersData[walletAddress];
      return {
        ...parsed,
        token_balance: userData?.token_balance ? Number(userData.token_balance) : 0
      };
    });
    
    return NextResponse.json(pixelsWithBalances);
  } catch (error) {
    console.error('Failed to fetch pixel history:', error);
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
  }
} 