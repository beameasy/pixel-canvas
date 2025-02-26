'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import { pusherManager } from '@/lib/client/pusherManager';
import { usePrivy } from '@privy-io/react-auth';

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
  const [lastEvent, setLastEvent] = useState<string>('');

  // Add connection state
  const [isConnected, setIsConnected] = useState(false);

  // Memoize the formatUser function
  const formatUser = useCallback((user: TopUser, index: number) => (
    <span 
      key={`user-${user.wallet_address}-${index}`}
      className="inline-flex items-center whitespace-nowrap gap-2"
    >
      {index === 0 && (
        <span className="text-white mx-6">* TOP 10 USERS - LAST HOUR *</span>
      )}
      <span className="text-gray-400">{index + 1}.</span>
      {user.farcaster_pfp && (
        <Image
          src={user.farcaster_pfp}
          alt={user.farcaster_username || user.wallet_address}
          width={16}
          height={16}
          className="rounded-full"
        />
      )}
      {user.farcaster_username ? (
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
      <span className="text-white mx-4">◆</span>
    </span>
  ), []);

  // Format activity spikes with progressive vibration
  const formatActivitySpikes = useCallback(() => {
    if (!activitySpikes || activitySpikes.length === 0) return null;
    
    return (
      <>
        {activitySpikes.map((spike, index) => {
          // Create class names based on intensity
          const intensityClass = `activity-intensity-${spike.intensity}`;
          
          // Choose message based on intensity
          let message;
          if (spike.intensity <= 2) {
            message = `${spike.count} pixels in ${spike.timeWindow} ${spike.timeWindow === 1 ? 'min' : 'mins'}`;
          } else if (spike.intensity === 3) {
            message = `Whoa! ${spike.count} pixels in just ${spike.timeWindow} ${spike.timeWindow === 1 ? 'min' : 'mins'}!`;
          } else if (spike.intensity === 4) {
            message = `HOT! ${spike.count} pixels flooding in!`;
          } else {
            message = `INSANE ACTIVITY! ${spike.count} PIXELS!`;
          }
          
          return (
            <span 
              key={`spike-${index}-${spike.count}`} 
              className="inline-flex items-center whitespace-nowrap gap-2 ml-2"
            >
              {index === 0 && (
                <span className="text-white mx-6 font-bold">* ACTIVITY SPIKE *</span>
              )}
              <span className={`text-amber-400 font-bold ${intensityClass}`}>
                {message}
              </span>
              <span className="text-white mx-6">◆</span>
            </span>
          );
        })}
      </>
    );
  }, [activitySpikes]);

  useEffect(() => {
    const handlePixelPlaced = (data: { topUsers: TopUser[], activitySpikes?: ActivitySpike[] }) => {
      if (DEBUG) console.log('📊 Received pixel-placed event:', data);
      if (Array.isArray(data.topUsers) && data.topUsers.length > 0) {
        // Preserve existing Farcaster data if the new data lacks it
        setUsers(prevUsers => {
          if (!prevUsers || prevUsers.length === 0) return data.topUsers;
          
          return data.topUsers.map(newUser => {
            // Try to find this user in previous state to preserve Farcaster data
            const prevUser = prevUsers.find(p => p.wallet_address === newUser.wallet_address);
            
            // If new user already has Farcaster data, use it
            if (newUser.farcaster_username || newUser.farcaster_pfp) {
              return newUser;
            }
            
            // Otherwise, use previous data if available
            if (prevUser && (prevUser.farcaster_username || prevUser.farcaster_pfp)) {
              return {
                ...newUser,
                farcaster_username: prevUser.farcaster_username,
                farcaster_pfp: prevUser.farcaster_pfp
              };
            }
            
            // Default to new user data
            return newUser;
          });
        });
      }
      
      // Always update activity spikes, even when empty
      // This ensures spikes are cleared when no longer warranted
      if (data.activitySpikes !== undefined) {
        setActivitySpikes(data.activitySpikes);
        if (DEBUG) console.log('📈 Activity spikes updated:', data.activitySpikes);
      }
    };

    // Updated initialize function with auth
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

      // Check connection and force reconnect if needed
      if (!pusherManager.isConnected()) {
        console.log('🔄 Ticker: Reconnecting Pusher');
        pusherManager.reconnect();
      }
      
      // Subscribe after ensuring connection
      pusherManager.subscribe('pixel-placed', handlePixelPlaced);
    };

    // Run initialize immediately
    initialize();

    // Set up an interval to check connection status
    const connectionCheck = setInterval(() => {
      if (!pusherManager.isConnected()) {
        console.log('🔄 Ticker: Connection lost, reconnecting...');
        pusherManager.reconnect();
        initialize(); // Re-initialize after reconnect
      }
    }, 30000); // Check every 30 seconds

    return () => {
      clearInterval(connectionCheck);
      pusherManager.unsubscribe('pixel-placed', handlePixelPlaced);
    };
  }, [getAccessToken]);

  // Debug logging only when needed
  useEffect(() => {
    if (DEBUG) {
      console.log('👥 Ticker: Users state updated:', {
        count: users.length,
        firstUser: users[0],
        lastEvent
      });
    }
  }, [users, lastEvent]);

  // Add a cleanup effect to remove activity spikes after a timeout period
  // This serves as a fallback in case server doesn't send empty updates
  useEffect(() => {
    // Only set timeout if we have activity spikes
    if (activitySpikes.length === 0) return;
    
    // Auto-expire activity spikes after 5 minutes if not updated
    const timeout = setTimeout(() => {
      if (DEBUG) console.log('⏱️ Auto-expiring activity spikes');
      setActivitySpikes([]);
    }, 5 * 60 * 1000);
    
    return () => clearTimeout(timeout);
  }, [activitySpikes]);

  // If we have no data at all, don't render
  if ((!users || users.length === 0) && (!activitySpikes || activitySpikes.length === 0)) {
    return null;
  }

  return (
    <div className="w-full overflow-hidden text-xs">
      <div className="h-6 overflow-hidden py-1 text-xs relative w-full">
        <div className="ticker-container w-full relative overflow-hidden">
          <div className="ticker-content inline-flex whitespace-nowrap">
            {/* First copy of content */}
            <div className="inline-flex items-center">
              {formatActivitySpikes()}
              <span className="mx-4"></span>
              {users.map((user, i) => formatUser(user, i))}
            </div>
            
            {/* Second copy to create seamless loop */}
            <div className="inline-flex items-center">
              {formatActivitySpikes()}
              <span className="mx-4"></span>
              {users.map((user, i) => formatUser(user, i))}
            </div>
          </div>
        </div>
        <style jsx global>{`
          .ticker-container {
            overflow: hidden;
            white-space: nowrap;
          }
          
          .ticker-content {
            animation: ticker 30s linear infinite;
          }
          
          @keyframes ticker {
            0% {
              transform: translateX(0);
            }
            100% {
              transform: translateX(-50%);
            }
          }
          
          /* Add flashing animation */
          .flash-text {
            animation: flash-animation 1s linear infinite;
          }
          
          @keyframes flash-animation {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
          }
          
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
          
          @media (min-width: 1024px) {
            .ticker-content {
              animation-duration: 35s;
            }
          }
          
          @media (min-width: 1536px) {
            .ticker-content {
              animation-duration: 45s;
            }
          }
        `}</style>
      </div>
    </div>
  );
}