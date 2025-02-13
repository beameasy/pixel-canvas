import { Alchemy, Network } from 'alchemy-sdk';

// Alchemy setup - client side
const settings = {
  apiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY,  // Add this to .env.local
  network: Network.BASE_MAINNET,
};

export const alchemy = new Alchemy(settings); 