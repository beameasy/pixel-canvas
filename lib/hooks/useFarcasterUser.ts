import { useState, useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';

interface FarcasterUser {
  username: string | null;
  pfpUrl: string | null;
  displayName: string | null;
}

export function useFarcasterUser(address: string | undefined) {
  const [farcasterUser, setFarcasterUser] = useState<FarcasterUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { getAccessToken, user } = usePrivy();
  
  useEffect(() => {
    async function fetchFarcasterUser() {
      if (!address) return;
      setError(null);

      try {
        // Get Privy token for auth
        const token = await getAccessToken();
        const headers: Record<string, string> = {};
        
        if (token) {
          headers['x-privy-token'] = token;
        }
        
        if (user?.wallet?.address) {
          headers['x-wallet-address'] = user.wallet.address;
        }
        
        const response = await fetch(`/api/farcaster?address=${encodeURIComponent(address)}`, {
          headers
        });
        
        if (response.status === 401 || response.status === 403) {
          setError('Authentication required to view Farcaster data');
          setFarcasterUser(null);
          return;
        }
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();

        if (data.success && data.data) {
          setFarcasterUser(data.data);
        } else {
          setFarcasterUser(null);
        }
      } catch (err) {
        console.error('Error fetching Farcaster user:', err);
        setFarcasterUser(null);
        setError('Failed to load Farcaster data');
      }
    }

    fetchFarcasterUser();
  }, [address, getAccessToken, user?.wallet?.address]);

  return { farcasterUser, error };
} 