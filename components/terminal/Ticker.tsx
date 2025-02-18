'use client';

import React, { useEffect, useState, useRef } from 'react';
import Image from 'next/image';
import { pusherClient } from '@/lib/client/pusher';

interface TopUser {
  wallet_address: string;
  count: number;
  farcaster_username: string | null;
  farcaster_pfp: string | null;
}

export default function Ticker() {
  const [users, setUsers] = useState<TopUser[]>([]);
  const tickerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Pusher subscription and data fetching
  useEffect(() => {
    const channel = pusherClient.subscribe('canvas');
    
    channel.bind('pixel-placed', (data: { pixel: any; topUsers: TopUser[] }) => {
      if (Array.isArray(data.topUsers)) {
        setUsers(data.topUsers);
      }
    });

    fetch('/api/ticker')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setUsers(data);
        }
      })
      .catch(error => console.error('❌ Error fetching ticker:', error));

    return () => {
      channel.unbind_all();
      channel.unsubscribe();
    };
  }, []);

  const formatUser = (user: TopUser, index: number) => (
    <span 
      key={`${user.wallet_address}-${index}`}
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
        ref={tickerRef} 
        className="h-10 overflow-hidden whitespace-nowrap py-1 text-xs relative w-full"
      >
        <div className="ticker-content" ref={contentRef}>
          {users.map((user, i) => formatUser(user, i))}
        </div>
        <style jsx>{`
          .ticker-content {
            display: inline-block;
            white-space: nowrap;
            position: relative;
            transform: translateX(100vw);
            animation: ticker 35s linear infinite;
            animation-play-state: running;
            will-change: transform;
            animation-fill-mode: forwards;
          }

          @keyframes ticker {
            to {
              transform: translateX(-100%);
            }
          }

          @media (min-width: 1024px) {
            .ticker-content {
              animation-duration: 45s;
            }
          }

          @media (min-width: 1536px) {
            .ticker-content {
              animation-duration: 55s;
            }
          }
        `}</style>
      </div>
    </div>
  );
}