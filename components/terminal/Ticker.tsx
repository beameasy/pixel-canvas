'use client';

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Image from 'next/image';
import { pusherManager } from '@/lib/client/pusherManager';
import { usePrivy } from '@privy-io/react-auth';
import FarcasterLogo from '@/components/ui/FarcasterLogo';

interface TopUser {
  wallet_address: string;
  count: number;  // Total number of pixels placed in last hour (including duplicates)
  farcaster_username: string | null;
  farcaster_pfp: string | null;
}

// We'll replace the ActivitySpike interface with a 24-hour users interface
interface TopUser24Hours {
  wallet_address: string;
  count: number;  // Total number of pixels placed in last 24 hours
  farcaster_username: string | null;
  farcaster_pfp: string | null;
}

const DEBUG = false; // Reduce debug logging

export default function Ticker() {
  const { getAccessToken } = usePrivy();
  if (DEBUG) console.log('🎯 Ticker component rendering');
  
  const [users, setUsers] = useState<TopUser[]>([]);
  // Replace activity spikes with 24h user data
  const [users24h, setUsers24h] = useState<TopUser24Hours[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [contentWidth, setContentWidth] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // Measure content width after render for proper animation
  useEffect(() => {
    if (contentRef.current) {
      // Use requestAnimationFrame to ensure smooth layout updates
      requestAnimationFrame(() => {
        setContentWidth(contentRef.current?.scrollWidth || 0);
      });
    }
  }, [users, users24h]);

  // Format user with CSS classes
  const formatUser = useCallback((user: TopUser, index: number) => {
    return (
      <span 
        key={`user-${user.wallet_address}-${index}`}
        className="ticker-item"
      >
        <span className="text-gray-400 mr-1">{index + 1}.</span>
        {user.farcaster_pfp && user.farcaster_pfp !== 'null' && (
          <span className="inline-flex items-center gap-2">
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
            className="text-purple-400 hover:text-purple-300 transition-colors ml-1"
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
        <span className="text-[#4ADE80] ml-1">
          - {user.count} {user.count === 1 ? 'pixel' : 'pixels'}
        </span>
      </span>
    );
  }, []);
  
  // Format a top user for the 24-hour period
  const formatUser24h = useCallback((user: TopUser24Hours, index: number) => {
    return (
      <span 
        key={`user24h-${user.wallet_address}-${index}`}
        className="ticker-item"
      >
        <span className="text-gray-400 mr-1">{index + 1}.</span>
        {user.farcaster_pfp && user.farcaster_pfp !== 'null' && (
          <span className="inline-flex items-center gap-2">
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
            className="text-purple-400 hover:text-purple-300 transition-colors ml-1"
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
        <span className="text-[#FFD700] ml-1">
          - {user.count} {user.count === 1 ? 'pixel' : 'pixels'}
        </span>
      </span>
    );
  }, []);

  const handlePixelPlaced = (data: { topUsers: TopUser[], topUsers24h?: TopUser24Hours[] }) => {
    if (DEBUG) console.log('📊 Received pixel-placed event:', data);
    
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
    
    // Update 24h users if provided
    if (data.topUsers24h && Array.isArray(data.topUsers24h) && data.topUsers24h.length > 0) {
      setUsers24h(data.topUsers24h);
      if (DEBUG) console.log('📊 24-hour users updated:', data.topUsers24h);
    }
  };

  const initialize = async () => {
    if (DEBUG) console.log('🚀 Ticker: Initializing...');
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
        if (DEBUG) console.log('📊 Initial user data loaded:', tickerData);
      }
      
      const users24hData = await users24hResponse.json();
      if (Array.isArray(users24hData) && users24hData.length > 0) {
        setUsers24h(users24hData);
        if (DEBUG) console.log('📊 Initial 24h user data loaded:', users24hData);
      }
    } catch (error) {
      console.error('Failed to load initial ticker data:', error);
    }

    // Always ensure Pusher is connected
    if (!pusherManager.isConnected()) {
      console.log('🔄 Ticker: Connecting Pusher');
      pusherManager.reconnect();
    }
    
    pusherManager.subscribe('pixel-placed', handlePixelPlaced);
    setIsConnected(true);
  };

  // Fetch data and handle updates
  useEffect(() => {
    // Initialize immediately
    initialize();

    // Set up a timer to check connection every 30 seconds
    const connectionCheck = setInterval(() => {
      if (!pusherManager.isConnected()) {
        console.log('🔄 Ticker: Connection lost, reconnecting...');
        pusherManager.reconnect();
        initialize();
        setIsConnected(false);
      }
    }, 30000);
    
    // Add visibility change handler
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('🔄 Ticker: Tab became visible, checking connection');
        if (!pusherManager.isConnected()) {
          console.log('🔄 Ticker: Reconnecting Pusher after tab became visible');
          pusherManager.reconnect();
          initialize();
          setIsConnected(false);
        }
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Also set up a handler for when the page loads or reloads
    const handleLoad = () => {
      console.log('🔄 Ticker: Page loaded, initializing ticker');
      initialize();
    };
    
    // Add periodic refresh to keep ticker data current
    const refreshInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        console.log('🔄 Ticker: Periodic refresh');
        initialize();
      }
    }, 60000); // Refresh every 60 seconds
    
    window.addEventListener('load', handleLoad);

    return () => {
      clearInterval(connectionCheck);
      pusherManager.unsubscribe('pixel-placed', handlePixelPlaced);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('load', handleLoad);
      clearInterval(refreshInterval); // Clean up the interval
    };
  }, [getAccessToken]);

  // Auto-expire 24h user data after inactivity to refresh from API
  useEffect(() => {
    if (users24h.length === 0) return;
    
    const timeout = setTimeout(() => {
      if (DEBUG) console.log('⏱️ Auto-refreshing 24h data');
      initialize();
    }, 30 * 60 * 1000); // Refresh every 30 minutes
    
    return () => clearTimeout(timeout);
  }, [users24h]);

  // Debug code to check what data we're receiving
  useEffect(() => {
    console.log('Current 1h users data:', users);
  }, [users]);
  
  useEffect(() => {
    console.log('Current 24h users data:', users24h);
  }, [users24h]);
  
  // Update users with a smooth transition
  useEffect(() => {
    if (users.length > 0 || users24h.length > 0) {
      setIsUpdating(true);
      const timer = setTimeout(() => {
        setIsUpdating(false);
      }, 300); // Short delay to allow CSS transition to complete
      return () => clearTimeout(timer);
    }
  }, [users, users24h]);

  // Update the ticker styles with transitions
  const tickerStyle = {
    transition: isUpdating ? 'none' : 'all 0.3s ease-out',
    opacity: isUpdating ? 0.9 : 1,
  };

  // If we have no data at all, don't render
  if ((!users || users.length === 0) && (!users24h || users24h.length === 0)) {
    return null;
  }

  return (
    <div className="w-full overflow-hidden text-xs ticker-wrapper">
      <div className="ticker-container">
        <div className="ticker-track" style={tickerStyle}>
          {/* Duplicate the content multiple times to ensure continuous flow */}
          {[0, 1, 2].map((idx) => (
            <div key={`content-${idx}`} className="ticker-content">
              {/* Diamond */}
              <span className="ticker-diamond">◆</span>
              
              {/* 24h users section */}
              {users24h && users24h.length > 0 && (
                <>
                  <span className="ticker-header ticker-header-24h">TOP USERS - LAST 24 HOURS</span>
                  {users24h.map((user, index) => (
                    <React.Fragment key={`user24h-fragment-${index}`}>
                      {formatUser24h(user, index)}
                      {index < users24h.length - 1 && (
                        <span className="ticker-dot">•</span>
                      )}
                    </React.Fragment>
                  ))}
                </>
              )}
              
              {/* Middle diamond - ensures equal spacing between sections */}
              <span className="ticker-diamond">◆</span>
              
              {/* 1h users section */}
              {users && users.length > 0 && (
                <>
                  <span className="ticker-header ticker-header-1h">TOP USERS - LAST HOUR</span>
                  {users.map((user, index) => (
                    <React.Fragment key={`user-fragment-${index}`}>
                      {formatUser(user, index)}
                      {index < users.length - 1 && (
                        <span className="ticker-dot">•</span>
                      )}
                    </React.Fragment>
                  ))}
                </>
              )}
              
              {/* Ending diamond - makes spacing consistent */}
              <span className="ticker-diamond">◆</span>
            </div>
          ))}
        </div>
      </div>
      
      <style jsx>{`
        .ticker-wrapper {
          height: 24px;
          position: relative;
          display: flex;
          align-items: center;
          background-color: #111827;
          overflow: hidden;
        }
        
        .ticker-container {
          position: relative;
          width: 100%;
          height: 100%;
          overflow: hidden;
        }
        
        .ticker-track {
          display: flex;
          white-space: nowrap;
          animation: ticker 18s linear infinite;
        }
        
        .ticker-content {
          display: inline-flex;
          align-items: center;
          flex-shrink: 0;
        }
        
        .ticker-diamond {
          color: white;
          margin: 0 24px; /* Increased consistent margin */
          display: inline-block;
        }
        
        .ticker-dot {
          color: #666;
          margin: 0 8px;
          display: inline-block;
        }
        
        .ticker-header {
          font-weight: bold;
          margin-right: 16px;
          display: inline-block;
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
          margin-right: 12px;
        }
        
        @keyframes ticker {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-33.333%); /* Move exactly one full repetition */
          }
        }
        
        @media (min-width: 768px) {
          .ticker-track {
            animation-duration: 20s;
          }
        }
        
        @media (min-width: 1024px) {
          .ticker-track {
            animation-duration: 22s;
          }
        }
        
        @media (min-width: 1536px) {
          .ticker-track {
            animation-duration: 25s;
          }
        }
      `}</style>
      
      <style jsx global>{`
        /* Intensity-based vibration animations */
        .activity-intensity-1 {
          animation: vibrate1 0.5s infinite;
        }
        
        .activity-intensity-2 {
          animation: vibrate2 0.4s infinite;
        }
        
        .activity-intensity-3 {
          animation: vibrate3 0.3s infinite;
          color: #ffd700;
        }
        
        .activity-intensity-4 {
          animation: vibrate4 0.2s infinite;
          color: #ff8c00;
        }
        
        .activity-intensity-5 {
          animation: vibrate5 0.1s infinite;
          color: #ff4500;
          font-weight: bold;
        }
        
        @keyframes vibrate1 {
          0% { transform: translateX(0); }
          25% { transform: translateX(-1px); }
          75% { transform: translateX(1px); }
          100% { transform: translateX(0); }
        }
        
        @keyframes vibrate2 {
          0% { transform: translateX(0) translateY(0); }
          25% { transform: translateX(-1px) translateY(1px); }
          75% { transform: translateX(1px) translateY(-1px); }
          100% { transform: translateX(0) translateY(0); }
        }
        
        @keyframes vibrate3 {
          0% { transform: translateX(0) translateY(0); }
          25% { transform: translateX(-2px) translateY(1px); }
          75% { transform: translateX(2px) translateY(-1px); }
          100% { transform: translateX(0) translateY(0); }
        }
        
        @keyframes vibrate4 {
          0% { transform: translateX(0) translateY(0) rotate(0); }
          25% { transform: translateX(-2px) translateY(1px) rotate(-1deg); }
          75% { transform: translateX(2px) translateY(-1px) rotate(1deg); }
          100% { transform: translateX(0) translateY(0) rotate(0); }
        }
        
        @keyframes vibrate5 {
          0% { transform: translateX(0) translateY(0) rotate(0) scale(1); }
          25% { transform: translateX(-3px) translateY(1px) rotate(-1deg) scale(1.05); }
          75% { transform: translateX(3px) translateY(-1px) rotate(1deg) scale(1.05); }
          100% { transform: translateX(0) translateY(0) rotate(0) scale(1); }
        }
      `}</style>
    </div>
  );
}