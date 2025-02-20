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
      <div>
        {children}
      </div>
    </>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Initial connection check
    const timer = setTimeout(() => {
      if (!pusherManager.isConnected()) {
        console.log('🔄 Layout: Initial connection check failed, requesting reconnect');
        pusherManager.reconnect();
      }
    }, 2000);

    // Handle visibility change (tab focus/blur, sleep/wake)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('🔄 Layout: Page became visible, checking connection');
        if (!pusherManager.isConnected()) {
          console.log('🔌 Layout: Connection lost, attempting to reconnect');
          pusherManager.reconnect();
        }
      }
    };

    // Handle online/offline events
    const handleOnline = () => {
      console.log('🌐 Layout: Browser came online, checking connection');
      if (!pusherManager.isConnected()) {
        console.log('🔌 Layout: Reconnecting after coming online');
        pusherManager.reconnect();
      }
    };

    // Add event listeners
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
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