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
  const [showCopied, setShowCopied] = useState(false);

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
    <header className="static bg-slate-800/95 backdrop-blur-sm border-b border-slate-700 relative z-[100]">
      <Ticker />
      <div className="w-full max-w-[1200px] mx-auto flex items-center justify-between px-4 py-4">
        <div className="flex items-center">
          {/* Hamburger Menu Button */}
          <button 
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="md:hidden text-[#FFD700] p-2 relative z-[101]"
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
            <Link href="/about" className="text-[#FFD700] hover:text-[#FFC700] font-mono">About</Link>
            <Link href="/socials" className="text-[#FFD700] hover:text-[#FFC700] font-mono">Socials</Link>
            
            {/* Token Dropdown */}
            <div 
              className="relative group"
            >
              <button className="text-[#FFD700] hover:text-[#FFC700] font-mono py-2">
                $BILLBOARD
              </button>
              
              {/* Invisible bridge to maintain hover */}
              <div className="absolute w-full h-2 bottom-0 translate-y-full" />
              
              <div className="hidden group-hover:block absolute left-0 top-full pt-2 w-60 z-[102]">
                <div className="bg-slate-800 border border-slate-700 rounded-md shadow-lg py-2">
                  <div 
                    className="block px-4 py-2 text-sm font-mono text-blue-400 hover:bg-slate-700 flex items-center justify-between cursor-pointer relative"
                    onClick={() => {
                      navigator.clipboard.writeText('0x0aB96f7A85f8480c0220296C3332488ce38D9818');
                      setShowCopied(true);
                      setTimeout(() => setShowCopied(false), 2000);
                    }}
                  >
                    <span className="text-sm">{showCopied ? 'Copied!' : 'Contract Address'}</span>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <a 
                    href="https://clank.fun/t/0x0ab96f7a85f8480c0220296c3332488ce38d9818"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block px-4 py-2 text-sm font-mono text-emerald-400 hover:bg-slate-700 flex items-center justify-between"
                  >
                    <span>Trade $BILLBOARD on Clank.fun</span>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              </div>
            </div>
          </nav>
        </div>

        {/* Wallet Connection */}
        <div className="flex items-center relative z-[101]">
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
        <div className="fixed top-[72px] left-0 right-0 bg-slate-800 border-t border-slate-700 md:hidden z-[99]">
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
            <Link 
              href="/about" 
              className="text-[#FFD700] hover:text-[#FFC700] font-mono"
              onClick={() => setIsMenuOpen(false)}
            >
              About
            </Link>
            <Link 
              href="/socials" 
              className="text-[#FFD700] hover:text-[#FFC700] font-mono"
              onClick={() => setIsMenuOpen(false)}
            >
              Socials
            </Link>
            {/* Mobile Token Links */}
            <div className="space-y-2 pl-2">
              <a 
                href="https://basescan.org/address/0x0aB96f7A85f8480c0220296C3332488ce38D9818"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-blue-400 hover:text-blue-300 font-mono text-sm"
              >
                $BILLBOARD Contract
              </a>
              <a 
                href="https://clank.fun/t/0x0ab96f7a85f8480c0220296c3332488ce38d9818"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-emerald-400 hover:text-emerald-300 font-mono text-sm"
              >
                Trade on Clank.fun
              </a>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
} 