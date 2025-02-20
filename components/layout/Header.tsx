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
  const [isMenuOpen, setIsMenuOpen] = useState(false);

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
    <header className="sticky top-0 z-[60] bg-slate-800/95 backdrop-blur-sm">
      <Ticker />
      <div className="w-full max-w-[1200px] mx-auto flex items-center justify-between px-4 py-4">
        <div className="flex items-center">
          {/* Hamburger Menu Button - Only visible on mobile */}
          <button 
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="md:hidden text-[#FFD700] p-2"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {isMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center space-x-6 ml-6">
            <Link href="/" className="text-[#FFD700] hover:text-[#FFC700] font-mono">Canvas</Link>
            <Link href="/logs" className="text-[#FFD700] hover:text-[#FFC700] font-mono">Logs</Link>
            <Link href="/leaderboard" className="text-[#FFD700] hover:text-[#FFC700] font-mono">Leaderboard</Link>
          </nav>
        </div>

        {/* Wallet Connection - Always visible */}
        <div className="flex items-center">
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

      {/* Mobile Navigation Menu */}
      {isMenuOpen && (
        <div className="absolute top-full left-0 right-0 bg-slate-800 border-t border-slate-700 md:hidden">
          <nav className="flex flex-col p-4 space-y-4">
            <Link 
              href="/" 
              className="text-[#FFD700] hover:text-[#FFC700] font-mono"
              onClick={() => setIsMenuOpen(false)}
            >
              Canvas
            </Link>
            <Link 
              href="/logs" 
              className="text-[#FFD700] hover:text-[#FFC700] font-mono"
              onClick={() => setIsMenuOpen(false)}
            >
              Logs
            </Link>
            <Link 
              href="/leaderboard" 
              className="text-[#FFD700] hover:text-[#FFC700] font-mono"
              onClick={() => setIsMenuOpen(false)}
            >
              Leaderboard
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
} 