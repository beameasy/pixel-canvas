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
  const cacheKey = `balance:${walletAddress}`;
  const cached = await redis.get(cacheKey);
  
  if (cached && typeof cached === 'string') {
    return parseFloat(cached);
  }

  const balance = Number(await getBillboardBalance(walletAddress));
  
  await redis.set(cacheKey, balance.toString(), {
    ex: 5 * 60 // 5 minutes
  });

  return balance;
}

export async function getUserTier(balanceOrAddress: number | string): Promise<TokenTier> {
  let balance: number;
  
  if (typeof balanceOrAddress === 'string') {
    balance = await getTokenBalance(balanceOrAddress);
  } else {
    balance = balanceOrAddress;
  }

  return TIERS.find(tier => balance >= tier.minTokens) || DEFAULT_TIER;
}

export async function canPlacePixel(walletAddress: string): Promise<boolean> {
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

  try {
    const [newBalance, existingBalance] = await Promise.all([
      getTokenBalance(newWalletAddress),
      getTokenBalance(existingPixelData.wallet_address)
    ]);

    const [newTier, existingTier] = await Promise.all([
      getUserTier(newBalance),
      getUserTier(existingBalance)
    ]);

    // Check if pixel owner has protection based on their tier
    const pixelAge = Date.now() - new Date(existingPixelData.placed_at).getTime();
    const protectionExpired = pixelAge > (existingTier.protectionTime * 60 * 60 * 1000);

    if (!protectionExpired) {
      // During protection, need equal or higher balance
      if (newBalance < existingBalance) {
        const hoursLeft = Math.ceil((existingTier.protectionTime * 60 * 60 * 1000 - pixelAge) / (60 * 60 * 1000));
        return {
          canOverwrite: false,
          message: `This pixel is protected for ${hoursLeft} more hours by a user with ${formatBillboardAmount(existingBalance)} tokens. You need at least ${formatBillboardAmount(existingBalance)} tokens to overwrite it.`
        };
      }
    }

    return { canOverwrite: true };
  } catch (error) {
    console.error('Error in canOverwritePixel:', error);
    return { canOverwrite: true };
  }
}