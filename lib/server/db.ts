import { createClient } from '@supabase/supabase-js';
import { Alchemy, Network } from 'alchemy-sdk';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const getAdminClient = () => createClient(supabaseUrl, supabaseServiceKey);

// Alchemy setup - server side only
const settings = {
  apiKey: process.env.ALCHEMY_API_KEY,  // Not NEXT_PUBLIC
  network: Network.BASE_MAINNET,
};

export const alchemy = new Alchemy(settings);

// Token balance functionality
export async function getTokenBalance(walletAddress: string) {
  return alchemy.core.getTokenBalances(
    walletAddress.toLowerCase(),
    [process.env.TOKEN_ADDRESS!]
  );
} 