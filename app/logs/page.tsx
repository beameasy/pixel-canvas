'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { timeAgo, formatNumber } from '@/lib/timeAgo';

interface PixelPlacement {
  id: string;
  x: number;
  y: number;
  color: string;
  wallet_address: string;
  farcaster_username: string | null;
  farcaster_pfp: string | null;
  placed_at: string;
  token_balance: number;
}

export default function LogsPage() {
  const [placements, setPlacements] = useState<PixelPlacement[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const ITEMS_PER_PAGE = 50;

  const fetchPlacements = async (pageNum: number) => {
    try {
      const response = await fetch(`/api/pixels/history?page=${pageNum}&limit=${ITEMS_PER_PAGE}`);
      const data = await response.json();
      
      // Parse the JSON strings into objects
      const parsedData = data.map((pixel: string) => 
        typeof pixel === 'string' ? JSON.parse(pixel) : pixel
      );
      
      if (parsedData.length < ITEMS_PER_PAGE) {
        setHasMore(false);
      }
      
      if (pageNum === 1) {
        setPlacements(parsedData);
      } else {
        setPlacements(prev => [...prev, ...parsedData]);
      }
    } catch (error) {
      console.error('Failed to fetch pixel history:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlacements(1);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-800 p-4">
        <div className="max-w-[1200px] mx-auto">
          <h1 className="text-[#FFD700] text-2xl font-mono mb-6">Pixel History</h1>
          <div className="text-slate-400 font-mono">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-800 p-4">
      <div className="max-w-[1200px] mx-auto">
        <h1 className="text-[#FFD700] text-2xl font-mono mb-6">Pixel History</h1>
        
        <div className="space-y-4">
          {placements.map((placement) => (
            <div 
              key={placement.id}
              className="bg-slate-900/50 rounded-lg p-4 border border-slate-700"
            >
              <div className="flex flex-wrap items-center gap-2 sm:gap-4">
                <div className="flex items-center gap-2 min-w-[140px]">
                  {placement.farcaster_pfp && (
                    <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full overflow-hidden flex-shrink-0">
                      <Image 
                        src={placement.farcaster_pfp}
                        alt=""
                        width={32}
                        height={32}
                        className="object-cover"
                      />
                    </div>
                  )}
                  <a 
                    href={placement.farcaster_username 
                      ? `https://warpcast.com/${placement.farcaster_username}`
                      : `https://basescan.org/address/${placement.wallet_address}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`font-mono truncate ${
                      placement.farcaster_username 
                        ? "text-purple-400 hover:text-purple-300" 
                        : "text-blue-400 hover:text-blue-300"
                    }`}
                  >
                    {placement.farcaster_username 
                      ? `@${placement.farcaster_username}`
                      : `${placement.wallet_address.slice(0, 6)}...${placement.wallet_address.slice(-4)}`
                    }
                  </a>
                </div>

                <div className="flex items-center gap-2 sm:gap-4 text-xs sm:text-sm font-mono flex-wrap">
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-3 h-3 sm:w-4 sm:h-4 rounded-sm border border-slate-700 flex-shrink-0"
                      style={{ backgroundColor: placement.color }}
                    />
                    <span className="hidden md:inline text-slate-300">{placement.color}</span>
                  </div>
                  
                  <span className="text-emerald-400 text-[10px] sm:text-sm whitespace-nowrap">({placement.x}, {placement.y})</span>
                  
                  <span className="hidden md:inline text-amber-400">
                    {formatNumber(placement.token_balance)} $BILLBOARD
                  </span>
                  
                  <span className="text-slate-400 whitespace-nowrap">
                    {timeAgo(new Date(placement.placed_at))}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {hasMore && (
          <div className="mt-8 flex justify-center">
            <button
              onClick={() => {
                setPage(prev => {
                  const nextPage = prev + 1;
                  fetchPlacements(nextPage);
                  return nextPage;
                });
              }}
              className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded font-mono text-sm"
            >
              Load More
            </button>
          </div>
        )}
      </div>
    </div>
  );
}