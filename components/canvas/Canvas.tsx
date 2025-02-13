'use client';

import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle, useCallback, memo } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { usePrivy, useWallets, getAccessToken } from '@privy-io/react-auth';
import { useFarcasterUser } from '@/components/farcaster/hooks/useFarcasterUser';
import MiniMap from './MiniMap';
// import SideColorPicker from './SideColorPicker';

// Constants
const GRID_SIZE = 200;        // Keep grid size the same
const MIN_ZOOM = 0.5;         // Reintroduce MIN_ZOOM
const MAX_ZOOM = 20;          // Reintroduce MAX_ZOOM

interface ViewState {
  x: number;
  y: number;
  scale: number;
}

interface CanvasProps {
  selectedColor: string;
  // onColorSelect: (color: string) => void; // Remove if not used
  authenticated: boolean;
  onAuthError: () => void;
  onMousePosChange: (x: number, y: number) => void;
  ref?: React.ForwardedRef<{
    resetView: () => void;
    clearCanvas: () => void;
  }>;
}

const DEBUG = false;  // Add at top of component

const Canvas = forwardRef<{ resetView: () => void; clearCanvas: () => void }, CanvasProps>(({ selectedColor, authenticated, onAuthError, onMousePosChange }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { user } = usePrivy();
  const { wallets } = useWallets();
  const activeWallet = wallets?.[0];
  const address = activeWallet?.address;
  const containerRef = useRef<HTMLDivElement>(null);

  // State
  const [pixels, setPixels] = useState<Map<string, string>>(new Map());
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
  const [clickStart, setClickStart] = useState<{ x: number, y: number } | null>(null);

  // Calculate dynamic canvas size
  const [canvasSize, setCanvasSize] = useState(600); // Default value

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

  // Initialize canvas and load pixels - EXACTLY as in your original code
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const containerWidth = containerRef.current?.offsetWidth || 600;
    
    // Set canvas size to match container
    canvas.width = containerWidth * dpr;
    canvas.height = containerWidth * dpr;
    ctx.scale(dpr, dpr);

    canvas.style.width = `${containerWidth}px`;
    canvas.style.height = `${containerWidth}px`;

    // Load initial pixels
    loadPixels();

    // Subscribe to pixel updates
    const subscription = supabase
      .channel('pixels')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'pixels' },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const { x, y, color } = payload.new;
            // Draw the new pixel directly
            drawSinglePixel(x, y, color);
            // Update the pixels map
            setPixels(prev => {
              const newPixels = new Map(prev);
              newPixels.set(`${x},${y}`, color);
              return newPixels;
            });
          }
        }
      )
      .subscribe();

    // Add event listener with { passive: false }
    const handleWheelEvent = (e: WheelEvent) => {
      e.preventDefault();
      const isZooming = e.ctrlKey || e.metaKey || e.deltaMode === WheelEvent.DOM_DELTA_PIXEL;
      
      if (isZooming) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left);
        const mouseY = (e.clientY - rect.top);

        const zoomAmount = e.deltaY * -0.005;
        
        setView(prev => {
          const newScale = Math.min(Math.max(prev.scale * (1 + zoomAmount), MIN_ZOOM), MAX_ZOOM);
          const scaleFactor = newScale / prev.scale;
          
          const newX = mouseX - (mouseX - prev.x) * scaleFactor;
          const newY = mouseY - (mouseY - prev.y) * scaleFactor;
          
          return {
            scale: newScale,
            x: newX,
            y: newY
          };
        });
      } else if (!isDragging) {
        setView(prev => ({
          ...prev,
          y: prev.y - e.deltaY
        }));
      }
    };

    canvas.addEventListener('wheel', handleWheelEvent, { passive: false });

    return () => {
      subscription.unsubscribe();
      canvas.removeEventListener('wheel', handleWheelEvent);
    };
  }, [isDragging, PIXEL_SIZE, drawSinglePixel]);

  // Load all pixels (most recent state for each coordinate)
  const loadPixels = useCallback(async () => {
    try {
      const response = await fetch('/api/pixels');
      const data = await response.json();
      // Convert array to Map if needed
      setPixels(new Map(Array.isArray(data) ? data : []));
    } catch (error) {
      console.error('Failed to load pixels:', error);
      setPixels(new Map());
      setFlashMessage('Failed to load canvas state');
    }
  }, []);

  useEffect(() => {
    loadPixels();
  }, [loadPixels]);

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

    if (e.button === 0 && address) {
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      // Calculate grid coordinates with centered offset
      const x = Math.floor((mouseX - view.x) / (PIXEL_SIZE * view.scale));
      const y = Math.floor((mouseY - view.y) / (PIXEL_SIZE * view.scale));
      
      console.log('🖱️ Click Position:', {
        mouseX,
        mouseY,
        viewX: view.x,
        viewY: view.y,
        pixelSize: PIXEL_SIZE,
        scale: view.scale,
        gridX: x,
        gridY: y,
        canvasWidth: rect.width,
        canvasHeight: rect.height,
        calculatedScreenX: x * PIXEL_SIZE * view.scale + view.x,
        calculatedScreenY: y * PIXEL_SIZE * view.scale + view.y
      });
      
      if (x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE) {
        setClickStart({ x, y });
      }
    }

    setIsDragging(true);
    setDragStart({ x: e.clientX - view.x, y: e.clientY - view.y });
    setDragStartPos({ x: e.clientX, y: e.clientY });
  };

  // Handle mouse move
  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const canvasX = (e.clientX - rect.left);
    const canvasY = (e.clientY - rect.top);
    
    const x = Math.floor((canvasX - view.x) / (PIXEL_SIZE * view.scale));
    const y = Math.floor((canvasY - view.y) / (PIXEL_SIZE * view.scale));
    
    onMousePosChange(x, y);

    // Only show preview if within bounds
    if (x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE) {
      setPreviewPixel({ x, y });
    } else {
      setPreviewPixel({ x: -1, y: -1 });
    }

    // Handle dragging
    if (isDragging) {
      setView({
        ...view,
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  // Modify handleMouseUp
  const handleMouseUp = async (e: React.MouseEvent) => {
    if (!isDragging) return;

    const dx = Math.abs(e.clientX - dragStartPos.x);
    const dy = Math.abs(e.clientY - dragStartPos.y);
    const hasMoved = dx > 5 || dy > 5;

    setIsDragging(false);

    if (e.button === 0 && !hasMoved && clickStart && address) {
      const { x, y } = clickStart;
      const pixelKey = `${x},${y}`;
      
      // Single optimistic update
      const previousColor = pixels.get(pixelKey);
      setPixels(prevPixels => {
        const newPixels = new Map(prevPixels);
        newPixels.set(pixelKey, selectedColor);
        return newPixels;
      });

      try {
        await placePixel(x, y, selectedColor);
      } catch (error) {
        // Revert only if the placement failed
        setPixels(prevPixels => {
          const newPixels = new Map(prevPixels);
          if (previousColor) {
            newPixels.set(pixelKey, previousColor);
          } else {
            newPixels.delete(pixelKey);
          }
          return newPixels;
        });
        
        // Call onAuthError if it's an authentication error
        if (error instanceof Error && 
            (error.message.includes('auth') || error.message.includes('token'))) {
          onAuthError();
        }
      }
    }
    
    setClickStart(null);
  };

  // Add preview pixel clearing when mouse leaves canvas
  const handleMouseLeave = (e: React.MouseEvent) => {
    setPreviewPixel({ x: -1, y: -1 });
    handleMouseUp(e);
  };

  // Modify the render useEffect
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas with gray background
    ctx.fillStyle = '#2C2C2C';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

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

    // Draw pixels - Add logging here
    if (pixels) {
      pixels.forEach((color, key) => {
        const [x, y] = key.split(',').map(Number);
        const screenX = x * PIXEL_SIZE * view.scale + view.x;
        const screenY = y * PIXEL_SIZE * view.scale + view.y;
        
        // Only log if debugging
        if (DEBUG) console.log('Drawing pixel:', { x, y, screenX, screenY, color });
        
        ctx.fillStyle = color;
        ctx.fillRect(
          screenX,
          screenY,
          PIXEL_SIZE * view.scale,
          PIXEL_SIZE * view.scale
        );
      });
    }

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

    // Draw border around the pixel grid area
    ctx.strokeStyle = '#666666';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      view.x,
      view.y,
      gridPixelWidth,
      gridPixelHeight
    );
  }, [view, pixels, previewPixel, selectedColor, isDragging, PIXEL_SIZE]);

  // Add this to debug what data we have available
  useEffect(() => {
    console.log('Privy user:', user);
  }, [user]);

  // Modify the placePixel function to use optimistic updates
  const placePixel = async (x: number, y: number, color: string) => {
    try {
      const response = await fetch('/api/pixels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y, color })
      });
      if (!response.ok) throw new Error('Failed to place pixel');
      return await response.json();
    } catch (error) {
      console.error('Failed to place pixel:', error);
      throw error;
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
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Two finger touch - prepare for pinch zoom
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const distance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );
      setPinchStart(distance);
      setPinchScale(view.scale);
    } else if (e.touches.length === 1) {
      // Single finger touch - prepare for pan
      setIsDragging(true);
      setDragStart({
        x: e.touches[0].clientX,
        y: e.touches[0].clientY
      });
      setDragStartPos({ x: view.x, y: view.y });
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Handle pinch zoom
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const distance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );
      
      // Calculate the center point of the pinch
      const centerX = (touch1.clientX + touch2.clientX) / 2;
      const centerY = (touch1.clientY + touch2.clientY) / 2;
      
      // Convert center point to canvas coordinates
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      
      const canvasX = ((centerX - rect.left) / rect.width) * canvasSize;
      const canvasY = ((centerY - rect.top) / rect.height) * canvasSize;
      
      const scale = Math.min(Math.max(pinchScale * (distance / pinchStart), MIN_ZOOM), MAX_ZOOM);
      const scaleFactor = scale / view.scale;
      
      setView(prev => ({
        scale: scale,
        x: canvasX - (canvasX - prev.x) * scaleFactor,
        y: canvasY - (canvasY - prev.y) * scaleFactor
      }));
    } else if (e.touches.length === 1 && isDragging) {
      // Handle pan
      const dx = e.touches[0].clientX - dragStart.x;
      const dy = e.touches[0].clientY - dragStart.y;
      
      setView({
        ...view,
        x: dragStartPos.x + dx,
        y: dragStartPos.y + dy
      });
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    setPinchStart(0);
  };

  useEffect(() => {
    if (user?.id && address) {
      console.log('🔵 Creating user:', { privy_id: user.id, wallet_address: address });
      fetch('/api/users/check-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privyId: user.id,
          walletAddress: address.toLowerCase()
        })
      })
      .then(async res => {
        const data = await res.json();
        console.log('🔵 Response from check-profile:', data);
        if (!res.ok) {
          throw new Error(data.error || 'Failed to check profile');
        }
        return data;
      })
      .catch(error => {
        console.error('🔴 Error checking profile:', error.message);
        setFlashMessage(error.message);
      });
    }
  }, [user?.id, address]);

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
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onContextMenu={(e) => e.preventDefault()}
        className="w-full h-full touch-none"
        style={{
          cursor: isDragging ? 'grabbing' : 'default',
          imageRendering: 'pixelated'
        }}
      />
      
      {!isSmallScreen && (
        <div className="absolute bottom-2 right-2">
          <MiniMap
            width={GRID_SIZE}
            height={GRID_SIZE}
            viewportWidth={GRID_SIZE}
            viewportHeight={GRID_SIZE}
            panPosition={{ 
              x: (view.x / canvasSize) * GRID_SIZE,
              y: (view.y / canvasSize) * GRID_SIZE
            }}
            zoom={view.scale}
            pixels={pixels}
            gridSize={GRID_SIZE}
          />
        </div>
      )}
    </div>
  );
});

Canvas.displayName = 'Canvas';

export default Canvas; 