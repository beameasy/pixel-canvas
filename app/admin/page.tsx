'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';

// Add this interface at the top of your file
interface ActiveUser {
  address: string;
  shortAddress: string;
  username: string | null;
  displayName: string | null;
  fid: number | null;
  avatarUrl: string | null;
}

// Define an interface for the historical data item
interface HistoricalDataItem {
  time?: string;
  count?: number;
}

// Define an interface for your stats data
interface AdminStats {
  lastActivity?: string | null;
  totalPixels?: number;
  totalUsers?: number;
  // other properties...
}

// Simplified SystemStats component directly in the page
function SystemStats() {
  const [timeframe, setTimeframe] = useState<'hour' | 'day' | 'week' | 'month'>('day');
  const [pixelData, setPixelData] = useState<any[]>([]);
  const [userData, setUserData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredBar, setHoveredBar] = useState<{chart: string, index: number, value: number} | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/admin/stats/historical?timeframe=${timeframe}`);
        
        if (response.ok) {
          const data = await response.json();
          setPixelData(data.pixels || []);
          setUserData(data.users || []);
        } else {
          setError('Failed to load historical data');
          console.error('Historical stats error:', await response.text());
        }
      } catch (error) {
        console.error('Error fetching stats:', error);
        setError('Error loading historical data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchStats();
  }, [timeframe]);

  // Display fewer labels based on data length to avoid overcrowding
  const getLabelIndexes = (dataLength: number) => {
    if (timeframe === 'hour') return [0, Math.floor(dataLength/2), dataLength-1];
    if (dataLength <= 8) return Array.from({length: dataLength}, (_, i) => i);
    if (dataLength <= 16) return Array.from({length: dataLength}, (_, i) => i % 2 === 0 ? i : null).filter(Boolean) as number[];
    return Array.from({length: dataLength}, (_, i) => i % 4 === 0 ? i : null).filter(Boolean) as number[];
  };

  // Fix time label formatting for better display
  const formatTimeLabel = (timeStr: string) => {
    if (timeframe === 'hour') {
      // For hour view, show only time in compact form
      return timeStr.replace(/(\d+):(\d+) (AM|PM)/, '$1:$2');
    } else if (timeframe === 'day') {
      // For day view, just return hours without AM/PM prefix
      return timeStr.replace(/(AM|PM)(\d+):(\d+)/, '$2:$3');
    } else {
      // For week/month, return date in more compact form
      return timeStr.replace(/(\w{3}) (\d+)/, '$1$2');
    }
  };

  return (
    <div className="bg-slate-700 p-6 rounded-lg mb-6">
      <h2 className="text-xl font-bold text-white mb-4 font-mono">Historical Activity</h2>
      
      <div className="flex space-x-2 mb-4">
        <button
          onClick={() => setTimeframe('hour')}
          className={`px-3 py-1 rounded font-mono ${
            timeframe === 'hour' ? 'bg-blue-600 text-white' : 'bg-slate-600 text-slate-300'
          }`}
        >
          Last Hour
        </button>
        <button
          onClick={() => setTimeframe('day')}
          className={`px-3 py-1 rounded font-mono ${
            timeframe === 'day' ? 'bg-blue-600 text-white' : 'bg-slate-600 text-slate-300'
          }`}
        >
          24 Hours
        </button>
        <button
          onClick={() => setTimeframe('week')}
          className={`px-3 py-1 rounded font-mono ${
            timeframe === 'week' ? 'bg-blue-600 text-white' : 'bg-slate-600 text-slate-300'
          }`}
        >
          7 Days
        </button>
        <button
          onClick={() => setTimeframe('month')}
          className={`px-3 py-1 rounded font-mono ${
            timeframe === 'month' ? 'bg-blue-600 text-white' : 'bg-slate-600 text-slate-300'
          }`}
        >
          30 Days
        </button>
      </div>
      
      {isLoading ? (
        <div className="text-white text-center py-4">Loading stats...</div>
      ) : error ? (
        <div className="text-red-400 text-center py-4">{error}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-slate-800 p-4 rounded-lg">
            <h3 className="text-lg font-mono text-white mb-3">Pixel Placements</h3>
            {pixelData.length === 0 ? (
              <div className="text-slate-400 text-center py-10 flex flex-col items-center">
                <div className="mb-2">No data yet</div>
                <div className="text-xs opacity-70">Waiting for activity...</div>
              </div>
            ) : (
              <div className="h-64 relative">
                {/* Value Tooltip */}
                {hoveredBar && hoveredBar.chart === 'pixels' && (
                  <div 
                    className="absolute bg-black/80 text-white font-mono text-xs p-2 rounded pointer-events-none z-10"
                    style={{
                      top: '0px',
                      left: `${(hoveredBar.index / pixelData.length) * 100}%`,
                      transform: 'translateX(-50%)'
                    }}
                  >
                    <div>{pixelData[hoveredBar.index].time}</div>
                    <div className="text-emerald-400">{hoveredBar.value} pixels</div>
                  </div>
                )}
                
                {/* Chart */}
                <div className="flex h-52 items-end space-x-0.5 mb-8 mt-2">
                  {pixelData.map((item, index) => {
                    const maxValue = Math.max(...pixelData.map(d => d.count || 1));
                    const height = Math.max(5, (item.count / maxValue) * 180);
                    
                    return (
                      <div 
                        key={index} 
                        className="flex flex-col items-center flex-1 group relative"
                        onMouseEnter={() => setHoveredBar({chart: 'pixels', index, value: item.count})}
                        onMouseLeave={() => setHoveredBar(null)}
                      >
                        <div className="absolute -top-6 text-xs text-white opacity-0 group-hover:opacity-100 font-mono">
                          {item.count}
                        </div>
                        <div 
                          className="bg-emerald-500 hover:bg-emerald-400 w-full transition-colors"
                          style={{height: `${height}px`}}
                        ></div>
                      </div>
                    );
                  })}
                </div>
                
                {/* X-Axis Labels */}
                <div className="flex justify-between mt-2 px-1">
                  {getLabelIndexes(pixelData.length).map(index => (
                    <div key={index} className="text-xs text-slate-400 font-mono whitespace-nowrap">
                      {formatTimeLabel(pixelData[index].time)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          
          <div className="bg-slate-800 p-4 rounded-lg">
            <h3 className="text-lg font-mono text-white mb-3">Active Users</h3>
            {userData.length === 0 ? (
              <div className="text-slate-400 text-center py-10">No data available</div>
            ) : (
              <div className="h-64 relative">
                {/* Value Tooltip */}
                {hoveredBar && hoveredBar.chart === 'users' && (
                  <div 
                    className="absolute bg-black/80 text-white font-mono text-xs p-2 rounded pointer-events-none z-10"
                    style={{
                      top: '0px',
                      left: `${(hoveredBar.index / userData.length) * 100}%`,
                      transform: 'translateX(-50%)'
                    }}
                  >
                    <div>{userData[hoveredBar.index].time}</div>
                    <div className="text-blue-400">{hoveredBar.value} users</div>
                  </div>
                )}
                
                {/* Chart */}
                <div className="flex h-52 items-end space-x-0.5 mb-8 mt-2">
                  {userData.map((item, index) => {
                    const maxValue = Math.max(...userData.map(d => d.count || 1));
                    const height = Math.max(5, (item.count / maxValue) * 180);
                    
                    return (
                      <div 
                        key={index} 
                        className="flex flex-col items-center flex-1 group relative"
                        onMouseEnter={() => setHoveredBar({chart: 'users', index, value: item.count})}
                        onMouseLeave={() => setHoveredBar(null)}
                      >
                        <div className="absolute -top-6 text-xs text-white opacity-0 group-hover:opacity-100 font-mono">
                          {item.count}
                        </div>
                        <div 
                          className="bg-blue-500 hover:bg-blue-400 w-full transition-colors"
                          style={{height: `${height}px`}}
                        ></div>
                      </div>
                    );
                  })}
                </div>
                
                {/* X-Axis Labels */}
                <div className="flex justify-between mt-2 px-1">
                  {getLabelIndexes(userData.length).map(index => (
                    <div key={index} className="text-xs text-slate-400 font-mono whitespace-nowrap">
                      {formatTimeLabel(userData[index].time)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminDashboard() {
  const { user, ready } = usePrivy();
  const router = useRouter();
  const [stats, setStats] = useState<{
    totalPixels: number;
    totalUsers: number;
    liveUsers: number;
    activeUsers: ActiveUser[];
  }>({
    totalPixels: 0,
    totalUsers: 0,
    liveUsers: 0,
    activeUsers: []
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const lastStatsRef = useRef<{totalPixels: number; liveUsers: number}>({totalPixels: 0, liveUsers: 0});
  const adminChecked = useRef(false);
  
  // Fetch stats without redundant admin checks
  const fetchStats = useCallback(async (force = false) => {
    if (!user?.wallet?.address || !isAdmin) return;
    
    try {
      // Full stats fetch without re-checking admin status
      const statsResponse = await fetch('/api/admin/stats', {
        headers: {
          // Add headers to skip admin check on the server if possible
          'x-is-admin': 'true',
          'x-wallet-address': user.wallet.address.toLowerCase()
        }
      });
      
      if (!statsResponse.ok) {
        if (statsResponse.status === 401 || statsResponse.status === 403) {
          setError('Not authorized to access admin dashboard');
          return;
        }
        
        setError('Failed to load admin statistics');
        return;
      }
      
      const data = await statsResponse.json();
      
      // Only update UI if there are actual changes or forced refresh
      const hasPixelChanges = data.totalPixels !== lastStatsRef.current.totalPixels;
      const hasUserChanges = data.liveUsers !== lastStatsRef.current.liveUsers;
      
      if (hasPixelChanges || hasUserChanges || force) {
        setStats(data);
        setLastUpdated(new Date());
      }
      
      // Always update our reference values
      lastStatsRef.current = {
        totalPixels: data.totalPixels || 0,
        liveUsers: data.liveUsers || 0
      };
      
    } catch (error) {
      console.error('Error fetching admin stats:', error);
    }
  }, [user?.wallet?.address, isAdmin]);

  // Single admin check when component mounts
  useEffect(() => {
    if (!ready || !user?.wallet?.address || adminChecked.current) return;
    
    const checkAdminStatus = async () => {
      try {
        console.log('Performing one-time admin check');
        setIsLoading(true);
        
        // One-time admin check
        const checkResponse = await fetch('/api/auth/check-admin');
        const checkData = await checkResponse.json();
        
        if (!checkData.isAdmin) {
          setError('Not authorized to access admin dashboard');
          setIsLoading(false);
          return;
        }
        
        // Store the admin check result
        setIsAdmin(true);
        adminChecked.current = true;
        
        // Initial stats fetch
        await fetchStats(true);
        setIsLoading(false);
      } catch (error) {
        setError('Error verifying admin access');
        setIsLoading(false);
      }
    };

    checkAdminStatus();
  }, [user?.wallet?.address, ready, fetchStats]);

  // Set up polling without redundant admin checks
  useEffect(() => {
    if (!isAdmin || !user?.wallet?.address) return;
    
    const intervalId = setInterval(() => {
      fetchStats();
    }, 20000); // Poll every 20 seconds
    
    return () => clearInterval(intervalId);
  }, [isAdmin, user?.wallet?.address, fetchStats]);

  // Add event listeners for visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isAdmin) {
        fetchStats(true);
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchStats, isAdmin]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-800 flex items-center justify-center">
        <div className="text-white font-mono text-lg">Loading admin dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-800 flex items-center justify-center">
        <div className="bg-slate-700 p-8 rounded-lg max-w-md">
          <h2 className="text-xl text-red-400 font-mono mb-4">Access Error</h2>
          <p className="text-white font-mono mb-6">{error}</p>
          <div className="flex justify-center">
            <button
              onClick={() => router.push('/')}
              className="bg-blue-600 hover:bg-blue-700 text-white font-mono py-2 px-4 rounded"
            >
              Return to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-slate-800 flex items-center justify-center">
        <div className="text-white font-mono text-lg">Verifying admin access...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-800 py-12 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-white font-mono">Admin Dashboard</h1>
          <div className="text-xs text-slate-400 font-mono">
            Last updated: {lastUpdated.toLocaleTimeString()}
            <button 
              onClick={() => fetchStats(true)} 
              className="ml-2 px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-white"
              title="Refresh data"
            >
              ↻
            </button>
          </div>
        </div>
        
        {/* Overview Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <StatCard title="Total Pixels" value={stats.totalPixels} />
          <StatCard title="Total Users" value={stats.totalUsers} />
          <StatCard title="Live Users" value={stats.liveUsers} />
        </div>
        
        {/* Active users section */}
        <div className="bg-slate-700 p-6 rounded-lg mb-8">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-white font-mono">Active Users ({stats.liveUsers})</h2>
          </div>
          
          {stats.activeUsers.length === 0 ? (
            <div className="text-slate-400 text-center py-6">No active users</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {stats.activeUsers.map((user, index) => (
                <div key={index} className="bg-slate-800 p-4 rounded-lg flex items-center space-x-3">
                  {user.avatarUrl ? (
                    <img 
                      src={user.avatarUrl} 
                      alt={user.displayName || user.username || 'User'} 
                      className="w-10 h-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-slate-600 flex items-center justify-center text-white">
                      {user.displayName?.[0]?.toUpperCase() || 
                       user.username?.[0]?.toUpperCase() || 
                       user.shortAddress?.[0]?.toUpperCase() || '?'}
                    </div>
                  )}
                  <div className="overflow-hidden">
                    {(user.displayName || user.username) && (
                      <p className="text-white font-mono font-bold truncate">
                        {user.displayName || user.username}
                      </p>
                    )}
                    <a 
                      href={`https://etherscan.io/address/${user.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 text-sm font-mono truncate"
                    >
                      {user.shortAddress}
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, className = '' }: { title: string, value: number | string, className?: string }) {
  return (
    <div className={`bg-slate-700 rounded-lg p-6 ${className}`}>
      <h3 className="text-lg font-bold text-white mb-2 font-mono">{title}</h3>
      <p className="text-xl text-emerald-400 font-mono overflow-hidden text-ellipsis">{value}</p>
    </div>
  );
} 