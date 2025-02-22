import { redis } from './redis';
import { getBillboardPrice, getBillboardBalance } from '@/app/api/_lib/subgraphClient';

interface TokenTier {
  minTokens: number;     // Amount of BILLBOARD tokens needed
  cooldown: number;      // in seconds
  protectionTime: number; // in hours
}

export const TIERS: TokenTier[] = [
  { minTokens: 350_000_000, cooldown: 1,  protectionTime: 24 }, // ~$250
  { minTokens: 150_000_000, cooldown: 5,  protectionTime: 24 }, // ~$100
  { minTokens: 75_000_000,  cooldown: 15, protectionTime: 24 }, // ~$50
  { minTokens: 30_000_000,  cooldown: 30, protectionTime: 24 }, // ~$20
  { minTokens: 0,           cooldown: 60, protectionTime: 0 }   // Default tier
];

export async function getUserTier(tokenBalance: number): Promise<TokenTier> {
  const tokenPrice = await getTokenPrice();
  const usdValue = tokenBalance * tokenPrice;
  
  return TIERS.find(tier => usdValue >= tier.minTokens) || TIERS[TIERS.length - 1];
}

async function getTokenPrice(): Promise<number> {
  // Check cache first
  const cached = await redis.get('billboard:token_price');
  if (cached && typeof cached === 'string') {
    return parseFloat(cached);
  }

  // Get fresh price and round to nearest 500000
  const price = await getBillboardPrice();
  const roundedPrice = Math.round(price / 500000) * 500000;

  // Cache for 15 minutes
  await redis.set('billboard:token_price', roundedPrice.toString(), {
    ex: 15 * 60 // 15 minutes
  });

  return roundedPrice;
}

export async function canPlacePixel(walletAddress: string): Promise<boolean> {
  const lastPlacement = await redis.get(`pixel:cooldown:${walletAddress}`);
  if (!lastPlacement || typeof lastPlacement !== 'string') return true;

  const balance = await getTokenBalance(walletAddress);
  const tier = await getUserTier(balance);
  const timeSinceLastPlacement = Date.now() - parseInt(lastPlacement);
  
  return timeSinceLastPlacement >= (tier.cooldown * 1000);
}

export async function canOverwritePixel(
  newWalletAddress: string, 
  existingPixelData: any
): Promise<boolean> {
  if (!existingPixelData) return true;

  const newBalance = await getTokenBalance(newWalletAddress);
  const existingBalance = await getTokenBalance(existingPixelData.wallet_address);
  
  const newTier = await getUserTier(newBalance);
  const existingTier = await getUserTier(existingBalance);

  // If original owner has less than $20 worth, anyone can overwrite
  if (existingTier.minTokens < 20) return true;

  // Check 48-hour protection
  const pixelAge = Date.now() - new Date(existingPixelData.placed_at).getTime();
  const protectionExpired = pixelAge > (existingTier.protectionTime * 60 * 60 * 1000);

  if (!protectionExpired) {
    // During protection, need equal or higher balance
    return newBalance >= existingBalance;
  }

  return true;
}

// Cache token balances for 30 seconds
async function getTokenBalance(walletAddress: string): Promise<number> {
  const cacheKey = `balance:${walletAddress}`;
  const cached = await redis.get(cacheKey);
  
  if (cached && typeof cached === 'string') {
    return parseFloat(cached);
  }

  const balance = Number(await getBillboardBalance(walletAddress));
  
  await redis.set(cacheKey, balance.toString(), {
    ex: 30 // 30 seconds
  });

  return balance;
}