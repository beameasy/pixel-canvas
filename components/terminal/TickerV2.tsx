'use client';

import React, { useEffect, useState, memo, useCallback } from 'react';
import Image from 'next/image';
import { pusherManager } from '@/lib/client/pusherManager';
import { usePrivy } from '@privy-io/react-auth';
import Marquee from 'react-fast-marquee';
import FarcasterLogo from '@/components/ui/FarcasterLogo';

interface TopUser {
  wallet_address: string;
  count: number;
  farcaster_username: string | null;
  farcaster_pfp: string | null;
}

interface TopUser24Hours {
  wallet_address: string;
  count: number;
  farcaster_username: string | null;
  farcaster_pfp: string | null;
}

// Ticker using react-fast-marquee
const TickerV2 = memo(function TickerV2() {
  const { getAccessToken } = usePrivy();
  const [users, setUsers] = useState<TopUser[]>([]);
  const [users24h, setUsers24h] = useState<TopUser24Hours[]>([]);
  const [retryCount, setRetryCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const maxRetries = 3;
  const retryDelay = 5000; // Increased to 5 seconds to avoid rate limiting
  
  const handlePixelPlaced = useCallback((data: { pixel: any, topUsers?: TopUser[], topUsers24h?: TopUser24Hours[] }) => {
    if (!data) return;
    console.log('Received Pusher update:', data);
    
    // Only update if we received new top users data
    if (Array.isArray(data.topUsers) && data.topUsers.length > 0) {
      setUsers(prevUsers => {
        // Skip update if data is the same
        if (JSON.stringify(prevUsers) === JSON.stringify(data.topUsers)) {
          return prevUsers;
        }
        return data.topUsers ?? prevUsers;
      });
    }
    
    if (data.topUsers24h && Array.isArray(data.topUsers24h) && data.topUsers24h.length > 0) {
      setUsers24h(prevUsers => {
        // Skip update if data is the same
        if (JSON.stringify(prevUsers) === JSON.stringify(data.topUsers24h)) {
          return prevUsers;
        }
        return data.topUsers24h ?? prevUsers;
      });
    }
  }, []);

  const fetchInitialTickerData = useCallback(async () => {
    try {
      console.log('Fetching initial ticker data...');
      setIsLoading(true);
      setError(null);
      
      const token = await getAccessToken();
      console.log('Got auth token:', token ? 'yes' : 'no');
      
      // Only retry for auth token if we haven't exceeded retries
      if (!token && retryCount < maxRetries) {
        console.log(`No auth token yet, retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${maxRetries})`);
        setRetryCount(prev => prev + 1);
        setTimeout(() => fetchInitialTickerData(), retryDelay);
        return;
      }

      // Add a small delay between retries to avoid rate limiting
      if (retryCount > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Fetch both 1h and 24h data in parallel
      console.log('Fetching ticker data...');
      const [tickerResponse, users24hResponse] = await Promise.all([
        fetch('/api/ticker', {
          method: 'GET',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            ...(token ? { 'x-privy-token': token } : {})
          }
        }),
        fetch('/api/ticker?period=24h', {
          method: 'GET',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            ...(token ? { 'x-privy-token': token } : {})
          }
        })
      ]);

      // Handle rate limiting for either response
      if (tickerResponse.status === 429 || users24hResponse.status === 429) {
        const retryAfter = parseInt(tickerResponse.headers.get('Retry-After') || users24hResponse.headers.get('Retry-After') || '5');
        console.log(`Rate limited, retrying in ${retryAfter}s`);
        setError('Rate limited, retrying...');
        setTimeout(() => fetchInitialTickerData(), retryAfter * 1000);
        return;
      }

      if (!tickerResponse.ok || !users24hResponse.ok) {
        throw new Error(`API error: ${tickerResponse.status}/${users24hResponse.status}`);
      }

      // Parse responses
      const [tickerData, users24hData] = await Promise.all([
        tickerResponse.json(),
        users24hResponse.json()
      ]);

      console.log('Received ticker data:', {
        ticker: tickerData?.length || 0,
        users24h: users24hData?.length || 0,
        tickerSample: tickerData?.[0],
        users24hSample: users24hData?.[0]
      });

      // Validate and set data
      if (Array.isArray(tickerData)) {
        setUsers(tickerData);
      }
      
      if (Array.isArray(users24hData)) {
        setUsers24h(users24hData);
      }

      // Reset retry count and error state if we got any valid data
      if ((tickerData && tickerData.length > 0) || (users24hData && users24hData.length > 0)) {
        setRetryCount(0);
        setError(null);
      } else {
        setError('No activity in the last 24 hours');
      }
    } catch (error) {
      console.error('Failed to load initial ticker data:', error);
      setError(error instanceof Error ? error.message : 'Failed to load ticker data');
      
      // Only retry on error if we haven't exceeded retries
      if (retryCount < maxRetries) {
        console.log(`Error fetching data, retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${maxRetries})`);
        setRetryCount(prev => prev + 1);
        setTimeout(() => fetchInitialTickerData(), retryDelay);
      }
    } finally {
      setIsLoading(false);
    }
  }, [getAccessToken, retryCount]);

  // Initialize data and setup Pusher
  useEffect(() => {
    console.log('TickerV2 component mounted');
    
    const initialize = async () => {
      await fetchInitialTickerData();

      // Ensure Pusher is connected
      if (!pusherManager.isConnected()) {
        console.log('Reconnecting Pusher...');
        pusherManager.reconnect();
      }
      
      // Create a stable reference to the event handler
      const eventHandler = (data: any) => handlePixelPlaced(data);
      
      // Subscribe to Pusher events
      console.log('Subscribing to pixel-placed events...');
      pusherManager.subscribe('pixel-placed', eventHandler);

      // Return cleanup function
      return () => {
        console.log('Cleaning up Pusher subscription...');
        pusherManager.unsubscribe('pixel-placed', eventHandler);
      };
    };

    initialize();
  }, [fetchInitialTickerData, handlePixelPlaced]);

  const formatUser = (user: TopUser, index: number) => {
    return (
      <span className="ticker-item" key={`user-${user.wallet_address}-${index}`}>
        <span className="text-gray-400">{index + 1}.</span>
        {user.farcaster_pfp && user.farcaster_pfp !== 'null' && (
          <span className="inline-flex items-center gap-1">
            <FarcasterLogo className="text-purple-400" size="sm" />
            <Image
              src={user.farcaster_pfp}
              alt={user.farcaster_username || user.wallet_address}
              width={16}
              height={16}
              className="rounded-full"
            />
          </span>
        )}
        {user.farcaster_username && user.farcaster_username !== 'null' ? (
          <a 
            href={`https://warpcast.com/${user.farcaster_username}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple-400 hover:text-purple-300 transition-colors"
          >
            @{user.farcaster_username}
          </a>
        ) : (
          <a 
            href={`https://basescan.org/address/${user.wallet_address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 transition-colors"
          >
            {user.wallet_address.slice(0, 6)}...{user.wallet_address.slice(-4)}
          </a>
        )}
        <span className="text-[#4ADE80]">
          - {user.count} {user.count === 1 ? 'pixel' : 'pixels'}
        </span>
      </span>
    );
  };

  const formatUser24h = (user: TopUser24Hours, index: number) => {
    return (
      <span className="ticker-item" key={`user24h-${user.wallet_address}-${index}`}>
        <span className="text-gray-400">{index + 1}.</span>
        {user.farcaster_pfp && user.farcaster_pfp !== 'null' && (
          <span className="inline-flex items-center gap-1">
            <FarcasterLogo className="text-purple-400" size="sm" />
            <Image
              src={user.farcaster_pfp}
              alt={user.farcaster_username || user.wallet_address}
              width={16}
              height={16}
              className="rounded-full"
            />
          </span>
        )}
        {user.farcaster_username && user.farcaster_username !== 'null' ? (
          <a 
            href={`https://warpcast.com/${user.farcaster_username}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple-400 hover:text-purple-300 transition-colors"
          >
            @{user.farcaster_username}
          </a>
        ) : (
          <a 
            href={`https://basescan.org/address/${user.wallet_address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 transition-colors"
          >
            {user.wallet_address.slice(0, 6)}...{user.wallet_address.slice(-4)}
          </a>
        )}
        <span className="text-[#FFD700]">
          - {user.count} {user.count === 1 ? 'pixel' : 'pixels'}
        </span>
      </span>
    );
  };

  // Render the ticker content
  const renderTickerContent = () => (
    <div className="ticker-content">
      <div className="ticker-section">
        <span className="ticker-header ticker-header-1h">TOP USERS - LAST HOUR</span>
        {users && users.length > 0 && users.map((user, index) => (
          <React.Fragment key={`user-fragment-${index}`}>
            {formatUser(user, index)}
            {index < users.length - 1 && (
              <span className="ticker-dot">•</span>
            )}
          </React.Fragment>
        ))}
      </div>
      
      <span className="ticker-diamond">◆</span>
      
      <div className="ticker-section">
        <span className="ticker-header ticker-header-24h">TOP USERS - LAST 24 HOURS</span>
        {users24h && users24h.length > 0 && users24h.map((user, index) => (
          <React.Fragment key={`user24h-fragment-${index}`}>
            {formatUser24h(user, index)}
            {index < users24h.length - 1 && (
              <span className="ticker-dot">•</span>
            )}
          </React.Fragment>
        ))}
      </div>
      
      <span className="ticker-diamond">◆</span>
    </div>
  );

  // If loading or error, show appropriate message
  if (isLoading) {
    return (
      <div className="ticker-wrapper">
        <div className="ticker-loading">Loading ticker data...</div>
        <style jsx>{`
          .ticker-loading {
            color: #666;
            text-align: center;
            padding: 4px;
          }
        `}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ticker-wrapper">
        <div className="ticker-error">{error}</div>
        <style jsx>{`
          .ticker-error {
            color: #ff4444;
            text-align: center;
            padding: 4px;
          }
        `}</style>
      </div>
    );
  }

  // If there's no data, don't render anything
  if (users.length === 0 && users24h.length === 0) {
    return null;
  }

  // Return a single element as required by PageVisibility
  return (
    <div className="ticker-wrapper">
      <Marquee
        speed={80} 
        gradient={false}
        pauseOnHover={true}
        className="ticker-marquee"
      >
        {renderTickerContent()}
      </Marquee>
      
      <style jsx global>{`
        .ticker-wrapper {
          height: 24px;
          background-color: #111827;
          overflow: hidden;
          width: 100%;
          position: relative;
        }
        
        .ticker-marquee {
          height: 24px !important;
        }
        
        .ticker-content {
          display: inline-flex;
          align-items: center;
          height: 100%;
          white-space: nowrap;
          padding: 0 20px;
        }
        
        .ticker-section {
          display: inline-flex;
          align-items: center;
          gap: 16px;
          height: 100%;
          padding: 0 12px;
        }
        
        .ticker-diamond {
          color: white;
          margin: 0 24px;
          display: inline-flex;
          align-items: center;
        }
        
        .ticker-dot {
          color: #666;
          margin: 0 16px;
          display: inline-flex;
          align-items: center;
        }
        
        .ticker-header {
          font-weight: bold;
          display: inline-flex;
          align-items: center;
          margin-right: 16px;
        }
        
        .ticker-header-24h {
          color: #FFD700; /* Gold color for 24h header */
        }
        
        .ticker-header-1h {
          color: #4ADE80; /* Green color for 1h header */
        }
        
        .ticker-item {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
      `}</style>
    </div>
  );
});

export default TickerV2; 