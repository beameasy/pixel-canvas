const ADMIN_WALLETS = [
  '0x4325775d28154fe505169cd1b680af5c0c589ca8'
];

export const isAdmin = (walletAddress?: string): boolean => {
  if (!walletAddress) return false;
  return ADMIN_WALLETS.includes(walletAddress.toLowerCase());
}; 