'use client';

import { useState, useEffect } from 'react';

interface LeaderboardEntry {
  wallet_address: string;
  farcaster_username: string | null;
  farcaster_pfp: string | null;
  total_pixels: number;
  pixels_24h: number;
  pixels_1h: number;
  favorite_color: string;
}

export default function Leaderboard() {
  const [users, setUsers] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<keyof LeaderboardEntry>('total_pixels');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const response = await fetch('/api/leaderboard');
        const data = await response.json();
        setUsers(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error('Failed to fetch leaderboard:', error);
        setUsers([]);
      } finally {
        setLoading(false);
      }
    };

    fetchLeaderboard();
  }, []);

  const handleSort = (field: keyof LeaderboardEntry) => {
    if (field === sortField) {
      setSortDirection(current => current === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-slate-800 p-4 text-white">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-800 p-4">
      <div className="max-w-[1200px] mx-auto">
        <h1 className="text-[#FFD700] text-2xl font-mono mb-6">Leaderboard</h1>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="p-4 text-slate-400 font-mono">#</th>
                <th className="p-4 text-slate-400 font-mono cursor-pointer hover:text-slate-200"
                    onClick={() => handleSort('wallet_address')}>
                  User
                </th>
                <th className="p-4 text-slate-400 font-mono cursor-pointer hover:text-slate-200"
                    onClick={() => handleSort('total_pixels')}>
                  Total Pixels
                </th>
                <th className="p-4 text-slate-400 font-mono cursor-pointer hover:text-slate-200"
                    onClick={() => handleSort('pixels_24h')}>
                  Last 24h
                </th>
                <th className="p-4 text-slate-400 font-mono cursor-pointer hover:text-slate-200"
                    onClick={() => handleSort('pixels_1h')}>
                  Last Hour
                </th>
                <th className="p-4 text-slate-400 font-mono cursor-pointer hover:text-slate-200"
                    onClick={() => handleSort('favorite_color')}>
                  Favorite Color
                </th>
              </tr>
            </thead>
            <tbody>
              {users
                .sort((a, b) => {
                  const aValue = a[sortField] ?? 0;
                  const bValue = b[sortField] ?? 0;
                  if (sortDirection === 'asc') {
                    return aValue > bValue ? 1 : -1;
                  }
                  return aValue < bValue ? 1 : -1;
                })
                .map((user, index) => (
                  <tr key={user.wallet_address} className="border-b border-slate-700">
                    <td className="p-4 font-mono text-slate-400">{index + 1}</td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {user.farcaster_pfp && (
                          <img 
                            src={user.farcaster_pfp} 
                            alt="" 
                            className="w-6 h-6 rounded-full"
                          />
                        )}
                        {user.farcaster_username ? (
                          <a 
                            href={`https://warpcast.com/${user.farcaster_username}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-purple-400 hover:text-purple-300 font-mono text-xs"
                          >
                            @{user.farcaster_username}
                          </a>
                        ) : (
                          <a 
                            href={`https://basescan.org/address/${user.wallet_address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 font-mono text-xs"
                          >
                            {user.wallet_address.slice(0, 6)}...{user.wallet_address.slice(-4)}
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="p-4 font-mono text-emerald-400">{user.total_pixels}</td>
                    <td className="p-4 font-mono text-emerald-400">{user.pixels_24h}</td>
                    <td className="p-4 font-mono text-emerald-400">{user.pixels_1h}</td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-4 h-4 rounded-sm border border-slate-700"
                          style={{ backgroundColor: user.favorite_color }}
                        />
                        <span className="font-mono text-slate-300">{user.favorite_color}</span>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}