import { redis } from './redis';
import { getBillboardBalance } from '@/app/api/_lib/subgraphClient';
import { TokenTier, TIERS, DEFAULT_TIER } from './tiers.config';

// Helper function for formatting token amounts
export function formatBillboardAmount(amount: number): string {
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(2)}B`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(2)}K`;
  return amount.toString();
}

// Cache token balances for 5 minutes
async function getTokenBalance(walletAddress: string): Promise<number> {
  console.log(`Getting token balance for wallet: ${walletAddress}`);
  
  // Make sure we're dealing with a wallet address and not a number
  if (!walletAddress.startsWith('0x')) {
    console.error(`Invalid wallet address passed: ${walletAddress}`);
    return 0;
  }

  const cacheKey = `balance:${walletAddress}`;
  const cached = await redis.get(cacheKey);
  
  if (cached && typeof cached === 'string') {
    const parsedBalance = parseFloat(cached);
    console.log(`Using cached balance for ${walletAddress}: ${parsedBalance}`);
    return parsedBalance;
  }

  console.log(`Fetching on-chain balance for: ${walletAddress}`);
  const balance = Number(await getBillboardBalance(walletAddress));
  console.log(`On-chain balance for ${walletAddress}: ${balance}`);
  
  await redis.set(cacheKey, balance.toString(), {
    ex: 5 * 60 // 5 minutes
  });

  return balance;
}

export async function getUserTier(balanceOrAddress: number | string, isAdmin = false): Promise<TokenTier> {
  // If user is admin, return highest tier directly
  if (isAdmin) {
    console.log('Admin user detected, using highest tier');
    return TIERS[0]; // Return Diamond tier for admins
  }

  let balance: number;
  
  if (typeof balanceOrAddress === 'string' && balanceOrAddress.startsWith('0x')) {
    // This is a wallet address, get balance from chain or cache
    balance = await getTokenBalance(balanceOrAddress);
    console.log(`Resolved balance for ${balanceOrAddress}: ${balance}`);
  } else {
    // This is already a balance
    balance = Number(balanceOrAddress);
    console.log(`Direct balance provided: ${balance}`);
  }

  // Force conversion to Number to ensure proper comparison
  balance = Number(balance);
  
  // Debug logging to diagnose the issue
  console.log(`Debug getUserTier: balance=${balance}, type=${typeof balance}`);
  console.log(`Tier thresholds: Diamond=${TIERS[0].minTokens}, Platinum=${TIERS[1].minTokens}`);
  console.log(`Comparison result: Diamond?=${balance >= TIERS[0].minTokens}, Platinum?=${balance >= TIERS[1].minTokens}`);

  // Iterate through tiers from highest to lowest
  for (const tier of TIERS) {
    if (balance >= tier.minTokens) {
      console.log(`Selected tier: ${tier.name} with cooldown ${tier.cooldownSeconds}s`);
      return tier;
    }
  }

  console.log(`No tier matched, using default: ${DEFAULT_TIER.name}`);
  return DEFAULT_TIER;
}

export async function canPlacePixel(walletAddress: string): Promise<boolean> {
  // Check if wallet is an admin
  const isAdmin = (process.env.ADMIN_WALLETS || '')
    .split(',')
    .map(wallet => wallet.trim().toLowerCase())
    .filter(wallet => wallet.length > 0)
    .includes(walletAddress.toLowerCase());
  
  // Admins can always place pixels, bypassing cooldown
  if (isAdmin) return true;
  
  const lastPlaced = await redis.get(`pixel:cooldown:${walletAddress}`);
  if (!lastPlaced) return true;

  // Get user's tier based on token balance
  const balance = await getTokenBalance(walletAddress);
  const tier = await getUserTier(balance);
  const cooldownMs = tier.cooldownSeconds * 1000;

  const now = Date.now();
  const lastPlacedTime = lastPlaced as string | null;
  const timeSinceLastPlaced = now - (lastPlacedTime ? parseInt(lastPlacedTime) : 0);
  
  return timeSinceLastPlaced >= cooldownMs;
}

export async function canOverwritePixel(
  newWalletAddress: string, 
  existingPixelData: any
): Promise<{ canOverwrite: boolean; message?: string }> {
  if (!existingPixelData) return { canOverwrite: true };
  
  // Check if wallet is an admin
  const isAdmin = (process.env.ADMIN_WALLETS || '')
    .split(',')
    .map(wallet => wallet.trim().toLowerCase())
    .filter(wallet => wallet.length > 0)
    .includes(newWalletAddress.toLowerCase());
  
  // Admins can always overwrite pixels
  if (isAdmin) return { canOverwrite: true };

  try {
    // Get the current token balances for both users
    const [newBalance, existingWalletCurrentBalance] = await Promise.all([
      getTokenBalance(newWalletAddress),
      getTokenBalance(existingPixelData.wallet_address)
    ]);

    const [newTier, existingTier] = await Promise.all([
      getUserTier(newBalance),
      getUserTier(existingWalletCurrentBalance)
    ]);

    // Check if pixel owner has protection based on their tier
    const pixelAge = Date.now() - new Date(existingPixelData.placed_at).getTime();
    const protectionExpired = pixelAge > (existingTier.protectionTime * 60 * 60 * 1000);

    if (!protectionExpired) {
      // During protection, need higher balance than the CURRENT balance of the pixel owner
      if (newBalance <= existingWalletCurrentBalance) {
        const hoursLeft = Math.ceil((existingTier.protectionTime * 60 * 60 * 1000 - pixelAge) / (60 * 60 * 1000));
        const messagePrefix = newBalance === 0 ? 
          `This pixel is protected. You need more than ${formatBillboardAmount(existingWalletCurrentBalance)} tokens to overwrite it.` :
          `This pixel is protected for ${hoursLeft} more hours by a user with ${formatBillboardAmount(existingWalletCurrentBalance)} tokens. You need more than ${formatBillboardAmount(existingWalletCurrentBalance)} tokens to overwrite it.`;
        
        return {
          canOverwrite: false,
          message: messagePrefix
        };
      }
    }

    return { canOverwrite: true };
  } catch (error) {
    console.error('Error in canOverwritePixel:', error);
    return { canOverwrite: true };
  }
}