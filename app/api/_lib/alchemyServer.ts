import { Network, Alchemy } from 'alchemy-sdk';

if (!process.env.ALCHEMY_API_KEY) {
  throw new Error('ALCHEMY_API_KEY is not set');
}

const settings = {
  apiKey: process.env.ALCHEMY_API_KEY,
  network: Network.BASE_MAINNET,
  maxRetries: 5,
  requestTimeout: 30000
};

// Log configuration on initialization
console.log('Initializing Alchemy with config:', {
  hasApiKey: !!process.env.ALCHEMY_API_KEY,
  network: Network.BASE_MAINNET
});

export const alchemy = new Alchemy(settings);

// Alternative method using fetch directly
export async function getTokenBalance(walletAddress: string, tokenAddress: string) {
  const response = await fetch(
    `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'alchemy_getTokenBalances',
        params: [walletAddress, [tokenAddress]]
      })
    }
  );
  
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  const data = await response.json();
  return data.result;
} 