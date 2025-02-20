'use client';

import React, { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { isAdmin } from './utils';

interface AdminToolsProps {
  onBanWallet: (wallet: string, reason: string) => Promise<void>;
  onClearSelection: (coordinates: Array<{x: number, y: number}>) => Promise<void>;
  onSelectionModeToggle: (enabled: boolean) => void;
}

export const AdminTools: React.FC<AdminToolsProps> = ({ onBanWallet, onClearSelection, onSelectionModeToggle }) => {
  const { user } = usePrivy();
  const [selectionMode, setSelectionMode] = useState(false);
  const [walletToBan, setWalletToBan] = useState('');
  const [banReason, setBanReason] = useState('');
  const [isMinimized, setIsMinimized] = useState(false);

  if (!isAdmin(user?.wallet?.address)) {
    return null;
  }

  const handleSelectionModeClick = () => {
    const newMode = !selectionMode;
    setSelectionMode(newMode);
    onSelectionModeToggle(newMode);
  };

  const handleBanSubmit = () => {
    if (!walletToBan) return;
    console.log('🚫 Submitting ban:', { wallet: walletToBan, reason: banReason });
    onBanWallet(walletToBan, banReason);
    setWalletToBan('');
    setBanReason('');
  };

  return (
    <div 
      className={`fixed transition-all duration-200 bg-black/80 p-2 rounded-lg border border-purple-500 z-50 text-sm ${
        isMinimized 
          ? 'top-4 right-4 w-auto' // Minimized: small and in corner
          : 'top-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-[640px]' // Full: centered
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
        <>
          <div className="flex items-center gap-2 mb-2">
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
              className="bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded text-xs h-fit"
            >
              Ban
            </button>
          </div>

          <button
            onClick={handleSelectionModeClick}
            className={`${
              selectionMode ? 'bg-purple-500' : 'bg-gray-500'
            } hover:bg-purple-600 text-white px-2 py-1 rounded text-xs w-full`}
          >
            {selectionMode ? 'Exit Selection' : 'Enter Selection'}
          </button>
        </>
      )}
    </div>
  );
}; 