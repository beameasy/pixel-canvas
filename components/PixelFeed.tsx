'use client';

import { useEffect, useState } from 'react';
import { pusherClient } from '@/lib/client/pusher';
import { timeAgo } from '@/lib/timeAgo';
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

export default function PixelFeed() {
  const [placements, setPlacements] = useState<PixelPlacement[]>([]);
  const [, setForceUpdate] = useState(0);
  
  useEffect(() => {
    // Fetch initial placements from history sorted set
    fetch('/api/pixels/history')
      .then(res => res.json())
      .then(history => {
        // Take last 3 entries and parse them
        const recentPixels = history
          .slice(-3)
          .map((pixel: string | PixelPlacement) => typeof pixel === 'string' ? JSON.parse(pixel) : pixel)
          .reverse();
        setPlacements(recentPixels);
      })
      .catch(error => {
        console.error('Failed to fetch recent pixels:', error);
      });

    const timer = setInterval(() => {
      setForceUpdate(n => n + 1);
    }, 1000);

    const channel = pusherClient.subscribe('canvas');
    
    channel.bind('pixel-placed', (data: { pixel: PixelPlacement }) => {
      setPlacements(prev => [data.pixel, ...prev].slice(0, 3));
    });

    return () => {
      clearInterval(timer);
      channel.unbind_all();
      channel.unsubscribe();
    };
  }, []);

  return (
    <div className="w-full max-w-[600px] mx-auto mb-2 sm:mb-4 font-mono text-[10px] sm:text-xs flex flex-col items-center h-20">
      <AnimatePresence>
        {placements.map((placement, index) => (
          <motion.div
            key={placement.id}
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1 - index * 0.2, y: index * 20 }}
            exit={{ opacity: 0, y: 60 }}
            transition={{ duration: 0.2 }}
            className="text-slate-300 whitespace-nowrap px-2 absolute"
          >
            <motion.span
              initial={{ scale: 1 }}
              animate={{ scale: [1, 1.02, 1] }}
              transition={{ duration: 0.2 }}
            >
              {`${timeAgo(new Date(placement.placed_at))} `}
              <span className={placement.farcaster_username ? "text-purple-400" : "text-blue-400"}>
                {placement.farcaster_username ? 
                  `@${placement.farcaster_username}` : 
                  `${placement.wallet_address.slice(0, 4)}...${placement.wallet_address.slice(-4)}`
                }
              </span>
              {` at `}
              <span className="text-emerald-400">({placement.x}, {placement.y})</span>
            </motion.span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
} 