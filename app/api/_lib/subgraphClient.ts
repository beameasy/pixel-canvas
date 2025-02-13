import { createClient } from '@urql/core';

const SUBGRAPH_URL = 'https://api.studio.thegraph.com/query/[YOUR_ID]/base-token-balances/version/latest';

export const client = createClient({
  url: SUBGRAPH_URL,
});

export async function getTokenBalance(walletAddress: string, tokenAddress: string) {
  const query = `
    query GetBalance($wallet: String!, $token: String!) {
      account(id: $wallet) {
        balances(where: { token: $token }) {
          value
          token {
            decimals
          }
        }
      }
    }
  `;

  const { data } = await client.query(query, {
    wallet: walletAddress.toLowerCase(),
    token: tokenAddress.toLowerCase(),
  }).toPromise();

  return data?.account?.balances[0] || { value: '0' };
} 