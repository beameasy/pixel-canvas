'use client';

import { useEffect, useState } from 'react';
import { pusherManager } from '@/lib/client/pusherManager';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { usePrivy } from '@privy-io/react-auth';
import FarcasterLogo from '@/components/ui/FarcasterLogo';

interface PixelPlacement {
  id: string;
  x: number;
  y: number;
  color: string;
  wallet_address: string;
  farcaster_username: string | null;
  placed_at: string;
  farcaster_pfp?: string;
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
      className="inline-flex items-center gap-2"
    >
      <LiveTimeAgo date={new Date(placement.placed_at)} />{' '}
      <span className="inline-flex items-center gap-2">
        {placement.farcaster_pfp && placement.farcaster_pfp !== 'null' && (
          <>
            <FarcasterLogo className="text-purple-400" size="sm" />
            <Image
              src={placement.farcaster_pfp}
              alt={placement.farcaster_username || placement.wallet_address}
              width={16}
              height={16}
              className="rounded-full"
            />
          </>
        )}
        <a 
          href={placement.farcaster_username && placement.farcaster_username !== 'null'
            ? `https://warpcast.com/${placement.farcaster_username}`
            : `https://basescan.org/address/${placement.wallet_address}`
          }
          target="_blank"
          rel="noopener noreferrer"
          className={`${
            placement.farcaster_username && placement.farcaster_username !== 'null' ? "text-purple-400 hover:text-purple-300" : "text-blue-400 hover:text-blue-300"
          }`}
        >
          {placement.farcaster_username && placement.farcaster_username !== 'null' ? 
            `@${placement.farcaster_username}` : 
            `${placement.wallet_address.slice(0, 4)}...${placement.wallet_address.slice(-4)}`
          }
        </a>
      </span>
      {` at `}
      <span style={{ color: placement.color }}>({placement.x}, {placement.y})</span>
    </motion.span>
  );
}

export default function PixelFeed() {
  const { getAccessToken } = usePrivy();
  const [placements, setPlacements] = useState<PixelPlacement[]>([]);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    let mounted = true;
    
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 640);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    const handlePixelPlaced = (data: { pixel: PixelPlacement }) => {
      if (!mounted) return;
      
      const newPlacement = data.pixel;
      setPlacements(prev => {
        // Check for duplicates before adding
        if (prev.some(p => p.id === newPlacement.id)) {
          return prev;
        }
        return [newPlacement, ...prev].slice(0, 6); // Limit to 6 items
      });
    };
    
    const fetchInitialData = async () => {
      try {
        const token = await getAccessToken();
        
        // Use original endpoint that returns pixel history
        const response = await fetch('/api/pixels/history?limit=6', {
          headers: {
            'Cache-Control': 'no-cache',
            'x-privy-token': token || ''
          }
        });
        
        if (response.ok) {
          const history = await response.json();
          if (mounted) {
            const recentPixels = history
              .map((pixel: string | PixelPlacement) => 
                typeof pixel === 'string' ? JSON.parse(pixel) : pixel
              )
              .filter((pixel: PixelPlacement, index: number, self: PixelPlacement[]) => 
                index === self.findIndex((p) => p.id === pixel.id)
              );
            setPlacements(recentPixels);
          }
        }
      } catch (error) {
        console.error('Failed to fetch recent pixels:', error);
      }
    };

    // Check connection and force reconnect if needed - using componentId
    if (!pusherManager.isConnected()) {
      console.log('🔄 PixelFeed: Reconnecting Pusher');
      pusherManager.reconnect();
    }

    fetchInitialData();
    // Add componentId 'pixel-feed' to track this component's subscription
    pusherManager.subscribe('pixel-placed', handlePixelPlaced, 'pixel-feed');
    
    // Add visibility change handler
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('🔄 PixelFeed: Tab became visible, checking connection');
        if (!pusherManager.isConnected()) {
          console.log('🔄 PixelFeed: Reconnecting Pusher after tab became visible');
          pusherManager.reconnect();
          fetchInitialData();
        }
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      mounted = false;
      // Add componentId when unsubscribing
      pusherManager.unsubscribe('pixel-placed', handlePixelPlaced, 'pixel-feed');
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [getAccessToken]);

  return (
    <div className="w-full max-w-[600px] mx-auto font-mono text-[10px] sm:text-xs flex flex-col items-center h-12">
      <AnimatePresence mode="popLayout">
        {isMobile ? (
          placements.slice(0, 3).map((placement, index) => (
            <motion.div
              key={`${placement.wallet_address}-${placement.x}-${placement.y}-${placement.placed_at}`}
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1 - index * 0.2, y: index * 20 }}
              exit={{ opacity: 0, y: 60 }}
              transition={{ duration: 0.2 }}
              className="text-slate-300 whitespace-nowrap px-2 absolute"
            >
              <motion.div
                initial={{ scale: 1, rotate: 0 }}
                animate={{ scale: [1, 1.05, 1], rotate: [0, -1, 1, 0] }}
                transition={{ duration: 0.5 }}
              >
                <PlacementMessage placement={placement} />
              </motion.div>
            </motion.div>
          ))
        ) : (
          Array.from({ length: Math.ceil(placements.length / 2) }).map((_, rowIndex) => {
            const leftPlacement = placements[rowIndex * 2];
            const rightPlacement = placements[rowIndex * 2 + 1];
            
            return (
              <motion.div
                key={`${leftPlacement.wallet_address}-${leftPlacement.x}-${leftPlacement.y}-${leftPlacement.placed_at}`}
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
          })
        )}
      </AnimatePresence>
    </div>
  );
} 