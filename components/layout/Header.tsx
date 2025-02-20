'use client';

import { useState } from 'react';
import Link from 'next/link';
import Ticker from '../terminal/Ticker';

interface HeaderProps {
  authenticated: boolean;
  onLogin: () => void;
  onLogout: () => void;
  userAddress?: string;
}

export default function Header({ authenticated, onLogin, onLogout, userAddress }: HeaderProps) {
  const [showDisconnect, setShowDisconnect] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = async () => {
    try {
      setIsLoggingIn(true);
      await onLogin();
    } catch (error) {
      console.error('Login error:', error);
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-transparent h-16">
      <Ticker />
      <div className="w-full max-w-[1200px] mx-auto flex flex-col sm:flex-row justify-between items-center px-4 pt-0 pb-2 space-y-2 sm:space-y-0">
        <nav className="flex items-center space-x-64 sm:space-x-96">
          <Link 
            href="/" 
            className="text-[#FFD700] hover:text-[#FFC700] font-mono whitespace-nowrap transition-colors"
          >
            Canvas
          </Link>
          <Link 
            href="/logs" 
            className="text-[#FFD700] hover:text-[#FFC700] font-mono whitespace-nowrap transition-colors"
          >
            Logs
          </Link>
          <Link 
            href="/leaderboard" 
            className="text-[#FFD700] hover:text-[#FFC700] font-mono whitespace-nowrap transition-colors"
          >
            Leaderboard
          </Link>
        </nav>
        
        {/* Wallet connection */}
        <div className="w-full sm:w-auto flex justify-center sm:justify-end">
          {!authenticated ? (
            <button
              onClick={handleLogin}
              disabled={isLoggingIn}
              className="text-emerald-400 hover:text-emerald-300 font-mono text-sm transition-colors cursor-pointer disabled:opacity-50"
            >
              {isLoggingIn ? 'Connecting...' : 'Connect Wallet'}
            </button>
          ) : (
            <button
              onClick={onLogout}
              onMouseEnter={() => setShowDisconnect(true)}
              onMouseLeave={() => setShowDisconnect(false)}
              className={`font-mono text-sm transition-colors cursor-pointer ${
                showDisconnect ? 'text-red-500' : 'text-emerald-400'
              } hover:text-emerald-300`}
            >
              {showDisconnect ? 'click to disconnect' : userAddress ? (
                <span className="text-emerald-400">
                  {userAddress.slice(0, 6)}...{userAddress.slice(-4)}
                </span>
              ) : ''}
            </button>
          )}
        </div>
      </div>
    </header>
  );
} 