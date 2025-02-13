import type { User, Wallet } from '@privy-io/react-auth'
import { getAccessToken } from '@privy-io/react-auth'
import { supabase } from './supabaseClient'
import { SupabaseClient } from '@supabase/supabase-js'

interface ExtendedPrivyUser extends User {
  wallet?: Wallet;
}

export type { ExtendedPrivyUser };

export const getAuthenticatedClient = async (privyUser: ExtendedPrivyUser): Promise<SupabaseClient> => {
  try {
    if (!privyUser?.wallet?.address) {
      throw new Error('No wallet connected')
    }

    const walletAddress = privyUser.wallet.address.toLowerCase()
    console.log('🔑 Wallet connected:', walletAddress)

    const token = await getAccessToken()
    if (!token) {
      throw new Error('Failed to get access token')
    }
    
    await supabase.auth.setSession({
      access_token: token,
      refresh_token: ''
    })

    return supabase
  } catch (error) {
    console.error('❌ Auth error:', error)
    return supabase
  }
}

export const getSupabaseClient = async (privyUser: ExtendedPrivyUser | null) => {
  console.log('getSupabaseClient called with:', privyUser?.wallet?.address)
  if (!privyUser) return supabase
  return getAuthenticatedClient(privyUser)
} 