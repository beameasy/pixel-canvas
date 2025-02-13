import { useState, useEffect } from 'react';

interface FarcasterUser {
  username: string | null;
  pfpUrl: string | null;
  displayName: string | null;
}

export function useFarcasterUser(address: string | undefined) {
  const [farcasterUser, setFarcasterUser] = useState<FarcasterUser | null>(null);

  useEffect(() => {
    async function fetchFarcasterUser() {
      if (!address) return;

      try {
        const response = await fetch(`/api/farcaster?address=${encodeURIComponent(address)}`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();

        if (data.success && data.data) {
          setFarcasterUser(data.data);
        } else {
          setFarcasterUser(null);
        }
      } catch {
        setFarcasterUser(null);
      }
    }

    fetchFarcasterUser();
  }, [address]);

  return { farcasterUser };
} 