'use client';

import { Providers } from './providers';
import { Geist, Geist_Mono } from "next/font/google";
import './globals.css';
import { pusherManager } from '@/lib/client/pusherManager';
import { useEffect } from 'react';
import Header from '@/components/layout/Header';
import { usePrivy } from '@privy-io/react-auth';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

function AppContent({ children }: { children: React.ReactNode }) {
  const { login, authenticated, user, logout } = usePrivy();

  return (
    <>
      <Header 
        authenticated={authenticated}
        onLogin={login}
        onLogout={logout}
        userAddress={user?.wallet?.address}
      />
      <div className="relative z-10">
        {children}
      </div>
    </>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!pusherManager.isConnected()) {
        console.log('🔄 Layout: Initial connection check failed, requesting reconnect');
        pusherManager.reconnect();
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-slate-800`}>
        <Providers>
          <AppContent>
            {children}
          </AppContent>
        </Providers>
      </body>
    </html>
  );
} 