import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';
import { isAdmin } from '@/components/admin/utils';
import { revalidatePath } from 'next/cache';

export async function POST(request: Request) {
  const adminWallet = request.headers.get('x-wallet-address')?.toLowerCase();
  if (!isAdmin(adminWallet)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 1. Clear Redis
    await redis.del('canvas:pixels');
    await redis.del('canvas:history');
    // ... other Redis clearing ...

    // 2. Revalidate the canvas API route to clear Vercel's edge cache
    revalidatePath('/api/canvas');

    return NextResponse.json({
      success: true,
      message: 'Redis and Edge cache cleared'
    });
  } catch (error) {
    console.error('Error clearing cache:', error);
    return NextResponse.json({ error: 'Failed to clear cache' }, { status: 500 });
  }
} 