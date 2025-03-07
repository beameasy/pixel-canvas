'use client';

import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle, useCallback, memo, useMemo } from 'react';
import { usePrivy, useWallets, getAccessToken } from '@privy-io/react-auth';
import { Minimap } from './MiniMap';
import { useFarcasterUser } from '@/components/farcaster/hooks/useFarcasterUser';
import { getCanvasChannel } from '@/lib/client/pusher';
import { debounce } from 'lodash';
import FlashMessage from '@/components/ui/FlashMessage';
import { safeFetch } from '@/lib/client/safeJsonFetch';
import { TIERS, DEFAULT_TIER } from '@/lib/server/tiers.config';
import FarcasterLogo from '@/components/ui/FarcasterLogo';
import { pusherManager } from '@/lib/client/pusherManager';

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

declare global {
  interface Window {
    tooltipTimeout: NodeJS.Timeout;
  }
}

// Constants
const GRID_SIZE = 400;        // Double from 200 to 400
const MIN_ZOOM = 0.25;        // Reduce min zoom to allow viewing more of the canvas
const MAX_ZOOM = 20;          // Keep max zoom the same
const TOOLTIP_ZOOM_THRESHOLD = 3.0; // Increase threshold since pixels are smaller

interface ViewState {
  x: number;
  y: number;
  scale: number;
}

interface CanvasProps {
  selectedColor: string;
  onColorSelect: (color: string) => void;
  authenticated: boolean;
  onAuthError: () => void;
  onMousePosChange: (pos: { x: number; y: number } | null) => void;
  touchMode: 'place' | 'view';
  onTouchModeChange: (mode: 'place' | 'view') => void;
  selectionMode: boolean;
  onClearSelection: () => void;
  profileReady: boolean;
  isBanned?: boolean;
}

// Add interface for pixel data
type PixelData = {
  x: number;
  y: number;
  color: string;
  wallet_address?: string;
  farcaster_username?: string | null;
  farcaster_pfp?: string | null;
  placed_at: string;
  // token_balance is now optional since new pixels won't have it, but legacy ones might still
  token_balance?: number;
  locked_until?: number | null;
  canOverwrite: boolean;
  version?: number;  // Add version for concurrency control
};

export interface CanvasRef {
  resetView: () => void;
  clearCanvas: () => void;
  shareCanvas: () => Promise<string>;
  getViewState: () => ViewState;
  setViewState: (viewState: ViewState) => void;
}

// Add type for TIERS if not already defined
type Tiers = Record<string, { cooldownSeconds: number }>;

interface PixelPlacedEvent {
  pixel: PixelData;
}

// Remove the getUserTier import and add this helper function
const getClientTier = (balance: number) => {
  // Match the tier logic from your server
  const tier = TIERS.find(t => balance >= t.minTokens) || DEFAULT_TIER;
  return tier;
};

interface UserProfile {
  farcaster_username: string | null;
  farcaster_pfp: string | null;
  token_balance?: number;
  last_active?: string;
  updated_at?: string;
}

// Add after UserProfile interface, before the Canvas component
interface CachedUserProfiles {
  [walletAddress: string]: {
    profile: UserProfile | null;
    lastFetched: number;
  }
}

const Canvas = forwardRef<CanvasRef, CanvasProps>(({ selectedColor, onColorSelect, authenticated, onAuthError, onMousePosChange, touchMode, onTouchModeChange, selectionMode, onClearSelection, profileReady, isBanned }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { user, login } = usePrivy();
  const { wallets } = useWallets();
  const activeWallet = wallets?.[0];
  const address = activeWallet?.address;
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number>(0);
  const pixelQueueRef = useRef<{x: number, y: number, color: string}[]>([]);

  // Combine related state into objects to reduce re-renders
  const [canvasState, setCanvasState] = useState({
    pixels: new Map<string, PixelData>(),
    isLoading: true,
    view: {
      x: 0,
      y: 0,
      scale: 1
    }
  });

  const [interactionState, setInteractionState] = useState({
    isDragging: false,
    dragStart: { x: 0, y: 0 },
    dragStartPos: { x: 0, y: 0 },
    previewPixel: { x: -1, y: -1 },
    pinchZooming: false
  });


  // 3. Memoize expensive calculations
  const canvasSize = useMemo(() => {
    return containerRef.current?.offsetWidth || 600;
  }, [containerRef.current?.offsetWidth]);

  const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });

  const [currentTime, setCurrentTime] = useState(Date.now());

  const [tooltipTimeout] = useState<NodeJS.Timeout | null>(null);

  // Add state for hover data
  const [hoverData, setHoverData] = useState<{
    x: number;
    y: number;
    screenX: number;
    screenY: number;
    pixel: PixelData | null;
  } | null>(null);

  // Add RAF-specific refs and state
  const rafRef = useRef<number>(0);
  const needsRender = useRef<boolean>(false);

  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{ x: number; y: number } | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  // Add a ref for the overlay canvas
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  // Add connection state tracking
  const [pusherConnected, setPusherConnected] = useState(false);

  // Add a ref to track the last load time
  const lastLoadRef = useRef<number>(0);
  const LOAD_COOLDOWN = 2000; // 2 seconds between loads

  // Add a ref to track component mount status
  const mountedRef = useRef(false);

  // Add this ref near other refs
  const userCheckRef = useRef(false);

  // Modify the user profile useEffect to use a ref instead of state
  const profileCheckedRef = useRef(false);

  // Add this near the top with other state declarations
  const [isCheckingProfile, setIsCheckingProfile] = useState(false);

  // Add new state near other state declarations
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(0);
  const [nextPlacementTime, setNextPlacementTime] = useState<number | null>(null);

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const [flashHasLink, setFlashHasLink] = useState(false);
  const { farcasterUser } = useFarcasterUser(address, isBanned);

  const [isSmallScreen, setIsSmallScreen] = useState(false);

  const [pinchStart, setPinchStart] = useState(0);
  const [pinchScale, setPinchScale] = useState(1);

  // Add this near other refs
  const lastBalanceFetchTime = useRef<number>(0);
  const BALANCE_FETCH_COOLDOWN = 30000; // 30 seconds in milliseconds

  // Add this state for cached user profiles
  const [userProfiles, setUserProfiles] = useState<CachedUserProfiles>({});

  // Add near the top with other state/refs
  const pixelUpdateQueue = useRef<{x: number, y: number, color: string, wallet_address: string}[]>([]);
  const isProcessingUpdates = useRef(false);

  // Add this function to process updates using requestAnimationFrame
  const processPixelUpdates = useCallback(() => {
    logger.log('🔴 Processing pixel updates. Queue length:', pixelUpdateQueue.current.length);
    
    if (pixelUpdateQueue.current.length === 0) {
      logger.log('🔴 No updates to process. Ending processing cycle.');
      isProcessingUpdates.current = false;
      return;
    }

    isProcessingUpdates.current = true;
    
    // Process up to 10 updates per frame
    const updates = pixelUpdateQueue.current.splice(0, 10);
    logger.log('🔴 Processing batch of updates:', updates.length);
    
    setCanvasState(prev => {
      const newPixels = new Map(prev.pixels);
      updates.forEach(update => {
        const key = `${update.x},${update.y}`;
        logger.log('🔴 Adding pixel to canvas:', key, update.color);
        
        const fullPixel: PixelData = {
          ...update,
          placed_at: new Date().toISOString(),
          canOverwrite: false,
          version: 1
        };
        newPixels.set(key, fullPixel);
      });
      return {
        ...prev,
        pixels: newPixels
      };
    });

    // Continue processing if more updates exist
    if (pixelUpdateQueue.current.length > 0) {
      logger.log('🔴 More updates to process. Continuing in next frame.');
      requestAnimationFrame(processPixelUpdates);
    } else {
      logger.log('🔴 All updates processed. Ending processing cycle.');
      isProcessingUpdates.current = false;
    }
  }, []);

  // Update the queuePixelUpdate function to include required fields
  const queuePixelUpdate = useCallback((pixel: {x: number, y: number, color: string, wallet_address: string}) => {
    logger.log('🔴 Adding pixel to update queue:', pixel);
    logger.log('🔴 Queue length before adding:', pixelUpdateQueue.current.length);
    
    pixelUpdateQueue.current.push(pixel); // Push the original pixel data
    
    logger.log('🔴 Queue length after adding:', pixelUpdateQueue.current.length);
    logger.log('🔴 Processing status:', isProcessingUpdates.current);
    
    if (!isProcessingUpdates.current) {
      logger.log('🔴 Starting pixel update processing');
      requestAnimationFrame(processPixelUpdates);
    }
  }, [processPixelUpdates]);

  // Initial canvas setup and state loading
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !containerRef.current) return;

    // Initialize canvas dimensions
    const dpr = window.devicePixelRatio || 1;
    const containerWidth = containerRef.current.offsetWidth;
    
    // Set physical dimensions
    canvas.width = containerWidth * dpr;
    canvas.height = containerWidth * dpr;
    
    // Set CSS dimensions
    canvas.style.width = `${containerWidth}px`;
    canvas.style.height = `${containerWidth}px`;

      // Scale context
    const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctx.imageSmoothingEnabled = false;
      }

    // Start Pusher subscription first
    const channel = getCanvasChannel();
    channel.bind('pusher:subscription_succeeded', () => {
      setPusherConnected(true);
      
      // Load initial state with CDN caching after Pusher is ready
      loadCanvasState(true).then(() => {
        // Start RAF loop after initial state is loaded
        needsRender.current = true;
        rafRef.current = requestAnimationFrame(animate);
      });
    });

    // Handle real-time updates through RAF queue
    channel.bind('pixel-placed', (data: PixelPlacedEvent) => {
      logger.log('🔴 Pusher event received:', {
        event: 'pixel-placed',
        pixel: data.pixel,
        pusherConnected,
        receivedTimestamp: new Date().toISOString()
      });
      
      if (!pusherConnected || !data.pixel.wallet_address) {
        logger.log('🔴 Pusher event ignored - not connected or missing wallet address');
        return;
      }
      
      logger.log('🔴 Queueing pixel update:', {
        x: data.pixel.x,
        y: data.pixel.y,
        color: data.pixel.color,
        wallet_address: data.pixel.wallet_address
      });
      
      queuePixelUpdate({
        x: data.pixel.x,
        y: data.pixel.y,
        color: data.pixel.color,
        wallet_address: data.pixel.wallet_address
      });
    });

    // Cleanup
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      channel.unbind_all();
      channel.unsubscribe();
    };
  }, []); // Empty dependency array for single initialization

  // Add this ref for ETag tracking
  const lastEtag = useRef<string | null>(null);
  
  // Keep the loadCanvasState function with CDN caching
  const loadCanvasState = useCallback(async (force = false) => {
    try {
      // Add cache-busting parameter when forcing a fresh load
      const url = force ? `/api/canvas?t=${Date.now()}` : '/api/canvas';
      
      const headers: HeadersInit = {
        'Cache-Control': force ? 'no-cache, no-store' : 'max-age=600, stale-while-revalidate=600',
        'Vary': 'Accept-Encoding',
        'Pragma': force ? 'no-cache' : ''
      };
      
      // Add If-None-Match only if we're not forcing a refresh
      if (!force && lastEtag.current) {
        headers['If-None-Match'] = lastEtag.current;
      }
      
      const response = await fetch(url, { headers });
      
      // Store ETag for future conditional requests
      const etag = response.headers.get('ETag');
      if (etag) {
        lastEtag.current = etag;
      }
      
      if (!response.ok && response.status !== 304) {
        throw new Error(`Failed to load canvas state: ${response.status}`);
      }
      
      // Only process body if we got new content (not 304 Not Modified)
      if (response.status !== 304) {
        const data = await response.json();
        setCanvasState(prev => ({
          ...prev,
          pixels: new Map(data.map((pixel: any) => [
            `${pixel.x},${pixel.y}`, 
            pixel
          ])),
          isLoading: false
        }));
      } else {
        logger.log('Canvas state unchanged (304), using cached version');
      }
    } catch (error) {
      logger.error('Failed to load canvas state:', error);
    }
  }, []);

  useEffect(() => {
    const updateCanvasSize = () => {
      if (containerRef.current) {
        setCanvasState(prev => ({
          ...prev,
          view: {
            ...prev.view,
            scale: canvasSize / (GRID_SIZE * PIXEL_SIZE)
          }
        }));
      }
    };

    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);

    return () => {
      window.removeEventListener('resize', updateCanvasSize);
    };
  }, [canvasSize]);

  // Use dynamic canvas size in calculations
  const PIXEL_SIZE = canvasSize / GRID_SIZE;

  // Update the initial view calculation
  useEffect(() => {
    const containerWidth = containerRef.current?.offsetWidth || 600;
    const scale = containerWidth / (GRID_SIZE * PIXEL_SIZE);
    
    // Center the grid in the container
    const centerX = (containerWidth - (GRID_SIZE * PIXEL_SIZE * scale)) / 2;
    const centerY = (containerWidth - (GRID_SIZE * PIXEL_SIZE * scale)) / 2;
    
    setCanvasState(prev => ({
      ...prev,
      view: {
        x: centerX,
        y: centerY,
        scale: scale
      }
    }));
  }, [PIXEL_SIZE]); // Add PIXEL_SIZE as dependency

  // Add useEffect to check screen size
  useEffect(() => {
    const checkScreenSize = () => {
      setIsSmallScreen(window.innerWidth < 768); // 768px is typical tablet breakpoint
    };

    // Check initially
    checkScreenSize();

    // Add resize listener
    window.addEventListener('resize', checkScreenSize);

    // Cleanup
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  // Add this new function before the useEffect that uses it
  const drawSinglePixel = useCallback((x: number, y: number, color: string) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

    ctx.save();
    
    // Draw the pixel
    ctx.fillStyle = color;
    ctx.fillRect(
      x * PIXEL_SIZE * canvasState.view.scale + canvasState.view.x,
      y * PIXEL_SIZE * canvasState.view.scale + canvasState.view.y,
      PIXEL_SIZE * canvasState.view.scale,
      PIXEL_SIZE * canvasState.view.scale
    );

    // Redraw grid lines for this pixel if needed
    if (canvasState.view.scale > 4) {
      ctx.strokeStyle = '#CCCCCC';
      ctx.lineWidth = 0.5;
      
      // Draw vertical grid line
      const screenX = Math.floor(x * PIXEL_SIZE * canvasState.view.scale + canvasState.view.x) + 0.5;
      ctx.beginPath();
      ctx.moveTo(screenX, y * PIXEL_SIZE * canvasState.view.scale + canvasState.view.y);
      ctx.lineTo(screenX, (y + 1) * PIXEL_SIZE * canvasState.view.scale + canvasState.view.y);
      ctx.stroke();

      // Draw horizontal grid line
      const screenY = Math.floor(y * PIXEL_SIZE * canvasState.view.scale + canvasState.view.y) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x * PIXEL_SIZE * canvasState.view.scale + canvasState.view.x, screenY);
      ctx.lineTo((x + 1) * PIXEL_SIZE * canvasState.view.scale + canvasState.view.x, screenY);
      ctx.stroke();
    }

    ctx.restore();
  }, [canvasState.view, PIXEL_SIZE]);

  // Update the initial load effect
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    const loadInitial = async () => {
      try {
        // Draw white background immediately before data loads
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
        }
        
        // Then proceed with data loading
        // Check if user has recently placed a pixel
        const pixelPlacedAt = localStorage.getItem('pixel_placed_at');
        const shouldForceRefresh = pixelPlacedAt ? 
                                   (Date.now() - parseInt(pixelPlacedAt)) < 60000 : false; // Within last minute
        
        // Start listening for real-time updates before loading full state
        const channel = getCanvasChannel();
        channel.bind('pusher:subscription_succeeded', () => {
          setPusherConnected(true);
        });

        // Then load the full state, forcing refresh if needed
        await loadCanvasState(shouldForceRefresh); 
        
        // Clear the placed pixel flag if it was used
        if (shouldForceRefresh) {
          localStorage.removeItem('pixel_placed_at');
        }
        
        // Handle subsequent real-time updates
        channel.bind('pixel-placed', (data: PixelPlacedEvent) => {
          if (!pusherConnected || !data.pixel.wallet_address) return;
          queuePixelUpdate({
            x: data.pixel.x,
            y: data.pixel.y,
            color: data.pixel.color,
            wallet_address: data.pixel.wallet_address
          });
        });
      } catch (error) {
        logger.error('Failed to load initial data:', error);
      }
    };

    loadInitial();
  }, []);

  // Single useEffect to handle profile and balance
  useEffect(() => {
    const checkProfileAndBalance = async () => {
      if (!authenticated || !profileReady) {
        return; // Don't attempt if not authenticated or profile not ready
      }
      
      try {
        // Now this will only run after profile is created
        const token = await getAccessToken();
        
        const balanceResponse = await fetch("/api/users/balance", {
          headers: {
            'x-wallet-address': address || '',
            ...(token && { 'x-privy-token': token })
          }
        });
        
        if (!balanceResponse.ok) {
          throw new Error("Failed to fetch balance");
        }
        
        const balanceData = await balanceResponse.json();
        if (balanceData.balance !== undefined) {
          setUserProfile(prev => ({
            farcaster_username: prev?.farcaster_username ?? null,
            farcaster_pfp: prev?.farcaster_pfp ?? null,
            token_balance: Number(balanceData.balance),
            last_active: prev?.last_active ?? undefined,
            updated_at: prev?.updated_at ?? undefined
          }));
        }
      } catch (error) {
        logger.error("Failed to fetch profile/balance:", error);
      }
    };
    
    checkProfileAndBalance();
  }, [authenticated, profileReady]);

  // 3. Defer non-critical UI setup
  useEffect(() => {
    if (!canvasRef.current) return;
    
    const timer = setTimeout(() => {
      // Initialize tooltips, minimap after initial render
      setCanvasState(prev => ({
        ...prev,
        isLoading: false
      }));
    }, 100);
    
    return () => clearTimeout(timer);
  }, [canvasRef.current]);

  // Modify the loadPixels function to reduce logging
  const loadPixels = useCallback(async () => {
    try {
      const response = await fetch('/api/pixels');
      
      if (!response.ok) {
        throw new Error('Failed to load canvas state');
      }

      const data = await response.json();
      
      setCanvasState(prev => ({
        ...prev,
        pixels: new Map(data.map((pixel: any) => 
          [`${pixel.x},${pixel.y}`, pixel]
        ))
      }));
    } catch (error) {
      logger.error('Failed to load pixels:', error);
      setFlashMessage('Failed to load canvas state');
    }
  }, []);

  // Modify resetView function
  const resetView = () => {
    const containerWidth = containerRef.current?.offsetWidth || 600;
    const scale = containerWidth / (GRID_SIZE * PIXEL_SIZE);
    
    const centerX = (containerWidth - (GRID_SIZE * PIXEL_SIZE * scale)) / 2;
    const centerY = (containerWidth - (GRID_SIZE * PIXEL_SIZE * scale)) / 2;
    
    // Clear preview pixel when resetting view
    drawPreviewPixel(-1, -1);
    setHoverData(null);
    onMousePosChange?.(null);
    
    // Also clear in interaction state
    setInteractionState(prev => ({
      ...prev,
      previewPixel: { x: -1, y: -1 }
    }));
    
    setCanvasState(prev => ({
      ...prev,
      view: {
        x: centerX,
        y: centerY,
        scale: scale
      }
    }));
  };

  // Add the shareCanvas method
  const shareCanvas = useCallback(async (): Promise<string> => {
    const canvas = canvasRef.current;
    if (!canvas) throw new Error('Canvas not available');

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // Create a temporary canvas for the snapshot
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) throw new Error('Could not get context');

    // Set the temp canvas size to match the visible area
    tempCanvas.width = rect.width * dpr;
    tempCanvas.height = rect.height * dpr;

    // Scale for retina displays
    tempCtx.scale(dpr, dpr);

    // Copy the exact visible portion of the canvas
    tempCtx.drawImage(
      canvas,
      0, 0, rect.width * dpr, rect.height * dpr,  // Source dimensions
      0, 0, rect.width, rect.height               // Destination dimensions
    );

    return tempCanvas.toDataURL('image/png');
  }, []);

  // Update useImperativeHandle to expose the shareCanvas method
  useImperativeHandle(ref, () => ({
    resetView,
    clearCanvas: () => setCanvasState(prev => ({
      ...prev,
      pixels: new Map()
    })),
    shareCanvas,
    getViewState: () => {
      return canvasState.view;
    },
    setViewState: (viewState: ViewState) => {
      // Ensure scale is within acceptable bounds
      const safeScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewState.scale));
      
      // Apply the view state
      setCanvasState(prev => ({
        ...prev,
        view: {
          x: viewState.x,
          y: viewState.y,
          scale: safeScale
        }
      }));
      
      // Force a render with the new view
      needsRender.current = true;
    }
  }), [resetView, shareCanvas, canvasState.view]);

  // Modify handleMouseDown
  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Calculate grid position
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const x = Math.floor((mouseX - canvasState.view.x) / (PIXEL_SIZE * canvasState.view.scale));
    const y = Math.floor((mouseY - canvasState.view.y) / (PIXEL_SIZE * canvasState.view.scale));

    // Clear preview pixel when starting drag
    setInteractionState(prev => ({
      ...prev,
      previewPixel: { x: -1, y: -1 }
    }));
    const canvas = overlayCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    // Right click or middle click is always drag
    if (e.button === 2 || e.button === 1) {
      setInteractionState(prev => ({
        ...prev,
        isDragging: true,
        dragStart: { x: e.clientX, y: e.clientY },
        dragStartPos: { x: canvasState.view.x, y: canvasState.view.y },
        previewPixel: { x: -1, y: -1 } // Ensure preview pixel is cleared for drag operations
      }));
      return;
    }

    // Normal pixel placement mode
    if (x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE && e.button === 0 && address) {
      setInteractionState(prev => ({
        ...prev,
        isDragging: true, // Always start a potential drag
        dragStart: { x: e.clientX, y: e.clientY },
        dragStartPos: { x: canvasState.view.x, y: canvasState.view.y },
        previewPixel: { x, y } // Set the preview pixel for potential placement
      }));
      return;
    }

    // If we're here, we're starting a drag but not for pixel placement
    // (e.g., outside the grid or without an address)
    setInteractionState(prev => ({
      ...prev,
      isDragging: true,
      dragStart: { x: e.clientX, y: e.clientY },
      dragStartPos: { x: canvasState.view.x, y: canvasState.view.y },
      previewPixel: { x: -1, y: -1 } // Ensure preview pixel is cleared
    }));
  };

  // Add this helper function
  const formatTimeSince = (dateString: string) => {
    const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
    
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours}h`; // Show hours for up to 47 hours (47h)
    const days = Math.floor(hours / 24);
    return `${days}d`;
  };

  // Add this function to draw only the preview pixel
  const drawPreviewPixel = useCallback((x: number, y: number) => {
    const canvas = overlayCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    // Match main canvas dimensions
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasRef.current?.width || 0;
    canvas.height = canvasRef.current?.height || 0;
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = false;

    // Clear the overlay
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Only draw if within bounds and not dragging
    if (x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE && !interactionState.isDragging) {
      const screenX = Math.floor(x * PIXEL_SIZE * canvasState.view.scale + canvasState.view.x);
      const screenY = Math.floor(y * PIXEL_SIZE * canvasState.view.scale + canvasState.view.y);
      const pixelSize = Math.ceil(PIXEL_SIZE * canvasState.view.scale);
      
      ctx.fillStyle = selectedColor + '80'; // 50% opacity
      ctx.fillRect(
        screenX,
        screenY,
        pixelSize,
        pixelSize
      );
    }
  }, [canvasState.view, selectedColor, interactionState.isDragging]);

  // New function to handle tooltip persistence
  const handleTooltipInteraction = useCallback((show: boolean) => {
    if (window.tooltipTimeout) {
      clearTimeout(window.tooltipTimeout);
    }
    
    if (!show) {
      window.tooltipTimeout = setTimeout(() => {
        setHoverData(null);
      }, 2000); // 2 second delay before hiding
    }
  }, []);
  
  // Modify handleMouseMove to use our new tooltip handler
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const canvasX = (e.clientX - rect.left);
    const canvasY = (e.clientY - rect.top);
    
    const x = Math.floor((canvasX - canvasState.view.x) / (PIXEL_SIZE * canvasState.view.scale));
    const y = Math.floor((canvasY - canvasState.view.y) / (PIXEL_SIZE * canvasState.view.scale));

    // Only draw preview if not dragging
    if (!interactionState.isDragging) {
      drawPreviewPixel(x, y);
      onMousePosChange({ x, y });
    } else {
      // Clear the preview when dragging
      drawPreviewPixel(-1, -1);
      onMousePosChange(null);
      
      // Also ensure the previewPixel is cleared in the state
      if (interactionState.previewPixel.x !== -1 || interactionState.previewPixel.y !== -1) {
        setInteractionState(prev => ({
          ...prev,
          previewPixel: { x: -1, y: -1 }
        }));
      }
    }

    // Handle dragging
    if (interactionState.isDragging) {
      const dx = e.clientX - interactionState.dragStart.x;
      const dy = e.clientY - interactionState.dragStart.y;
      
      setCanvasState(prev => ({
        ...prev,
        view: {
          ...prev.view,
          x: interactionState.dragStartPos.x + dx,
          y: interactionState.dragStartPos.y + dy
        }
      }));
      return; // Exit early if dragging
    }

    // Update hover data for tooltip
    if (x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE) {
      const key = `${x},${y}`;
      const pixelData = canvasState.pixels.get(key);

      if (canvasState.view.scale >= TOOLTIP_ZOOM_THRESHOLD) {
        // Clear any hover timeout when we're over a pixel 
        if (window.tooltipTimeout) {
          clearTimeout(window.tooltipTimeout);
        }
        
        setHoverData({
          x,
          y,
          screenX: x * PIXEL_SIZE * canvasState.view.scale + canvasState.view.x,
          screenY: y * PIXEL_SIZE * canvasState.view.scale + canvasState.view.y,
          pixel: pixelData || null
        });
      }
    }
  }, [canvasState.pixels, canvasState.view, interactionState.isDragging, interactionState.dragStart, interactionState.dragStartPos, onMousePosChange, drawPreviewPixel]);

  const handleMouseLeave = useCallback(() => {
    drawPreviewPixel(-1, -1);
    
    // Don't immediately hide the tooltip on mouse leave
    // Instead, set a timeout to hide it after a delay
    handleTooltipInteraction(false);
  }, [drawPreviewPixel, handleTooltipInteraction]);

  // Modify handleMouseUp
  const handleMouseUp = async (e: React.MouseEvent) => {
    if (!interactionState.isDragging) return;

    const dx = Math.abs(e.clientX - interactionState.dragStart.x);
    const dy = Math.abs(e.clientY - interactionState.dragStart.y);
    const hasMoved = dx > 5 || dy > 5;

    setInteractionState(prev => ({
      ...prev,
      isDragging: false
    }));

    // Only place pixel if it's a left click, hasn't moved much, and we have a valid click start
    if (e.button === 0 && !hasMoved && interactionState.previewPixel && address) {
      const { x, y } = interactionState.previewPixel;
      try {
        await handlePlacePixel(x, y, selectedColor);
      } catch (error) {
        if (error instanceof Error && 
            (error.message.includes('auth') || error.message.includes('token'))) {
          onAuthError();
        }
      }
    }
  };

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (tooltipTimeout) {
        clearTimeout(tooltipTimeout);
      }
    };
  }, [tooltipTimeout]);

  // Add a debounced save function to avoid excessive writes during continuous operations like zooming/panning
  const debouncedSaveViewState = useCallback(
    debounce((viewState: ViewState) => {
      try {
        localStorage.setItem('canvasViewState', JSON.stringify(viewState));
        logger.log('💾 Canvas: View state saved (debounced)');
      } catch (error) {
        logger.error('Failed to save canvas view state:', error);
      }
    }, 300),
    []
  );
  
  // Optimize render function with useMemo
  const render = useMemo(() => {
    const canvas = canvasRef.current;
    if (!canvas || !needsRender.current) return;
    
    return () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;

      ctx.save();
      
      // Clear the entire canvas first
      ctx.fillStyle = '#1F1F1F';
      ctx.fillRect(0, 0, width, height);

      // Draw white background for grid area
      const gridPixelWidth = GRID_SIZE * PIXEL_SIZE * canvasState.view.scale;
      const gridPixelHeight = GRID_SIZE * PIXEL_SIZE * canvasState.view.scale;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(
        canvasState.view.x,
        canvasState.view.y,
        gridPixelWidth,
        gridPixelHeight
      );

      // Draw pixels
      canvasState.pixels.forEach((pixel, key) => {
        const [x, y] = key.split(',').map(Number);
        ctx.fillStyle = pixel.color;
        ctx.fillRect(
          x * PIXEL_SIZE * canvasState.view.scale + canvasState.view.x,
          y * PIXEL_SIZE * canvasState.view.scale + canvasState.view.y,
          PIXEL_SIZE * canvasState.view.scale,
          PIXEL_SIZE * canvasState.view.scale
        );
      });

      // Draw grid if zoomed in
      if (canvasState.view.scale > 4) {
        ctx.strokeStyle = '#CCCCCC';
        ctx.lineWidth = 0.5;
        
        for (let x = 0; x <= GRID_SIZE; x++) {
          const screenX = Math.floor(x * PIXEL_SIZE * canvasState.view.scale + canvasState.view.x) + 0.5;
          ctx.beginPath();
          ctx.moveTo(screenX, canvasState.view.y);
          ctx.lineTo(screenX, GRID_SIZE * PIXEL_SIZE * canvasState.view.scale + canvasState.view.y);
          ctx.stroke();
        }

        for (let y = 0; y <= GRID_SIZE; y++) {
          const screenY = Math.floor(y * PIXEL_SIZE * canvasState.view.scale + canvasState.view.y) + 0.5;
          ctx.beginPath();
          ctx.moveTo(canvasState.view.x, screenY);
          ctx.lineTo(GRID_SIZE * PIXEL_SIZE * canvasState.view.scale + canvasState.view.x, screenY);
          ctx.stroke();
        }
      }

      ctx.restore();
      
      // After successful render, save the view state (debounced)
      if (!canvasState.isLoading) {
        debouncedSaveViewState(canvasState.view);
      }
      
      needsRender.current = false;
    };
  }, [canvasState.pixels, canvasState.view, PIXEL_SIZE, debouncedSaveViewState, canvasState.isLoading]);

  // Add RAF loop
  const animate = useCallback(() => {
    // Add safety check to prevent rendering if unmounting
    if (!canvasRef.current) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      return;
    }
    
    if (render) render();
    rafRef.current = requestAnimationFrame(animate);
  }, [render]);

  // Start RAF immediately on mount
  useEffect(() => {
    rafRef.current = requestAnimationFrame(animate);
    
    return () => {
      // Ensure animation frame is cancelled when unmounting
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      
      // Clear any pending renders
      needsRender.current = false;
    };
  }, [animate]);

  // Request render when view or pixels change
  useEffect(() => {
    needsRender.current = true;
    
    // Save view state to localStorage whenever it changes (but not during initial loading)
    if (!canvasState.isLoading) {
      try {
        localStorage.setItem('canvasViewState', JSON.stringify(canvasState.view));
      } catch (error) {
        logger.error('Failed to save canvas view state:', error);
      }
    }
  }, [canvasState.view, canvasState.pixels]);

  // Update the fetchBalance function to accept a force parameter and respect profileReady
  const fetchBalance = useCallback(async (force = false) => {
    if (!authenticated) {
      logger.log("💰 [Balance] Not authenticated, skipping balance fetch");
      return;
    }
    
    if (isBanned) {
      logger.log("🚫 [Balance] Wallet is banned, skipping balance fetch");
      return;
    }

    if (!profileReady) {
      logger.log("💰 [Balance] Profile not ready, skipping balance fetch");
      return;
    }
    
    const now = Date.now();
    // Skip if recently fetched and not forced
    if (!force && now - lastBalanceFetchTime.current < BALANCE_FETCH_COOLDOWN) {
      logger.log('🔵 Balance fetch skipped (cooldown active)');
      return;
    }
    
    try {
      logger.log(`🔵 Fetching balance for: ${address}${force ? ' (forced)' : ''}`);
      const token = await getAccessToken();
      
      // Add cache-busting parameter when forced
      const cacheBuster = force ? `?t=${now}` : '';
      
      const response = await fetch(`/api/users/balance${cacheBuster}`, {
        headers: {
          'x-wallet-address': address || '',
          ...(token && { 'x-privy-token': token }),
          // Use CDN-friendly caching strategy
          'Cache-Control': force ? 'no-cache, no-store' : 'max-age=15, stale-while-revalidate=60',
          'Vary': 'x-wallet-address'
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch balance');
      }
      
      const data = await response.json();
      lastBalanceFetchTime.current = now; // Update the timestamp
      
      if (data.balance !== undefined) {
        setUserProfile(prev => ({
          farcaster_username: prev?.farcaster_username ?? null,
          farcaster_pfp: prev?.farcaster_pfp ?? null,
          token_balance: Number(data.balance),
          last_active: prev?.last_active ?? undefined,
          updated_at: prev?.updated_at ?? undefined
        }));
        logger.log('🔵 Balance updated:', {
          new: Number(data.balance),
          old: userProfile?.token_balance,
          timestamp: now
        });
      }
    } catch (error) {
      logger.error('Failed to fetch balance:', error);
    }
  }, [authenticated, profileReady, address, user?.id, getAccessToken, isBanned]);

  // Add this function to ensure we're using the latest balance for tier calculation
  const getCurrentTier = useCallback(() => {
    const userBalance = userProfile?.token_balance || 0;
    return getClientTier(userBalance);
  }, [userProfile?.token_balance]);

  // Modify the handlePlacePixel function to use getCurrentTier instead of directly using getClientTier
  const handlePlacePixel = async (x: number, y: number, color: string) => {
    if (!authenticated) {
      onAuthError();
      clearPreviewPixel();
      return;
    }
    
    if (!profileReady) {
      logger.warn("Profile not ready, cannot place pixel yet");
      clearPreviewPixel();
      return;
    }
    
    // Use the handlePixelPlacement function which already has proper authentication and visual feedback
    return handlePixelPlacement(x, y, color);
  };

  // Add useEffect to auto-clear flash message
  useEffect(() => {
    if (flashMessage) {
      const timer = setTimeout(() => setFlashMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [flashMessage]);

  // Add these handlers to the Canvas component
  const handleTouchStart = useCallback((e: TouchEvent) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (e.touches.length === 2) {
      // Two finger touch - always handle pinch zoom
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const distance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );
      
      // Store the midpoint for zooming around the pinch center
      const midX = (touch1.clientX + touch2.clientX) / 2;
      const midY = (touch1.clientY + touch2.clientY) / 2;
      
      setPinchStart(distance);
      setPinchScale(canvasState.view.scale);
      
      setInteractionState(prev => ({
        ...prev,
        isDragging: false,
        dragStart: { x: midX, y: midY },
        pinchZooming: true
      }));
    } else if (e.touches.length === 1) {
      const touch = e.touches[0];
      const canvasX = touch.clientX - rect.left;
      const canvasY = touch.clientY - rect.top;
      
      const x = Math.floor((canvasX - canvasState.view.x) / (PIXEL_SIZE * canvasState.view.scale));
      const y = Math.floor((canvasY - canvasState.view.y) / (PIXEL_SIZE * canvasState.view.scale));

      // Always set up for potential panning
      setInteractionState(prev => ({
        ...prev,
        isDragging: true,
        dragStart: {
          x: touch.clientX,
          y: touch.clientY
        },
        dragStartPos: { x: canvasState.view.x, y: canvasState.view.y },
        previewPixel: touchMode === 'place' && x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE
          ? { x, y }
          : { x: -1, y: -1 } // Clear preview for panning in view mode
      }));

      // In place mode, also set up for potential pixel placement if coordinates are valid
      if (touchMode === 'place' && x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE && address) {
        setInteractionState(prev => ({
          ...prev,
          previewPixel: { x, y }
        }));
      } else {
        // Ensure invalid coordinates don't get stored
        setInteractionState(prev => ({
          ...prev,
          previewPixel: { x: -1, y: -1 }
        }));
      }
    }
  }, [address, touchMode, canvasState.view.x, canvasState.view.y, PIXEL_SIZE, canvasState.view.scale]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    if (e.touches.length === 2) {
      // Handle pinch zoom
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const distance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );
      
      if (pinchStart > 0) {
        // Clear the preview pixel during pinch zoom
        drawPreviewPixel(-1, -1);
        setHoverData(null);
        
        // Also clear in interaction state
        setInteractionState(prev => ({
          ...prev,
          previewPixel: { x: -1, y: -1 }
        }));
        
        const midX = (touch1.clientX + touch2.clientX) / 2 - rect.left;
        const midY = (touch1.clientY + touch2.clientY) / 2 - rect.top;
        
        const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchScale * (distance / pinchStart)));
        
        setCanvasState(prev => {
          const scaleChange = scale / prev.view.scale;
          return {
            ...prev,
            view: {
              scale: scale,
              x: midX - (midX - prev.view.x) * scaleChange,
              y: midY - (midY - prev.view.y) * scaleChange
            }
          };
        });
      }
    } else if (interactionState.isDragging && e.touches.length === 1) {
      // Handle panning
      const touch = e.touches[0];
      const dx = touch.clientX - interactionState.dragStart.x;
      const dy = touch.clientY - interactionState.dragStart.y;
      
      // For view mode, clear preview pixel immediately during any panning
      if (touchMode === 'view') {
        // Clear preview pixel
        setInteractionState(prev => ({
          ...prev,
          previewPixel: { x: -1, y: -1 }
        }));
        
        // Also clear visual preview
        drawPreviewPixel(-1, -1);
        setHoverData(null);
      }
      // For place mode, only clear preview pixel if dragged substantially
      else if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        setInteractionState(prev => ({
          ...prev,
          previewPixel: { x: -1, y: -1 }
        }));
        
        // Also clear visual preview
        drawPreviewPixel(-1, -1);
        setHoverData(null);
      }
      
      setCanvasState(prev => ({
        ...prev,
        view: {
          ...prev.view,
          x: interactionState.dragStartPos.x + dx,
          y: interactionState.dragStartPos.y + dy
        }
      }));
    }
  }, [interactionState.isDragging, interactionState.dragStart, interactionState.dragStartPos, pinchStart, pinchScale, drawPreviewPixel, touchMode]);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    e.preventDefault();
    
    // Only attempt to place a pixel if:
    // 1. We have a preview pixel with valid coordinates
    // 2. We're ending a single touch (not a pinch)
    // 3. We're in place mode (important check that was missing)
    if (
      interactionState.previewPixel.x >= 0 && 
      interactionState.previewPixel.x < GRID_SIZE &&
      interactionState.previewPixel.y >= 0 && 
      interactionState.previewPixel.y < GRID_SIZE &&
      e.touches.length === 0 && 
      e.changedTouches.length === 1 &&
      touchMode === 'place'
    ) {
      logger.log('Placing pixel on touch end:', interactionState.previewPixel);
      handlePlacePixel(
        interactionState.previewPixel.x,
        interactionState.previewPixel.y,
        selectedColor
      );
    }
    
    // Reset interaction state
    setInteractionState(prev => ({
      ...prev,
      isDragging: false,
      previewPixel: { x: -1, y: -1 },
      pinchZooming: false
    }));
    setPinchStart(0);
  }, [interactionState.previewPixel, interactionState.isDragging, selectedColor, handlePlacePixel, touchMode]);

  // Add this helper function
  const hexToDecimal = (hex: string) => {
    // Remove '0x' prefix and any leading zeros
    const cleanHex = hex.replace('0x', '').replace(/^0+/, '');
    return BigInt('0x' + cleanHex).toString();
  };

  const debouncedFetchProfile = useCallback(
    debounce(async (address: string) => {
      try {
        // Add proper authentication headers
        const token = await getAccessToken();
        const response = await fetch(`/api/farcaster?address=${address}`, {
          headers: {
            'x-wallet-address': address,
            ...(token && { 'x-privy-token': token })
          }
        });
        
        if (!response.ok) {
          logger.warn('Failed to fetch Farcaster profile:', response.status);
          return;
        }
        
        const data = await response.json();
        setUserProfile(data);
      } catch (error) {
        logger.error('Error fetching Farcaster profile:', error);
      }
    }, 500),
    []
  );

  useEffect(() => {
    // Set initial size
    setWindowSize({
      width: window.innerWidth,
      height: window.innerHeight
    });

    // Update on resize
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Fix the handleWheel function
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Clear the preview pixel
    drawPreviewPixel(-1, -1);
    setHoverData(null);
    onMousePosChange(null);
    
    // Clear the preview pixel in interaction state
    setInteractionState(prev => ({
      ...prev,
      previewPixel: { x: -1, y: -1 }
    }));

    setCanvasState(prev => {
      const delta = e.deltaY;
      const scaleChange = delta > 0 ? 0.9 : 1.1;
      const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.view.scale * scaleChange));
      
      // Calculate the point to zoom towards (mouse position)
      const zoomPoint = {
        x: (mouseX - prev.view.x) / prev.view.scale,
        y: (mouseY - prev.view.y) / prev.view.scale
      };

      // Calculate new position that keeps the zoom point stationary
      return {
        ...prev,
        view: {
          scale: newScale,
          x: mouseX - zoomPoint.x * newScale,
          y: mouseY - zoomPoint.y * newScale
        }
      };
    });
  }, [drawPreviewPixel, onMousePosChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    
    return () => {
      canvas.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Add this helper function
  const formatNumber = (num: number): string => {
    if (num >= 1000000000) {
      return `${(num / 1000000000).toFixed(2)}B`;
    } else if (num >= 1000000) {
      return `${(num / 1000000).toFixed(2)}M`;
    } else if (num >= 1000) {
      return `${(num / 1000).toFixed(2)}K`;
    }
    return Math.floor(num).toString();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });

    return () => {
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
    };
  }, [canvasState.view.scale]);

  const toggleTouchMode = () => {
    onTouchModeChange(touchMode === 'view' ? 'place' : 'view');
  };

  // Add these handlers for React touch events on the canvas element
  const handleReactTouchStart = (e: React.TouchEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const touch = e.touches[0];
    const x = Math.floor((touch.clientX - rect.left - canvasState.view.x) / (PIXEL_SIZE * canvasState.view.scale));
    const y = Math.floor((touch.clientY - rect.top - canvasState.view.y) / (PIXEL_SIZE * canvasState.view.scale));

    if (touchMode === 'place' && x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE && address) {
      handlePlacePixel(x, y, selectedColor);
    } else if (touchMode === 'view' && x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE) {
      // Show tooltip without timeout - will persist until next touch
      const key = `${x},${y}`;
      const pixelData = canvasState.pixels.get(key);
      if (pixelData) {
        const screenX = x * PIXEL_SIZE * canvasState.view.scale + canvasState.view.x;
        const screenY = y * PIXEL_SIZE * canvasState.view.scale + canvasState.view.y;
        setHoverData({
          x,
          y,
          screenX,
          screenY,
          pixel: pixelData
        });
      } else {
        setHoverData(null);
      }
    }

    // Handle panning
    setInteractionState(prev => ({
      ...prev,
      isDragging: false,
      dragStart: {
        x: touch.clientX,
        y: touch.clientY
      },
      dragStartPos: { x: canvasState.view.x, y: canvasState.view.y }
    }));
  };

  const handleReactTouchMove = (e: React.TouchEvent) => {
    // Clear tooltip when moving
    setHoverData(null);
    
    // ... rest of touch move handler
  };

  const handleReactTouchEnd = (e: React.TouchEvent) => {
    // Clear tooltip when touch ends
    setHoverData(null);
    
    // Check if user tried to place a pixel but is not authenticated
    if (
      touchMode === 'place' && 
      interactionState.previewPixel.x >= 0 && 
      interactionState.previewPixel.x < GRID_SIZE &&
      interactionState.previewPixel.y >= 0 && 
      interactionState.previewPixel.y < GRID_SIZE &&
      !interactionState.isDragging &&
      !authenticated
    ) {
      onAuthError();
      clearPreviewPixel();
    }
    
    setInteractionState(prev => ({
      ...prev,
      isDragging: false
    }));
  };

  // Add useEffect to monitor canvasRef
  useEffect(() => {
    logger.log('Canvas component - canvasRef updated:', {
      ref: canvasRef,
      current: canvasRef.current,
      element: document.querySelector('canvas')
    });
  }, [canvasRef.current]);

  // Log only when the canvas element is mounted/unmounted
  useEffect(() => {
    if (canvasRef.current) {
      logger.log('Canvas mounted:', canvasRef.current);
    }
    return () => {
      logger.log('Canvas unmounting');
    };
  }, []);

  // Render canvas
  useEffect(() => {
    if (canvasState.isLoading || !canvasRef.current) return;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    // First fill entire canvas with dark background
    ctx.fillStyle = '#1F1F1F'; // Dark gray background
    ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);

    // Draw white background only for the pixel grid area
    const gridPixelWidth = GRID_SIZE * PIXEL_SIZE * canvasState.view.scale;
    const gridPixelHeight = GRID_SIZE * PIXEL_SIZE * canvasState.view.scale;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(
      canvasState.view.x,
      canvasState.view.y,
      gridPixelWidth,
      gridPixelHeight
    );

    // Draw pixels with proper scaling and position
    canvasState.pixels.forEach((pixel, key) => {
      const [x, y] = key.split(',').map(Number);
      ctx.fillStyle = pixel.color;
      ctx.fillRect(
        x * PIXEL_SIZE * canvasState.view.scale + canvasState.view.x,
        y * PIXEL_SIZE * canvasState.view.scale + canvasState.view.y,
        PIXEL_SIZE * canvasState.view.scale,
        PIXEL_SIZE * canvasState.view.scale
      );
    });

    // Draw preview pixel if valid position
    if (interactionState.previewPixel.x !== -1 && interactionState.previewPixel.y !== -1 && !interactionState.isDragging) {
      const screenX = interactionState.previewPixel.x * PIXEL_SIZE * canvasState.view.scale + canvasState.view.x;
      const screenY = interactionState.previewPixel.y * PIXEL_SIZE * canvasState.view.scale + canvasState.view.y;
      
      ctx.fillStyle = selectedColor + '80'; // 50% opacity
      ctx.fillRect(
        screenX,
        screenY,
        PIXEL_SIZE * canvasState.view.scale,
        PIXEL_SIZE * canvasState.view.scale
      );
    }

    // Draw grid when zoomed in
    if (canvasState.view.scale > 4) {
      ctx.strokeStyle = '#CCCCCC';
      ctx.lineWidth = 0.5;
      
      for (let x = 0; x <= GRID_SIZE; x++) {
        const screenX = x * PIXEL_SIZE * canvasState.view.scale + canvasState.view.x;
        ctx.beginPath();
        ctx.moveTo(screenX, canvasState.view.y);
        ctx.lineTo(screenX, GRID_SIZE * PIXEL_SIZE * canvasState.view.scale + canvasState.view.y);
        ctx.stroke();
      }

      for (let y = 0; y <= GRID_SIZE; y++) {
        const screenY = y * PIXEL_SIZE * canvasState.view.scale + canvasState.view.y;
        ctx.beginPath();
        ctx.moveTo(canvasState.view.x, screenY);
        ctx.lineTo(GRID_SIZE * PIXEL_SIZE * canvasState.view.scale + canvasState.view.x, screenY);
        ctx.stroke();
      }
    }

    // Draw border
    ctx.strokeStyle = '#666666';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      canvasState.view.x,
      canvasState.view.y,
      gridPixelWidth,
      gridPixelHeight
    );
  }, [canvasState.pixels, canvasState.view, selectedColor, interactionState.previewPixel, interactionState.isDragging, PIXEL_SIZE]);

  // Add admin handlers
  const handleBanWallet = async (wallet: string, reason?: string) => {
    try {
      const response = await fetch('/api/admin/ban', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': address || ''
        },
        body: JSON.stringify({ wallet, reason })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to ban wallet');
      }

      const data = await response.json();
      logger.log('Successfully queued wallet ban:', wallet);
    } catch (error) {
      logger.error('Failed to ban wallet:', error);
    }
  };

  const handleClearSelection = async (coordinates: Array<{x: number, y: number}>) => {
    try {
      const response = await fetch('/api/admin/clear', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': address || ''
        },
        body: JSON.stringify({ coordinates })
      });
      if (!response.ok) throw new Error('Failed to clear selection');
    } catch (error) {
      logger.error('Failed to clear selection:', error);
    }
  };

  // Add selection handlers
  const handleSelectionStart = useCallback((e: MouseEvent) => {
    if (!isSelectionMode) return;
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = Math.floor((e.clientX - rect.left - canvasState.view.x) / (PIXEL_SIZE * canvasState.view.scale));
    const y = Math.floor((e.clientY - rect.top - canvasState.view.y) / (PIXEL_SIZE * canvasState.view.scale));
    
    setSelectionStart({ x, y });
    setSelectionEnd({ x, y });
  }, [canvasState.view, isSelectionMode, PIXEL_SIZE]);

  const handleSelectionMove = useCallback((e: MouseEvent) => {
    if (!isSelectionMode || !selectionStart) return;
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = Math.floor((e.clientX - rect.left - canvasState.view.x) / (PIXEL_SIZE * canvasState.view.scale));
    const y = Math.floor((e.clientY - rect.top - canvasState.view.y) / (PIXEL_SIZE * canvasState.view.scale));
    
    setSelectionEnd({ x, y });
  }, [canvasState.view, isSelectionMode, selectionStart, PIXEL_SIZE]);

  const handleSelectionEnd = useCallback(async () => {
    if (!selectionStart || !selectionEnd) return;

    const startX = Math.min(selectionStart.x, selectionEnd.x);
    const endX = Math.max(selectionStart.x, selectionEnd.x);
    const startY = Math.min(selectionStart.y, selectionEnd.y);
    const endY = Math.max(selectionStart.y, selectionEnd.y);

    try {
      const coordinates = [];
      for (let x = startX; x <= endX; x++) {
        for (let y = startY; y <= endY; y++) {
          coordinates.push({ x, y });
        }
      }
      await onClearSelection();
      setSelectionStart(null);
      setSelectionEnd(null);
    } catch (error) {
      logger.error('Failed to clear selection:', error);
    }
  }, [selectionStart, selectionEnd, onClearSelection]);

  // Update your event listeners
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener('mousedown', handleSelectionStart);
    canvas.addEventListener('mousemove', handleSelectionMove);
    canvas.addEventListener('mouseup', handleSelectionEnd);

    return () => {
      canvas.removeEventListener('mousedown', handleSelectionStart);
      canvas.removeEventListener('mousemove', handleSelectionMove);
      canvas.removeEventListener('mouseup', handleSelectionEnd);
    };
  }, [handleSelectionStart, handleSelectionMove, handleSelectionEnd]);

  // Add to your AdminTools props
  const handleSelectionModeToggle = useCallback((enabled: boolean) => {
    setIsSelectionMode(enabled);
    if (!enabled) {
      setSelectionStart(null);
      setSelectionEnd(null);
    }
  }, []);

  // Add an effect to update hover data when pixels change
  useEffect(() => {
    if (hoverData) {
      const key = `${hoverData.x},${hoverData.y}`;
      const freshPixelData = canvasState.pixels.get(key);
      if (freshPixelData) {
        setHoverData(prev => ({
          ...prev!,
          pixel: freshPixelData
        }));
      }
    }
  }, [canvasState.pixels, hoverData?.x, hoverData?.y]);

  // For Pusher updates, only log significant state changes
  const handlePusherUpdate = useCallback((data: any) => {
    if (data.type === 'pixel-update') {
      logger.log('🟣 Significant state change:', {
        type: data.type,
        key: data.key,
        balance: data.balance 
      });
    }
  }, []);

  // Add a helper function to clear the preview pixel
  const clearPreviewPixel = useCallback(() => {
    setInteractionState(prev => ({
      ...prev,
      previewPixel: { x: -1, y: -1 }
    }));
    drawPreviewPixel(-1, -1);
  }, [drawPreviewPixel]);

  // Update handlePixelPlacement to use clearPreviewPixel
  const handlePixelPlacement = async (x: number, y: number, color: string) => {
    try {
      // Check if the wallet is banned before proceeding
      if (isBanned) {
        logger.log('🚫 Cannot place pixel: Wallet is banned');
        setFlashMessage('Your wallet has been banned from placing pixels');
        clearPreviewPixel(); // Clear preview when banned
        return false;
      }
      
      logger.log('🎨 Starting pixel placement:', { x, y, color });
      const previousPixel = canvasState.pixels.get(`${x},${y}`);
      logger.log('🎨 Previous pixel state:', previousPixel);

      // Create a temporary pixel for optimistic update
      const tempPixel: PixelData = {
        x, 
        y, 
        color,
        wallet_address: address || '',
        farcaster_username: userProfile?.farcaster_username || null,
        farcaster_pfp: userProfile?.farcaster_pfp || null,
        placed_at: new Date().toISOString(),
        token_balance: userProfile?.token_balance,
        locked_until: null,
        canOverwrite: false,
        version: previousPixel?.version ? previousPixel.version + 1 : 1
      };

      // Apply optimistic update immediately
      setCanvasState(prev => {
        const newPixels = new Map(prev.pixels);
        newPixels.set(`${x},${y}`, tempPixel);
        return {
          ...prev,
          pixels: newPixels
        };
      });

      // Make API request after updating local state
      const response = await fetch('/api/pixels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': address || '',
          'x-privy-token': (await getAccessToken()) || '',
          // Add cache purge headers for CDN
          'Cache-Control': 'no-cache',
          'Cache-Purge-Tags': 'canvas_load',
          'Surrogate-Key': `pixel-${x}-${y}` // For targeted purging of this pixel in the CDN
        },
        body: JSON.stringify({ 
          x, 
          y, 
          color,
          version: previousPixel?.version || 0  // Send current version for conflict detection
        })
      });

      logger.log('🎨 API response status:', response.status);

      if (!response.ok) {
        logger.log('🎨 Placement failed, reverting to previous state');
        const error = await response.json();
        logger.log('🔵 Received error:', error);
        
        // Revert to previous state if placement failed
        setCanvasState(prev => {
          const newPixels = new Map(prev.pixels);
          if (previousPixel) {
            newPixels.set(`${x},${y}`, previousPixel);
          } else {
            newPixels.delete(`${x},${y}`);
          }
          return {
            ...prev,
            pixels: newPixels
          };
        });

        // Clear the preview pixel when placement fails
        clearPreviewPixel();
        
        // Special handling for version conflicts
        if (response.status === 409 && error.currentVersion) {
          // If we have a version conflict, fetch the latest canvas state
          logger.log('🔄 Version conflict detected, refreshing canvas state');
          setFlashMessage('Pixel was modified by someone else. Canvas refreshed.');
          setFlashHasLink(false);
          loadCanvasState(true); // Force refresh the canvas state
        } else if (response.status === 403 && error.banned) {
          // Specific handling for banned wallets
          logger.log('🚫 Received ban response from server');
          setFlashMessage(error.error || 'Your wallet has been banned from placing pixels');
          setFlashHasLink(false);
          // No need to update isBanned state here as it's already managed by the hook
        } else if (response.status === 403) {
          // This is likely a pixel protection message with a link
          logger.log('🔒 Cannot overwrite pixel:', error.error);
          
          // Add better instructions for acquiring tokens
          let message = error.error || 'Cannot overwrite this pixel';
          if (message.includes('need') && message.includes('tokens')) {
            // Extract the token amount needed
            let tokenAmount = "";
            const match = message.match(/need\s+(\d+(\.\d+)?[BMK]?)\s+tokens/i);
            if (match && match[1]) {
              tokenAmount = match[1];
            }
            
            // Create a more user-friendly message with clear instructions
            message = message.replace(
              /need\s+(\d+(\.\d+)?[BMK]?)\s+tokens/i, 
              `need ${tokenAmount} tokens. Click here or press 'C' to acquire tokens`
            );
          }
          
          setFlashMessage(message);
          setFlashHasLink(true); // Always enable clickable messages for token-related errors
          
          // When showing a token related error, make the message clickable
          if (message.includes('tokens') && message.includes('Click here')) {
            // Setup to handle clicks on the message
            flashLinkAction.current = openTokenPurchasePage;
          } else {
            flashLinkAction.current = null;
          }
        } else {
          throw new Error(error.error || 'Failed to place pixel');
        }
        return false;
      }

      // Update with confirmed data from server
      logger.log('🎨 Placement succeeded, updating with server data');
      const data = await response.json();
      
      try {
        // Store timestamp of successful pixel placement
        localStorage.setItem('pixel_placed_at', Date.now().toString());
      } catch (e) {
        logger.error('Failed to set localStorage:', e);
      }
      
      setCanvasState(prev => {
        const newPixels = new Map(prev.pixels);
        newPixels.set(`${x},${y}`, data.pixel);
        return {
          ...prev,
          pixels: newPixels
        };
      });
      
      // Set cooldown based on user's current tier
      const userTier = getCurrentTier();
      const cooldownMs = userTier.cooldownSeconds * 1000;
      const nextTime = Date.now() + cooldownMs;
      
      // Set the nextPlacementTime in state and localStorage
      setNextPlacementTime(nextTime);
      localStorage.setItem('nextPlacementTime', nextTime.toString());
      logger.log(`🕒 Cooldown set: ${cooldownMs/1000}s until next pixel placement`);
      
      // Force refresh the token balance from Alchemy
      setTimeout(() => {
        logger.log('🔄 Refreshing token balance after pixel placement');
        fetchBalance(true);
      }, 500); // Small delay to ensure backend has time to set the flag
     
      return true;
    } catch (error) {
      logger.error('Failed to place pixel:', error);
      setFlashMessage(error instanceof Error ? error.message : 'Failed to place pixel');
      clearPreviewPixel(); // Clear preview on any error
      return false;
    }
  };

  // Update the canvas initialization effect
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const initializeCanvas = () => {
      // Add debugging to check canvas element
      const canvasElement = canvasRef.current;
      logger.log('Canvas initialization:', {
        canvasExists: !!canvasElement,
        width: canvasElement?.width,
        height: canvasElement?.height,
        offsetWidth: canvasElement?.offsetWidth,
        offsetHeight: canvasElement?.offsetHeight,
        containerWidth: containerRef.current?.offsetWidth,
        remounted: 'fresh-mount'
      });
      
      // First check if canvasRef.current and containerRef.current exist
      if (!canvasRef.current || !containerRef.current) return;
      
      const dpr = window.devicePixelRatio || 1;
      const containerWidth = containerRef.current.offsetWidth || 600;
      
      // Now it's safe to access canvasRef.current since we've checked it's not null
      canvasRef.current.width = containerWidth * dpr;
      canvasRef.current.height = containerWidth * dpr;
      
      // Set CSS size
      canvasRef.current.style.width = `${containerWidth}px`;
      canvasRef.current.style.height = `${containerWidth}px`;

      // Scale context
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctx.imageSmoothingEnabled = false;
      }

      // Also initialize overlay canvas - check for null before using
      if (overlayCanvasRef.current) {
        overlayCanvasRef.current.width = containerWidth * dpr;
        overlayCanvasRef.current.height = containerWidth * dpr;
        overlayCanvasRef.current.style.width = `${containerWidth}px`;
        overlayCanvasRef.current.style.height = `${containerWidth}px`;
        
        const overlayCtx = overlayCanvasRef.current.getContext('2d');
        if (overlayCtx) {
          overlayCtx.scale(dpr, dpr);
          overlayCtx.imageSmoothingEnabled = false;
        }
      }

      // Try to restore view state from localStorage before resetting
      try {
        const savedViewState = localStorage.getItem('canvasViewState');
        if (savedViewState) {
          const viewState = JSON.parse(savedViewState);
          
          // Validate the view state
          if (viewState && 
              typeof viewState.x === 'number' && 
              typeof viewState.y === 'number' && 
              typeof viewState.scale === 'number') {
            
            // Ensure scale is within acceptable bounds
            const safeScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewState.scale));
            
            logger.log('🔄 Canvas: Restoring saved view state:', viewState);
            
            // Apply the saved view state
            setCanvasState(prev => ({
              ...prev,
              view: {
                x: viewState.x,
                y: viewState.y,
                scale: safeScale
              }
            }));
          } else {
            // Fall back to reset view if view state is invalid
            resetView();
          }
        } else {
          // No saved state, use default reset view
          resetView();
        }
      } catch (error) {
        logger.error('Failed to restore canvas view state:', error);
        // Fall back to reset view on error
        resetView();
      }
      
      // Clear any preview pixels
      setInteractionState(prev => ({
        ...prev,
        previewPixel: { x: -1, y: -1 }
      }));
      setHoverData(null);
      
      // Force render
      needsRender.current = true;
    };

    // Initialize immediately
    initializeCanvas();

    // Also initialize after a short delay to handle any layout shifts
    const timer = setTimeout(initializeCanvas, 100);

    // Add resize observer to handle container size changes
    const resizeObserver = new ResizeObserver(() => {
      // Only call initializeCanvas if component is still mounted
      if (canvasRef.current && containerRef.current) {
        initializeCanvas();
      }
    });
    
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      clearTimeout(timer);
      resizeObserver.disconnect();
    };
  }, []);

  // Add this effect to update the cooldown timer
  useEffect(() => {
    const interval = setInterval(() => {
      if (nextPlacementTime) {
        const now = Date.now();
        if (now >= nextPlacementTime) {
          setNextPlacementTime(null);
        }
        // Force re-render for countdown
        setCurrentTime(now);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [nextPlacementTime]);

  // Add this effect to initialize from localStorage
  useEffect(() => {
    const storedTime = localStorage.getItem('nextPlacementTime');
    if (storedTime) {
      const timeMs = parseInt(storedTime);
      // Only restore if the time hasn't passed yet
      if (timeMs > Date.now()) {
        setNextPlacementTime(timeMs);
      } else {
        localStorage.removeItem('nextPlacementTime');
      }
    }
  }, []);

  // Add this near the top of your file with other helper functions
  const formatBillboardAmount = (amount: number): string => {
    if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(2)}B`;
    if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
    if (amount >= 1_000) return `${(amount / 1_000).toFixed(2)}K`;
    return amount.toString();
  };

  // Add this effect to monitor userProfile changes
  useEffect(() => {
    logger.log('🔵 User profile updated:', {
      balance: userProfile?.token_balance,
      timestamp: userProfile?.updated_at
    });
  }, [userProfile]);

  // Add effect to clear preview when color changes
  useEffect(() => {
    setInteractionState(prev => ({
      ...prev,
      previewPixel: { x: -1, y: -1 }
    }));
  }, [selectedColor]);

  // Update the visibility change handler
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        logger.log('🔴 Tab became visible - reconnecting Pusher');
        
        // Only proceed if both refs are available
        if (!containerRef.current || !canvasRef.current) return;
        
        const dpr = window.devicePixelRatio || 1;
        const containerWidth = containerRef.current.offsetWidth;
          
        // Now safe to update canvas dimensions
        canvasRef.current.width = containerWidth * dpr;
        canvasRef.current.height = containerWidth * dpr;
          
        // Reset overlay canvas as well if present
        if (overlayCanvasRef.current) {
          overlayCanvasRef.current.width = containerWidth * dpr;
          overlayCanvasRef.current.height = containerWidth * dpr;
        }
          
        // Update context and scale
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          ctx.scale(dpr, dpr);
          ctx.imageSmoothingEnabled = false;
        }

        // Use pusherManager to reconnect instead of direct channel access
        if (!pusherManager.isConnected()) {
          logger.log('🔴 Reconnecting via pusherManager');
          pusherManager.reconnect();
        }

        // Set up the event handler again using pusherManager
        pusherManager.subscribe('pixel-placed', (data: PixelPlacedEvent) => {
          logger.log('🔴 Pusher event received after reconnect:', {
            event: 'pixel-placed',
            pixel: data.pixel
          });
          
          if (!data.pixel.wallet_address) {
            logger.log('🔴 Pusher event ignored - missing wallet address');
            return;
          }
          
          queuePixelUpdate({
            x: data.pixel.x,
            y: data.pixel.y,
            color: data.pixel.color,
            wallet_address: data.pixel.wallet_address
          });
        });

        // Ensure we're marked as connected
        setPusherConnected(true);
        
        // Check if user has recently placed a pixel
        const pixelPlacedAt = localStorage.getItem('pixel_placed_at');
        const shouldForceRefresh = pixelPlacedAt ? 
                                  (Date.now() - parseInt(pixelPlacedAt)) < 60000 : false;
        
        // Load canvas state, force refresh if needed
        loadCanvasState(shouldForceRefresh);
        
        // Clear the placed pixel flag if it was used
        if (shouldForceRefresh) {
          localStorage.removeItem('pixel_placed_at');
        }
        
        // Clear any preview pixel
        drawPreviewPixel(-1, -1);
        setHoverData(null);
        onMousePosChange?.(null);
          
        // Force redraw
        needsRender.current = true;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [PIXEL_SIZE, loadCanvasState, drawPreviewPixel, onMousePosChange]);

  // Add this function to fetch user profiles
  const fetchUserProfile = async (walletAddress: string): Promise<UserProfile | null> => {
    // Check if we have a cached profile that's less than 10 seconds old
    const cachedProfile = userProfiles[walletAddress];
    const now = Date.now();
    
    if (cachedProfile && (now - cachedProfile.lastFetched < 10000)) {
      return cachedProfile.profile;
    }
    
    try {
      const response = await fetch(`/api/users/${walletAddress}`, {
        headers: {
          'Cache-Control': 'max-age=300, stale-while-revalidate=3600',
          'Vary': 'Accept-Encoding'
        }
      });
      
      if (!response.ok) {
        setUserProfiles(prev => ({
          ...prev,
          [walletAddress]: { profile: null, lastFetched: now }
        }));
        return null;
      }
      
      const data = await response.json();
      setUserProfiles(prev => ({
        ...prev,
        [walletAddress]: { profile: data, lastFetched: now }
      }));
      return data;
    } catch (error) {
      logger.error('Error fetching user profile:', error);
      setUserProfiles(prev => ({
        ...prev,
        [walletAddress]: { profile: null, lastFetched: now }
      }));
      return null;
    }
  };

  // Find the useEffect that sets the hover data or other appropriate place
  // Add this effect to fetch the wallet balance when hover data changes
  useEffect(() => {
    if (hoverData?.pixel?.wallet_address) {
      fetchUserProfile(hoverData.pixel.wallet_address);
    }
  }, [hoverData?.pixel?.wallet_address]);

  // Add this single useEffect to handle canvas visibility
  useEffect(() => {
    let lastVisibilityTime = Date.now();
    
    // Set up visibility change handler
    const visibilityHandler = async () => {
      if (document.visibilityState === 'visible') {
        logger.log('Tab became visible, refreshing canvas');
        
        // Set the render flag to trigger a redraw immediately
        needsRender.current = true;
        
        // Only do the expensive operations if we've been away for a while
        const now = Date.now();
        const timeAway = now - lastVisibilityTime;
        
        // If we've been away for more than 30 seconds, reconnect Pusher and fetch updates
        if (timeAway > 30000) {
          logger.log('Tab was away for more than 30 seconds, reconnecting Pusher');
          
          // Reconnect Pusher
          pusherManager.reconnect();
          
          // Rebind events directly with pusherManager
          pusherManager.subscribe('pixel-placed', (data: any) => {
            const { pixel } = data;
            if (!pixel) return;
            
            // Update local state with the new pixel
            setCanvasState(prev => ({
              ...prev,
              pixels: new Map(prev.pixels).set(`${pixel.x},${pixel.y}`, pixel)
            }));
            
            // Trigger render
            needsRender.current = true;
          });
          
          // Only fetch new pixels if we've been away for a significant time
          try {
            const response = await fetch('/api/pixels/recent?since=' + Math.floor(lastVisibilityTime / 1000));
            if (response.ok) {
              const data = await response.json();
              
              // Only update changed pixels instead of replacing the entire map
              setCanvasState(prev => {
                const newPixels = new Map(prev.pixels);
                data.pixels.forEach((pixel: any) => {
                  newPixels.set(`${pixel.x},${pixel.y}`, pixel);
                });
                
                return {
                  ...prev,
                  pixels: newPixels,
                  isLoading: false
                };
              });
            } else {
              // If the recent API fails, fall back to full refresh
              const fullResponse = await fetch('/api/pixels');
              if (fullResponse.ok) {
                const data = await fullResponse.json();
                
                setCanvasState(prev => ({
                  ...prev,
                  pixels: new Map(data.map((pixel: any) => 
                    [`${pixel.x},${pixel.y}`, pixel]
                  )),
                  isLoading: false
                }));
              }
            }
            
            needsRender.current = true;
          } catch (error) {
            logger.error('Failed to reload canvas state:', error);
          }
        }
        
        // Update the last visibility time
        lastVisibilityTime = now;
      } else {
        // Update the last visibility time when tab becomes hidden
        lastVisibilityTime = Date.now();
      }
    };
    
    document.addEventListener('visibilitychange', visibilityHandler);
    
    return () => {
      document.removeEventListener('visibilitychange', visibilityHandler);
    };
  }, []);

  // Add an effect to load the view state from localStorage on mount
  useEffect(() => {
    try {
      const savedViewState = localStorage.getItem('canvasViewState');
      if (savedViewState) {
        const viewState = JSON.parse(savedViewState);
        
        // Only apply if it's a valid view state
        if (viewState && 
            typeof viewState.x === 'number' && 
            typeof viewState.y === 'number' && 
            typeof viewState.scale === 'number') {
          
          // Ensure scale is within acceptable bounds
          const safeScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewState.scale));
          
          logger.log('🔄 Restoring saved canvas view state:', viewState);
          
          setCanvasState(prev => ({
            ...prev,
            view: {
              x: viewState.x,
              y: viewState.y,
              scale: safeScale
            }
          }));
          
          // Force a render with the restored view
          needsRender.current = true;
        }
      }
    } catch (error) {
      logger.error('Failed to restore canvas view state:', error);
    }
  }, []);

  // Enhanced useEffect for view state changes - save to localStorage reliably
  useEffect(() => {
    // Only save when not in initial loading state and after the canvas is fully initialized
    if (!canvasState.isLoading && canvasRef.current && needsRender.current) {
      try {
        localStorage.setItem('canvasViewState', JSON.stringify(canvasState.view));
        logger.log('💾 Canvas: View state saved to localStorage', {
          x: Math.round(canvasState.view.x),
          y: Math.round(canvasState.view.y),
          scale: canvasState.view.scale.toFixed(2)
        });
      } catch (error) {
        logger.error('Failed to save canvas view state:', error);
      }
    }
  }, [canvasState.view, canvasState.isLoading]);
  
  // Add an effect to save view state before unmounting 
  useEffect(() => {
    return () => {
      // Final save on unmount - flush any pending debounced saves
      debouncedSaveViewState.flush();
      
      // Also do a direct save to ensure latest state is captured
      try {
        localStorage.setItem('canvasViewState', JSON.stringify(canvasState.view));
        logger.log('💾 Canvas: Final view state saved before unmount');
      } catch (error) {
        logger.error('Failed to save final canvas view state:', error);
      }
    };
  }, [debouncedSaveViewState, canvasState.view]);

  // First, add a constant for the clank.fun link near other constants
  const BILLBOARD_TOKEN_URL = "https://clank.fun/t/0x0ab96f7a85f8480c0220296c3332488ce38d9818";

  // Add a function to determine if the user can place a pixel at the current hover position
  const canPlacePixelAtPosition = useCallback((x: number, y: number): { canPlace: boolean; reason: string; hasHtml: boolean; needsTokens: boolean } => {
    // First check if user is authenticated and profile is ready
    if (!authenticated) {
      return { canPlace: false, reason: "Sign in to place pixels", hasHtml: false, needsTokens: false };
    }
    
    if (!profileReady) {
      return { canPlace: false, reason: "Profile not ready", hasHtml: false, needsTokens: false };
    }
    
    if (isBanned) {
      return { canPlace: false, reason: "Your wallet has been banned", hasHtml: false, needsTokens: false };
    }

    // Check if we're in cooldown period
    if (nextPlacementTime && Date.now() < nextPlacementTime) {
      const secondsLeft = Math.ceil((nextPlacementTime - Date.now()) / 1000);
      return { canPlace: false, reason: `Cooldown: wait ${secondsLeft}s`, hasHtml: false, needsTokens: false };
    }

    // Get existing pixel data if any
    const pixelKey = `${x},${y}`;
    const existingPixel = canvasState.pixels.get(pixelKey);
    
    if (!existingPixel) {
      // No existing pixel, can always place
      return { canPlace: true, reason: "Ready to place", hasHtml: false, needsTokens: false };
    }

    // If it's the user's own pixel, they can overwrite it
    if (existingPixel.wallet_address && address && 
        existingPixel.wallet_address.toLowerCase() === address.toLowerCase()) {
      return { canPlace: true, reason: "Your own pixel", hasHtml: false, needsTokens: false };
    }

    // Check if the pixel is locked (explicit lock, not just tier protection)
    if (existingPixel.locked_until && Number(existingPixel.locked_until) > Date.now()) {
      const hoursLeft = Math.ceil((Number(existingPixel.locked_until) - Date.now()) / (1000 * 60 * 60));
      return { canPlace: false, reason: `Locked for ${hoursLeft}h`, hasHtml: false, needsTokens: false };
    }

    // Get both balances for comparison
    // Prioritize the live user profiles for current balances when available
    let ownerBalance = 0;
    const ownerWallet = existingPixel.wallet_address?.toLowerCase();
    
    // Try to get the most up-to-date balance for the owner
    if (ownerWallet && userProfiles[ownerWallet]?.profile?.token_balance !== undefined) {
      // Use the live profile data if available
      ownerBalance = userProfiles[ownerWallet].profile.token_balance || 0;
    } else {
      // Fall back to the balance stored with the pixel
      ownerBalance = existingPixel.token_balance || 0;
    }
    
    // Your balance
    const currentUserBalance = userProfile?.token_balance || 0;
    
    // Calculate protection based on token tiers
    const pixelAge = Date.now() - new Date(existingPixel.placed_at).getTime();
    const ownerTier = getClientTier(ownerBalance);
    
    // Check if protection is still active
    const protectionTimeMs = ownerTier.protectionTime * 60 * 60 * 1000;
    
    if (pixelAge < protectionTimeMs && ownerTier.protectionTime > 0) {
      // Pixel is under protection based on tier
      
      // During protection, you can only overwrite if your balance is STRICTLY greater
      if (currentUserBalance > ownerBalance) {
        return { 
          canPlace: true, 
          reason: `Protected but your balance is higher`,
          hasHtml: false,
          needsTokens: false
        };
      } else {
        const tokensNeeded = ownerBalance - currentUserBalance + 1;
        const hoursLeft = Math.ceil((protectionTimeMs - pixelAge) / (60 * 60 * 1000));
        const formattedTokens = formatBillboardAmount(tokensNeeded);
        // Create a hyperlinked message with HTML
        return { 
          canPlace: false, 
          reason: `Protected for ${hoursLeft}h, need ${formattedTokens} tokens. Press 'C' to buy.`,
          hasHtml: true,
          needsTokens: true
        };
      }
    }
    
    // Protection has expired
    return { canPlace: true, reason: "Protection expired", hasHtml: false, needsTokens: false };
  }, [authenticated, profileReady, isBanned, nextPlacementTime, canvasState.pixels, address, userProfile, userProfiles]);

  // Add a function to open the token purchase page
  const openTokenPurchasePage = useCallback(() => {
    window.open(BILLBOARD_TOKEN_URL, '_blank');
  }, []);

  // Add a keyboard event listener to handle the 'c' key for buying tokens
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if the key is 'c' or 'C'
      if ((e.key === 'c' || e.key === 'C') && hoverData) {
        const pixelStatus = canPlacePixelAtPosition(hoverData.x, hoverData.y);
        if (pixelStatus.needsTokens) {
          openTokenPurchasePage();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hoverData, canPlacePixelAtPosition, openTokenPurchasePage]);

  // Add a state to track when to show the buy tokens button
  const [showBuyTokensButton, setShowBuyTokensButton] = useState(false);
  // Track the position of the pixel that needs more tokens
  const [needTokensPosition, setNeedTokensPosition] = useState({ x: 0, y: 0 });

  // Add a ref to store the function to call when flash message is clicked
  const flashLinkAction = useRef<(() => void) | null>(null);

  // Create a dedicated function for handling real-time pixel updates
  const handleRealTimePixelUpdate = useCallback((data: any) => {
    if (!data || !data.pixel) return;
    
    const pixel = data.pixel;
    logger.log('🟢 Received real-time pixel update:', pixel);
    
    // Queue the update for processing
    queuePixelUpdate({
      x: pixel.x,
      y: pixel.y,
      color: pixel.color,
      wallet_address: pixel.wallet_address
    });
    
    // Force a render
    needsRender.current = true;
  }, [queuePixelUpdate]);

  // Set up Pusher subscription for real-time updates
  useEffect(() => {
    logger.log('Setting up Pusher subscription for real-time updates');
    
    // Subscribe to pixel-placed events
    pusherManager.subscribe('pixel-placed', handleRealTimePixelUpdate);
    
    // Cleanup on unmount
    return () => {
      pusherManager.unsubscribe('pixel-placed', handleRealTimePixelUpdate);
    };
  }, [handleRealTimePixelUpdate]);

  // Add visibility change handler to fetch recent pixels when returning to tab
  useEffect(() => {
    let lastVisibilityTime = Date.now();
    
    // Set up visibility change handler
    const visibilityHandler = async () => {
      if (document.visibilityState === 'visible') {
        logger.log('Tab became visible, refreshing canvas');
        
        // Set the render flag to trigger a redraw immediately
        needsRender.current = true;
        
        // Reconnect Pusher on visibility change
        pusherManager.reconnect();
        
        // Only fetch new data if we've been away for a while
        const now = Date.now();
        const timeAway = now - lastVisibilityTime;
        
        // If we've been away for more than 10 seconds, fetch updates
        if (timeAway > 10000) {
          logger.log('Tab was away for more than 10 seconds, fetching recent pixels');
          
          try {
            const response = await fetch('/api/pixels/recent?since=' + Math.floor(lastVisibilityTime / 1000));
            if (response.ok) {
              const data = await response.json();
              
              // Update changed pixels
              setCanvasState(prev => {
                const newPixels = new Map(prev.pixels);
                data.pixels.forEach((pixel: any) => {
                  newPixels.set(`${pixel.x},${pixel.y}`, pixel);
                });
                
                return {
                  ...prev,
                  pixels: newPixels,
                  isLoading: false
                };
              });
            }
            
            needsRender.current = true;
          } catch (error) {
            logger.error('Failed to reload canvas state:', error);
          }
        }
        
        // Update the last visibility time
        lastVisibilityTime = now;
      } else {
        // Update the last visibility time when tab becomes hidden
        lastVisibilityTime = Date.now();
      }
    };
    
    document.addEventListener('visibilitychange', visibilityHandler);
    
    return () => {
      document.removeEventListener('visibilitychange', visibilityHandler);
    };
  }, []);

  return (
    <div 
      ref={containerRef}
      className="relative bg-neutral-800 rounded-lg"
      style={{ 
        touchAction: 'none',
        overflow: 'hidden',
        width: '90vmin',
        height: '90vmin',
        maxWidth: '90vh',
        minWidth: '300px',
        margin: '0 auto',
        isolation: 'isolate',
        backfaceVisibility: 'hidden',
        transform: 'translateZ(0)',
        WebkitBackfaceVisibility: 'hidden',
        WebkitTransform: 'translateZ(0)'
      }}
    >
      {isSmallScreen && (
        <button
          onClick={toggleTouchMode}
          className="absolute top-2 left-2 z-50 bg-neutral-900/90 text-white px-2 py-1 rounded-full text-xs font-mono"
        >
          {touchMode === 'view' ? '👆' : '👁️'}
        </button>
      )}

      {/* Buy Tokens Button for mobile/touch users */}
      {showBuyTokensButton && (
        <div 
          className="fixed bottom-24 left-1/2 transform -translate-x-1/2 z-[100] animate-bounce"
        >
          <button
            className="px-4 py-2 rounded-lg bg-yellow-600 hover:bg-yellow-500 text-white font-bold shadow-lg flex items-center gap-2"
            onClick={openTokenPurchasePage}
          >
            <span>Buy $BILLBOARD Tokens</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="16" />
              <line x1="8" y1="12" x2="16" y2="12" />
            </svg>
          </button>
        </div>
      )}

      {/* Flash Message - keep within container but increase z-index */}
      {flashMessage && (
        <div className="fixed left-1/2 top-1/3 transform -translate-x-1/2 -translate-y-1/2 z-[100]">
          <div 
            onClick={() => flashLinkAction.current && flashLinkAction.current()}
            className={flashLinkAction.current ? "cursor-pointer" : ""}
          >
            <FlashMessage 
              message={flashMessage}
              hasLink={flashHasLink}
              duration={flashHasLink ? 15000 : 10000} // 15 seconds for links, 10 seconds for regular messages
              onComplete={() => {
                setFlashMessage(null);
                setFlashHasLink(false);
                flashLinkAction.current = null;
              }} 
            />
          </div>
        </div>
      )}
      
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleReactTouchStart}
        onTouchMove={handleReactTouchMove}
        onTouchEnd={handleReactTouchEnd}
        onContextMenu={(e) => e.preventDefault()}
        className="w-full h-full touch-none"
        style={{
          cursor: interactionState.isDragging ? 'grabbing' : 'default',
          imageRendering: 'pixelated',
          touchAction: 'none'
        }}
      />
      
      <canvas
        ref={overlayCanvasRef}
        className="absolute top-0 left-0 w-full h-full pointer-events-none"
        style={{
          imageRendering: 'pixelated'
        }}
      />
      
      {hoverData && hoverData.pixel && (
        <>
          {/* Invisible hover area */}
          <div 
            className="absolute bg-transparent"
            style={{
              left: hoverData.screenX,
              top: hoverData.screenY,
              width: `${(PIXEL_SIZE * canvasState.view.scale) + 100}px`,
              height: `${PIXEL_SIZE * canvasState.view.scale}px`,
              zIndex: 49,
              pointerEvents: 'none'
            }}
          />
          {/* Fixed Position Tooltip */}
          <div 
            className={`absolute top-[calc(2rem+44px)] right-2 z-50 rounded border transition-colors duration-300 ${
              hoverData && hoverData.pixel ? (
                canPlacePixelAtPosition(hoverData.x, hoverData.y).canPlace 
                  ? 'bg-green-900/90 border-green-700/90' 
                  : 'bg-red-900/90 border-red-700/90'
              ) : 'bg-neutral-900/90 border-neutral-700'
            }`}
            style={{
              fontFamily: 'var(--font-mono)',
              padding: '12px',
              pointerEvents: 'auto', // Allow interaction with the tooltip
              minWidth: '180px',
              maxWidth: '220px'  // Set a max width to prevent horizontal stretching
            }}
            onMouseEnter={() => handleTooltipInteraction(true)}
            onMouseLeave={() => handleTooltipInteraction(false)}
          >
            <div className="flex items-center gap-2 text-xs">
              {hoverData?.pixel?.farcaster_pfp && hoverData.pixel.farcaster_pfp !== 'null' && (
                <>
                  <FarcasterLogo className="text-purple-400" size="sm" />
                  <img 
                    src={hoverData.pixel.farcaster_pfp} 
                    alt="" 
                    className="w-4 h-4 rounded-full"
                    width={16}
                    height={16}
                    loading="eager"
                  />
                </>
              )}
              <span className={hoverData?.pixel?.farcaster_username && hoverData.pixel.farcaster_username !== 'null' ? "text-purple-400" : "text-blue-400"}>
                {hoverData?.pixel?.farcaster_username && hoverData.pixel.farcaster_username !== 'null' ? (
                  <a 
                    href={`https://warpcast.com/${hoverData.pixel.farcaster_username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-purple-300 transition-colors"
                  >
                    @{hoverData.pixel.farcaster_username}
                  </a>
                ) : (
                  hoverData?.pixel?.wallet_address && (
                    <a 
                      href={`https://etherscan.io/address/${hoverData.pixel.wallet_address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-blue-300 transition-colors"
                    >
                      {`${hoverData.pixel.wallet_address.slice(0, 6)}...${hoverData.pixel.wallet_address.slice(-4)}`}
                    </a>
                  )
                )}
              </span>
            </div>
            
            <div className="text-neutral-400 mt-1 text-xs">
              {hoverData.x}, {hoverData.y}
            </div>
            
            <div className="text-neutral-500 mt-0.5 text-xs">
              {formatTimeSince(hoverData.pixel.placed_at)} ago
            </div>
            
            {/* Tooltip balance - styling like in the screenshot */}
            <div className="text-yellow-400 text-xs">
              {hoverData?.pixel?.wallet_address && userProfiles[hoverData.pixel.wallet_address] ? 
                formatBillboardAmount(userProfiles[hoverData.pixel.wallet_address].profile?.token_balance ?? 0) : 
                hoverData?.pixel?.token_balance ? 
                formatBillboardAmount(hoverData.pixel.token_balance) :
                '0'
              }
            </div>
            
            <div className="text-yellow-400 text-xs">$BILLBOARD</div>
            
            {hoverData?.pixel?.wallet_address && userProfiles[hoverData.pixel.wallet_address] && (
              <div className="text-yellow-400 text-xs">(current)</div>
            )}
            
            {hoverData?.pixel?.locked_until && Number(hoverData.pixel.locked_until) > Date.now() && (
              <div className="text-yellow-400 mt-0.5 text-xs">
                🔒 Locked for {formatTimeSince(new Date(Number(hoverData.pixel.locked_until)).toISOString())}
              </div>
            )}
            
            {hoverData?.pixel?.version !== undefined && (
              <div className="text-neutral-500 text-xs mt-0.5">
                v{hoverData.pixel.version}
              </div>
            )}
            
            {/* Status indicator */}
            {authenticated && (
              <div className="mt-2 pt-1 border-t border-neutral-700/50">
                <div className={`text-xs ${
                  canPlacePixelAtPosition(hoverData.x, hoverData.y).canPlace
                    ? 'text-green-400'
                    : 'text-red-400'
                } break-words`}>
                  {canPlacePixelAtPosition(hoverData.x, hoverData.y).hasHtml ? (
                    <div dangerouslySetInnerHTML={{ __html: canPlacePixelAtPosition(hoverData.x, hoverData.y).reason }} />
                  ) : (
                    canPlacePixelAtPosition(hoverData.x, hoverData.y).reason
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
      
      {/* Simple coordinates tooltip when hovering empty pixels */}
      {hoverData && !hoverData.pixel && (
        <div 
          className={`absolute top-[calc(2rem+44px)] right-2 z-50 rounded px-3 py-1.5 text-xs font-mono border transition-colors duration-300 ${
            authenticated && canPlacePixelAtPosition(hoverData.x, hoverData.y).canPlace 
              ? 'bg-green-900/90 border-green-700/90' 
              : 'bg-red-900/90 border-red-700/90'
          }`}
          style={{
            fontFamily: 'var(--font-mono)',
            pointerEvents: 'none',
            maxWidth: '220px'  // Set a max width for empty pixel tooltip too
          }}
        >
          <div className="text-neutral-400">
            Empty pixel: {hoverData.x}, {hoverData.y}
          </div>
          
          {/* Status indicator for empty pixels */}
          {authenticated && (
            <div className={`mt-1 text-xs break-words ${
              canPlacePixelAtPosition(hoverData.x, hoverData.y).canPlace
                ? 'text-green-400'
                : 'text-red-400'
            }`}>
              {canPlacePixelAtPosition(hoverData.x, hoverData.y).hasHtml ? (
                <div dangerouslySetInnerHTML={{ __html: canPlacePixelAtPosition(hoverData.x, hoverData.y).reason }} />
              ) : (
                canPlacePixelAtPosition(hoverData.x, hoverData.y).reason
              )}
            </div>
          )}
        </div>
      )}
      
      {!canvasState.isLoading && !isSmallScreen && windowSize.width > 0 && (
        <div className="absolute bottom-4 right-4 z-50">
          <Minimap
            canvasSize={GRID_SIZE}
            viewportSize={{
              width: canvasSize / (PIXEL_SIZE * canvasState.view.scale),
              height: canvasSize / (PIXEL_SIZE * canvasState.view.scale)
            }}
            viewPosition={{
              x: -canvasState.view.x / (PIXEL_SIZE * canvasState.view.scale),
              y: -canvasState.view.y / (PIXEL_SIZE * canvasState.view.scale)
            }}
            pixels={new Map([...canvasState.pixels].map(([key, pixel]) => [key, pixel.color]))}
          />
        </div>
      )}
      {/* Status UI - more compact on mobile */}
      <div className="absolute top-2 right-2 z-50 bg-neutral-900/90 rounded-lg px-2 py-1 text-xs font-mono flex flex-col items-end gap-0.5">
        <div className="flex items-center">
          <div className="text-amber-400 flex-grow whitespace-nowrap">
            {formatBillboardAmount(userProfile?.token_balance || 0)}{isSmallScreen ? ' BB' : ' $BILLBOARD'}
          </div>
          <button 
            onClick={() => fetchBalance(true)} 
            className="ml-1.5 text-neutral-500 hover:text-neutral-300 transition-colors"
            title="Refresh token balance"
          >
            ↻
          </button>
        </div>
        <div className={`${!nextPlacementTime ? 'text-green-400' : 'text-neutral-400'} text-[10px] leading-tight`}>
          {!nextPlacementTime 
            ? (isSmallScreen ? 'Ready!' : 'Ready to place!') 
            : isSmallScreen 
              ? `${Math.max(0, Math.ceil((nextPlacementTime - Date.now()) / 1000))}s`
            : `Next Pixel: ${Math.max(0, Math.ceil((nextPlacementTime - Date.now()) / 1000))}s`}
        </div>
      </div>
    </div>
  );
});

export default Canvas;