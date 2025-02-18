import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';
import { getBillboardBalance } from '@/app/api/_lib/subgraphClient';
import { getFarcasterUser } from '@/lib/farcaster';

export async function POST(req: Request) {
  try {
    const { privy_id, wallet_address } = await req.json()
    
    // Add validation here
    if (!wallet_address || !privy_id) {
      console.log('🔴 Missing required fields:', { wallet_address, privy_id })
      return NextResponse.json(
        { error: 'Missing required fields' }, 
        { status: 400 }
      )
    }

    const normalizedAddress = wallet_address.toLowerCase()

    // Get external data
    const [farcasterData, balance] = await Promise.all([
      getFarcasterUser(wallet_address).catch(e => {
        console.error('🔴 Farcaster error:', e)
        return null
      }),
      getBillboardBalance(wallet_address).catch(e => {
        console.error('🔴 Balance error:', e)
        return 0
      })
    ])

    // Create user data
    const userData = {
      wallet_address: normalizedAddress,
      privy_id,
      farcaster_username: farcasterData?.farcaster_username || null,
      farcaster_pfp: farcasterData?.farcaster_pfp || null,
      token_balance: balance || 0,
      last_active: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    // Store in Redis hash
    await redis.hset('users', {
      [normalizedAddress]: JSON.stringify(userData)
    });

    // Queue for Supabase
    await redis.rpush('supabase:users:queue', JSON.stringify(userData));

    // Trigger queue processing
    await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/cron/process-queue`, {
      method: 'POST',
      headers: { 
        'x-cron-secret': process.env.CRON_SECRET || '',
        'origin': process.env.NEXT_PUBLIC_APP_URL || ''
      }
    });

    return NextResponse.json(userData)
  } catch (error) {
    console.error('🔴 Top level error:', error)
    return NextResponse.json({ error: 'Failed to check profile' }, { status: 500 })
  }
} 