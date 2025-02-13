import type { User, Wallet } from '@privy-io/react-auth';

export interface ExtendedPrivyUser extends User {
  wallet?: Wallet;
}

export function formatWalletAddress(address: string | undefined): string {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
} 