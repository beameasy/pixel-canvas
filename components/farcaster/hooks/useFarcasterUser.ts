import { useState, useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';

interface FarcasterUser {
  username: string | null;
  pfpUrl: string | null;
  displayName: string | null;
}

export function useFarcasterUser(address: string | undefined, isBanned?: boolean) {
  const [farcasterUser, setFarcasterUser] = useState<FarcasterUser | null>(null);
  const { authenticated, getAccessToken, user } = usePrivy();

  useEffect(() => {
    async function fetchFarcasterUser() {
      if (!address || !authenticated || !user?.wallet?.address) {
        console.log('Skipping Farcaster fetch - prerequisites not met');
        return;
      }

      if (isBanned) {
        console.log('🚫 Skipping Farcaster fetch - wallet is banned');
        return;
      }

      try {
        const token = await getAccessToken();
        if (!token) {
          console.log('No token available for Farcaster fetch');
          return;
        }
        
        console.log(`🔍 Fetching Farcaster data for address: ${address.substring(0, 10)}...`);
        
        const response = await fetch(`/api/farcaster?address=${encodeURIComponent(address)}`, {
          headers: {
            'x-wallet-address': user.wallet.address,
            'x-privy-token': token
          }
        });
        
        if (!response.ok) {
          console.warn(`Failed to fetch Farcaster profile: ${response.status}`);
          if (response.status === 401) {
            console.log('Authentication not complete yet, will retry Farcaster fetch later');
          }
          return;
        }
        
        const data = await response.json();

        if (data && data.success === true && data.data) {
          console.log('✅ Farcaster data fetched successfully');
          setFarcasterUser(data.data);
        } else {
          console.log('No Farcaster profile found or invalid data format', data);
          setFarcasterUser(null);
        }
      } catch (error) {
        console.error('Error fetching Farcaster data:', error);
        setFarcasterUser(null);
      }
    }

    fetchFarcasterUser();
  }, [address, authenticated, user?.wallet?.address, getAccessToken, isBanned]);

  return { farcasterUser };
} 