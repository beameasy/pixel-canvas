// Tokenomics model

export interface TokenomicsInfo {
  name: string;
  network: string;
  contract: string;
  launchInfo: string;
}

export interface TokenTier {
  name: string;
  minTokens: number;
  cooldownSeconds: number;
  protectionTime: number;
}

export interface TokenomicsData {
  info: TokenomicsInfo;
  tiers: TokenTier[];
}

// Default tokenomics data
export const DEFAULT_TOKENOMICS: TokenomicsData = {
  info: {
    name: "BILLBOARD",
    network: "Base",
    contract: "0x0aB96f7A85f8480c0220296C3332488ce38D9818",
    launchInfo: "Launched via Clanker on Clank.fun"
  },
  tiers: [] // This will be populated dynamically from the server
};

// Helper function to format token amounts
export function formatTokenAmount(amount: number): string {
  return amount === 0 ? '0' : `${amount / 1_000_000}M`;
} 