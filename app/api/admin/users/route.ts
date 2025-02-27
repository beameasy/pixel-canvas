import { NextResponse } from 'next/server'
import { redis } from '@/lib/server/redis'
import { getAdminClient } from '../../_lib/supabaseAdmin'

export async function GET(request: Request) {
  try {
    // Check if user is admin
    const walletAddress = request.headers.get('x-wallet-address')?.toLowerCase();
    
    // Get admin wallets from environment variable
    const adminWallets = (process.env.ADMIN_WALLETS || '')
      .split(',')
      .filter(Boolean)
      .map(address => address.trim().toLowerCase());
    
    // Check if the wallet is in the admin list
    const isAdmin = walletAddress ? adminWallets.includes(walletAddress) : false;
    
    if (!isAdmin || !walletAddress) {
      console.log('Unauthorized access attempt to admin/users:', walletAddress);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Parse the search query parameter
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    
    // Get user data from Supabase
    const supabase = getAdminClient();
    
    let query = supabase.from('users').select('*');
    
    if (search) {
      query = query.or(`wallet_address.ilike.%${search}%,farcaster_username.ilike.%${search}%`);
    }
    
    const { data: users, error } = await query.limit(20);
    
    if (error) {
      console.error('Error fetching users:', error);
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
    }
    
    return NextResponse.json(users || []);
  } catch (error) {
    console.error('Error in admin/users endpoint:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 