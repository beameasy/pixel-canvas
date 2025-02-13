import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';
import { getAdminClient } from '../../_lib/supabaseAdmin';

export async function GET() {
  const supabase = getAdminClient();
  const BATCH_SIZE = 100;

  try {
    // Process users queue
    const userBatch = await redis.lrange('users:queue', 0, BATCH_SIZE - 1);
    if (userBatch.length > 0) {
      const users = userBatch.map((item: string) => JSON.parse(item));
      const { error: userError } = await supabase
        .from('users')
        .upsert(users, { 
          onConflict: 'wallet_address',
          ignoreDuplicates: false 
        });
      
      if (userError) throw userError;
      await redis.ltrim('users:queue', userBatch.length, -1);
    }

    // Process pixels queue
    const pixelBatch = await redis.lrange('canvas:pixels:queue', 0, BATCH_SIZE - 1);
    if (pixelBatch.length > 0) {
      const pixels = pixelBatch.map((item: string) => JSON.parse(item));
      const { error: pixelError } = await supabase
        .from('pixels')
        .insert(pixels);
      
      if (pixelError) throw pixelError;
      await redis.ltrim('canvas:pixels:queue', pixelBatch.length, -1);
    }

    return NextResponse.json({ 
      processed: {
        users: userBatch.length,
        pixels: pixelBatch.length
      }
    });
  } catch (error) {
    console.error('Queue processing error:', error);
    return NextResponse.json({ error: 'Failed to process queue' }, { status: 500 });
  }
} 