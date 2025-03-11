'use client';

import React, { useEffect, useState, memo } from 'react';
import Image from 'next/image';
import { pusherManager } from '@/lib/client/pusherManager';
import { usePrivy } from '@privy-io/react-auth';
import Marquee from 'react-fast-marquee';
import FarcasterLogo from '@/components/ui/FarcasterLogo';
// @ts-ignore
import PageVisibility from 'react-page-visibility';

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
  const [isVisible, setIsVisible] = useState(true);
  
  const handleVisibilityChange = (visible: boolean) => {
    setIsVisible(visible);
  };

  const handlePixelPlaced = (data: { topUsers: TopUser[], topUsers24h?: TopUser24Hours[] }) => {
    if (Array.isArray(data.topUsers) && data.topUsers.length > 0) {
      setUsers(prevUsers => {
        if (!prevUsers || prevUsers.length === 0) return data.topUsers;
        
        return data.topUsers.map(newUser => {
          const prevUser = prevUsers.find(p => p.wallet_address === newUser.wallet_address);
          
          if (newUser.farcaster_username || newUser.farcaster_pfp) {
            return newUser;
          }
          
          if (prevUser && (prevUser.farcaster_username || prevUser.farcaster_pfp)) {
            return {
              ...newUser,
              farcaster_username: prevUser.farcaster_username,
              farcaster_pfp: prevUser.farcaster_pfp
            };
          }
          
          return newUser;
        });
      });
    }
    
    if (data.topUsers24h && Array.isArray(data.topUsers24h) && data.topUsers24h.length > 0) {
      setUsers24h(data.topUsers24h);
    }
  };

  const initialize = async () => {
    try {
      const token = await getAccessToken();
      const [tickerResponse, users24hResponse] = await Promise.all([
        fetch('/api/ticker', {
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'x-privy-token': token || ''
          }
        }),
        fetch('/api/ticker?period=24h', {
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'x-privy-token': token || ''
          }
        })
      ]);
      
      const tickerData = await tickerResponse.json();
      if (Array.isArray(tickerData) && tickerData.length > 0) {
        setUsers(tickerData);
      }
      
      const users24hData = await users24hResponse.json();
      if (Array.isArray(users24hData) && users24hData.length > 0) {
        setUsers24h(users24hData);
      }
    } catch (error) {
      console.error('Failed to load ticker data:', error);
    }

    // Ensure Pusher is connected
    if (!pusherManager.isConnected()) {
      pusherManager.reconnect();
    }
    
    pusherManager.subscribe('pixel-placed', handlePixelPlaced);
  };

  // Initialize data and setup Pusher
  useEffect(() => {
    initialize();
    
    // Set up a timer to check connection every 30 seconds
    const connectionCheck = setInterval(() => {
      if (!pusherManager.isConnected()) {
        pusherManager.reconnect();
        initialize();
      }
    }, 30000);
    
    // Add periodic refresh to keep ticker data current
    const refreshInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        initialize();
      }
    }, 60000); // Refresh every 60 seconds
    
    return () => {
      clearInterval(connectionCheck);
      clearInterval(refreshInterval);
      pusherManager.unsubscribe('pixel-placed', handlePixelPlaced);
    };
  }, [getAccessToken]);

  // Set up page visibility handling
  useEffect(() => {
    const handleVisChange = () => {
      setIsVisible(document.visibilityState === 'visible');
    };
    
    document.addEventListener('visibilitychange', handleVisChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisChange);
    };
  }, []);

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

  // If there's no data or the page isn't visible, don't render anything
  if (!isVisible || (users.length === 0 && users24h.length === 0)) {
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