import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'edge';

const COOLDOWN_PERIOD = 60; // seconds

export async function POST(request: Request) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { x, y, color, wallet_address } = await request.json();
  
  // Check cooldown
  const { data: lastPlacement } = await supabase
    .from('pixels')
    .select('placed_at')
    .eq('placed_by', wallet_address)
    .order('placed_at', { ascending: false })
    .limit(1);

  if (lastPlacement?.[0]) {
    const timeSinceLastPlacement = (Date.now() - new Date(lastPlacement[0].placed_at).getTime()) / 1000;
    if (timeSinceLastPlacement < COOLDOWN_PERIOD) {
      return NextResponse.json({ 
        error: `Please wait ${Math.ceil(COOLDOWN_PERIOD - timeSinceLastPlacement)} seconds` 
      }, { status: 429 });
    }
  }

  // Place pixel
  const { error } = await supabase.from('pixels').upsert({ x, y, color, placed_by: wallet_address });
  
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  
  return NextResponse.json({ success: true });
} 