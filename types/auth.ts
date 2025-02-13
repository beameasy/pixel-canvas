import type { User, Wallet } from '@privy-io/react-auth';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ExtendedPrivyUser extends User {
  wallet?: Wallet;
}

export type AuthenticatedClient = SupabaseClient; 