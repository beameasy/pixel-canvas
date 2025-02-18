import { NextResponse } from 'next/server';
import { receiver, processPixelQueue } from '../../_lib/queueProcessor';

export async function POST(request: Request) {
  try {
    const body = await request.text();
    const headers = Object.fromEntries(request.headers);
    
    await receiver.verify({
      body,
      signature: headers['upstash-signature'] || ''
    });

    await processPixelQueue();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }
}

export const config = { api: { bodyParser: false } }; 