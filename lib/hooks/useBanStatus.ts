import { useState, useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';

export function useBanStatus() {
  const [isBanned, setIsBanned] = useState<boolean>(false);
  const [banReason, setBanReason] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const { user, authenticated, getAccessToken } = usePrivy();

  useEffect(() => {
    const checkBanStatus = async () => {
      // Only proceed if authenticated and have wallet address
      if (!authenticated || !user?.wallet?.address) {
        // Reset ban state when not authenticated or no wallet
        setIsBanned(false);
        setBanReason(null);
        return;
      }

      setIsChecking(true);
      try {
        const token = await getAccessToken();
        if (!token) {
          console.log("No token available yet, skipping ban check");
          return;
        }

        console.log("🔍 Checking ban status for wallet:", user.wallet.address.substring(0, 10) + "...");
        
        const response = await fetch('/api/users/ban-status', {
          headers: {
            'x-wallet-address': user.wallet.address,
            'x-privy-token': token
          }
        });

        if (response.status === 403) {
          // 403 means the wallet is banned
          const data = await response.json();
          console.warn('🚫 Wallet is banned:', data);
          setIsBanned(true);
          setBanReason(data.reason || null);
          return;
        } else if (response.status === 401) {
          // 401 is expected if authentication isn't complete
          console.log("Authentication not complete yet, will retry ban check later");
          return;
        } else if (!response.ok) {
          console.warn(`Ban check failed with status: ${response.status}`);
          return;
        }

        // Any other status with OK means the wallet is not banned
        setIsBanned(false);
        setBanReason(null);
        console.log("✅ Wallet is not banned");
      } catch (error) {
        console.error('Error checking ban status:', error);
        // Default to not banned on error to avoid locking out users incorrectly
        setIsBanned(false);
      } finally {
        setIsChecking(false);
      }
    };

    checkBanStatus();
  }, [authenticated, user?.wallet?.address, getAccessToken]);

  return { isBanned, banReason, isChecking };
} 