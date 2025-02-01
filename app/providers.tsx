'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { PropsWithChildren } from 'react';

export function Providers({ children }: PropsWithChildren) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        loginMethods: ['wallet'],
        appearance: {
          theme: 'light',
          accentColor: '#0052FF', // Base blue
        },
        defaultChain: {
          id: 8453, // Base mainnet
          name: 'Base',
          network: 'base',
          nativeCurrency: {
            name: 'Ethereum',
            symbol: 'ETH',
            decimals: 18,
          },
          rpcUrls: {
            default: {
              http: ['https://mainnet.base.org'],
            },
            public: {
              http: ['https://mainnet.base.org'],
            },
          },
          blockExplorers: {
            default: {
              name: 'Basescan',
              url: 'https://basescan.org',
            },
          },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
} 