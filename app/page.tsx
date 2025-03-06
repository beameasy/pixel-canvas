'use client';

import Canvas from '@/components/canvas/CanvasV2';
import PixelLogo from '@/components/ui/PixelLogo';
import Controls from '@/components/layout/Controls';
import TokenomicsPopup from '@/components/ui/TokenomicsPopup';
import { usePrivy, type User as PrivyUser } from '@privy-io/react-auth';
import { useState, useRef, useEffect } from 'react';
import { AdminTools } from '@/components/admin/AdminTools';
import PixelFeed from '@/components/PixelFeed';
import { CanvasRef } from '@/components/canvas/CanvasV2';
import { pusherManager } from '@/lib/client/pusherManager';
import Head from 'next/head';
import { useBanStatus } from '@/lib/hooks/useBanStatus';

export default function Home() {
  const { authenticated, user, getAccessToken } = usePrivy();
  const { isBanned, banReason } = useBanStatus();
  const [selectedColor, setSelectedColor] = useState('#000000');
  const [showError, setShowError] = useState(false);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: -1, y: -1 });
  const [touchMode, setTouchMode] = useState<'place' | 'view'>('place');
  const canvasRef = useRef<CanvasRef>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showTokenomicsPopup, setShowTokenomicsPopup] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [canvasMountKey, setCanvasMountKey] = useState(Date.now());

  const handleAuthError = () => {
    setShowError(true);
    setTimeout(() => setShowError(false), 3000);
  };

  const handleResetView = () => {
    canvasRef.current?.resetView();
  };

  const handleShare = () => {
    canvasRef.current?.shareCanvas();
  };

  const [canvasError, setCanvasError] = useState(false);
  
  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  // Reset canvas view when navigating back to this page
  useEffect(() => {
    // Update the mount key to force a full remount
    setCanvasMountKey(Date.now());
    
    // Short delay to ensure canvas is fully mounted
    const resetTimer = setTimeout(() => {
      if (canvasRef.current) {
        console.log('🔄 Resetting canvas view after navigation');
        canvasRef.current.resetView();
      }
    }, 300);
    
    return () => clearTimeout(resetTimer);
  }, []);

  // Show tokenomics popup after a short delay
  useEffect(() => {
    const hasSeenPopup = localStorage.getItem('tokenomicsPopupClosed') === 'true';
    
    // Only show the popup if the user hasn't closed it before
    if (!hasSeenPopup) {
      const popupTimer = setTimeout(() => {
        setShowTokenomicsPopup(true);
      }, 2000); // Show popup after 2 seconds
      
      return () => clearTimeout(popupTimer);
    }
  }, []);

  useEffect(() => {
    const storeUserData = async () => {
      console.log("📝 Checking/creating user profile...");
      
      try {
        // Skip profile creation for banned wallets
        if (isBanned) {
          console.log("🚫 Wallet is banned, skipping profile creation");
          return;
        }

        const token = await getAccessToken();
        if (!token) return;

        if (!user || !user.wallet) {
          console.log("User or wallet not available yet");
          return;
        }

        const response = await fetch("/api/users/check-profile", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-wallet-address": user.wallet.address,
            "x-privy-token": token
          }
        });

        if (!response.ok) {
          console.error('Failed to store user data:', await response.text());
          throw new Error('Failed to store user data');
        }

        console.log("✅ Profile check/creation complete, Canvas can now fetch balance");
        
        setProfileReady(true);
        
        setTimeout(() => {
          console.log("🔄 Pusher reconnection initiated after profile setup");
          pusherManager.reconnect();
        }, 500);
      } catch (error) {
        console.error("Error checking/creating profile:", error);
      }
    };

    storeUserData();
    
    return () => {
      // Cleanup if needed
    };
  }, [authenticated, user?.wallet?.address, getAccessToken, isBanned]);

  return (
    <>
      <Head>
        <meta property="og:title" content="Billboard on Base" />
        <meta property="og:description" content="A collaborative canvas where anyone can place pixels on Base" />
        <meta property="og:image" content="https://www.billboardonbase.xyz/og-image.png" />
        <meta property="og:url" content="https://www.billboardonbase.xyz" />
        <meta name="twitter:card" content="summary_large_image" />
      </Head>
      <div className="min-h-screen bg-slate-800 overflow-y-auto">
        <main className="w-full max-w-[1200px] mx-auto p-1 flex flex-col items-center gap-1 py-1 sm:gap-2 sm:py-2">
          <div>
            <PixelLogo />
          </div>
          
          <div className="mb-4 sm:mb-6 w-full">
            <PixelFeed />
          </div>
          
          <div className="flex flex-col items-center relative">
            {!authenticated && showError && (
              <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 z-50">
                <div className="font-mono text-red-500 text-sm animate-pulse bg-slate-900/90 px-4 py-2 rounded-lg">
                  connect wallet to place pixels
                </div>
              </div>
            )}

            {isBanned && (
              <div className="absolute -top-14 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-sm">
                <div className="font-mono text-red-500 text-sm bg-slate-900/90 px-4 py-2 rounded-lg border border-red-500">
                  <p className="font-bold">🚫 Your wallet has been banned</p>
                  {banReason && <p className="text-xs mt-1">{banReason}</p>}
                  <p className="text-xs mt-1">You can view the canvas but cannot place pixels.</p>
                </div>
              </div>
            )}

            <Controls 
              coordinates={mousePos}
              onResetView={handleResetView}
              selectedColor={selectedColor}
              onColorSelect={setSelectedColor}
              touchMode={touchMode}
              onTouchModeChange={setTouchMode}
              canvasRef={canvasRef}
              flashMessage={null}
            />
            
            <AdminTools />
            
            {canvasError ? (
              <div className="bg-slate-900 rounded-lg p-4 border border-red-500">
                <p className="text-red-400 font-mono">Canvas failed to load. Please refresh the page.</p>
                <button 
                  onClick={() => window.location.reload()}
                  className="mt-2 bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded font-mono text-white text-sm"
                >
                  Refresh
                </button>
              </div>
            ) : (
              <Canvas 
                key={`canvas-${user?.wallet?.address || 'no-wallet'}-${canvasMountKey}`}
                ref={canvasRef}
                selectedColor={selectedColor}
                onColorSelect={setSelectedColor}
                authenticated={!!user}
                onAuthError={handleAuthError}
                onMousePosChange={(pos) => pos ? setMousePos(pos) : setMousePos({ x: -1, y: -1 })}
                touchMode={touchMode}
                onTouchModeChange={setTouchMode}
                selectionMode={false}
                onClearSelection={() => {}}
                profileReady={profileReady && !isBanned}
                isBanned={isBanned}
              />
            )}
          </div>
        </main>
      </div>
      
      {/* Tokenomics Popup */}
      <TokenomicsPopup 
        isOpen={showTokenomicsPopup} 
        onClose={() => setShowTokenomicsPopup(false)} 
      />
    </>
  );
} 