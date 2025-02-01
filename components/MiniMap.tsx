'use client';

import { useRef, useEffect } from 'react';

interface MiniMapProps {
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  panPosition: { x: number; y: number };
  zoom: number;
  pixels: Map<string, string>;
  gridSize: number;
}

export default function MiniMap({ 
  width, 
  height, 
  viewportWidth, 
  viewportHeight,
  panPosition,
  zoom,
  pixels,
  gridSize
}: MiniMapProps) {
  const MINIMAP_SIZE = 120;
  const MINIMAP_PADDING = 10;
  const MINIMAP_BORDER = 2;
  const MIN_VIEWPORT_SIZE = 20; // Minimum size for viewport rectangle
  const scale = MINIMAP_SIZE / Math.max(width, height);
  
  // Calculate viewport rectangle dimensions
  let viewportRect = {
    width: (viewportWidth / zoom) * scale,
    height: (viewportHeight / zoom) * scale,
    x: (-panPosition.x / zoom) * scale,
    y: (-panPosition.y / zoom) * scale
  };

  // Constrain viewport rectangle to minimap bounds with margin
  const margin = 2; // Margin from border
  viewportRect = {
    width: Math.max(MIN_VIEWPORT_SIZE, Math.min(viewportRect.width, MINIMAP_SIZE - margin * 2)),
    height: Math.max(MIN_VIEWPORT_SIZE, Math.min(viewportRect.height, MINIMAP_SIZE - margin * 2)),
    x: Math.max(margin, Math.min(viewportRect.x, MINIMAP_SIZE - viewportRect.width - margin)),
    y: Math.max(margin, Math.min(viewportRect.y, MINIMAP_SIZE - viewportRect.height - margin))
  };

  // Draw pixels on canvas
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas with a white background
    ctx.fillStyle = '#FFFFFF';  // White background
    ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

    if (pixels && pixels.size > 0) {
      const pixelSize = Math.max(1, MINIMAP_SIZE / gridSize);

      pixels.forEach((color, key) => {
        const [x, y] = key.split(',').map(Number);
        ctx.fillStyle = color;
        const mapX = Math.floor((x / gridSize) * MINIMAP_SIZE);
        const mapY = Math.floor((y / gridSize) * MINIMAP_SIZE);
        ctx.fillRect(mapX, mapY, Math.ceil(pixelSize), Math.ceil(pixelSize));
      });
    }

    // Draw the viewport rectangle
    ctx.strokeStyle = '#FF0000';  // Red viewport indicator
    ctx.lineWidth = 2;
    ctx.strokeRect(
      viewportRect.x,
      viewportRect.y,
      viewportRect.width,
      viewportRect.height
    );

    // Draw border
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
  }, [pixels, gridSize, viewportRect]);

  // Add more margin and a subtle shadow
  return (
    <div className="absolute bottom-8 left-8 p-2 bg-neutral-900 rounded-lg shadow-lg">
      <canvas
        ref={canvasRef}
        width={MINIMAP_SIZE}
        height={MINIMAP_SIZE}
        style={{
          width: MINIMAP_SIZE,
          height: MINIMAP_SIZE,
        }}
      />
    </div>
  );
} 