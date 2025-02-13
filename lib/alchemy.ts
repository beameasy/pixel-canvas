import { Alchemy, Network } from 'alchemy-sdk';

if (!process.env.ALCHEMY_API_KEY) {
  throw new Error('Missing ALCHEMY_API_KEY environment variable');
}

export const alchemy = new Alchemy({
  apiKey: process.env.ALCHEMY_API_KEY,
  network: Network.BASE_MAINNET,
});