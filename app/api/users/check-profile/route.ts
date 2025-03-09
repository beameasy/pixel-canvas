import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';
import { extractPrivyId } from '@/lib/jose';
import { getFarcasterUser } from '@/components/farcaster/api/getFarcasterUser';
import { getBillboardBalance } from '@/app/api/_lib/subgraphClient';
import { validatePrivyToken } from '@/middleware';

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
    
    // Add timestamp validation for extra security against replay attacks
    const walletVerifiedAt = parseInt(request.headers.get('x-wallet-verified-at') || '0');
    if (walletVerifiedAt === 0 || Date.now() - walletVerifiedAt > 30000) { // 30 second max window
      console.log('❌ Wallet verification timestamp invalid or too old', { walletVerifiedAt });
      return NextResponse.json({ error: 'Authentication session expired' }, { status: 401 });
    }
    
    console.log('📝 Check Profile Headers:', { 
      walletAddress, 
      privyId: !!privyId, 
      privyToken: !!privyToken
    });
    
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
        token_balance: onChainBalance.toString(),
        created_at: Date.now().toString()
      };
      
      // Add Privy ID if available
      if (privyId) {
        parsedUserData.privy_id = privyId;
        
        // Create wallet mapping for security validation
        const existingMapping = await redis.hget('privy:wallet_mappings', privyId);
        const walletMapping = existingMapping ? 
          (typeof existingMapping === 'string' ? JSON.parse(existingMapping) : existingMapping) 
          : { wallets: [], updated_at: Date.now() };
        
        // Add wallet to mapping if not already present
        if (!walletMapping.wallets.includes(walletAddress.toLowerCase())) {
          walletMapping.wallets.push(walletAddress.toLowerCase());
          walletMapping.updated_at = Date.now();
          
          // Store updated mapping
          await redis.hset('privy:wallet_mappings', {
            [privyId]: JSON.stringify(walletMapping)
          });
          
          console.log('📝 Updated wallet mapping for security validation');
        }
      } else if (privyToken) {
        // Remove duplicate token validation - depend on middleware validation
        console.log('❌ Expected verified privyId from middleware but not found');
        return NextResponse.json({ error: 'Authentication error' }, { status: 401 });
      }
      
      // Store new user data with atomic check-and-set to prevent race conditions
      // Use watch-multi-exec pattern for optimistic locking
      const setResult = await redis.eval(
        `
        local exists = redis.call('HEXISTS', KEYS[1], ARGV[1])
        if exists == 0 then
          redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
          return 1
        else
          return 0
        end
        `,
        ['users'],
        [walletAddress, JSON.stringify(parsedUserData)]
      );
      
      if (setResult === 0) {
        // Another request created the profile first, fetch the current data
        const currentData = await redis.hget('users', walletAddress);
        parsedUserData = currentData ? 
          (typeof currentData === 'string' ? JSON.parse(currentData) : currentData) 
          : parsedUserData;
      }
      
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
        
        // Update wallet mapping for security validation
        const existingMapping = await redis.hget('privy:wallet_mappings', privyId);
        const walletMapping = existingMapping ? 
          (typeof existingMapping === 'string' ? JSON.parse(existingMapping) : existingMapping) 
          : { wallets: [], updated_at: Date.now() };
        
        // Add wallet to mapping if not already present
        if (!walletMapping.wallets.includes(walletAddress.toLowerCase())) {
          walletMapping.wallets.push(walletAddress.toLowerCase());
          walletMapping.updated_at = Date.now();
          
          // Store updated mapping
          await redis.hset('privy:wallet_mappings', {
            [privyId]: JSON.stringify(walletMapping)
          });
          
          console.log('📝 Updated wallet mapping for security validation');
        }
      } else if (!parsedUserData.privy_id && privyToken) {
        // Remove duplicate token validation - depend on middleware validation
        console.log('❌ Expected verified privyId from middleware but not found');
        return NextResponse.json({ error: 'Authentication error' }, { status: 401 });
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

function filterForDatabaseSchema(userData: any) {
  // Create a new object with only the fields that exist in the database
  const filtered = { ...userData };
  
  // Remove fields that don't exist in the dev_users table
  if ('farcaster_display_name' in filtered) {
    delete filtered.farcaster_display_name;
  }
  
  // Also remove farcaster_updated_at field if it exists
  if ('farcaster_updated_at' in filtered) {
    delete filtered.farcaster_updated_at;
  }
  
  return filtered;
}