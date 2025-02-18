'use client';

import { useEffect, useRef } from 'react';

interface MinimapProps {
  canvasSize: number;
  viewportSize: { width: number; height: number };
  viewPosition: { x: number; y: number };
  pixels: Map<string, string>;
}

export function Minimap({ 
  canvasSize, 
  viewportSize, 
  viewPosition, 
  pixels
}: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapSize = 150; // Reduced from 200 to 150
  const scale = minimapSize / canvasSize;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas with white background
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, minimapSize, minimapSize);

    // Draw pixels
    pixels.forEach((color, key) => {
      const [x, y] = key.split(',').map(Number);
      ctx.fillStyle = color;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    });

    // Draw viewport indicator
    const viewportWidth = Math.min(viewportSize.width * scale, minimapSize);
    const viewportHeight = Math.min(viewportSize.height * scale, minimapSize);
    const viewX = Math.max(0, Math.min(viewPosition.x * scale, minimapSize - viewportWidth));
    const viewY = Math.max(0, Math.min(viewPosition.y * scale, minimapSize - viewportHeight));

    // Draw red rectangle with padding
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      viewX,
      viewY,
      viewportWidth,
      viewportHeight
    );
  }, [canvasSize, viewportSize, viewPosition, pixels, scale]);

  return (
    <canvas
      ref={canvasRef}
      width={minimapSize}
      height={minimapSize}
      className="fixed bottom-4 right-4 border border-gray-300 bg-white shadow-lg"
      style={{ width: minimapSize, height: minimapSize }}
    />
  );
} 