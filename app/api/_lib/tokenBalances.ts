import { alchemy } from './alchemyServer';
import { BigNumber } from '@ethersproject/bignumber';

// Define the TokenBalance type
export type TokenBalance = {
  contractAddress: string;
  tokenBalance: string;
};

export type TokenBalancesResponse = {
  tokenBalances: TokenBalance[];
};

export async function getTokenBalance(address: string) {
  try {
    if (!process.env.TOKEN_ADDRESS) {
      throw new Error('TOKEN_ADDRESS environment variable is not set');
    }

    console.log('Checking balance for:', {
      address,
      tokenAddress: process.env.TOKEN_ADDRESS
    });

    const response = await alchemy.core.getTokenBalances(
      address,
      [process.env.TOKEN_ADDRESS]
    );

    console.log('Balance response:', response);
    return response;
    
  } catch (error) {
    console.error('Token balance check failed:', error);
    throw error;
  }
}

export function formatTokenBalance(balance: string | null) {
  if (!balance) return 0;
  try {
    return Number(BigNumber.from(balance)) / 1e18;
  } catch (error) {
    console.error('Error formatting balance:', error);
    return 0;
  }
} 