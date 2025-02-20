'use client';

import { useEffect, useState } from 'react';
import { pusherManager } from '@/lib/client/pusherManager';
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

  useEffect(() => {
    const handlePixelPlaced = (data: { pixel: PixelPlacement }) => {
      setPlacements(prev => [data.pixel, ...prev].slice(0, 3));
    };

    const fetchInitialData = async () => {
      try {
        const response = await fetch('/api/pixels/history');
        const history = await response.json();
        const recentPixels = history
          .slice(-3)
          .map((pixel: string | PixelPlacement) => 
            typeof pixel === 'string' ? JSON.parse(pixel) : pixel
          )
          .reverse();
        setPlacements(recentPixels);
      } catch (error) {
        console.error('Failed to fetch recent pixels:', error);
      }
    };

    // Subscribe to events
    pusherManager.subscribe('pixel-placed', handlePixelPlaced);
    pusherManager.subscribe('subscription_succeeded', fetchInitialData);

    // Initial data fetch
    fetchInitialData();

    return () => {
      pusherManager.unsubscribe('pixel-placed', handlePixelPlaced);
      pusherManager.unsubscribe('subscription_succeeded', fetchInitialData);
    };
  }, []);

  return (
    <div className="w-full max-w-[600px] mx-auto mb-1 font-mono text-[10px] sm:text-xs flex flex-col items-center h-16">
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