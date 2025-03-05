'use client';

import { Providers } from './providers';
import './globals.css';
import { pusherManager } from '@/lib/client/pusherManager';
import { useEffect } from 'react';
import Header from '@/components/layout/Header';
import { usePrivy } from '@privy-io/react-auth';
import { usePathname } from 'next/navigation';

function AppContent({ children }: { children: React.ReactNode }) {
  const { login, authenticated, user, logout } = usePrivy();

  // Add a delay for wallet initialization
  useEffect(() => {
    // Give time for wallet proxies to initialize before attempting connections
    const timer = setTimeout(() => {
      // Any wallet initialization code here
    }, 1000); // 1 second delay
    
    return () => clearTimeout(timer);
  }, []);
  
  // Handle visibility changes with proper error handling
  useEffect(() => {
    const handleVisibilityChange = () => {
      try {
        if (document.visibilityState === "visible") {
          // Your existing code
        }
      } catch (error) {
        console.warn("Error in visibility change handler:", error);
      }
    };
    
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

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
  const pathname = usePathname();

  useEffect(() => {
    // Check and reconnect Pusher on route changes
    console.log('🔄 Layout: Route changed to', pathname);
    if (!pusherManager.isConnected()) {
      console.log('🔌 Layout: Reconnecting Pusher after route change');
      pusherManager.reconnect();
    }

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
  }, [pathname]);

  return (
    <html lang="en">
      <body className="antialiased bg-slate-800 font-sans">
        <Providers>
          <AppContent>
            {children}
          </AppContent>
        </Providers>
      </body>
    </html>
  );
} 