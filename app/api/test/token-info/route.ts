import { NextResponse } from 'next/server';
import { getBillboardBalance, getBillboardPrice } from '@/app/api/_lib/subgraphClient';

export async function GET(request: Request) {
  try {
    const testWallet = "0xb9c5714089F77fd7E96F65e66F48afcE1fA0055b";
    
    console.log('🔍 Starting test with wallet:', testWallet);
    console.log('🪙 Token address:', process.env.TOKEN_ADDRESS);
    
    // Test balance
    console.log('💰 Fetching balance...');
    const balance = Number(await getBillboardBalance(testWallet));
    console.log('💰 Balance result:', balance);
    
    // Test price
    console.log('💵 Fetching price...');
    const price = await getBillboardPrice();
    console.log('💵 Price result:', price);
    
    return NextResponse.json({
      wallet: testWallet,
      balance,
      price,
      usdValue: balance * price,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Test endpoint error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
} 