'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';

interface LeaderboardEntry {
  wallet_address: string;
  farcaster_username: string | null;
  farcaster_pfp: string | null;
  total_pixels: number;
  current_pixels: number;
  pixels_24h: number;
  pixels_1h: number;
  favorite_color: string;
  token_balance?: number;
}

const formatBalance = (balance: number): string => {
  if (balance >= 1000000000) {
    return (balance / 1000000000).toFixed(1) + 'B';
  } else if (balance >= 1000000) {
    return (balance / 1000000).toFixed(1) + 'M';
  } else if (balance >= 1000) {
    return (balance / 1000).toFixed(1) + 'K';
  }
  return balance.toString();
};

export default function Leaderboard() {
  const { getAccessToken } = usePrivy();
  const [users, setUsers] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<keyof LeaderboardEntry>('total_pixels');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [lastUpdateTime, setLastUpdateTime] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchLeaderboard = useCallback(async () => {
    console.log('Fetching leaderboard data with timestamp:', Date.now());
    
    try {
      setIsRefreshing(true);
      setLoading(prev => users.length === 0 ? true : prev);
      
      const token = await getAccessToken();
      
      const response = await fetch(`/api/leaderboard?_t=${Date.now()}`, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'x-privy-token': token || ''
        },
        // Force cache bypass
        cache: 'no-store'
      });
      
      console.log('Leaderboard API response status:', response.status);
      
      if (!response.ok) {
        let errorMessage = `API Error: ${response.status} ${response.statusText}`;
        try {
          const errorData = await response.json();
          console.error('Error response data:', errorData);
          if (errorData.error) {
            errorMessage += ` - ${errorData.error}`;
          }
        } catch (e) {
          console.error('Could not parse error response as JSON:', e);
          // If we can't parse the error JSON, just use the status
        }
        
        throw new Error(errorMessage);
      }
      
      let data;
      try {
        const text = await response.text();
        console.log('Raw response length:', text.length, 'bytes');
        
        // Try to identify if there's a prefix or problem with the JSON
        if (text.length < 500) {
          console.log('Raw response:', text);
        } else {
          console.log('Raw response start:', text.substring(0, 500) + '...');
        }
        
        data = JSON.parse(text);
      } catch (e) {
        console.error('Failed to parse response as JSON:', e);
        throw new Error('Failed to parse server response as JSON');
      }
      
      if (!Array.isArray(data)) {
        console.error('Unexpected data format:', data);
        throw new Error('Unexpected data format - expected array');
      }
      
      console.log(`Received ${data.length} leaderboard entries at time:`, Date.now());
      
      setUsers(data);
      setLastUpdateTime(new Date());
      setError(null);
    } catch (error) {
      console.error('Failed to fetch leaderboard:', error);
      setError(error instanceof Error ? error.message : 'Unknown error fetching leaderboard');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [getAccessToken, users.length]);

  // Load data on initial page load
  useEffect(() => {
    console.log('Leaderboard component mounted, fetching data...');
    const controller = new AbortController();
    
    const loadData = async () => {
      try {
        await fetchLeaderboard();
      } catch (err) {
        console.error('Error in initial data load:', err);
      }
    };
    
    loadData();
    
    // Also fetch when the route changes to this page
    const handlePopState = () => {
      if (window.location.pathname === '/leaderboard') {
        console.log('Navigated to leaderboard via popstate, refreshing data...');
        fetchLeaderboard();
      }
    };

    // Add event listener for route changes
    window.addEventListener('popstate', handlePopState);

    return () => {
      controller.abort();
      window.removeEventListener('popstate', handlePopState);
    };
  }, [fetchLeaderboard]);

  const handleSort = (field: keyof LeaderboardEntry) => {
    if (field === sortField) {
      setSortDirection(current => current === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const handleRefresh = () => {
    fetchLeaderboard();
  };

  if (loading && users.length === 0) {
    return <div className="min-h-screen bg-slate-800 p-4 text-white">Loading leaderboard data...</div>;
  }
  
  if (error && users.length === 0) {
    return (
      <div className="min-h-screen bg-slate-800 p-4">
        <div className="max-w-[1200px] mx-auto">
          <h1 className="text-[#FFD700] text-2xl font-mono mb-6">Leaderboard</h1>
          <div className="bg-red-900/50 border border-red-700 rounded-lg p-4 text-white">
            <h2 className="text-xl font-mono mb-2">Error Loading Leaderboard</h2>
            <p className="mb-2 text-red-300">{error}</p>
            <button 
              className="bg-red-700 hover:bg-red-600 text-white px-4 py-2 rounded-md font-mono mt-4"
              onClick={handleRefresh}
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="min-h-screen bg-slate-800 p-4">
        <div className="max-w-[1200px] mx-auto">
          <h1 className="text-[#FFD700] text-2xl font-mono mb-6">Leaderboard</h1>
          <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-8 text-white text-center">
            <p className="text-xl font-mono mb-4">No leaderboard data available yet</p>
            <p className="text-slate-400">Be the first to place pixels on the canvas!</p>
            <button 
              className="mt-6 bg-blue-700 hover:bg-blue-600 text-white px-4 py-2 rounded-md font-mono"
              onClick={handleRefresh}
            >
              Refresh
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-800 p-4">
      <div className="max-w-[1200px] mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-[#FFD700] text-2xl font-mono">Leaderboard</h1>
          <div className="flex items-center">
            {lastUpdateTime && (
              <div className="text-slate-400 text-xs mr-4">
                Last updated: {lastUpdateTime.toLocaleTimeString()}
              </div>
            )}
            <button 
              className="bg-blue-700 hover:bg-blue-600 text-white px-4 py-2 rounded-md font-mono flex items-center"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              {isRefreshing ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Refreshing...
                </>
              ) : (
                'Refresh Data'
              )}
            </button>
          </div>
        </div>
        
        {error && (
          <div className="bg-red-900/50 border border-red-700 rounded-lg p-3 text-white mb-4">
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="p-4 text-slate-400 font-mono">#</th>
                <th className="p-4 text-slate-400 font-mono cursor-pointer hover:text-slate-200"
                    onClick={() => handleSort('wallet_address')}>
                  User
                </th>
                <th className="p-4 text-slate-400 font-mono cursor-pointer hover:text-slate-200 text-center"
                    onClick={() => handleSort('total_pixels')}>
                  Total Placed
                </th>
                <th className="p-4 text-slate-400 font-mono cursor-pointer hover:text-slate-200 text-center"
                    onClick={() => handleSort('current_pixels')}>
                  On Canvas
                </th>
                <th className="p-4 text-slate-400 font-mono cursor-pointer hover:text-slate-200 text-center"
                    onClick={() => handleSort('pixels_24h')}>
                  Last 24h
                </th>
                <th className="p-4 text-slate-400 font-mono cursor-pointer hover:text-slate-200 text-center"
                    onClick={() => handleSort('pixels_1h')}>
                  Last Hour
                </th>
                <th className="p-4 text-slate-400 font-mono cursor-pointer hover:text-slate-200 text-center"
                    onClick={() => handleSort('favorite_color')}>
                  Favorite Color
                </th>
                <th className="p-4 text-slate-400 font-mono cursor-pointer hover:text-slate-200 hidden md:table-cell text-center"
                    onClick={() => handleSort('token_balance')}>
                  $BILLBOARD
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
                        {user.farcaster_pfp && user.farcaster_pfp !== 'null' && (
                          <img 
                            src={user.farcaster_pfp} 
                            alt="" 
                            className="w-6 h-6 rounded-full"
                          />
                        )}
                        {user.farcaster_username && user.farcaster_username !== 'null' ? (
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
                    <td className="p-4 font-mono text-emerald-400 text-center">{user.total_pixels}</td>
                    <td className="p-4 font-mono text-emerald-400 text-center">{user.current_pixels}</td>
                    <td className="p-4 font-mono text-emerald-400 text-center">{user.pixels_24h}</td>
                    <td className="p-4 font-mono text-emerald-400 text-center">{user.pixels_1h}</td>
                    <td className="p-4 text-center">
                      <div className="flex items-center gap-2 justify-center">
                        <div 
                          className="w-4 h-4 rounded-sm border border-slate-700"
                          style={{ backgroundColor: user.favorite_color }}
                        />
                        <span className="font-mono text-slate-300">{user.favorite_color}</span>
                      </div>
                    </td>
                    <td className="p-4 font-mono text-amber-400 hidden md:table-cell text-center">
                      {user.token_balance ? formatBalance(user.token_balance) : '0'}
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