export interface TokenTier {
  name: string;
  minTokens: number;     // Raw token amount needed
  cooldownSeconds: number; // Seconds between placements
  protectionTime: number; // Hours of protection
}

// Tiers are checked from top to bottom, first match wins
export const TIERS: TokenTier[] = [
  { 
    name: 'Diamond',
    minTokens: 750_000_000, // 750M tokens (reduced from 1B)
    cooldownSeconds: 3,     // 3 second cooldown (slightly increased)
    protectionTime: 24      // 24 hours protection
  },
  { 
    name: 'Platinum',
    minTokens: 350_000_000, // 350M tokens (reduced from 500M)
    cooldownSeconds: 6,     // 6 seconds cooldown
    protectionTime: 18      // 18 hours protection
  },
  { 
    name: 'Gold',
    minTokens: 150_000_000,  // 150M tokens
    cooldownSeconds: 15,    // 10 seconds cooldown (reduced from 15)
    protectionTime: 12      // 12 hours protection
  },
  { 
    name: 'Silver',
    minTokens: 30_000_000,  // 30M tokens (reduced from 30M)
    cooldownSeconds: 20,    // 15 seconds cooldown (reduced from 20)
    protectionTime: 6       // 6 hours protection (increased from 3)
  },
  {
    name: 'Bronze',
    minTokens: 5_000_000,   // 5M tokens (new tier between Silver and default)
    cooldownSeconds: 25,    // 20 seconds cooldown
    protectionTime: 0.5       // 2 hours protection
  },
  { 
    name: 'Member',
    minTokens: 0,           // Default tier (renamed from Bronze)
    cooldownSeconds: 30,    // 25 seconds cooldown (reduced from 30)
    protectionTime: 0       // No protection
  }
];

// Default values if something goes wrong
export const DEFAULT_TIER: TokenTier = {
  name: 'Member',
  minTokens: 0,
  cooldownSeconds: 30,
  protectionTime: 0
}; 