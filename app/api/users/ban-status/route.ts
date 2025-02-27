import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';
import { authenticateUser } from '../../_lib/authenticateUser';

export async function GET(request: Request) {
  try {
    const session = await authenticateUser(request);
    if (!session || !session.wallet_address) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const walletAddress = session.wallet_address.toLowerCase();
    
    // Check if the wallet is banned
    const isBanned = await redis.sismember('banned:wallets:permanent', walletAddress);
    
    // If banned, get the reason
    let reason = null;
    if (isBanned) {
      const reasonData = await redis.hget('banned:wallets:reasons', walletAddress);
      if (reasonData) {
        const parsedReason = typeof reasonData === 'string' ? JSON.parse(reasonData) : reasonData;
        reason = parsedReason.reason;
      }
      
      // Return a 403 status with the custom message for banned users
      return NextResponse.json({ 
        banned: true,
        reason: reason,
        message: "This wallet has been banned. You probably deserved it."
      }, { status: 403 });
    }
    
    return NextResponse.json({ 
      banned: false,
      reason: null
    });
  } catch (error) {
    console.error('Error checking ban status:', error);
    return NextResponse.json({ error: 'Failed to check ban status' }, { status: 500 });
  }
} 