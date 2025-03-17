import { gql, request } from 'graphql-request';
import { formatUnits, getAddress } from 'viem';
import { alchemy } from '@/lib/alchemy';
import { redis } from '@/lib/server/redis';

const SUBGRAPH_URL = process.env.SUBGRAPH_URL;
if (!SUBGRAPH_URL) throw new Error('SUBGRAPH_URL not set');

const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
if (!TOKEN_ADDRESS) throw new Error('TOKEN_ADDRESS not set');

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
if (!ALCHEMY_API_KEY) throw new Error('❌ ALCHEMY_API_KEY not set');

type BalanceResponse = {
  account?: {
    id: string;
    balance: string;
  };
};

type PriceResponse = {
  token: {
    derivedETH: string;
  };
  bundle: {
    ethPrice: string;
  };
};

const GET_BALANCE = gql`
  query GetBalance($id: String!) {
    account(id: $id) {
      id
      balance
    }
  }
`;

const GET_PRICE = gql`
  query GetPrice($tokenAddress: String!) {
    token(id: $tokenAddress) {
      derivedETH
    }
    bundle(id: "1") {
      ethPrice
    }
  }
`;

export async function getBillboardBalance(walletAddress: string) {
    try {
        console.log('Getting token balance from Alchemy');
        console.log('📍 Wallet:', walletAddress);
        console.log('🎯 Token:', TOKEN_ADDRESS);
        
        const body = {
            id: 1,
            jsonrpc: "2.0",
            method: "alchemy_getTokenBalances",
            params: [
                walletAddress,
                [getAddress(TOKEN_ADDRESS!)]
            ]
        };
        
        const response = await fetch(
            `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
            {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            }
        );

        const data = await response.json();
        const tokenBalance = data.result?.tokenBalances?.[0]?.tokenBalance || "0";
        const formatted = formatUnits(BigInt(tokenBalance), 18);
        const rounded = Math.round(Number(formatted));
        console.log('💰 Formatted balance:', rounded);
        
        return rounded;
    } catch (error) {
        console.error("❌ Balance query failed:", error);
        return 0;
    }
}

export async function getBillboardPrice(): Promise<number> {
    try {
        console.log('🔍 Getting token price from Alchemy API');
        
        const response = await fetch(
            `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    id: 1,
                    jsonrpc: "2.0",
                    method: "alchemy_getTokenMetadata",
                    params: [TOKEN_ADDRESS!]
                })
            }
        );

        if (!response.ok) {
            throw new Error(`Failed to fetch price. Status: ${response.status}`);
        }

        const data = await response.json();
        return data.result?.price || 0.001;
    } catch (error) {
        console.error("❌ Price fetch failed:", error);
        return 0.001;
    }
}

export async function getTokensNeededForUsdAmount(usdAmount: number): Promise<number> {
  const billboardPriceInUsd = await getBillboardPrice();
  if (billboardPriceInUsd === 0) return 0;
  return usdAmount / billboardPriceInUsd;
}

export async function getTokenPrice(tokenAddress: string) {
    try {
        const checksumToken = getAddress(tokenAddress);
        
        const response = await fetch(
            `https://token-api.alchemy.com/v1/token/base-mainnet/${checksumToken}`,
            {
                headers: { 
                    accept: 'application/json',
                    Authorization: `Bearer ${ALCHEMY_API_KEY}`
                }
            }
        );

        if (!response.ok) {
            throw new Error(`Failed to fetch price. Status: ${response.status}`);
        }

        const data = await response.json();
        console.log('💰 Price response:', data);
        return data.price?.usd || 0;
    } catch (error) {
        console.error('Error fetching token price:', error);
        return 0;
    }
} 