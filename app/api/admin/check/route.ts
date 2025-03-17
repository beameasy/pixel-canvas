import { NextResponse } from 'next/server'

// Simple admin check endpoint
export async function GET(request: Request) {
  try {
    const walletAddress = request.headers.get('x-wallet-address')?.toLowerCase()
    
    if (!walletAddress) {
      return NextResponse.json({ error: 'No wallet address provided' }, { status: 400 })
    }
    
    // Get admin wallets from environment variable
    const adminWallets = (process.env.ADMIN_WALLETS || '').split(',').map(w => w.toLowerCase())
    
    // Check if the wallet is in the admin list
    const isAdmin = adminWallets.includes(walletAddress)
    
    if (isAdmin) {
      return NextResponse.json({ isAdmin: true })
    } else {
      return NextResponse.json({ error: 'Not an admin' }, { status: 403 })
    }
  } catch (error) {
    console.error('Error checking admin status:', error)
    return NextResponse.json({ error: 'Failed to check admin status' }, { status: 500 })
  }
} 