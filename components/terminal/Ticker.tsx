'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Image from 'next/image';
import type { Pixel } from '@/types/database';

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
  return Math.floor(seconds) + 's';
}

export default function Ticker() {
  const [pixels, setPixels] = useState<Pixel[]>([]);
  const [tick, setTick] = useState(0);

  // Update time displays every second
  useEffect(() => {
    const timer = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const fetchRecentPixels = async () => {
      const { data } = await supabase
        .from('pixels')
        .select('*')
        .order('placed_at', { ascending: false })
        .limit(10);

      if (data) {
        setPixels(data);
      }
    };

    fetchRecentPixels();

    // Subscribe to new pixel placements
    const channel = supabase
      .channel('pixels')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'pixels',
        },
        (payload) => {
          setPixels(prev => [payload.new as Pixel, ...prev.slice(0, 9)]);
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, []);

  const formatMessage = (pixel: Pixel, currentTime: number) => {
    const timeSince = getTimeSince(pixel.placed_at);
    const seconds = Math.floor((Date.now() - new Date(pixel.placed_at).getTime()) / 1000);
    
    return (
      <span key={`${pixel.id}-${currentTime}`} className="inline-flex items-center whitespace-nowrap gap-2">
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
        <a 
          href={`https://basescan.org/address/${pixel.wallet_address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300"
        >
          {`${pixel.wallet_address.slice(0, 6)}...${pixel.wallet_address.slice(-4)}`}
        </a>
        <span className="text-gray-400">placed</span>
        <span style={{ color: pixel.color }}>pixel</span>
        <span className="text-gray-400">at</span>
        <span className="text-green-400">({pixel.x}, {pixel.y})</span>
        <span className="text-[#FFD700]">●</span>
      </span>
    );
  };

  return (
    <div className="h-10 overflow-hidden whitespace-nowrap py-1 text-xs">
      <div className="animate-ticker inline-block">
        {pixels.map(pixel => formatMessage(pixel, Date.now()))}
        {pixels.map(pixel => formatMessage(pixel, Date.now()))}
      </div>
    </div>
  );
} 