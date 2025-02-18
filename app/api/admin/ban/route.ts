import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis'; // Using the environment-aware Redis client

const ADMIN_WALLETS = [
  '0x4325775d28154fe505169cd1b680af5c0c589ca8'
];

const isAdmin = (walletAddress?: string): boolean => {
  if (!walletAddress) return false;
  return ADMIN_WALLETS.includes(walletAddress.toLowerCase());
};

export async function POST(request: Request) {
  try {
    const adminWallet = request.headers.get('x-wallet-address')?.toLowerCase();
    if (!isAdmin(adminWallet)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { wallet, reason } = await request.json();
    if (!wallet) {
      return NextResponse.json({ error: 'No wallet provided' }, { status: 400 });
    }

    const banData = {
      wallet_address: wallet.toLowerCase(),
      banned_at: new Date().toISOString(),
      banned_by: adminWallet,
      reason: reason || null,
      active: true
    };

    console.log('🚫 Storing ban data in Redis:', banData);
    
    // Store in Redis as a pending ban to be processed
    await redis.rpush('supabase:bans:queue', JSON.stringify(banData));
    
    // Use the permanent set for quick lookups (create a new SET)
    await redis.sadd('banned:wallets:permanent', wallet.toLowerCase());
    
    // Verify data was stored
    const pendingBans = await redis.lrange('supabase:bans:queue', 0, -1);
    const bannedWallets = await redis.smembers('banned:wallets:permanent');
    console.log('🚫 Redis state:', { pendingBans, bannedWallets });
    
    // Trigger queue processing
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/cron/process-queue`, {
      method: 'POST',
      headers: { 
        'x-cron-secret': process.env.CRON_SECRET || '',
        'origin': process.env.NEXT_PUBLIC_APP_URL || ''
      }
    });

    if (!response.ok) {
      console.error('Failed to trigger queue processing:', await response.text());
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in ban endpoint:', error);
    return NextResponse.json({ error: 'Failed to ban wallet' }, { status: 500 });
  }
} 