'use client';

import { Providers } from './providers';
import './globals.css';
import { pusherManager } from '@/lib/client/pusherManager';
import { useEffect } from 'react';
import Header from '@/components/layout/Header';
import { usePrivy } from '@privy-io/react-auth';
import { usePathname } from 'next/navigation';
import { SpeedInsights } from "@vercel/speed-insights/next"

function AppContent({ children }: { children: React.ReactNode }) {
  const { login, authenticated, user, logout } = usePrivy();

  // Consolidated initialization with prioritized tasks
  useEffect(() => {
    // Handle critical initialization immediately
    const immediateInit = () => {
      // Any critical initialization that shouldn't be delayed
    };
    
    // Handle delayed initialization (for wallet proxies and other features)
    const delayedInit = () => {
      // Wallet initialization code here
    };
    
    immediateInit();
    const timer = setTimeout(delayedInit, 1000);
    
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

  // Centralized Pusher connection management
  useEffect(() => {
    console.log('🚀 Layout: Initializing Pusher connection on app load');
    
    // Initial connection setup
    pusherManager.reconnect();
    
    // Set up reconnection strategy
    const connectionCheck = () => {
      if (!pusherManager.isConnected()) {
        console.log('🔄 Reconnecting Pusher...');
        pusherManager.reconnect();
      }
    };
    
    // Initial connection check
    const initialCheck = setTimeout(connectionCheck, 1000);
    
    // Setup visibility change handler for reconnection
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        connectionCheck();
      }
    };
    
    // Setup online event handler
    const handleOnline = () => {
      console.log('🌐 Network online, checking Pusher connection');
      connectionCheck();
    };
    
    // Set up event listeners
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);
    
    return () => {
      clearTimeout(initialCheck);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.addEventListener('online', handleOnline);
    };
  }, []);

  // Route change handler with simplified logic
  useEffect(() => {
    console.log('🔄 Layout: Route changed to', pathname);
    // Only check connection status on route change, no additional initialization
    if (!pusherManager.isConnected()) {
      console.log('🔌 Layout: Reconnecting Pusher after route change');
      pusherManager.reconnect();
    }
  }, [pathname]);

  return (
    <html lang="en">
      <body className="antialiased bg-slate-800 font-sans">
        <Providers>
          <AppContent>
            {children}
          </AppContent>
        </Providers>
        <SpeedInsights />
      </body>
    </html>
  );
} 