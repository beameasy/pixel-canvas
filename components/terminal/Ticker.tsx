'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import { pusherManager } from '@/lib/client/pusherManager';

interface TopUser {
  wallet_address: string;
  count: number;  // Total number of pixels placed in last hour (including duplicates)
  farcaster_username: string | null;
  farcaster_pfp: string | null;
}

const DEBUG = false; // Reduce debug logging

export default function Ticker() {
  if (DEBUG) console.log('🎯 Ticker component rendering');
  
  const [users, setUsers] = useState<TopUser[]>([]);
  const [lastEvent, setLastEvent] = useState<string>('');

  // Add connection state
  const [isConnected, setIsConnected] = useState(false);

  // Memoize the formatUser function
  const formatUser = useCallback((user: TopUser, index: number) => (
    <span 
      key={`${user.wallet_address}-${user.count}-${index}`}
      className="inline-flex items-center whitespace-nowrap gap-2"
    >
      {index === 0 && (
        <span className="text-white mr-4">* TOP 10 USERs - LAST HOUR *</span>
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
  ), []); // No dependencies since it doesn't use any external values

  useEffect(() => {
    const handlePixelPlaced = (data: { topUsers: TopUser[] }) => {
      if (DEBUG) console.log('📊 Received pixel-placed event:', data);
      if (Array.isArray(data.topUsers) && data.topUsers.length > 0) {
        setUsers(data.topUsers);
      }
    };

    // Fetch initial data and set up Pusher subscription
    const initialize = async () => {
      try {
        const response = await fetch('/api/ticker', {
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          setUsers(data);
          if (DEBUG) console.log('📊 Initial data loaded:', data);
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
  }, []);

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

  if (!users || users.length === 0) {
    return null;
  }

  return (
    <div className="w-full overflow-hidden whitespace-nowrap text-xs">
      <div className="h-6 overflow-hidden whitespace-nowrap py-1 text-xs relative w-full">
        <div className="ticker-content">
          <div className="inline-block">
            {users.map((user, i) => formatUser(user, i))}
          </div>
        </div>
        <style jsx>{`
          .ticker-content {
            display: inline-block;
            white-space: nowrap;
            position: relative;
            animation: ticker 15s linear infinite;
          }

          @keyframes ticker {
            0% {
              transform: translateX(100vw);
            }
            100% {
              transform: translateX(-100%);
            }
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