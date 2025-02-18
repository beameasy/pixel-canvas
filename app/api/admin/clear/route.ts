import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';
import { isAdmin } from '@/components/admin/utils';
import { pusher } from '@/lib/server/pusher';

export async function POST(request: Request) {
  try {
    const { startX, startY, endX, endY } = await request.json();
    const adminWallet = request.headers.get('x-wallet-address');

    if (!isAdmin(adminWallet || undefined)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all pixels
    const pixels = await redis.hgetall('canvas:pixels');
    
    // Find pixels in selection area
    for (const [key, value] of Object.entries(pixels || {})) {
      const [x, y] = key.split(',').map(Number);
      if (x >= startX && x <= endX && y >= startY && y <= endY) {
        // Remove pixel
        await redis.hdel('canvas:pixels', key);
      }
    }

    // Notify clients of cleared area
    await pusher.trigger('canvas', 'area-cleared', {
      startX,
      startY,
      endX,
      endY
    });
    
    console.log(`🧹 Area cleared by admin: (${startX},${startY}) to (${endX},${endY})`);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error clearing area:', error);
    return NextResponse.json({ error: 'Failed to clear area' }, { status: 500 });
  }
} 