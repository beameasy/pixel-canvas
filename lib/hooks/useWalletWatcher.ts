import { useEffect, useRef, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';

export function useWalletWatcher() {
  const { authenticated, ready, user, logout, getAccessToken } = usePrivy();
  const previousWalletRef = useRef<string | null>(null);
  const isTransitioning = useRef<boolean>(false);
  
  // Check if auth is in a valid state
  const isAuthValid = ready && authenticated && !!user?.wallet?.address;
  
  // Handle wallet change with controlled logout and refresh
  const handleWalletChange = useCallback(async () => {
    if (isTransitioning.current) return; // Prevent multiple calls
    
    try {
      isTransitioning.current = true;
      console.log('🔄 Wallet changed, refreshing session...');
      
      // First clear local storage cache that might contain stale data
      const keysToPreserve = ['privy:embedded', 'privy:last-used-login-method'];
      Object.keys(localStorage).forEach(key => {
        if (!keysToPreserve.includes(key) && (key.includes('privy') || key.includes('user') || key.includes('wallet'))) {
          localStorage.removeItem(key);
        }
      });
      
      // Then trigger logout
      await logout();
      
      // Force reload to get fresh state
      window.location.reload();
    } catch (error) {
      console.error('Failed to handle wallet change:', error);
      isTransitioning.current = false;
      window.location.reload(); // Fallback - force reload anyway
    }
  }, [logout]);
  
  // Safe API call helper that checks auth status first
  const authenticatedFetch = useCallback(async (
    url: string, 
    options: RequestInit = {}
  ): Promise<Response | null> => {
    if (!isAuthValid || isTransitioning.current) {
      console.warn('Cannot make API call - authentication in transition or invalid');
      return null;
    }
    
    try {
      const token = await getAccessToken();
      if (!token) {
        console.warn('No valid token available for API call');
        return null;
      }
      
      // Set up authenticated headers
      const headers = new Headers(options.headers || {});
      headers.set('x-privy-token', token);
      if (user?.wallet?.address) {
        headers.set('x-wallet-address', user.wallet.address);
      }
      
      return fetch(url, {
        ...options,
        headers
      });
    } catch (error) {
      console.error('Error making authenticated API call:', error);
      return null;
    }
  }, [isAuthValid, getAccessToken, user?.wallet?.address]);
  
  // Detect wallet changes
  useEffect(() => {
    if (isAuthValid) {
      const currentWallet = user?.wallet?.address || null;
      
      // Initialize on first valid auth
      if (previousWalletRef.current === null) {
        previousWalletRef.current = currentWallet;
        return;
      }
      
      // Check for wallet change
      if (previousWalletRef.current !== currentWallet) {
        console.log(`Wallet changed from ${previousWalletRef.current} to ${currentWallet}`);
        handleWalletChange();
      } else {
        // Update ref to current wallet
        previousWalletRef.current = currentWallet;
      }
    }
  }, [isAuthValid, user?.wallet?.address, handleWalletChange]);
  
  return {
    isAuthValid,
    isTransitioning: isTransitioning.current,
    currentWallet: user?.wallet?.address || null,
    authenticatedFetch
  };
} 