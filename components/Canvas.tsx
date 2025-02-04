'use client';

import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useFarcasterUser } from '@/lib/hooks/useFarcasterUser';
import MiniMap from './MiniMap';
import ColorPalette from './ColorPalette';
import CoordinatesDisplay from './CoordinatesDisplay';
import SideColorPicker from './SideColorPicker';

// Constants
const CANVAS_SIZE = 600;      // Canvas display size
const GRID_SIZE = 200;        // Number of pixels in grid
const PIXEL_SIZE = 3;         // Base size of each pixel (3px)
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 20;

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
  onMousePosChange: (x: number, y: number) => void;
  ref?: React.ForwardedRef<{
    resetView: () => void;
    clearCanvas: () => void;
  }>;
}

const Canvas = forwardRef<{ resetView: () => void; clearCanvas: () => void }, CanvasProps>(({ selectedColor, onColorSelect, authenticated, onAuthError, onMousePosChange }, ref) => {
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
  const [mousePos, setMousePos] = useState({ x: -1, y: -1 });
  const [previewPixel, setPreviewPixel] = useState({ x: -1, y: -1 });
  const [flashMessage, setFlashMessage] = useState<string | null>(null);

  // Use your existing Farcaster hook
  const { farcasterUser } = useFarcasterUser(address);

  // Initialize canvas and load pixels
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set up canvas
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high DPI displays
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_SIZE * dpr;
    canvas.height = CANVAS_SIZE * dpr;
    ctx.scale(dpr, dpr);
    
    canvas.style.width = `${CANVAS_SIZE}px`;
    canvas.style.height = `${CANVAS_SIZE}px`;

    // Load initial pixels
    loadPixels();

    // Subscribe to pixel updates
    const subscription = supabase
      .channel('pixels')
      .on('postgres_changes', 
        { event: 'INSERT', schema: 'public', table: 'pixels' },
        (payload) => {
          setPixels(prev => new Map(prev).set(`${payload.new.x},${payload.new.y}`, payload.new.color));
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
  }, [isDragging]);

  // Load existing pixels
  const loadPixels = async () => {
    const { data } = await supabase.from('pixels').select('*');
    if (data) {
      const pixelMap = new Map();
      data.forEach(pixel => {
        pixelMap.set(`${pixel.x},${pixel.y}`, pixel.color);
      });
      setPixels(pixelMap);
    }
  };

  // Reset view to default
  const resetView = () => {
    setView({
      x: 0,
      y: 0,
      scale: 1
    });
  };

  // Expose methods to parent
  useImperativeHandle(ref, () => ({
    resetView,
    clearCanvas: () => setPixels(new Map())
  }));

  // Handle mouse down for dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    // Allow dragging with left click (button 0) or middle click (button 1)
    if (e.button === 0 || e.button === 1) {
      e.preventDefault();
      setIsDragging(true);
      setDragStart({ x: e.clientX - view.x, y: e.clientY - view.y });
      setDragStartPos({ x: e.clientX, y: e.clientY });
    }
  };

  // Handle mouse move
  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Calculate pixel coordinates
    const x = Math.floor((e.clientX - rect.left - view.x) / (PIXEL_SIZE * view.scale));
    const y = Math.floor((e.clientY - rect.top - view.y) / (PIXEL_SIZE * view.scale));
    
    // Update mouse position for coordinate display and preview
    setMousePos({ x, y });
    
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

    // Update mouse position through callback
    onMousePosChange(x, y);
  };

  // Handle mouse up and pixel placement
  const handleMouseUp = async (e: React.MouseEvent) => {
    if (!isDragging) return;

    // Calculate distance moved during drag
    const dx = Math.abs(e.clientX - dragStartPos.x);
    const dy = Math.abs(e.clientY - dragStartPos.y);
    const hasMoved = dx > 5 || dy > 5; // 5px threshold for movement

    setIsDragging(false);

    // Only place pixel if we haven't moved (i.e., it was a click)
    if (!hasMoved && address) {
      if (!authenticated) {
        setFlashMessage('Please connect your wallet to place pixels');
        return;
      }

      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = Math.floor((e.clientX - rect.left - view.x) / (PIXEL_SIZE * view.scale));
      const y = Math.floor((e.clientY - rect.top - view.y) / (PIXEL_SIZE * view.scale));

      // Ensure within bounds
      if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return;

      try {
        // Place pixel
        const { error: pixelError } = await supabase
          .from('pixels')
          .upsert({
            x,
            y,
            color: selectedColor,
            placed_by: address
          });

        if (pixelError) throw pixelError;

        // Update local state
        setPixels(prev => new Map(prev).set(`${x},${y}`, selectedColor));

        // Create terminal message with Farcaster data
        console.log('Current farcasterUser:', farcasterUser); // Debug log
        
        const { error: messageError, data: messageData } = await supabase
          .from('terminal_messages')
          .insert({
            message: `placed a ${selectedColor} pixel at (${x}, ${y})`,
            wallet_address: address,
            message_type: 'pixel_placed',
            farcaster_username: farcasterUser?.username || null,
            farcaster_pfp: farcasterUser?.pfpUrl || null
          })
          .select()
          .single();

        if (messageError) {
          console.error('Error creating terminal message:', messageError);
          throw messageError;
        }

        console.log('Terminal message created:', messageData);
      } catch (error) {
        console.error('Error placing pixel:', error, 'farcasterUser:', farcasterUser);
      }
    }
  };

  // Add preview pixel clearing when mouse leaves canvas
  const handleMouseLeave = (e: React.MouseEvent) => {
    setPreviewPixel({ x: -1, y: -1 });
    handleMouseUp(e);
  };

  // Render function
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas with gray background
    ctx.fillStyle = '#2C2C2C';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

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

    // Draw pixels
    pixels.forEach((color, key) => {
      const [x, y] = key.split(',').map(Number);
      const screenX = x * PIXEL_SIZE * view.scale + view.x;
      const screenY = y * PIXEL_SIZE * view.scale + view.y;
      
      ctx.fillStyle = color;
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
      
      // Draw semi-transparent preview
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
  }, [view, pixels, previewPixel, selectedColor, isDragging]);

  // Add this to debug what data we have available
  useEffect(() => {
    console.log('Privy user:', user);
  }, [user]);

  const handleCanvasClick = async (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!authenticated) {
      onAuthError();
      return;
    }

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = Math.floor((event.clientX - rect.left) * (600 / rect.width));
    const y = Math.floor((event.clientY - rect.top) * (600 / rect.height));
    
    // Update the pixel in the pixels state
    setPixels(prevPixels => {
      const newPixels = new Map(prevPixels);
      newPixels.set(`${x},${y}`, selectedColor);
      return newPixels;
    });

    // If you have a backend API call, you can add it here
    try {
      // Example API call:
      // await fetch('/api/pixels', {
      //   method: 'POST',
      //   body: JSON.stringify({ x, y, color: selectedColor }),
      // });
    } catch (error) {
      console.error('Failed to place pixel:', error);
    }

    // Trigger a redraw
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      drawPixel(ctx, x, y, selectedColor);
    }
  };

  // Helper function to draw a single pixel
  const drawPixel = (ctx: CanvasRenderingContext2D, x: number, y: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  };

  // Add useEffect to auto-clear flash message
  useEffect(() => {
    if (flashMessage) {
      const timer = setTimeout(() => setFlashMessage(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [flashMessage]);

  return (
    <div 
      ref={containerRef}
      className="relative w-full h-full"
      style={{ 
        touchAction: 'none',
        overflow: 'hidden'
      }}
    >
      {/* Add Color Picker above canvas */}
      <div className="absolute top-[-60px] left-0 right-0 w-full">
        <div className="bg-neutral-900 p-2 rounded-lg w-full">
          <SideColorPicker
            selectedColor={selectedColor}
            onColorSelect={onColorSelect}
          />
        </div>
      </div>

      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onContextMenu={(e) => e.preventDefault()}
        onClick={handleCanvasClick}
        className="absolute top-0 left-0 w-full h-full"
        style={{
          cursor: isDragging ? 'grabbing' : 'default'
        }}
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
      />
      
      {/* MiniMap overlay */}
      <div className="absolute bottom-2 right-2">
        <MiniMap
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          viewportWidth={CANVAS_SIZE}
          viewportHeight={CANVAS_SIZE}
          panPosition={{ x: view.x, y: view.y }}
          zoom={view.scale}
          pixels={pixels}
          gridSize={GRID_SIZE}
        />
      </div>
    </div>
  );
});

Canvas.displayName = 'Canvas';

export default Canvas; 