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
import { CONFIG_VERSION } from '@/lib/server/tiers.config';

// Add conditional logging utility
const isDev = process.env.NODE_ENV === 'development';
const logger = {
  log: (...args: any[]) => {
    if (isDev) console.log(...args);
  },
  error: (...args: any[]) => {
    if (isDev) console.error(...args);
  },
  warn: (...args: any[]) => {
    if (isDev) console.warn(...args);
  }
};

export default function Home() {
  const { authenticated, user, getAccessToken } = usePrivy();
  const { isBanned, banReason } = useBanStatus();
  
  // Group related UI states together
  const [uiState, setUiState] = useState({
    selectedColor: '#000000',
    showError: false,
    isLoading: true,
    mousePos: { x: -1, y: -1 },
    touchMode: 'place' as 'place' | 'view',
    showTokenomicsPopup: false,
    canvasError: false,
  });
  
  // Use a ref for canvasRef to avoid unnecessary re-renders
  const canvasRef = useRef<CanvasRef>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [canvasMountKey, setCanvasMountKey] = useState(Date.now());

  // Combine UI state updates with immutable pattern
  const updateUiState = (updates: Partial<typeof uiState>) => {
    setUiState(current => ({ ...current, ...updates }));
  };

  const handleAuthError = () => {
    updateUiState({ showError: true });
    setTimeout(() => updateUiState({ showError: false }), 3000);
  };

  const handleResetView = () => {
    canvasRef.current?.resetView();
  };

  const handleShare = () => {
    canvasRef.current?.shareCanvas();
  };
  
  // Optimized initialization effect
  useEffect(() => {
    // Set loading to false after a delay for better UX
    const timer = setTimeout(() => updateUiState({ isLoading: false }), 3000);
    
    // Check if tokenomics popup should be shown
    const popupClosed = localStorage.getItem('tokenomicsPopupClosed');
    const configVersion = localStorage.getItem('tokenomicsConfigVersion');
    const currentVersion = process.env.NEXT_PUBLIC_TOKENOMICS_CONFIG_VERSION || '1.0';
    
    if (!popupClosed || configVersion !== currentVersion) {
      updateUiState({ showTokenomicsPopup: true });
    }
    
    return () => clearTimeout(timer);
  }, []);

  // Save a reference to the canvas view state when unmounting
  useEffect(() => {
    return () => {
      // When navigating away from the canvas page, save the current view state if available
      if (canvasRef.current?.getViewState) {
        try {
          const viewState = canvasRef.current.getViewState();
          if (viewState) {
            localStorage.setItem('canvasViewState', JSON.stringify(viewState));
            logger.log('💾 Saved canvas view state before navigation');
          }
        } catch (error) {
          logger.error('Failed to save canvas view state:', error);
        }
      }
    };
  }, []);

  // Reset canvas view when navigating back to this page
  useEffect(() => {
    // Update the mount key to force a full remount
    setCanvasMountKey(Date.now());
    
    // Short delay to ensure canvas is fully mounted before trying to use the ref
    const resetTimer = setTimeout(() => {
      if (canvasRef.current) {
        // The canvas component will automatically restore view state from localStorage
        // so we don't need to manually set it here
        logger.log('🔄 Canvas component mounted, view state will be auto-restored if available');
      }
    }, 300);
    
    return () => clearTimeout(resetTimer);
  }, []);

  useEffect(() => {
    const storeUserData = async () => {
      logger.log("📝 Checking/creating user profile...");
      
      try {
        // Skip profile creation for banned wallets
        if (isBanned) {
          logger.log("🚫 Wallet is banned, skipping profile creation");
          return;
        }

        const token = await getAccessToken();
        if (!token) {
          logger.log("No authentication token available");
          return;
        }

        if (!user || !user.wallet) {
          logger.log("User or wallet not available yet");
          return;
        }

        const walletAddress = user.wallet.address;
        
        // First attempt without signature
        let response = await fetch("/api/users/check-profile", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-wallet-address": walletAddress,
            "x-privy-token": token
          }
        });

        // Handle token expiration with refresh
        if (response.status === 401) {
          logger.log("Authentication token expired or invalid, attempting to refresh");
          
          // Force token refresh via Privy
          try {
            // Check Privy SDK documentation for correct refresh method
            // Remove the non-standard { force: true } option if not supported
            const refreshedToken = await getAccessToken();
            if (refreshedToken) {
              logger.log("Token refreshed successfully, retrying request");
              
              // Retry with refreshed token
              response = await fetch("/api/users/check-profile", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-wallet-address": walletAddress,
                  "x-privy-token": refreshedToken
                }
              });
            } else {
              logger.log("Unable to refresh token");
              handleAuthError();
              return;
            }
          } catch (refreshError) {
            logger.error("Error refreshing token:", refreshError);
            handleAuthError();
            return;
          }
        }
        
        // If still unauthorized after token refresh, might need signature
        if (response.status === 401) {
          const errorData = await response.json();
          
          if (errorData.needs_signature) {
            logger.log("New wallet registration, signature required");
            
            // Generate a message to sign
            const message = `Verify wallet ownership for Billboard: ${walletAddress}`;
            let signature = '';
            
            try {
              // Use the Privy client to sign the message
              // We need to cast user.wallet to any because the type definition is incomplete
              signature = await (user.wallet as any).signMessage(message);
              logger.log("✅ Signature obtained for wallet verification");
              
              // Retry with signature
              response = await fetch("/api/users/check-profile", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-wallet-address": walletAddress,
                  "x-privy-token": token
                },
                body: JSON.stringify({
                  message,
                  signature
                })
              });
            } catch (error) {
              logger.error("Failed to sign message:", error);
              alert("You must sign the message to verify wallet ownership");
              return;
            }
          }
        }

        if (!response.ok) {
          logger.error('Failed to store user data:', await response.text());
          return;
        }

        logger.log("✅ Profile check/creation complete, Canvas can now fetch balance");
        
        setProfileReady(true);
        
        setTimeout(() => {
          logger.log("🔄 Pusher reconnection initiated after profile setup");
          pusherManager.reconnect();
        }, 500);
      } catch (error) {
        logger.error("Error checking/creating profile:", error);
      }
    };

    storeUserData();
    
    return () => {
      // Cleanup if needed
    };
  }, [authenticated, user?.wallet?.address, getAccessToken, isBanned]);

  // Add a helper for signing messages with proper error handling
  const signWalletMessage = async (message: string): Promise<string | null> => {
    if (!user?.wallet) {
      logger.error("Cannot sign: wallet not available");
      return null;
    }
    
    try {
      // Create standardized message with timestamp to prevent replay attacks
      const timestamp = Date.now();
      const fullMessage = `${message}\nTimestamp: ${timestamp}`;
      
      logger.log("Requesting signature for:", fullMessage);
      
      // Use the Privy client to sign the message
      const signature = await (user.wallet as any).signMessage(fullMessage);
      
      if (!signature) {
        logger.error("Failed to get signature");
        return null;
      }
      
      logger.log("✅ Signature obtained");
      return signature;
    } catch (error) {
      logger.error("Error signing message:", error);
      return null;
    }
  };

  // Function to add signatures to API requests
  const signRequest = async (url: string, method: string, body: any = {}): Promise<Response | null> => {
    if (!user?.wallet?.address) {
      logger.error("Cannot sign request: wallet not available");
      handleAuthError();
      return null;
    }
    
    const token = await getAccessToken();
    if (!token) {
      logger.error("Cannot sign request: no authentication token");
      handleAuthError();
      return null;
    }
    
    // Critical operations that should be signed
    const isHighValueOperation = url.includes('/api/pixels') || 
                                url.includes('/api/users/ban') || 
                                url.includes('/api/admin/');
    
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-wallet-address": user.wallet.address,
      "x-privy-token": token
    };
    
    // Add signature for high-value operations
    if (isHighValueOperation) {
      const timestamp = Date.now().toString();
      const message = `${method} ${url} ${JSON.stringify(body)}\nTimestamp: ${timestamp}`;
      const signature = await signWalletMessage(message);
      
      if (signature) {
        headers["x-wallet-signature"] = signature;
        headers["x-signature-timestamp"] = timestamp;
        headers["x-signature-message"] = message;
      }
    }
    
    try {
      return fetch(url, {
        method,
        headers,
        body: method !== 'GET' ? JSON.stringify(body) : undefined
      });
    } catch (error) {
      logger.error("Error making signed request:", error);
      return null;
    }
  };

  // Update pixel handling to use the new secure request method
  useEffect(() => {
    // Create a secure version of the handlePixelPlacement function
    const securePixelPlacement = async (x: number, y: number, color: string) => {
      if (!canvasRef.current) return false;
      
      try {
        // Get the current pixel data from the canvas if possible
        let version = 0;
        
        // Access canvas pixels if available through a different method
        // Fallback to direct API call if we can't get version info
        
        // Call the original pixel placement method which has all the UI feedback
        const response = await signRequest('/api/pixels', 'POST', {
          x, y, color, version
        });
        
        return !!response && response.ok;
      } catch (error) {
        logger.error("Error in secure pixel placement:", error);
        return false;
      }
    };
    
    // Store the secure method for use in components that need it
    // without modifying the CanvasRef interface
    (window as any).securePixelPlacement = securePixelPlacement;
  }, [user, authenticated]);

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
        <main className="w-full max-w-[1200px] mx-auto p-1 flex flex-col items-center gap-1 py-1 sm:gap-2 sm:py-2 pt-8">
          <div>
            <PixelLogo />
          </div>
          
          <div className="mb-4 sm:mb-6 w-full">
            <PixelFeed />
          </div>
          
          <div className="flex flex-col items-center relative">
            {!authenticated && uiState.showError && (
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
              coordinates={uiState.mousePos}
              onResetView={handleResetView}
              selectedColor={uiState.selectedColor}
              onColorSelect={(color) => updateUiState({ selectedColor: color })}
              touchMode={uiState.touchMode}
              onTouchModeChange={(mode) => updateUiState({ touchMode: mode })}
              canvasRef={canvasRef}
              flashMessage={null}
            />
            
            <AdminTools />
            
            {uiState.canvasError ? (
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
                selectedColor={uiState.selectedColor}
                onColorSelect={(color) => updateUiState({ selectedColor: color })}
                authenticated={!!user}
                onAuthError={handleAuthError}
                onMousePosChange={(pos) => pos ? updateUiState({ mousePos: pos }) : updateUiState({ mousePos: { x: -1, y: -1 } })}
                touchMode={uiState.touchMode}
                onTouchModeChange={(mode) => updateUiState({ touchMode: mode })}
                selectionMode={false}
                onClearSelection={() => {}}
                profileReady={profileReady && !isBanned}
                isBanned={isBanned}
              />
            )}
          </div>
        </main>
      </div>
      
      {/* Development-only test controls */}
      {process.env.NODE_ENV === 'development' && (
        <div className="fixed bottom-4 right-4 z-50">
          <button 
            onClick={() => {
              localStorage.removeItem('tokenomicsPopupClosed');
              localStorage.removeItem('tokenomicsConfigVersion');
              updateUiState({ showTokenomicsPopup: true });
            }}
            className="bg-purple-600 text-white px-3 py-1 rounded text-xs"
          >
            Test Tokenomics Popup
          </button>
        </div>
      )}
      
      {/* Tokenomics Popup */}
      <TokenomicsPopup 
        isOpen={uiState.showTokenomicsPopup} 
        onClose={() => updateUiState({ showTokenomicsPopup: false })}
        configVersion={CONFIG_VERSION}
      />
    </>
  );
} 