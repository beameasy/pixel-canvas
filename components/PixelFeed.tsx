'use client';

import { useEffect, useState } from 'react';
import { pusherManager } from '@/lib/client/pusherManager';
import { motion, AnimatePresence } from 'framer-motion';

interface PixelPlacement {
  id: string;
  x: number;
  y: number;
  color: string;
  wallet_address: string;
  farcaster_username: string | null;
  placed_at: string;
}

function LiveTimeAgo({ date }: { date: Date }) {
  const [timeAgoText, setTimeAgoText] = useState('');

  useEffect(() => {
    const updateTime = () => {
      const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
      if (seconds < 60) setTimeAgoText(`${seconds}s`);
      else if (seconds < 3600) setTimeAgoText(`${Math.floor(seconds / 60)}m`);
      else if (seconds < 86400) setTimeAgoText(`${Math.floor(seconds / 3600)}h`);
      else setTimeAgoText(`${Math.floor(seconds / 86400)}d`);
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, [date]);

  return <span>{timeAgoText}</span>;
}

function PlacementMessage({ placement }: { placement: PixelPlacement }) {
  return (
    <motion.span
      initial={{ scale: 1 }}
      animate={{ scale: [1, 1.02, 1] }}
      transition={{ duration: 0.2 }}
    >
      <LiveTimeAgo date={new Date(placement.placed_at)} />{' '}
      <a 
        href={placement.farcaster_username 
          ? `https://warpcast.com/${placement.farcaster_username}`
          : `https://basescan.org/address/${placement.wallet_address}`
        }
        target="_blank"
        rel="noopener noreferrer"
        className={`${
          placement.farcaster_username ? "text-purple-400 hover:text-purple-300" : "text-blue-400 hover:text-blue-300"
        }`}
      >
        {placement.farcaster_username ? 
          `@${placement.farcaster_username}` : 
          `${placement.wallet_address.slice(0, 4)}...${placement.wallet_address.slice(-4)}`
        }
      </a>
      {` at `}
      <span style={{ color: placement.color }}>({placement.x}, {placement.y})</span>
    </motion.span>
  );
}

export default function PixelFeed() {
  const [placements, setPlacements] = useState<PixelPlacement[]>([]);

  useEffect(() => {
    let mounted = true;

    const handlePixelPlaced = (data: { pixel: PixelPlacement }) => {
      if (!mounted) return;
      setPlacements(prev => [data.pixel, ...prev].slice(0, 6));
    };

    const fetchInitialData = async () => {
      if (!mounted) return;
      try {
        const response = await fetch('/api/pixels/history?limit=6', {
          cache: 'no-cache',
          headers: {
            'Cache-Control': 'no-cache'
          }
        });
        
        if (!response.ok) throw new Error('Failed to fetch');
        
        const history = await response.json();
        if (!mounted) return;
        
        const recentPixels = history
          .map((pixel: string | PixelPlacement) => 
            typeof pixel === 'string' ? JSON.parse(pixel) : pixel
          );
        setPlacements(recentPixels);
      } catch (error) {
        console.error('Failed to fetch recent pixels:', error);
      }
    };

    fetchInitialData();
    pusherManager.subscribe('pixel-placed', handlePixelPlaced);
    
    return () => {
      mounted = false;
      pusherManager.unsubscribe('pixel-placed', handlePixelPlaced);
    };
  }, []);

  return (
    <div className="w-full max-w-[600px] mx-auto mb-1 font-mono text-[10px] sm:text-xs flex flex-col items-center h-24">
      <AnimatePresence>
        {Array.from({ length: Math.ceil(placements.length / 2) }).map((_, rowIndex) => {
          const leftPlacement = placements[rowIndex * 2];
          const rightPlacement = placements[rowIndex * 2 + 1];
          
          return (
            <motion.div
              key={leftPlacement.id}
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1 - rowIndex * 0.2, y: rowIndex * 20 }}
              exit={{ opacity: 0, y: 60 }}
              transition={{ duration: 0.2 }}
              className="text-slate-300 whitespace-nowrap px-2 absolute"
            >
              <motion.div
                initial={{ scale: 1, rotate: 0 }}
                animate={{ scale: [1, 1.05, 1], rotate: [0, -1, 1, 0] }}
                transition={{ duration: 0.5 }}
              >
                <PlacementMessage placement={leftPlacement} />
                {rightPlacement && (
                  <>
                    <span className="text-slate-400">, </span>
                    <PlacementMessage placement={rightPlacement} />
                  </>
                )}
              </motion.div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
} 