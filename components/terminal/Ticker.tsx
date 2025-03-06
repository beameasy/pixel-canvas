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

// Updated activity spike interface
interface ActivitySpike {
  count: number;      // Number of pixels placed in that timeframe
  timeWindow: number; // Time window in minutes
  intensity: number;  // 1-5 scale for vibration intensity
}

const DEBUG = false; // Reduce debug logging

export default function Ticker() {
  const { getAccessToken } = usePrivy();
  if (DEBUG) console.log('🎯 Ticker component rendering');
  
  const [users, setUsers] = useState<TopUser[]>([]);
  const [activitySpikes, setActivitySpikes] = useState<ActivitySpike[]>([]);
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
  }, [users, activitySpikes]);

  // Format user with memoization
  const formatUser = useCallback((user: TopUser, index: number) => (
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
      <span className="text-[#FFD700] ml-1">
        - {user.count} {user.count === 1 ? 'pixel' : 'pixels'}
      </span>
    </span>
  ), []);

  // Format activity spikes with color intensity
  const formatActivitySpike = useCallback((spike: ActivitySpike, index: number) => {
    const intensityClass = `activity-intensity-${spike.intensity}`;
    
    // Color gets more red as intensity increases
    let textColorClass;
    if (spike.intensity <= 2) {
      textColorClass = "text-amber-400"; // Yellow/amber for low intensity
    } else if (spike.intensity === 3) {
      textColorClass = "text-orange-400"; // Orange for medium intensity
    } else if (spike.intensity === 4) {
      textColorClass = "text-orange-600"; // Darker orange for higher intensity
    } else {
      textColorClass = "text-red-500"; // Red for highest intensity
    }
    
    let message;
    if (spike.intensity <= 2) {
      message = `${spike.count} pixels in ${spike.timeWindow} ${spike.timeWindow === 1 ? 'min' : 'mins'}`;
    } else if (spike.intensity === 3) {
      message = `Whoa! ${spike.count} pixels in just ${spike.timeWindow} ${spike.timeWindow === 1 ? 'min' : 'mins'}!`;
    } else if (spike.intensity === 4) {
      message = `HOT! ${spike.count} pixels in ${spike.timeWindow} ${spike.timeWindow === 1 ? 'min' : 'mins'}!`;
    } else {
      message = `INSANE ACTIVITY! ${spike.count} PIXELS!`;
    }
    
    return (
      <span 
        key={`spike-${index}-${spike.count}`} 
        className={`ticker-item font-bold ${intensityClass} ${textColorClass}`}
      >
        * {message} *
      </span>
    );
  }, []);

  // Fetch data and handle updates
  useEffect(() => {
    const handlePixelPlaced = (data: { topUsers: TopUser[], activitySpikes?: ActivitySpike[] }) => {
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
      
      if (data.activitySpikes !== undefined) {
        setActivitySpikes(data.activitySpikes);
        if (DEBUG) console.log('📈 Activity spikes updated:', data.activitySpikes);
      }
    };

    const initialize = async () => {
      try {
        const token = await getAccessToken();
        const [tickerResponse, activityResponse] = await Promise.all([
          fetch('/api/ticker', {
            headers: {
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache',
              'x-privy-token': token || ''
            }
          }),
          fetch('/api/pixels/activity', {
            headers: {
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache'
            }
          })
        ]);
        
        const tickerData = await tickerResponse.json();
        if (Array.isArray(tickerData) && tickerData.length > 0) {
          setUsers(tickerData);
          if (DEBUG) console.log('📊 Initial user data loaded:', tickerData);
        }
        
        const activityData = await activityResponse.json();
        if (Array.isArray(activityData) && activityData.length > 0) {
          setActivitySpikes(activityData);
          if (DEBUG) console.log('📈 Initial activity data loaded:', activityData);
        }
      } catch (error) {
        console.error('Failed to load initial ticker data:', error);
      }

      if (!pusherManager.isConnected()) {
        console.log('🔄 Ticker: Reconnecting Pusher');
        pusherManager.reconnect();
      }
      
      pusherManager.subscribe('pixel-placed', handlePixelPlaced);
      setIsConnected(true);
    };

    initialize();

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

    return () => {
      clearInterval(connectionCheck);
      pusherManager.unsubscribe('pixel-placed', handlePixelPlaced);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [getAccessToken]);

  // Auto-expire activity spikes after 5 minutes
  useEffect(() => {
    if (activitySpikes.length === 0) return;
    
    const timeout = setTimeout(() => {
      if (DEBUG) console.log('⏱️ Auto-expiring activity spikes');
      setActivitySpikes([]);
    }, 5 * 60 * 1000);
    
    return () => clearTimeout(timeout);
  }, [activitySpikes]);

  // Update users with a smooth transition
  useEffect(() => {
    if (users.length > 0) {
      setIsUpdating(true);
      const timer = setTimeout(() => {
        setIsUpdating(false);
      }, 300); // Short delay to allow CSS transition to complete
      return () => clearTimeout(timer);
    }
  }, [users]);

  // Update the ticker styles with transitions
  const tickerStyle = {
    transition: isUpdating ? 'none' : 'all 0.3s ease-out',
    opacity: isUpdating ? 0.9 : 1,
  };

  // If we have no data at all, don't render
  if (!users || users.length === 0) {
    return null;
  }

  return (
    <div className="w-full overflow-hidden text-xs ticker-wrapper">
      <div className="ticker-track" style={tickerStyle}>
        {/* Repeating content */}
        {[1, 2, 3].map((_, idx) => (
          <div key={idx} className="ticker-content">
            {/* Diamond */}
            <span className="ticker-diamond">◆</span>
            
            {/* Activity spike section */}
            {activitySpikes && activitySpikes.length > 0 && (
              <>
                <span className="ticker-header">* ACTIVITY SPIKE *</span>
                {activitySpikes.map((spike, index) => formatActivitySpike(spike, index))}
                <span className="ticker-diamond">◆</span>
              </>
            )}
            
            {/* Users section */}
            {users && users.length > 0 && (
              <>
                <span className="ticker-header">TOP 10 USERS - LAST HOUR</span>
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
          </div>
        ))}
      </div>
      
      <style jsx>{`
        .ticker-wrapper {
          height: 24px;
          position: relative;
          display: flex;
          align-items: center;
          background-color: #111827;
        }
        
        .ticker-track {
          display: flex;
          white-space: nowrap;
          will-change: transform;
          animation: ticker 20s linear infinite;
          transform: translateZ(0);
          backface-visibility: hidden;
        }
        
        .ticker-content {
          display: inline-flex;
          align-items: center;
          flex-shrink: 0;
          padding-right: 100px;
        }
        
        .ticker-diamond {
          color: white;
          margin: 0 16px;
          flex-shrink: 0;
        }
        
        .ticker-header {
          color: white;
          font-weight: bold;
          margin-right: 16px;
          flex-shrink: 0;
        }
        
        .ticker-dot {
          color: #4b5563;
          margin: 0 6px;
          flex-shrink: 0;
        }
        
        :global(.ticker-item) {
          display: inline-flex;
          align-items: center;
          margin: 0 8px;
          flex-shrink: 0;
        }
        
        @keyframes ticker {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-33.33%);
          }
        }
        
        @media (min-width: 1024px) {
          .ticker-track {
            animation-duration: 24s;
          }
        }
        
        @media (min-width: 1536px) {
          .ticker-track {
            animation-duration: 28s;
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