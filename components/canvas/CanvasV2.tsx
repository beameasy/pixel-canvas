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
    previewPixel: { x: -1, y: -1 }
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
    if (pixelUpdateQueue.current.length === 0) {
      isProcessingUpdates.current = false;
      return;
    }

    isProcessingUpdates.current = true;
    
    // Process up to 10 updates per frame
    const updates = pixelUpdateQueue.current.splice(0, 10);
    
    setCanvasState(prev => {
      const newPixels = new Map(prev.pixels);
      updates.forEach(update => {
        const key = `${update.x},${update.y}`;
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
      requestAnimationFrame(processPixelUpdates);
    } else {
      isProcessingUpdates.current = false;
    }
  }, []);

  // Update the queuePixelUpdate function to include required fields
  const queuePixelUpdate = useCallback((pixel: {x: number, y: number, color: string, wallet_address: string}) => {
    pixelUpdateQueue.current.push(pixel); // Push the original pixel data
    if (!isProcessingUpdates.current) {
      requestAnimationFrame(processPixelUpdates);
    }
  }, [processPixelUpdates]);

  useEffect(() => {
    const channel = getCanvasChannel();
    
    // Handle connection state
    channel.bind('pusher:subscription_succeeded', () => {
      setPusherConnected(true);
    });

    channel.bind('pusher:subscription_error', () => {
      console.error('Pusher subscription failed');
      setPusherConnected(false);
    });

    // Handle pixel updates
    channel.bind('pixel-placed', (data: PixelPlacedEvent) => {
      if (!pusherConnected || !data.pixel.wallet_address) return;
      queuePixelUpdate({
        x: data.pixel.x,
        y: data.pixel.y,
        color: data.pixel.color,
        wallet_address: data.pixel.wallet_address
      });
    });

    return () => {
      channel.unbind_all();
      channel.unsubscribe();
      setPusherConnected(false);
    };
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

  // Update the loadCanvasState function
  const loadCanvasState = useCallback(async (force = false) => {
    try {
      // Add ETag support and cache control
      const headers: HeadersInit = {
        'Cache-Control': force ? 'no-cache, no-store' : 'max-age=30',
        'Pragma': force ? 'no-cache' : ''
      };
      
      const response = await fetch('/api/canvas', { headers });
      if (!response.ok) throw new Error('Failed to load canvas state');
      
      // Only update if we got new data (not a 304)
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
      }
    } catch (error) {
      console.error('Failed to load canvas state:', error);
    }
  }, []);

  // Update the initial load effect
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    const loadInitial = async () => {
      try {
        // Start listening for real-time updates before loading full state
        const channel = getCanvasChannel();
        channel.bind('pusher:subscription_succeeded', () => {
          setPusherConnected(true);
        });
        
        // Then load the full state
        await loadCanvasState(true); // Force fresh load on initial render
        
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
        console.error('Failed to load initial data:', error);
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
        console.error("Failed to fetch profile/balance:", error);
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
      console.error('Failed to load pixels:', error);
      setFlashMessage('Failed to load canvas state');
    }
  }, []);

  // Modify resetView function
  const resetView = () => {
    const containerWidth = containerRef.current?.offsetWidth || 600;
    const scale = containerWidth / (GRID_SIZE * PIXEL_SIZE);
    
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
    shareCanvas
  }), [resetView, shareCanvas]);

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
        dragStartPos: { x: canvasState.view.x, y: canvasState.view.y }
      }));
      return;
    }

    // Normal pixel placement mode
    if (x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE && e.button === 0 && address) {
      setInteractionState(prev => ({
        ...prev,
        previewPixel: { x, y }
      }));
    }

    setInteractionState(prev => ({
      ...prev,
      isDragging: true,
      dragStart: { x: e.clientX, y: e.clientY },
      dragStartPos: { x: canvasState.view.x, y: canvasState.view.y }
    }));
  };

  // Add this helper function
  const formatTimeSince = (dateString: string) => {
    const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
    
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
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

  // Update handleMouseMove
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
        setHoverData({
          x,
          y,
          screenX: x * PIXEL_SIZE * canvasState.view.scale + canvasState.view.x,
          screenY: y * PIXEL_SIZE * canvasState.view.scale + canvasState.view.y,
          pixel: pixelData || null
        });
      }
    } else {
      setHoverData(null);
    }
  }, [canvasState.pixels, canvasState.view, interactionState.isDragging, interactionState.dragStart, interactionState.dragStartPos, onMousePosChange, drawPreviewPixel]);

  const handleMouseLeave = useCallback(() => {
    drawPreviewPixel(-1, -1);
    setHoverData(null);
  }, [drawPreviewPixel]);

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

  // Optimize render function with useMemo
  const render = useMemo(() => {
    if (!canvasRef.current || !needsRender.current) return;
    
    return () => {
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;

      ctx.save();
      
      // First fill entire canvas with dark background
      ctx.fillStyle = '#1F1F1F'; // Dark gray background
      ctx.fillRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);

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

      // Draw all pixels
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

      // Always draw grid when zoomed in
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
      needsRender.current = false;
    };
  }, [canvasState.pixels, canvasState.view, PIXEL_SIZE]);

  // Add RAF loop
  const animate = useCallback(() => {
    if (render) render();
    rafRef.current = requestAnimationFrame(animate);
  }, [render]);

  // Start RAF immediately on mount
  useEffect(() => {
    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [animate]);

  // Request render when view or pixels change
  useEffect(() => {
    needsRender.current = true;
  }, [canvasState.view, canvasState.pixels]);

  // Update the fetchBalance function to accept a force parameter and respect profileReady
  const fetchBalance = useCallback(async (force = false) => {
    if (!authenticated) {
      console.log("💰 [Balance] Not authenticated, skipping balance fetch");
      return;
    }
    
    if (isBanned) {
      console.log("🚫 [Balance] Wallet is banned, skipping balance fetch");
      return;
    }

    if (!profileReady) {
      console.log("💰 [Balance] Profile not ready, skipping balance fetch");
      return;
    }
    
    const now = Date.now();
    // Skip if recently fetched and not forced
    if (!force && now - lastBalanceFetchTime.current < BALANCE_FETCH_COOLDOWN) {
      console.log('🔵 Balance fetch skipped (cooldown active)');
      return;
    }
    
    try {
      console.log(`🔵 Fetching balance for: ${address}${force ? ' (forced)' : ''}`);
      const token = await getAccessToken();
      
      // Add cache-busting parameter when forced
      const cacheBuster = force ? `?t=${now}` : '';
      
      const response = await fetch(`/api/users/balance${cacheBuster}`, {
        headers: {
          'x-wallet-address': address || '',
          ...(token && { 'x-privy-token': token }),
          // Add no-cache header when forcing refresh
          ...(force && { 'Cache-Control': 'no-cache, no-store' })
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
        console.log('🔵 Balance updated:', {
          new: Number(data.balance),
          old: userProfile?.token_balance,
          timestamp: now
        });
      }
    } catch (error) {
      console.error('Failed to fetch balance:', error);
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
      return;
    }
    
    if (!profileReady) {
      console.warn("Profile not ready, cannot place pixel yet");
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
        dragStart: { x: midX, y: midY }
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
        dragStartPos: { x: canvasState.view.x, y: canvasState.view.y }
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
      
      setCanvasState(prev => ({
        ...prev,
        view: {
          ...prev.view,
          x: interactionState.dragStartPos.x + dx,
          y: interactionState.dragStartPos.y + dy
        }
      }));
      
      // Clear preview pixel if we've dragged more than a few pixels
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        setInteractionState(prev => ({
          ...prev,
          previewPixel: { x: -1, y: -1 }
        }));
      }
    }
  }, [interactionState.isDragging, interactionState.dragStart, interactionState.dragStartPos, pinchStart, pinchScale]);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    e.preventDefault();
    
    // Only attempt to place a pixel if:
    // 1. We have a preview pixel with valid coordinates
    // 2. We haven't dragged significantly
    // 3. We're ending a single touch (not a pinch)
    if (
      interactionState.previewPixel.x >= 0 && 
      interactionState.previewPixel.x < GRID_SIZE &&
      interactionState.previewPixel.y >= 0 && 
      interactionState.previewPixel.y < GRID_SIZE &&
      !interactionState.isDragging &&
      e.touches.length === 0 && 
      e.changedTouches.length === 1
    ) {
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
      previewPixel: { x: -1, y: -1 }
    }));
    setPinchStart(0);
  }, [interactionState.previewPixel, interactionState.isDragging, selectedColor, handlePlacePixel]);

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
          console.warn('Failed to fetch Farcaster profile:', response.status);
          return;
        }
        
        const data = await response.json();
        setUserProfile(data);
      } catch (error) {
        console.error('Error fetching Farcaster profile:', error);
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

  // Add zoom handling to clear preview
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    
    // Clear preview pixel during zoom
    const canvas = overlayCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setInteractionState(prev => ({
      ...prev,
      previewPixel: { x: -1, y: -1 }
    }));
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    setCanvasState(prev => {
      const delta = e.deltaY;
      const scaleChange = delta > 0 ? 0.9 : 1.1;
      const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.view.scale * scaleChange));
      
      return {
        ...prev,
        view: {
          scale: newScale,
          x: mouseX - (mouseX - prev.view.x) * (newScale / prev.view.scale),
          y: mouseY - (mouseY - prev.view.y) * (newScale / prev.view.scale)
        }
      };
    });
  }, []);

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
    
    setInteractionState(prev => ({
      ...prev,
      isDragging: false
    }));
  };

  // Add useEffect to monitor canvasRef
  useEffect(() => {
    console.log('Canvas component - canvasRef updated:', {
      ref: canvasRef,
      current: canvasRef.current,
      element: document.querySelector('canvas')
    });
  }, [canvasRef.current]);

  // Log only when the canvas element is mounted/unmounted
  useEffect(() => {
    if (canvasRef.current) {
      console.log('Canvas mounted:', canvasRef.current);
    }
    return () => {
      console.log('Canvas unmounting');
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
      console.log('Successfully queued wallet ban:', wallet);
    } catch (error) {
      console.error('Failed to ban wallet:', error);
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
      console.error('Failed to clear selection:', error);
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
      console.error('Failed to clear selection:', error);
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
      console.log('🟣 Significant state change:', {
        type: data.type,
        key: data.key,
        balance: data.balance 
      });
    }
  }, []);

  // For pixel placement, consolidate logs
  const handlePixelPlacement = async (x: number, y: number, color: string) => {
    try {
      // Check if the wallet is banned before proceeding
      if (isBanned) {
        console.log('🚫 Cannot place pixel: Wallet is banned');
        setFlashMessage('Your wallet has been banned from placing pixels');
        return false;
      }
      
      console.log('🎨 Starting pixel placement:', { x, y, color });
      const previousPixel = canvasState.pixels.get(`${x},${y}`);
      console.log('🎨 Previous pixel state:', previousPixel);

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
          'x-privy-token': (await getAccessToken()) || ''
        },
        body: JSON.stringify({ 
          x, 
          y, 
          color,
          version: previousPixel?.version || 0  // Send current version for conflict detection
        })
      });

      console.log('🎨 API response status:', response.status);

      if (!response.ok) {
        console.log('🎨 Placement failed, reverting to previous state');
        const error = await response.json();
        console.log('🔵 Received error:', error);
        
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
        
        // Special handling for version conflicts
        if (response.status === 409 && error.currentVersion) {
          // If we have a version conflict, fetch the latest canvas state
          console.log('🔄 Version conflict detected, refreshing canvas state');
          setFlashMessage('Pixel was modified by someone else. Canvas refreshed.');
          loadCanvasState(true); // Force refresh the canvas state
        } else if (response.status === 403 && error.banned) {
          // Specific handling for banned wallets
          console.log('🚫 Received ban response from server');
          setFlashMessage(error.error || 'Your wallet has been banned from placing pixels');
          // No need to update isBanned state here as it's already managed by the hook
        } else {
          throw new Error(error.error || 'Failed to place pixel');
        }
        return false;
      }

      // Update with confirmed data from server
      console.log('🎨 Placement succeeded, updating with server data');
      const data = await response.json();
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
      console.log(`🕒 Cooldown set: ${cooldownMs/1000}s until next pixel placement`);
      
      // Force refresh the token balance from Alchemy
      setTimeout(() => {
        console.log('🔄 Refreshing token balance after pixel placement');
        fetchBalance(true);
      }, 500); // Small delay to ensure backend has time to set the flag
    } catch (error) {
      console.error('Failed to place pixel:', error);
      setFlashMessage(error instanceof Error ? error.message : 'Failed to place pixel');
      return false;
    }
    
    return true;
  };

  // Add initialization for overlay canvas
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    // Get DPR for retina displays
    const dpr = window.devicePixelRatio || 1;
    
    // Set canvas size based on container
    const containerWidth = containerRef.current.offsetWidth;
    canvasRef.current.width = containerWidth * dpr;
    canvasRef.current.height = containerWidth * dpr;
    
    // Set display size
    canvasRef.current.style.width = `${containerWidth}px`;
    canvasRef.current.style.height = `${containerWidth}px`;

    // Enable pixel-perfect rendering
    const ctx = canvasRef.current.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.imageSmoothingEnabled = false;
    }

    needsRender.current = true;
  }, [containerRef.current, canvasRef.current]);

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
    console.log('🔵 User profile updated:', {
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
        // Re-initialize canvas dimensions
        if (containerRef.current && canvasRef.current) {
          const dpr = window.devicePixelRatio || 1;
          const containerWidth = containerRef.current.offsetWidth;
          
          // Reset canvas dimensions
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

          // Force refresh canvas state from server
          loadCanvasState(true);
          
          // Restore view state
          const scale = containerWidth / (GRID_SIZE * PIXEL_SIZE);
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
          
          // Force redraw
          needsRender.current = true;
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [PIXEL_SIZE, loadCanvasState]);

  // Add this function to fetch user profiles
  const fetchUserProfile = async (walletAddress: string): Promise<UserProfile | null> => {
    // Check if we have a cached profile that's less than 1 minute old
    const cachedProfile = userProfiles[walletAddress];
    const now = Date.now();
    
    if (cachedProfile && (now - cachedProfile.lastFetched < 60000)) {
      return cachedProfile.profile;
    }
    
    try {
      const response = await fetch(`/api/users/${walletAddress}`);
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
      console.error('Error fetching user profile:', error);
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
      {/* Flash Message - keep within container but increase z-index */}
      {flashMessage && (
        <div className="fixed left-1/2 top-32 transform -translate-x-1/2 z-50">
          <FlashMessage 
            message={flashMessage} 
            onComplete={() => setFlashMessage(null)} 
          />
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
            onMouseEnter={() => {
              if (window.tooltipTimeout) {
                clearTimeout(window.tooltipTimeout);
              }
              setHoverData(hoverData);
            }}
          />
          {/* Tooltip */}
          <div 
            className="absolute bg-neutral-900/90 rounded px-2 py-1 text-xs border border-neutral-700"
            style={{
              left: hoverData.screenX + (PIXEL_SIZE * canvasState.view.scale),
              top: hoverData.screenY,
              fontFamily: 'var(--font-mono)',
              zIndex: 50,
              maxWidth: '200px',
              padding: '8px',
              transform: 'translateY(-25%)',
              pointerEvents: 'auto'
            }}
            onMouseEnter={() => {
              if (window.tooltipTimeout) {
                clearTimeout(window.tooltipTimeout);
              }
              setHoverData(hoverData);
            }}
            onMouseLeave={() => {
              window.tooltipTimeout = setTimeout(() => {
                setHoverData(null);
              }, 300);
            }}
          >
            <div className="flex items-center gap-2">
              {hoverData?.pixel?.farcaster_pfp && (
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
              <span className="text-purple-400">
                {hoverData?.pixel?.farcaster_username ? (
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
                      className="hover:text-purple-300 transition-colors"
                    >
                      {`${hoverData.pixel.wallet_address.slice(0, 6)}...${hoverData.pixel.wallet_address.slice(-4)}`}
                    </a>
                  )
                )}
              </span>
            </div>
            <div className="text-neutral-400 mt-1">
              {hoverData.x}, {hoverData.y}
            </div>
            <div className="text-neutral-500 mt-0.5">
              {hoverData?.pixel?.placed_at && formatTimeSince(hoverData.pixel.placed_at)} ago
            </div>
            {/* Tooltip balance */}
            <div className="text-amber-400 mt-0.5">
              {hoverData?.pixel?.wallet_address && userProfiles[hoverData.pixel.wallet_address] ? 
                `${formatBillboardAmount(userProfiles[hoverData.pixel.wallet_address].profile?.token_balance ?? 0)} $BILLBOARD (current)` : 
                hoverData?.pixel?.token_balance ? 
                `${formatBillboardAmount(hoverData.pixel.token_balance)} $BILLBOARD (at placement)` :
                '0 $BILLBOARD'
              }
            </div>
            {hoverData?.pixel?.locked_until && Number(hoverData.pixel.locked_until) > Date.now() && (
              <div className="text-yellow-400 mt-0.5">
                🔒 Locked for {formatTimeSince(new Date(Number(hoverData.pixel.locked_until)).toISOString())}
              </div>
            )}
          </div>
        </>
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