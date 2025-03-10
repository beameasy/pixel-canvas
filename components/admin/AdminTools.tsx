'use client';

import React, { useState } from 'react';
import { usePrivy, getAccessToken } from '@privy-io/react-auth';
import { isAdmin } from './utils';

interface AdminToolsProps {
  // We're going to implement the banning directly inside this component
}

export const AdminTools: React.FC<AdminToolsProps> = () => {
  const { user, authenticated } = usePrivy();
  const [walletToBan, setWalletToBan] = useState('');
  const [banReason, setBanReason] = useState('');
  const [isMinimized, setIsMinimized] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{text: string, type: 'success' | 'error'} | null>(null);

  if (!authenticated || !isAdmin(user?.wallet?.address)) {
    return null;
  }

  const handleBanSubmit = async () => {
    if (!walletToBan) return;
    
    try {
      setLoading(true);
      setMessage(null);
      
      const token = await getAccessToken();
      
      const response = await fetch('/api/admin/ban', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': user?.wallet?.address || '',
          'x-privy-token': token || ''
        },
        body: JSON.stringify({
          wallet: walletToBan,
          reason: banReason
        })
      });
      
      if (response.ok) {
        setMessage({
          text: `Successfully banned wallet ${walletToBan}`,
          type: 'success'
        });
        setWalletToBan('');
        setBanReason('');
      } else {
        const data = await response.json();
        setMessage({
          text: `Error: ${data.error || 'Failed to ban wallet'}`,
          type: 'error'
        });
      }
    } catch (error) {
      console.error('Ban request failed:', error);
      setMessage({
        text: `Error: ${error instanceof Error ? error.message : 'Failed to ban wallet'}`,
        type: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      className={`fixed transition-all duration-200 bg-black/80 p-2 rounded-lg border border-purple-500 z-[55] text-sm ${
        isMinimized 
          ? 'top-20 right-4 w-auto'
          : 'top-20 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-[640px]'
      }`}
    >
      <div className="flex justify-between items-center mb-2">
        <span className="text-white text-xs">
          {isMinimized ? '🛠️' : 'Admin Tools'}
        </span>
        <button
          onClick={() => setIsMinimized(!isMinimized)}
          className="text-gray-400 hover:text-white text-xs ml-2"
        >
          {isMinimized ? '🔽' : '🔼'}
        </button>
      </div>

      {!isMinimized && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex-1 space-y-2">
              <input
                type="text"
                value={walletToBan}
                onChange={(e) => setWalletToBan(e.target.value)}
                placeholder="Wallet to ban"
                className="bg-gray-800 text-white p-1 rounded w-full"
              />
              <input
                type="text"
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
                placeholder="Reason for ban"
                className="bg-gray-800 text-white p-1 rounded w-full"
              />
            </div>
            <button
              onClick={handleBanSubmit}
              disabled={loading || !walletToBan}
              className={`${
                loading ? 'bg-gray-500' : 'bg-red-500 hover:bg-red-600'
              } text-white px-2 py-1 rounded text-xs h-fit`}
            >
              {loading ? 'Banning...' : 'Ban'}
            </button>
          </div>
          
          {message && (
            <div className={`text-xs p-1 rounded ${
              message.type === 'success' ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'
            }`}>
              {message.text}
            </div>
          )}
        </div>
      )}
    </div>
  );
}; 