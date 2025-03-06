import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';
import { extractPrivyId } from '@/lib/jose';
import { getFarcasterUser } from '@/components/farcaster/api/getFarcasterUser';
import { getBillboardBalance } from '@/app/api/_lib/subgraphClient';
import { validatePrivyToken } from '@/middleware';
import { ethers } from 'ethers';

// Function to verify wallet signature
async function verifyWalletSignature(address: string, message: string, signature: string): Promise<boolean> {
  try {
    // Standard Ethereum signed message format
    const recoveredAddress = ethers.utils.verifyMessage(message, signature);
    return recoveredAddress.toLowerCase() === address.toLowerCase();
  } catch (error) {
    console.error('Error verifying signature:', error);
    return false;
  }
}

export async function POST(request: Request) {
  try {
    console.log('📝 Check Profile Request received');
    
    // Switch to use x-verified-wallet instead of x-wallet-address
    const walletAddress = request.headers.get('x-verified-wallet')?.toLowerCase();
    const privyId = request.headers.get('x-privy-id');
    const privyToken = request.headers.get('x-privy-token');
    
    // If we're here and we don't have a verified wallet, the middleware didn't validate the wallet
    if (!walletAddress) {
      // If we received a normal wallet address but not a verified one, that means validation failed
      const unverifiedWallet = request.headers.get('x-wallet-address');
      console.log('❌ No verified wallet address - validation failed', { unverifiedWallet });
      return NextResponse.json({ error: 'Wallet authentication failed' }, { status: 401 });
    }
    
    // Get user data from Redis to check if this is a new registration
    const userData = await redis.hget('users', walletAddress);
    let parsedUserData = userData ? 
      (typeof userData === 'string' ? JSON.parse(userData) : userData) 
      : null;
    
    // For new users, require signature verification
    if (!parsedUserData) {
      // Try to parse the request body to get signature
      let signature, message;
      
      try {
        const body = await request.json();
        signature = body.signature;
        message = body.message;
      } catch (error) {
        // No body or invalid JSON
      }
      
      // If no signature was provided, return a specific error code requesting signature
      if (!signature || !message) {
        return NextResponse.json({ 
          error: 'Wallet signature required',
          needs_signature: true,
          wallet_address: walletAddress
        }, { status: 401 });
      }
      
      // Verify the signature matches the claimed wallet address
      const isValidSignature = await verifyWalletSignature(walletAddress, message, signature);
      
      if (!isValidSignature) {
        console.log('🚨 Invalid signature during profile creation', { walletAddress });
        return NextResponse.json({ 
          error: 'Invalid wallet signature. You must prove wallet ownership.',
          needs_signature: true,
          wallet_address: walletAddress
        }, { status: 401 });
      }
      
      console.log('✅ Wallet signature verified for new user', { walletAddress });
    }
    
    console.log('📝 Check Profile Headers:', { 
      walletAddress, 
      privyId: !!privyId, 
      privyToken: !!privyToken
    });
    
    // Fetch on-chain $BILLBOARD token balance from Alchemy
    let onChainBalance = 0;
    try {
      console.log('🔍 Fetching on-chain $BILLBOARD balance for:', walletAddress);
      onChainBalance = await getBillboardBalance(walletAddress);
      console.log('💰 On-chain $BILLBOARD balance:', onChainBalance);
    } catch (error) {
      console.error('❌ Failed to fetch on-chain $BILLBOARD balance:', error);
    }
    
    // Check if we need to fetch or update Farcaster data
    const shouldFetchFarcaster = !parsedUserData?.farcaster_username || 
                               (Date.now() - parseInt(parsedUserData?.farcaster_updated_at || '0')) > 24 * 60 * 60 * 1000;
    
    if (shouldFetchFarcaster) {
      console.log('🔄 Fetching Farcaster data for:', walletAddress);
      const farcasterData = await getFarcasterUser(walletAddress);
      
      if (farcasterData?.farcaster_username) {
        if (!parsedUserData) parsedUserData = {
          wallet_address: walletAddress,
          token_balance: '0',
          created_at: Date.now().toString()
        };
        
        parsedUserData.farcaster_username = farcasterData.farcaster_username;
        parsedUserData.farcaster_pfp = farcasterData.farcaster_pfp;
        parsedUserData.farcaster_display_name = farcasterData.display_name;
        // Skip farcaster_id if not available in the data structure
        parsedUserData.farcaster_updated_at = Date.now().toString();
        
        console.log('✅ Found Farcaster data:', {
          username: farcasterData.farcaster_username,
          pfp: farcasterData.farcaster_pfp?.substring(0, 30) + '...'
        });
      }
    }
    
    // Convert any non-string values to strings for Redis
    if (parsedUserData) {
      Object.keys(parsedUserData).forEach(key => {
        if (typeof parsedUserData![key] !== 'string') {
          parsedUserData![key] = String(parsedUserData![key]);
        }
      });
    }
    
    if (!parsedUserData || Object.keys(parsedUserData).length === 0) {
      // Initialize new user with actual on-chain balance
      parsedUserData = {
        wallet_address: walletAddress,
        token_balance: onChainBalance.toString(),
        created_at: Date.now().toString()
      };
      
      // Add Privy ID if available
      if (privyId) {
        parsedUserData.privy_id = privyId;
      } else if (privyToken) {
        // Replace extractPrivyId with validatePrivyToken
        const verifiedPrivyId = await validatePrivyToken(privyToken);
        if (verifiedPrivyId) {
          parsedUserData.privy_id = verifiedPrivyId;
        } else {
          console.log('❌ Invalid Privy token provided during account creation');
          return NextResponse.json({ error: 'Invalid authentication token' }, { status: 401 });
        }
      }
      
      // Store new user data
      await redis.hset('users', {
        [walletAddress]: JSON.stringify(parsedUserData)
      });
      console.log('📝 Created new user with $BILLBOARD balance:', onChainBalance);
    } else {
      // Update token balance with on-chain balance
      parsedUserData.token_balance = onChainBalance.toString();
      
      // Remove on_chain_balance field if it exists
      if ('on_chain_balance' in parsedUserData) {
        delete parsedUserData.on_chain_balance;
      }
      
      // Update Privy ID if available and changed
      let updated = true; // Set to true to always update for on-chain balance
      
      if (privyId && parsedUserData.privy_id !== privyId) {
        parsedUserData.privy_id = privyId;
      } else if (!parsedUserData.privy_id && privyToken) {
        const verifiedPrivyId = await validatePrivyToken(privyToken);
        if (verifiedPrivyId) {
          parsedUserData.privy_id = verifiedPrivyId;
        } else {
          console.log('❌ Invalid Privy token provided during Privy ID update');
          return NextResponse.json({ error: 'Invalid authentication token' }, { status: 401 });
        }
      }
      
      // Save updates if needed
      if (updated || shouldFetchFarcaster) {
        await redis.hset('users', {
          [walletAddress]: JSON.stringify(parsedUserData)
        });
        console.log('📝 Updated user profile with $BILLBOARD balance:', onChainBalance);
      }
    }

    // Return only a single balance value in the response
    const balance = parseInt(parsedUserData.token_balance || '0');

    return NextResponse.json({ 
      success: true,
      balance: balance,
      farcaster_username: parsedUserData.farcaster_username,
      farcaster_pfp: parsedUserData.farcaster_pfp,
      farcaster_display_name: parsedUserData.farcaster_display_name,
      farcaster_id: parsedUserData.farcaster_id
    }, {
      headers: {
        'Cache-Control': 'no-store, max-age=0'
      }
    });
  } catch (error) {
    console.error('Failed to check profile:', error);
    return NextResponse.json({ error: 'Server error' }, { 
      status: 500,
      headers: {
        'Cache-Control': 'no-store'
      }
    });
  }
} 