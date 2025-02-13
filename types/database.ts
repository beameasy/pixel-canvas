export type User = {
  wallet_address: string
  privy_id: string
  updated_at: string
  last_active: string
  token_balance?: number
  farcaster_username?: string
  farcaster_pfp?: string
  // Add other user fields you want
}

export interface Pixel {
  id?: string;
  x: number;
  y: number;
  color: string;
  wallet_address: string;
  placed_at: string;
}

export type Canvas = {
  id: string
  pixels: Pixel[]
  updated_at: string
} 