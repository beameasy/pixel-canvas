'use client';

import React, { useEffect, useState } from 'react';
import { useTerminalMessages } from '@/lib/hooks/useTerminalMessages';
import { supabase } from '@/lib/supabase';
import Image from 'next/image';

function getTimeSince(date: string) {
  const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);
  let interval = seconds / 31536000;

  if (interval > 1) return Math.floor(interval) + 'y';
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + 'mo';
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + 'd';
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + 'h';
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + 'm';
  return seconds + 's';
}

export default function Ticker() {
  const [initialLoad, setInitialLoad] = useState(true);
  const { messages, loading } = useTerminalMessages(10, 0, false);
  const [tickerText, setTickerText] = useState<React.ReactNode[]>([]);
  const [time, setTime] = useState(Date.now());

  // Update time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setTime(Date.now());
      setTickerText(current => 
        messages.map(msg => formatMessage(msg, Date.now()))
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [messages]);

  const formatMessage = (msg: any, currentTime: number) => {
    const coords = msg.message.match(/\((\d+),\s*(\d+)\)/);
    const x = coords?.[1] || '';
    const y = coords?.[2] || '';
    
    // Extract color from message - match the Terminal component's pattern
    const colorMatch = msg.message.match(/a (#[A-Fa-f0-9]{6}) pixel/);
    const pixelColor = colorMatch?.[1] || '#000000';
    
    const displayName = msg.farcaster_username 
      ? `@${msg.farcaster_username}` 
      : `${msg.wallet_address.slice(0, 6)}...${msg.wallet_address.slice(-4)}`;
    
    const timeSince = getTimeSince(msg.created_at);
    const seconds = Math.floor((Date.now() - new Date(msg.created_at).getTime()) / 1000);
    
    return (
      <span key={`${msg.id}-${currentTime}`} className="inline-flex items-center whitespace-nowrap gap-2">
        <span className={`${
          seconds < 60 
            ? 'text-green-400 animate-pulse' 
            : seconds < 3600 
              ? 'text-blue-400' 
              : 'text-gray-400'
        } w-[4ch] text-right`}>
          {timeSince}
        </span>
        <span className="text-gray-400">→</span>
        {msg.farcaster_pfp && (
          <Image
            src={msg.farcaster_pfp}
            alt={displayName}
            width={14}
            height={14}
            className="rounded-full"
          />
        )}
        {msg.farcaster_username ? (
          <a 
            href={`https://warpcast.com/${msg.farcaster_username}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300"
          >
            {displayName}
          </a>
        ) : (
          <span className="text-blue-400">{displayName}</span>
        )}
        <span className="text-gray-400">placed</span>
        <span style={{ color: pixelColor }}>pixel</span>
        <span className="text-gray-400">at</span>
        <span className="text-green-400">({x}, {y})</span>
        <span className="text-[#FFD700]">●</span>
      </span>
    );
  };

  // Initial load of messages
  useEffect(() => {
    async function loadInitialMessages() {
      const { data } = await supabase
        .from('terminal_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);
      
      if (data) {
        const elements = data.map(msg => formatMessage(msg, Date.now()));
        setTickerText(elements);
        setInitialLoad(false);
      }
    }

    loadInitialMessages();
  }, []);

  // Handle real-time updates
  useEffect(() => {
    if (!loading && messages.length > 0 && !initialLoad) {
      const elements = messages.map(msg => formatMessage(msg, Date.now()));
      setTickerText(elements);
    }
  }, [messages, loading, initialLoad]);

  if (tickerText.length === 0) return null;

  return (
    <div className="fixed top-0 left-0 right-0 bg-slate-900/90 overflow-hidden whitespace-nowrap py-1 z-40 text-xs">
      <div className="animate-ticker inline-block">
        {tickerText}
        {tickerText}
      </div>
    </div>
  );
} 