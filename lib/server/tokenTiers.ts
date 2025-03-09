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
  
  // Get the last placed timestamp from Redis
  const lastPlaced = await redis.hget('pixel:cooldowns', walletAddress) as string | null;
  if (!lastPlaced || lastPlaced === '0') return true; // No cooldown if never placed before

  // Get user's tier based on token balance
  const balance = await getTokenBalance(walletAddress);
  const tier = await getUserTier(balance);
  const cooldownMs = tier.cooldownSeconds * 1000;

  const now = Date.now();
  const lastPlacedTime = parseInt(lastPlaced);
  const timeSinceLastPlaced = now - lastPlacedTime;
  
  // Compare with cooldown period based on user's tier
  return timeSinceLastPlaced >= cooldownMs;
}

/**
 * Get the time remaining in seconds before a user can place their next pixel
 * @param walletAddress User's wallet address
 * @returns Object with cooldown information, or null if no cooldown
 */
export async function getCooldownInfo(walletAddress: string): Promise<{
  canPlace: boolean;
  tier: TokenTier;
  cooldownSeconds: number;
  remainingSeconds: number;
  nextPlacementTime: number;
} | null> {
  // Check if wallet is an admin
  const isAdmin = (process.env.ADMIN_WALLETS || '')
    .split(',')
    .map(wallet => wallet.trim().toLowerCase())
    .filter(wallet => wallet.length > 0)
    .includes(walletAddress.toLowerCase());
  
  // Admins have no cooldown
  if (isAdmin) {
    return {
      canPlace: true,
      tier: TIERS[0],
      cooldownSeconds: 0,
      remainingSeconds: 0,
      nextPlacementTime: Date.now()
    };
  }
  
  const lastPlaced = await redis.hget('pixel:cooldowns', walletAddress) as string | null;
  if (!lastPlaced || lastPlaced === '0') {
    // No cooldown if never placed before
    const balance = await getTokenBalance(walletAddress);
    const tier = await getUserTier(balance);
    return {
      canPlace: true,
      tier,
      cooldownSeconds: tier.cooldownSeconds,
      remainingSeconds: 0,
      nextPlacementTime: Date.now()
    };
  }

  const balance = await getTokenBalance(walletAddress);
  const tier = await getUserTier(balance);
  const cooldownMs = tier.cooldownSeconds * 1000;

  const now = Date.now();
  const lastPlacedTime = parseInt(lastPlaced);
  const timeSinceLastPlaced = now - lastPlacedTime;
  const cooldownRemaining = cooldownMs - timeSinceLastPlaced;
  
  const canPlace = cooldownRemaining <= 0;
  const remainingSeconds = Math.max(0, Math.ceil(cooldownRemaining / 1000));
  const nextPlacementTime = lastPlacedTime + cooldownMs;

  return {
    canPlace,
    tier,
    cooldownSeconds: tier.cooldownSeconds,
    remainingSeconds,
    nextPlacementTime
  };
}

/**
 * Check cooldown and update timestamp atomically if allowed
 * @param walletAddress User's wallet address
 * @returns Object with cooldown check result and new timestamp if updated
 */
export async function checkAndUpdateCooldown(walletAddress: string): Promise<{
  canPlace: boolean;
  tier: TokenTier;
  cooldownSeconds: number;
  remainingSeconds: number;
  nextPlacementTime: number;
  updatedAt?: number;
}> {
  // Check if wallet is an admin
  const isAdmin = (process.env.ADMIN_WALLETS || '')
    .split(',')
    .map(wallet => wallet.trim().toLowerCase())
    .filter(wallet => wallet.length > 0)
    .includes(walletAddress.toLowerCase());
  
  // Admins have no cooldown
  if (isAdmin) {
    const now = Date.now();
    await redis.hset('pixel:cooldowns', {
      [walletAddress]: now.toString()
    });
    return {
      canPlace: true,
      tier: TIERS[0],
      cooldownSeconds: 0,
      remainingSeconds: 0,
      nextPlacementTime: now,
      updatedAt: now
    };
  }
  
  const balance = await getTokenBalance(walletAddress);
  const tier = await getUserTier(balance);
  const cooldownMs = tier.cooldownSeconds * 1000;
  
  // Use a Lua script to make the check and update atomic
  const now = Date.now();
  const script = `
    local lastPlaced = redis.call('HGET', 'pixel:cooldowns', ARGV[1])
    if not lastPlaced or lastPlaced == '0' then
      redis.call('HSET', 'pixel:cooldowns', ARGV[1], ARGV[2])
      return 1
    end
    
    local cooldownMs = tonumber(ARGV[3])
    local now = tonumber(ARGV[2])
    local lastPlacedTime = tonumber(lastPlaced)
    local timeSinceLastPlaced = now - lastPlacedTime
    
    if timeSinceLastPlaced >= cooldownMs then
      redis.call('HSET', 'pixel:cooldowns', ARGV[1], ARGV[2])
      return 1
    end
    
    return 0
  `;
  
  // Execute the script
  const result = await redis.eval(
    script,
    [],
    [walletAddress, now.toString(), cooldownMs.toString()]
  );
  
  const canPlace = result === 1;
  
  if (!canPlace) {
    // If not allowed to place, get the remaining cooldown time
    const lastPlaced = await redis.hget('pixel:cooldowns', walletAddress) as string;
    const lastPlacedTime = parseInt(lastPlaced);
    const timeSinceLastPlaced = now - lastPlacedTime;
    const cooldownRemaining = cooldownMs - timeSinceLastPlaced;
    const remainingSeconds = Math.max(0, Math.ceil(cooldownRemaining / 1000));
    const nextPlacementTime = lastPlacedTime + cooldownMs;
    
    return {
      canPlace,
      tier,
      cooldownSeconds: tier.cooldownSeconds,
      remainingSeconds,
      nextPlacementTime
    };
  }
  
  return {
    canPlace: true,
    tier,
    cooldownSeconds: tier.cooldownSeconds,
    remainingSeconds: 0,
    nextPlacementTime: now + cooldownMs,
    updatedAt: now
  };
}

/**
 * Update the user's cooldown timestamp in Redis
 * @param walletAddress User's wallet address
 * @returns The timestamp that was set
 */
export async function updateCooldownTimestamp(walletAddress: string): Promise<number> {
  const now = Date.now();
  await redis.hset('pixel:cooldowns', {
    [walletAddress]: now.toString()
  });
  return now;
}

export async function canOverwritePixel(
  newWalletAddress: string, 
  existingPixelData: any
): Promise<{ canOverwrite: boolean; message?: string; hasLink: boolean }> {
  if (!existingPixelData) return { canOverwrite: true, hasLink: false };
  
  // Users can always overwrite their own pixels
  if (newWalletAddress.toLowerCase() === existingPixelData.wallet_address.toLowerCase()) {
    return { canOverwrite: true, hasLink: false };
  }
  
  // Check if wallet is an admin
  const isAdmin = (process.env.ADMIN_WALLETS || '')
    .split(',')
    .map(wallet => wallet.trim().toLowerCase())
    .filter(wallet => wallet.length > 0)
    .includes(newWalletAddress.toLowerCase());
  
  // Admins can always overwrite pixels
  if (isAdmin) return { canOverwrite: true, hasLink: false };

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
        const tokensNeeded = existingWalletCurrentBalance - newBalance + 1;
        const clankLink = "https://clank.fun/t/0x0ab96f7a85f8480c0220296c3332488ce38d9818";
        
        const messagePrefix = newBalance === 0 ? 
          `This pixel is protected. You need more than ${formatBillboardAmount(existingWalletCurrentBalance)} tokens to overwrite it. <a href="${clankLink}" target="_blank" class="text-emerald-400 underline">Acquire ${formatBillboardAmount(tokensNeeded)} tokens here &rarr;</a>` :
          `This pixel is protected for ${hoursLeft} more hours by a user with ${formatBillboardAmount(existingWalletCurrentBalance)} tokens. You need an additional ${formatBillboardAmount(tokensNeeded)} tokens to overwrite it. <a href="${clankLink}" target="_blank" class="text-emerald-400 underline">Acquire tokens here &rarr;</a>`;
        
        return {
          canOverwrite: false,
          message: messagePrefix,
          hasLink: true
        };
      }
    }

    return { canOverwrite: true, hasLink: false };
  } catch (error) {
    console.error('Error in canOverwritePixel:', error);
    return { canOverwrite: true, hasLink: false };
  }
}