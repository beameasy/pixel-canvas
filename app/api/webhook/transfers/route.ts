import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';
import { verifyAlchemySignature } from '@/lib/server/verifyWebhook';

export const runtime = 'edge';

export async function POST(request: Request) {
  try {
    const signature = request.headers.get('x-alchemy-signature');
    
    // Log all incoming requests
    console.log('📥 Webhook request received:', {
      headers: Object.fromEntries(request.headers),
      url: request.url,
      method: request.method
    });

    // Special handling for Alchemy test requests
    if (request.headers.get('x-alchemy-test') === 'true') {
      console.log('🧪 Received Alchemy test webhook');
      return NextResponse.json({ status: 'success' });
    }

    const body = await request.json();
    console.log('📨 Received transfer event:', body);

    // Extract addresses from Transfer event topics
    const logs = body.event.data.block.logs;
    const addressesToInvalidate = new Set<string>();

    for (const log of logs) {
      // Skip if not our token contract
      if (log.account.address.toLowerCase() !== process.env.TOKEN_ADDRESS?.toLowerCase()) {
        continue;
      }

      // Topics[1] is from address (padded to 32 bytes)
      // Topics[2] is to address (padded to 32 bytes)
      const fromAddress = '0x' + log.topics[1].slice(26).toLowerCase();
      const toAddress = '0x' + log.topics[2].slice(26).toLowerCase();
      
      addressesToInvalidate.add(fromAddress);
      addressesToInvalidate.add(toAddress);
    }

    // Check which addresses exist in our users table
    const existingAddresses = await Promise.all(
      Array.from(addressesToInvalidate).map(async address => {
        const exists = await redis.hexists('users', address);
        return exists ? address : null;
      })
    );

    const addressesToUpdate = existingAddresses.filter((addr): addr is string => addr !== null);

    if (addressesToUpdate.length > 0) {
      await Promise.all(
        addressesToUpdate.map(async address => {
          const userData = await redis.hget('users', address);
          if (userData) {
            const parsedData = typeof userData === 'string' ? JSON.parse(userData) : userData;
            // Only nullify the balance, keep other user data
            parsedData.token_balance = null;
            parsedData.updated_at = new Date().toISOString();
            await redis.hset('users', {
              [address]: JSON.stringify(parsedData)
            });
          }
        })
      );
      console.log(`🔄 Invalidated balance for users:`, addressesToUpdate);
    } else {
      console.log('👻 Transfer involved no cached users');
    }

    return NextResponse.json({ status: 'success' });
  } catch (error) {
    console.error('❌ Transfer webhook error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
} 