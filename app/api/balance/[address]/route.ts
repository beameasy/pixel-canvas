import { getBillboardBalance } from '@/app/api/_lib/subgraphClient';
import { NextResponse } from 'next/server';

export async function GET(
  request: Request,
  { params }: { params: { address: string } }
) {
  try {
    const balance = await getBillboardBalance(params.address);
    return NextResponse.json({ balance });
  } catch (error) {
    console.error('Failed to fetch balance:', error);
    return NextResponse.json({ error: 'Failed to fetch balance' }, { status: 500 });
  }
} 