import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis'; // Using the environment-aware Redis client

// Get admin wallets from environment variable for consistency
const ADMIN_WALLETS = (process.env.ADMIN_WALLETS || '')
  .split(',')
  .map(wallet => wallet.trim().toLowerCase())
  .filter(wallet => wallet.length > 0);

const isAdmin = (walletAddress?: string): boolean => {
  if (!walletAddress) return false;
  return ADMIN_WALLETS.includes(walletAddress.toLowerCase());
};

export async function POST(request: Request) {
  try {
    const adminWallet = request.headers.get('x-wallet-address')?.toLowerCase();
    const isAdminHeader = request.headers.get('x-is-admin');
    
    if (!isAdmin(adminWallet) && isAdminHeader !== 'true') {
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
    
    // Store in Redis as a pending ban to be processed
    await redis.rpush('supabase:bans:queue', JSON.stringify(banData));
    
    // Use the permanent set for quick lookups
    await redis.sadd('banned:wallets:permanent', wallet.toLowerCase());
    
    // Store the reason for quicker lookups
    if (reason) {
      await redis.set(`banned:wallet:reason:${wallet.toLowerCase()}`, JSON.stringify({
        reason,
        banned_at: banData.banned_at,
        banned_by: banData.banned_by
      }));
    }
    
    // Trigger queue processing if enabled
    if (process.env.NEXT_PUBLIC_APP_URL && process.env.CRON_SECRET) {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/cron/process-queue`, {
          method: 'POST',
          headers: { 
            'x-cron-secret': process.env.CRON_SECRET,
            'origin': process.env.NEXT_PUBLIC_APP_URL
          }
        });

        if (!response.ok) {
          console.error('Failed to trigger queue processing:', await response.text());
        }
      } catch (error) {
        console.error('Error triggering queue processing:', error);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in ban endpoint:', error);
    return NextResponse.json({ error: 'Failed to ban wallet' }, { status: 500 });
  }
} 