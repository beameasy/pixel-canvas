export interface TokenTier {
  name: string;
  minTokens: number;     // Raw token amount needed
  cooldownSeconds: number; // Seconds between placements
  protectionTime: number; // Hours of protection
}

// Tiers are checked from top to bottom, first match wins
export const TIERS: TokenTier[] = [
  { 
    name: 'Ultimate',
    minTokens: 2_500_000_000, // 2.5B tokens (new top tier)
    cooldownSeconds: 2,       // Changed from 1s to 2s
    protectionTime: 36        // Changed from 48h to 36h
  },
  { 
    name: 'Legendary',
    minTokens: 1_250_000_000, // 1.25B tokens 
    cooldownSeconds: 4,       // Changed from 3s to 4s
    protectionTime: 24        // Maximum protection
  },
  { 
    name: 'Diamond',
    minTokens: 750_000_000,   // 750M tokens
    cooldownSeconds: 5,       // Increased from 3 to create step down
    protectionTime: 20        // Decreased from 24 to create step down
  },
  { 
    name: 'Platinum',
    minTokens: 350_000_000,   // 350M tokens
    cooldownSeconds: 8,       // Increased from 6 to create better progression
    protectionTime: 16        // Decreased from 18 to create better progression
  },
  { 
    name: 'Gold',
    minTokens: 150_000_000,   // 150M tokens
    cooldownSeconds: 12,      // Decreased from 15 to fit progression
    protectionTime: 12        // 12 hours protection (unchanged)
  },
  { 
    name: 'Silver',
    minTokens: 30_000_000,    // 30M tokens
    cooldownSeconds: 18,      // Decreased from 20 to fit progression
    protectionTime: 6         // 6 hours protection (unchanged)
  },
  {
    name: 'Bronze',
    minTokens: 5_000_000,     // 5M tokens
    cooldownSeconds: 24,      // Decreased from 25 to fit progression
    protectionTime: 3         // Changed from 1h to 3h for smoother progression
  },
  { 
    name: 'Member',
    minTokens: 0,             // Default tier
    cooldownSeconds: 30,      // 30 seconds cooldown
    protectionTime: 0         // No protection
  }
];

// Default values if something goes wrong
export const DEFAULT_TIER: TokenTier = {
  name: 'Member',
  minTokens: 0,
  cooldownSeconds: 30,
  protectionTime: 0
}; 