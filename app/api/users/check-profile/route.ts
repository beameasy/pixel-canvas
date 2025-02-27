import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';
import { extractPrivyId } from '@/lib/jose';
import { getFarcasterUser } from '@/components/farcaster/api/getFarcasterUser';
import { getBillboardBalance } from '@/app/api/_lib/subgraphClient';

export async function POST(request: Request) {
  try {
    console.log('📝 Check Profile Request received');
    
    // Get headers from request
    const walletAddress = request.headers.get('x-wallet-address')?.toLowerCase();
    const privyId = request.headers.get('x-privy-id');
    const privyToken = request.headers.get('x-privy-token');
    
    console.log('📝 Check Profile Headers:', { 
      walletAddress, 
      privyId: !!privyId, 
      privyToken: !!privyToken
    });
    
    // Check if wallet address was provided
    if (!walletAddress) {
      console.log('❌ No wallet address provided');
      return NextResponse.json({ error: 'Wallet address is required' }, { status: 400 });
    }
    
    // Get user data from Redis
    const userData = await redis.hget('users', walletAddress);
    let parsedUserData = userData ? 
      (typeof userData === 'string' ? JSON.parse(userData) : userData) 
      : null;
    
    console.log('📝 Existing User Data:', parsedUserData);
    
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
        token_balance: onChainBalance.toString(), // Use on-chain balance
        created_at: Date.now().toString()
      };
      
      // Add Privy ID if available
      if (privyId) {
        parsedUserData.privy_id = privyId;
      } else if (privyToken) {
        // Extract Privy ID from token if not provided directly
        const extractedPrivyId = await extractPrivyId(privyToken);
        if (extractedPrivyId) {
          parsedUserData.privy_id = extractedPrivyId;
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
        const extractedPrivyId = await extractPrivyId(privyToken);
        if (extractedPrivyId) {
          parsedUserData.privy_id = extractedPrivyId;
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