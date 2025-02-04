'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { PropsWithChildren } from 'react';

export function Providers({ children }: PropsWithChildren) {
  if (!process.env.NEXT_PUBLIC_PRIVY_APP_ID) {
    console.error('Missing PRIVY_APP_ID');
    return <>{children}</>;
  }

  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID}
      config={{
        loginMethods: ['wallet'],
        appearance: {
          theme: 'dark',
          accentColor: '#646cff',
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
} 