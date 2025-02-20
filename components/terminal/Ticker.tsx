'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { pusherClient } from '@/lib/client/pusher';  // Note: direct import

interface TopUser {
  wallet_address: string;
  count: number;
  farcaster_username: string | null;
  farcaster_pfp: string | null;
}

const DEBUG = true;

export default function Ticker() {
  if (DEBUG) console.log('🎯 Ticker component rendering');
  
  const [users, setUsers] = useState<TopUser[]>([]);
  const [lastEvent, setLastEvent] = useState<string>('');

  // Simplified Pusher subscription
  useEffect(() => {
    console.log('🔄 Ticker: Setting up Pusher subscription');
    
    const channel = pusherClient.subscribe('canvas');
    
    channel.bind('pixel-placed', (data: { pixel: any; topUsers: TopUser[] }) => {
      console.log('📨 Ticker: Received update:', {
        usersCount: data.topUsers?.length,
        firstUser: data.topUsers?.[0]
      });
      
      // Directly update state with new top users data
      if (Array.isArray(data.topUsers) && data.topUsers.length > 0) {
        setUsers(data.topUsers);
        setLastEvent('Updated: ' + new Date().toISOString());
      }
    });

    // Initial data fetch
    fetch('/api/ticker')
      .then(res => res.json())
      .then(data => {
        console.log('📈 Ticker: Initial data loaded:', {
          count: data?.length,
          firstUser: data?.[0]
        });
        if (Array.isArray(data) && data.length > 0) {
          setUsers(data);
        }
      })
      .catch(error => {
        console.error('❌ Ticker: Failed to load initial data:', error);
      });

    return () => {
      console.log('🔄 Ticker: Cleaning up Pusher subscription');
      channel.unbind_all();
      channel.unsubscribe();
    };
  }, []);

  // Add debug logging for state updates
  useEffect(() => {
    console.log('👥 Ticker: Users state updated:', {
      count: users.length,
      firstUser: users[0],
      lastEvent
    });
  }, [users, lastEvent]);

  const formatUser = (user: TopUser, index: number) => (
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
  );

  if (!users || users.length === 0) {
    return null;
  }

  return (
    <div className="w-full overflow-hidden whitespace-nowrap text-xs">
      <div 
        className="h-10 overflow-hidden whitespace-nowrap py-1 text-xs relative w-full"
      >
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