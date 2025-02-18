import { gql, request } from 'graphql-request';
import { formatUnits } from 'viem';

const SUBGRAPH_URL = process.env.SUBGRAPH_URL;
if (!SUBGRAPH_URL) throw new Error('SUBGRAPH_URL not set');

const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
if (!TOKEN_ADDRESS) throw new Error('TOKEN_ADDRESS not set');

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
        const data = await request<BalanceResponse>(
            SUBGRAPH_URL!,
            GET_BALANCE,
            { id: walletAddress.toLowerCase() }
        );
        
        const balanceInWei = data?.account?.balance || "0";
        return formatUnits(BigInt(balanceInWei), 18); // Convert from wei to ether
    } catch (error) {
        console.error("Subgraph query failed:", error);
        return "0";
    }
}

export async function getBillboardPrice(): Promise<number> {
  try {
    const data = await request<PriceResponse>(
      SUBGRAPH_URL!,
      GET_PRICE,
      { tokenAddress: TOKEN_ADDRESS!.toLowerCase() }
    );

    const billboardPriceInEth = parseFloat(data.token.derivedETH);
    const ethPriceInUsd = parseFloat(data.bundle.ethPrice);
    return billboardPriceInEth * ethPriceInUsd;
  } catch (error) {
    console.error("Price query failed:", error);
    return 0;
  }
}

export async function getTokensNeededForUsdAmount(usdAmount: number): Promise<number> {
  const billboardPriceInUsd = await getBillboardPrice();
  if (billboardPriceInUsd === 0) return 0;
  return usdAmount / billboardPriceInUsd;
} 