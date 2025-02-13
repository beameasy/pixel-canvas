'use client';

import { useEffect, useState } from 'react';
import { supabaseClient } from '@/lib/supabaseClient';
import Image from 'next/image';

interface LeaderboardUser {
  wallet_address: string;
  pixel_count: number;
  farcaster_username: string | null;
  farcaster_pfp: string | null;
  last_active: string;
}

export default function LeaderboardPage() {
  const [users, setUsers] = useState<LeaderboardUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalPixels, setTotalPixels] = useState(0);

  useEffect(() => {
    fetchLeaderboard();
  }, []);

  async function fetchLeaderboard() {
    setLoading(true);
    
    const { data, error } = await supabaseClient
      .from('leaderboard')
      .select('*')
      .order('pixel_count', { ascending: false });
    
    if (error) {
      console.error('Error fetching leaderboard:', error);
      setLoading(false);
      return;
    }

    if (!data || data.length === 0) {
      console.log('No leaderboard data found');
      setLoading(false);
      return;
    }

    console.log('Fetched leaderboard data:', data.length, 'entries');
    setUsers(data);
    setTotalPixels(data.reduce((sum: number, user) => sum + user.pixel_count, 0));
    setLoading(false);
  }

  if (loading) {
    return <div className="text-white">Loading leaderboard...</div>;
  }

  return (
    <div className="mt-20">
      <main className="w-full max-w-[1000px] mx-auto p-5">
        <h1 className="text-[#FFD700] font-mono text-2xl text-center mb-8">
          Pixels Placed, Ranked
        </h1>
        <div className="text-center mb-4 text-gray-400">
          Total Pixels Placed: <span className="text-[#FFD700]">{totalPixels.toLocaleString()}</span>
        </div>
        <div className="flex justify-center">
          <div className="w-full max-w-xl font-mono text-xs sm:text-sm px-4 sm:px-8">
            {users.map((user, index) => (
              <div 
                key={user.farcaster_username || user.wallet_address}
                className="flex items-center gap-4 py-3 border-b border-slate-700"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <span className="text-[#FFD700] w-6 sm:w-8 flex-shrink-0">{index + 1}.</span>
                  <div className="flex items-center gap-2 min-w-0">
                    {user.farcaster_pfp && (
                      <Image
                        src={user.farcaster_pfp}
                        alt=""
                        width={20}
                        height={20}
                        className="rounded-full flex-shrink-0"
                      />
                    )}
                    <a 
                      href={user.farcaster_username 
                        ? `https://warpcast.com/${user.farcaster_username}`
                        : `https://basescan.org/address/${user.wallet_address}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 truncate"
                    >
                      {user.farcaster_username ? 
                        `@${user.farcaster_username}` : 
                        `${user.wallet_address.slice(0, 6)}...${user.wallet_address.slice(-4)}`
                      }
                    </a>
                  </div>
                </div>
                <div className="flex-grow border-b border-dotted border-slate-700 mx-4" />
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-[#FFD700] font-bold">{user.pixel_count}</span>
                  <span className="text-gray-400">pixels</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
