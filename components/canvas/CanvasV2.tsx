'use client';

import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle, useCallback, memo } from 'react';
import { usePrivy, useWallets, getAccessToken } from '@privy-io/react-auth';
import { Minimap } from './MiniMap';
import { pusherClient } from '@/lib/client/pusher';
import { useFarcasterUser } from '@/components/farcaster/hooks/useFarcasterUser';
import Controls from '@/components/layout/Controls';
import { AdminTools } from '@/components/admin/AdminTools';
import { isAdmin } from '@/components/admin/utils';
// import SideColorPicker from './SideColorPicker';

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
  onClearSelection: (coordinates: Array<{x: number, y: number}>) => Promise<void>;
}

// Add interface for pixel data
interface PixelData {
  color: string;
  wallet_address?: string;
  farcaster_username?: string | null;
  farcaster_pfp?: string | null;
  placed_at: string;
  token_balance: number;
  locked_until?: string | null;
}

const Canvas = forwardRef<{ resetView: () => void; clearCanvas: () => void }, CanvasProps>(({ selectedColor, onColorSelect, authenticated, onAuthError, onMousePosChange, touchMode, onTouchModeChange, selectionMode, onClearSelection }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { user, login } = usePrivy();
  const { wallets } = useWallets();
  const activeWallet = wallets?.[0];
  const address = activeWallet?.address;
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number>(0);
  const pixelQueueRef = useRef<{x: number, y: number, color: string}[]>([]);

  // State
  const [pixels, setPixels] = useState<Map<string, PixelData>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState<ViewState>({
    x: 0,
    y: 0,
    scale: 1
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 });
  const [previewPixel, setPreviewPixel] = useState({ x: -1, y: -1 });
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const [isSmallScreen, setIsSmallScreen] = useState(false);
  const [pinchStart, setPinchStart] = useState(0);
  const [pinchScale, setPinchScale] = useState(1);
  const [clickStart, setClickStart] = useState<{ x: number, y: number, time: number } | null>(null);
  const [userProfile, setUserProfile] = useState<{
    farcaster_username: string | null;
    farcaster_pfp: string | null;
  } | null>(null);

  // Calculate dynamic canvas size
  const [canvasSize, setCanvasSize] = useState(600); // Default value

  const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });

  const [currentTime, setCurrentTime] = useState(Date.now());

  const [tooltipTimeout, setTooltipTimeout] = useState<NodeJS.Timeout | null>(null);

  // Add debug logging
  const [lastTouchAction, setLastTouchAction] = useState<string>('');

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

  // Add a ref to track recent placement
  const lastPlacementRef = useRef<number>(0);

  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{ x: number; y: number } | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isAdminMode, setIsAdminMode] = useState(false);

  useEffect(() => {
    const updateCanvasSize = () => {
      if (containerRef.current) {
        setCanvasSize(containerRef.current.offsetWidth);
      }
    };

    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);

    return () => {
      window.removeEventListener('resize', updateCanvasSize);
    };
  }, []);

  // Use dynamic canvas size in calculations
  const PIXEL_SIZE = canvasSize / GRID_SIZE;

  // Use your existing Farcaster hook
  const { farcasterUser } = useFarcasterUser(address);

  // Update the initial view calculation
  useEffect(() => {
    const containerWidth = containerRef.current?.offsetWidth || 600;
    const scale = containerWidth / (GRID_SIZE * PIXEL_SIZE);
    
    // Center the grid in the container
    const centerX = (containerWidth - (GRID_SIZE * PIXEL_SIZE * scale)) / 2;
    const centerY = (containerWidth - (GRID_SIZE * PIXEL_SIZE * scale)) / 2;
    
    setView({
      x: centerX,
      y: centerY,
      scale: scale
    });
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

    // Convert grid coordinates to screen coordinates using current view
    const screenX = x * PIXEL_SIZE * view.scale + view.x;
    const screenY = y * PIXEL_SIZE * view.scale + view.y;

    ctx.fillStyle = color;
    ctx.fillRect(
      screenX,
      screenY,
      PIXEL_SIZE * view.scale,
      PIXEL_SIZE * view.scale
    );
  }, [view, PIXEL_SIZE]);

  // Modify the initialization useEffect to only load pixels once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const containerWidth = containerRef.current?.offsetWidth || 600;
    
    canvas.width = containerWidth * dpr;
    canvas.height = containerWidth * dpr;
    ctx.scale(dpr, dpr);

    canvas.style.width = `${containerWidth}px`;
    canvas.style.height = `${containerWidth}px`;

    // Load initial pixels only once
    loadPixels();

    // Subscribe to Pusher updates
    const channel = pusherClient.subscribe('canvas');
    
    channel.bind('pixel-placed', (data: any) => {
      const { pixel } = data;
      if (!pixel) return;
      drawSinglePixel(pixel.x, pixel.y, pixel.color);
      setPixels(prev => {
        const newPixels = new Map(prev);
        newPixels.set(`${pixel.x},${pixel.y}`, pixel);
        return newPixels;
      });
    });

    return () => {
      channel.unbind_all();
      channel.unsubscribe();
    };
  }, []); // Remove drawSinglePixel from dependencies

  // Modify the loadPixels function to reduce logging
  const loadPixels = useCallback(async () => {
    try {
      const response = await fetch('/api/pixels');
      const data = await response.json();
      
      // Convert array to Map
      const pixelMap = new Map();
      data.forEach((pixel: any) => {
        pixelMap.set(`${pixel.x},${pixel.y}`, pixel);
      });
      
      setPixels(pixelMap);
    } catch (error) {
      console.error('Failed to load pixels:', error);
      setPixels(new Map());
      setFlashMessage('Failed to load canvas state');
    }
  }, []);

  // Modify resetView function
  const resetView = () => {
    const containerWidth = containerRef.current?.offsetWidth || 600;
    const scale = containerWidth / (GRID_SIZE * PIXEL_SIZE);
    
    const centerX = (containerWidth - (GRID_SIZE * PIXEL_SIZE * scale)) / 2;
    const centerY = (containerWidth - (GRID_SIZE * PIXEL_SIZE * scale)) / 2;
    
    setView({
      x: centerX,
      y: centerY,
      scale: scale
    });
  };

  // Expose methods to parent
  useImperativeHandle(ref, () => ({
    resetView,
    clearCanvas: () => setPixels(new Map())
  }));

  // Modify handleMouseDown
  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Calculate grid position
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const x = Math.floor((mouseX - view.x) / (PIXEL_SIZE * view.scale));
    const y = Math.floor((mouseY - view.y) / (PIXEL_SIZE * view.scale));

    // Right click or middle click is always drag
    if (e.button === 2 || e.button === 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setDragStartPos({ x: view.x, y: view.y });
      return;
    }

    // Left click within bounds and authenticated - prepare for potential pixel placement
    if (x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE && e.button === 0 && address) {
      setClickStart({ x, y, time: Date.now() });
    }

    // Start drag regardless of button (but store start position)
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setDragStartPos({ x: view.x, y: view.y });
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

  // Update handleMouseMove
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const canvasX = (e.clientX - rect.left);
    const canvasY = (e.clientY - rect.top);
    
    // Handle dragging first
    if (isDragging) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      
      setView(prev => ({
        ...prev,
        x: dragStartPos.x + dx,
        y: dragStartPos.y + dy
      }));
    }

    // Calculate grid position for hover/preview
    const x = Math.floor((canvasX - view.x) / (PIXEL_SIZE * view.scale));
    const y = Math.floor((canvasY - view.y) / (PIXEL_SIZE * view.scale));
    
    onMousePosChange({ x, y });

    // Check if we recently placed a pixel (within last 1000ms)
    const timeSincePlacement = Date.now() - lastPlacementRef.current;
    if (timeSincePlacement < 1000) {
      onMousePosChange(null); // Hide tooltip
      return;
    }

    // Only show tooltip if zoomed in enough and not dragging
    if (!isDragging && x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE) {
      const key = `${x},${y}`;
      const pixelData = pixels.get(key);

      // Check if mouse is within the current pixel bounds
      const pixelScreenX = x * PIXEL_SIZE * view.scale + view.x;
      const pixelScreenY = y * PIXEL_SIZE * view.scale + view.y;
      const isWithinPixel = 
        canvasX >= pixelScreenX && 
        canvasX <= pixelScreenX + (PIXEL_SIZE * view.scale) &&
        canvasY >= pixelScreenY && 
        canvasY <= pixelScreenY + (PIXEL_SIZE * view.scale);

      if (pixelData && view.scale >= TOOLTIP_ZOOM_THRESHOLD && isWithinPixel) {
        setHoverData({
          x,
          y,
          screenX: pixelScreenX,
          screenY: pixelScreenY,
          pixel: pixelData
        });
      } else {
        setHoverData(null);
      }
      setPreviewPixel({ x, y });
    } else {
      setHoverData(null);
      setPreviewPixel({ x: -1, y: -1 });
    }
  }, [pixels, view, PIXEL_SIZE, isDragging, dragStart, dragStartPos, onMousePosChange]);

  // Modify handleMouseUp
  const handleMouseUp = async (e: React.MouseEvent) => {
    if (!isDragging) return;

    const dx = Math.abs(e.clientX - dragStart.x);
    const dy = Math.abs(e.clientY - dragStart.y);
    const hasMoved = dx > 5 || dy > 5;

    setIsDragging(false);

    // Only place pixel if it's a left click, hasn't moved much, and we have a valid click start
    if (e.button === 0 && !hasMoved && clickStart && address) {
      const { x, y } = clickStart;
      try {
        await handlePlacePixel(x, y, selectedColor);
      } catch (error) {
        if (error instanceof Error && 
            (error.message.includes('auth') || error.message.includes('token'))) {
          onAuthError();
        }
      }
    }
    
    setClickStart(null);
  };

  // Add to handleMouseLeave
  const handleMouseLeave = (e: React.MouseEvent) => {
    setPreviewPixel({ x: -1, y: -1 });
    setHoverData(null);
  };

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (tooltipTimeout) {
        clearTimeout(tooltipTimeout);
      }
    };
  }, [tooltipTimeout]);

  // Add render callback
  const render = useCallback(() => {
    if (!canvasRef.current || !needsRender.current) return;
    
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    // Use existing canvas clearing and setup
    ctx.fillStyle = '#2C2C2C';
    ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);

    const gridPixelWidth = GRID_SIZE * PIXEL_SIZE * view.scale;
    const gridPixelHeight = GRID_SIZE * PIXEL_SIZE * view.scale;
    
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(
      view.x,
      view.y,
      gridPixelWidth,
      gridPixelHeight
    );

    // Keep existing pixel rendering
    pixels.forEach((pixel, key) => {
      const [x, y] = key.split(',').map(Number);
      const screenX = x * PIXEL_SIZE * view.scale + view.x;
      const screenY = y * PIXEL_SIZE * view.scale + view.y;
      
      ctx.fillStyle = pixel.color;
      ctx.fillRect(
        screenX,
        screenY,
        PIXEL_SIZE * view.scale,
        PIXEL_SIZE * view.scale
      );
    });

    ctx.strokeStyle = '#666666';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      view.x,
      view.y,
      gridPixelWidth,
      gridPixelHeight
    );

    // Draw selection rectangle if in selection mode
    if (isSelectionMode && selectionStart && selectionEnd) {
      const startX = Math.min(selectionStart.x, selectionEnd.x);
      const endX = Math.max(selectionStart.x, selectionEnd.x);
      const startY = Math.min(selectionStart.y, selectionEnd.y);
      const endY = Math.max(selectionStart.y, selectionEnd.y);

      ctx.strokeStyle = '#FF0000';
      ctx.lineWidth = 2;
      ctx.strokeRect(
        startX * PIXEL_SIZE * view.scale + view.x,
        startY * PIXEL_SIZE * view.scale + view.y,
        (endX - startX + 1) * PIXEL_SIZE * view.scale,
        (endY - startY + 1) * PIXEL_SIZE * view.scale
      );
    }

    needsRender.current = false;
  }, [pixels, view, isSelectionMode, selectionStart, selectionEnd, PIXEL_SIZE]);

  // Add RAF loop
  const animate = useCallback(() => {
    render();
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
  }, [view, pixels]);

  // Add this to debug what data we have available
  useEffect(() => {
    console.log('Privy user:', user);
  }, [user]);

  // Modify the placePixel function to use optimistic updates
  const handlePlacePixel = async (x: number, y: number, color: string) => {
    try {
      // Optimistically update the UI immediately
      const newPixel: PixelData = {
        color,
        wallet_address: address,
        farcaster_username: userProfile?.farcaster_username || null,
        farcaster_pfp: userProfile?.farcaster_pfp || null,
        placed_at: new Date().toISOString(),
        token_balance: 0
      };

      // Update local state and redraw
      setPixels(prev => {
        const newPixels = new Map(prev);
        newPixels.set(`${x},${y}`, newPixel);
        return newPixels;
      });
      drawSinglePixel(x, y, color);

      // Then send to server
      const response = await fetch('/api/pixels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': address,
          'x-privy-token': (await getAccessToken()) || ''
        },
        body: JSON.stringify({
          x,
          y,
          color
        })
      });

      if (!response.ok) {
        const data = await response.json();
        console.log('Response error:', { status: response.status, data });
        setFlashMessage(data.error || 'Failed to place pixel');
        
        // Revert the optimistic update on error
        setPixels(prev => {
          const newPixels = new Map(prev);
          newPixels.delete(`${x},${y}`);
          return newPixels;
        });
      }

      lastPlacementRef.current = Date.now(); // Record placement time
      onMousePosChange(null); // Hide tooltip immediately after placement
    } catch (error) {
      console.error('Failed to place pixel:', error);
      setFlashMessage(error instanceof Error ? error.message : 'Failed to place pixel');
    }
  };

  // Add useEffect to auto-clear flash message
  useEffect(() => {
    if (flashMessage) {
      const timer = setTimeout(() => setFlashMessage(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [flashMessage]);

  // Add these handlers to the Canvas component
  const handleTouchStart = (e: TouchEvent) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (e.touches.length === 2) {
      // Two finger touch - always handle pinch zoom
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const distance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch2.clientY
      );
      setPinchStart(distance);
      setPinchScale(view.scale);
    } else if (e.touches.length === 1) {
      const touch = e.touches[0];
      const x = Math.floor((touch.clientX - rect.left - view.x) / (PIXEL_SIZE * view.scale));
      const y = Math.floor((touch.clientY - rect.top - view.y) / (PIXEL_SIZE * view.scale));

      // Always set up for potential panning
      setIsDragging(true);
      setDragStart({
        x: touch.clientX,
        y: touch.clientY
      });
      setDragStartPos({ x: view.x, y: view.y });

      // In place mode, also set up for potential pixel placement
      if (touchMode === 'place' && x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE && address) {
        setClickStart({ x, y, time: Date.now() });
      }
    }
  };

  const handleTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    
    if (isDragging && e.touches.length === 1) {
      const touch = e.touches[0];
      const dx = touch.clientX - dragStart.x;
      const dy = touch.clientY - dragStart.y;
      
      setView(prev => ({
        ...prev,
        x: dragStartPos.x + dx,
        y: dragStartPos.y + dy
      }));
    }
  };

  const handleTouchEnd = (e: TouchEvent) => {
    if (clickStart && !isDragging) {
      // Only place pixel if we haven't dragged
      handlePlacePixel(clickStart.x, clickStart.y, selectedColor);
    }
    setIsDragging(false);
    setPinchStart(0);
    setClickStart(null);
  };

  // Add this helper function
  const hexToDecimal = (hex: string) => {
    // Remove '0x' prefix and any leading zeros
    const cleanHex = hex.replace('0x', '').replace(/^0+/, '');
    return BigInt('0x' + cleanHex).toString();
  };

  useEffect(() => {
    if (user?.id && address) {
      console.log('🔵 Creating user:', { 
        privy_id: user.id, 
        wallet_address: address.toLowerCase()
      });
      fetch('/api/users/check-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privy_id: user.id,
          wallet_address: address.toLowerCase()
        })
      })
      .then(async res => {
        const data = await res.json();
        console.log('🔵 Response from check-profile:', data);
        if (!res.ok) {
          throw new Error(data.error || 'Failed to check profile');
        }
        setUserProfile(data);
      })
      .catch(error => {
        console.error('🔴 Error checking profile:', error.message);
        setFlashMessage(error.message);
      });
    }
  }, [user?.id, address]);

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

  // Replace the handleWheel function with this adjusted version
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    setView(prev => {
      const delta = e.deltaY;
      const scaleChange = delta > 0 ? 0.9 : 1.1; // Adjusted to be less aggressive
      const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.scale * scaleChange));
      
      // Calculate the point to zoom towards (mouse position)
      const zoomPoint = {
        x: (mouseX - prev.x) / prev.scale,
        y: (mouseY - prev.y) / prev.scale
      };

      // Calculate new position that keeps the zoom point stationary
      return {
        scale: newScale,
        x: mouseX - zoomPoint.x * newScale,
        y: mouseY - zoomPoint.y * newScale
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
  }, [view.scale]);

  const toggleTouchMode = () => {
    onTouchModeChange(touchMode === 'view' ? 'place' : 'view');
  };

  // Add these handlers for React touch events on the canvas element
  const handleReactTouchStart = (e: React.TouchEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const touch = e.touches[0];
    const x = Math.floor((touch.clientX - rect.left - view.x) / (PIXEL_SIZE * view.scale));
    const y = Math.floor((touch.clientY - rect.top - view.y) / (PIXEL_SIZE * view.scale));

    if (touchMode === 'place' && x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE && address) {
      handlePlacePixel(x, y, selectedColor);
    } else if (touchMode === 'view' && x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE) {
      // Show tooltip without timeout - will persist until next touch
      const key = `${x},${y}`;
      const pixelData = pixels.get(key);
      if (pixelData) {
        const screenX = x * PIXEL_SIZE * view.scale + view.x;
        const screenY = y * PIXEL_SIZE * view.scale + view.y;
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
    setIsDragging(false);
    setDragStart({
      x: touch.clientX,
      y: touch.clientY
    });
    setDragStartPos({ x: view.x, y: view.y });
  };

  const handleReactTouchMove = (e: React.TouchEvent) => {
    // Clear tooltip when moving
    setHoverData(null);
    
    // ... rest of touch move handler
  };

  const handleReactTouchEnd = (e: React.TouchEvent) => {
    // Clear tooltip when touch ends
    setHoverData(null);
    
    setIsDragging(false);
    setPinchStart(0);
    setClickStart(null);
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

  // Add a debug log when canvas is mounted
  useEffect(() => {
    console.log('Canvas mounted:', {
      canvasRef,
      hasCanvas: !!canvasRef.current,
      element: document.querySelector('canvas')
    });
  }, []);

  // Render canvas
  useEffect(() => {
    if (isLoading || !canvasRef.current) return;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    // Clear canvas with gray background
    ctx.fillStyle = '#2C2C2C';
    ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);

    // Draw white background for the pixel grid area
    const gridPixelWidth = GRID_SIZE * PIXEL_SIZE * view.scale;
    const gridPixelHeight = GRID_SIZE * PIXEL_SIZE * view.scale;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(
      view.x,
      view.y,
      gridPixelWidth,
      gridPixelHeight
    );

    // Draw pixels with proper scaling and position
    pixels.forEach((pixel, key) => {
      const [x, y] = key.split(',').map(Number);
      const screenX = x * PIXEL_SIZE * view.scale + view.x;
      const screenY = y * PIXEL_SIZE * view.scale + view.y;
      
      ctx.fillStyle = pixel.color;
      ctx.fillRect(
        screenX,
        screenY,
        PIXEL_SIZE * view.scale,
        PIXEL_SIZE * view.scale
      );
    });

    // Draw preview pixel if valid position
    if (previewPixel.x !== -1 && previewPixel.y !== -1 && !isDragging) {
      const screenX = previewPixel.x * PIXEL_SIZE * view.scale + view.x;
      const screenY = previewPixel.y * PIXEL_SIZE * view.scale + view.y;
      
      ctx.fillStyle = selectedColor + '80'; // 50% opacity
      ctx.fillRect(
        screenX,
        screenY,
        PIXEL_SIZE * view.scale,
        PIXEL_SIZE * view.scale
      );
    }

    // Draw grid when zoomed in
    if (view.scale > 4) {
      ctx.strokeStyle = '#CCCCCC';
      ctx.lineWidth = 0.5;
      
      for (let x = 0; x <= GRID_SIZE; x++) {
        const screenX = x * PIXEL_SIZE * view.scale + view.x;
        ctx.beginPath();
        ctx.moveTo(screenX, view.y);
        ctx.lineTo(screenX, GRID_SIZE * PIXEL_SIZE * view.scale + view.y);
        ctx.stroke();
      }

      for (let y = 0; y <= GRID_SIZE; y++) {
        const screenY = y * PIXEL_SIZE * view.scale + view.y;
        ctx.beginPath();
        ctx.moveTo(view.x, screenY);
        ctx.lineTo(GRID_SIZE * PIXEL_SIZE * view.scale + view.x, screenY);
        ctx.stroke();
      }
    }

    // Draw border
    ctx.strokeStyle = '#666666';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      view.x,
      view.y,
      gridPixelWidth,
      gridPixelHeight
    );
  }, [pixels, isLoading, view, PIXEL_SIZE]);

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

    const x = Math.floor((e.clientX - rect.left - view.x) / (PIXEL_SIZE * view.scale));
    const y = Math.floor((e.clientY - rect.top - view.y) / (PIXEL_SIZE * view.scale));
    
    setSelectionStart({ x, y });
    setSelectionEnd({ x, y });
  }, [view, isSelectionMode, PIXEL_SIZE]);

  const handleSelectionMove = useCallback((e: MouseEvent) => {
    if (!isSelectionMode || !selectionStart) return;
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = Math.floor((e.clientX - rect.left - view.x) / (PIXEL_SIZE * view.scale));
    const y = Math.floor((e.clientY - rect.top - view.y) / (PIXEL_SIZE * view.scale));
    
    setSelectionEnd({ x, y });
  }, [view, isSelectionMode, selectionStart, PIXEL_SIZE]);

  const handleSelectionEnd = useCallback(async () => {
    if (!selectionStart || !selectionEnd) return;

    const startX = Math.min(selectionStart.x, selectionEnd.x);
    const endX = Math.max(selectionStart.x, selectionEnd.x);
    const startY = Math.min(selectionStart.y, selectionEnd.y);
    const endY = Math.max(selectionStart.y, selectionEnd.y);

    try {
      const response = await fetch('/api/admin/clear', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': address || ''
        },
        body: JSON.stringify({ startX, startY, endX, endY })
      });

      if (!response.ok) throw new Error('Failed to clear selection');
      
      setSelectionStart(null);
      setSelectionEnd(null);
    } catch (error) {
      console.error('Failed to clear selection:', error);
    }
  }, [selectionStart, selectionEnd, address]);

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
  const handleSelectionModeToggle = (enabled: boolean) => {
    setIsSelectionMode(enabled);
    setSelectionStart(null);
    setSelectionEnd(null);
  };

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
          className="absolute top-2 right-2 z-50 bg-neutral-900/90 text-white px-2 py-1 rounded-full text-xs font-mono"
        >
          {touchMode === 'view' ? '👆' : '👁️'}
        </button>
      )}
      {/* Flash Message - keep within container but increase z-index */}
      {flashMessage && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[100] bg-black/90 text-white px-4 py-2 rounded-lg">
          {flashMessage}
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
          cursor: isDragging ? 'grabbing' : 'default',
          imageRendering: 'pixelated',
          touchAction: 'none'
        }}
      />
      
      {hoverData && (
        <>
          {/* Invisible hover area */}
          <div 
            className="absolute bg-transparent"
            style={{
              left: hoverData.screenX,
              top: hoverData.screenY,
              width: `${(PIXEL_SIZE * view.scale) + 100}px`,
              height: `${PIXEL_SIZE * view.scale}px`,
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
              left: hoverData.screenX + (PIXEL_SIZE * view.scale),
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
                <img 
                  src={hoverData.pixel.farcaster_pfp} 
                  alt="" 
                  className="w-4 h-4 rounded-full"
                  loading="eager"
                />
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
            <div className="text-amber-400 mt-0.5">
              {formatNumber(hoverData.pixel!.token_balance ?? 0)} $BILLBOARD
            </div>
            {hoverData?.pixel?.locked_until && Number(hoverData.pixel.locked_until) > Date.now() && (
              <div className="text-yellow-400 mt-0.5">
                🔒 Locked for {formatTimeSince(new Date(Number(hoverData.pixel.locked_until)).toISOString())}
              </div>
            )}
          </div>
        </>
      )}
      {!isLoading && (
        <Minimap
          canvasSize={GRID_SIZE}
          viewportSize={{
            width: canvasSize / (PIXEL_SIZE * view.scale),
            height: canvasSize / (PIXEL_SIZE * view.scale)
          }}
          viewPosition={{
            x: -view.x / (PIXEL_SIZE * view.scale),
            y: -view.y / (PIXEL_SIZE * view.scale)
          }}
          pixels={new Map([...pixels].map(([key, pixel]) => [key, pixel.color]))}
        />
      )}
    </div>
  );
});

export default Canvas;