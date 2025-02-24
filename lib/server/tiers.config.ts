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
    minTokens: 1_000_000_000, // 1B tokens
    cooldownSeconds: 2,              // 2 second cooldown
    protectionTime: 24        // 24 hours protection
  },
  { 
    name: 'Platinum',
    minTokens: 500_000_000,   // 500M tokens
    cooldownSeconds: 5,              // 5 seconds cooldown
    protectionTime: 18        // 20 hours protection
  },
  { 
    name: 'Gold',
    minTokens: 100_000_000,   // 100M tokens
    cooldownSeconds: 15,             // 15 seconds cooldown
    protectionTime: 12        // 24 hours protection
  },
  { 
    name: 'Silver',
    minTokens: 10_000_000,    // 10M tokens
    cooldownSeconds: 30,             // 30 seconds cooldown
    protectionTime: 6        // 24 hours protection
  },
  { 
    name: 'Bronze',
    minTokens: 0,             // Default tier
    cooldownSeconds: 45,             // 45 seconds cooldown
    protectionTime: 0         // No protection
  }
];

// Default values if something goes wrong
export const DEFAULT_TIER: TokenTier = {
  name: 'Bronze',
  minTokens: 0,
  cooldownSeconds: 45,
  protectionTime: 0
}; 