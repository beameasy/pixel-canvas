'use client';

import { Providers } from './providers';
import { usePrivy } from '@privy-io/react-auth';
import { useState } from 'react';
import Link from 'next/link';
import Ticker from '@/components/terminal/Ticker';
import { Geist, Geist_Mono } from "next/font/google";
import './globals.css';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

function Navigation() {
  const { login, authenticated, user, logout } = usePrivy();
  const [showDisconnect, setShowDisconnect] = useState(false);

  const linkStyles = "text-[#FFD700] hover:text-[#FFC700] font-mono text-sm transition-colors";

  return (
    <div className="w-full max-w-[1200px] mx-auto flex justify-between items-center px-4 py-4">
      <nav className="flex items-center gap-6">
        <Link href="/" className={linkStyles}>
          Canvas
        </Link>
        <Link href="/logs" className={linkStyles}>
          Logs
        </Link>
        <Link href="/leaderboard" className={linkStyles}>
          Leaderboard
        </Link>
      </nav>
      <div className="flex items-center">
        {!authenticated ? (
          <button onClick={login} className={linkStyles}>
            Connect Wallet
          </button>
        ) : (
          <button
            onClick={logout}
            onMouseEnter={() => setShowDisconnect(true)}
            onMouseLeave={() => setShowDisconnect(false)}
            className={`${linkStyles} ${showDisconnect ? 'text-red-500' : ''}`}
          >
            {showDisconnect ? 'click to disconnect' : `${user?.wallet?.address.slice(0, 6)}...${user?.wallet?.address.slice(-4)}`}
          </button>
        )}
      </div>
    </div>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-slate-800`}>
        <Providers>
          {/* Header stack */}
          <div className="relative">
            {/* Ticker layer */}
            <div>
              <Ticker />
            </div>
            
            {/* Navigation layer */}
            <div className="bg-slate-800">
              <Navigation />
            </div>
          </div>

          {/* Content area - removed margin */}
          <div className="relative z-10">
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
} 