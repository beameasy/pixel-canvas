import { useState, useEffect, useCallback, useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';

interface FarcasterUser {
  username: string | null;
  pfpUrl: string | null;
  displayName: string | null;
}

export function useFarcasterUser(address: string | undefined) {
  const [farcasterUser, setFarcasterUser] = useState<FarcasterUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { getAccessToken, user, authenticated, ready } = usePrivy();
  const profileCheckCompleted = useRef(false);
  
  // Check if user profile exists to avoid 401s
  useEffect(() => {
    if (!authenticated || !user?.wallet?.address) return;
    
    // Use a simple endpoint to check if profile creation is complete
    const checkProfileStatus = async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        
        const headers: Record<string, string> = {
          'x-privy-token': token
        };
        
        if (user?.wallet?.address) {
          headers['x-wallet-address'] = user.wallet.address;
        }
        
        const response = await fetch('/api/users/balance', {
          headers
        });
        
        if (response.ok) {
          console.log('✅ User profile confirmed ready for Farcaster API calls');
          profileCheckCompleted.current = true;
        } else {
          console.log('⏳ User profile not yet ready, will retry');
          setTimeout(checkProfileStatus, 1500);
        }
      } catch (err) {
        console.warn('Error checking profile status', err);
        setTimeout(checkProfileStatus, 2000);
      }
    };
    
    checkProfileStatus();
  }, [authenticated, user?.wallet?.address, getAccessToken]);
  
  const fetchFarcasterUser = useCallback(async () => {
    // Only proceed if we have an address, authentication is complete, and profile exists
    if (!address || !authenticated || !ready || !user?.wallet?.address || !profileCheckCompleted.current) {
      console.log('Prerequisites not met for Farcaster API call:', { 
        hasAddress: !!address, 
        authenticated, 
        ready, 
        hasWallet: !!user?.wallet?.address,
        profileReady: profileCheckCompleted.current
      });
      return;
    }
    
    setIsLoading(true);
    setError(null);

    try {
      console.log('Preparing to fetch Farcaster data for:', address);
      
      // Get Privy token for auth
      const token = await getAccessToken();
      
      if (!token) {
        console.error('Failed to get Privy access token');
        setError('Authentication error');
        setIsLoading(false);
        return;
      }
      
      console.log('Fetching Farcaster data with headers');
      
      const response = await fetch(`/api/farcaster?address=${encodeURIComponent(address)}`, {
        headers: {
          'x-privy-token': token,
          'x-wallet-address': user?.wallet?.address || ''
        },
        credentials: 'same-origin'
      });
      
      console.log('Farcaster API response status:', response.status);
      
      if (response.status === 401 || response.status === 403) {
        console.warn(`Authentication error (${response.status}) when fetching Farcaster data`);
        setError('Authentication required to view Farcaster data');
        setFarcasterUser(null);
        setIsLoading(false);
        return;
      }
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Farcaster API response data:', data);

      // Handle both response formats:
      // 1. The API may return {success: true, data: {...}} format
      // 2. Or it might directly return the farcaster data object
      // 3. Or it might return null if no Farcaster account is found
      if (data && data.success && data.data) {
        // Format 1: Success wrapper with data object
        setFarcasterUser(data.data);
      } else if (data && (data.farcaster_username || data.farcaster_pfp)) {
        // Format 2: Direct data object
        setFarcasterUser({
          username: data.farcaster_username,
          pfpUrl: data.farcaster_pfp,
          displayName: data.display_name
        });
      } else {
        // No valid data
        setFarcasterUser(null);
      }
    } catch (err) {
      console.error('Error fetching Farcaster user:', err);
      setFarcasterUser(null);
      setError('Failed to load Farcaster data');
    } finally {
      setIsLoading(false);
    }
  }, [address, getAccessToken, user?.wallet?.address, authenticated, ready, profileCheckCompleted]);

  // Poll for Farcaster data every few seconds once we're ready
  useEffect(() => {
    if (!profileCheckCompleted.current) return;
    
    fetchFarcasterUser();
    
    const interval = setInterval(() => {
      fetchFarcasterUser();
    }, 30000); // Poll every 30 seconds
    
    return () => clearInterval(interval);
  }, [fetchFarcasterUser, profileCheckCompleted.current]);

  return { farcasterUser, error, isLoading, refetch: fetchFarcasterUser };
} 