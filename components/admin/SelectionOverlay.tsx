'use client';

import React, { useState, useCallback } from 'react';

interface SelectionOverlayProps {
  enabled: boolean;
  onClearSelection: (coordinates: Array<{x: number, y: number}>) => Promise<void>;
  scale: number;
  pixelSize: number;
  viewX: number;
  viewY: number;
  onPixelsCleared?: (coordinates: Array<{x: number, y: number}>) => void;
}

export const SelectionOverlay: React.FC<SelectionOverlayProps> = ({ enabled, onClearSelection, scale, pixelSize, viewX, viewY, onPixelsCleared }) => {
  const [selecting, setSelecting] = useState(false);
  const [startCoord, setStartCoord] = useState<{x: number, y: number} | null>(null);
  const [currentCoord, setCurrentCoord] = useState<{x: number, y: number} | null>(null);
  const [selectedCoords, setSelectedCoords] = useState<Array<{x: number, y: number}> | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!enabled) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    
    // Store raw screen coordinates for visual selection
    setStartCoord({ x: canvasX, y: canvasY });
    setCurrentCoord({ x: canvasX, y: canvasY });
    
    // Calculate grid coordinates for actual selection
    const gridX = Math.floor((canvasX - viewX) / (pixelSize * scale));
    const gridY = Math.floor((canvasY - viewY) / (pixelSize * scale));
    
    setSelecting(true);
    setSelectedCoords(null);
  }, [enabled, scale, pixelSize, viewX, viewY]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!selecting || !enabled) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    
    // Update visual selection
    setCurrentCoord({ x: canvasX, y: canvasY });
  }, [selecting, enabled]);

  const handleMouseUp = useCallback(() => {
    if (!selecting || !startCoord || !currentCoord || !enabled) return;
    
    // Convert screen coordinates to grid coordinates for the selection area
    const startGridX = Math.floor((startCoord.x - viewX) / (pixelSize * scale));
    const startGridY = Math.floor((startCoord.y - viewY) / (pixelSize * scale));
    const endGridX = Math.floor((currentCoord.x - viewX) / (pixelSize * scale));
    const endGridY = Math.floor((currentCoord.y - viewY) / (pixelSize * scale));
    
    const coordinates = [];
    const minX = Math.min(startGridX, endGridX);
    const maxX = Math.max(startGridX, endGridX);
    const minY = Math.min(startGridY, endGridY);
    const maxY = Math.max(startGridY, endGridY);
    
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        coordinates.push({ x, y });
      }
    }
    
    setSelectedCoords(coordinates);
    setSelecting(false);
  }, [selecting, startCoord, currentCoord, enabled, scale, pixelSize, viewX, viewY]);

  const handleConfirmClear = async () => {
    if (!selectedCoords) return;
    
    console.log('Attempting to clear pixels:', selectedCoords.map(coord => 
      `(${coord.x}, ${coord.y})`
    ).join(', '));
    
    try {
      await onClearSelection(selectedCoords);
      console.log('Clear request completed for coordinates:', selectedCoords);
      
      if (onPixelsCleared) {
        onPixelsCleared(selectedCoords);
      }
      
      setSelectedCoords(null);
      setStartCoord(null);
      setCurrentCoord(null);
    } catch (error) {
      console.error('Failed to clear selection:', error);
    }
  };

  if (!enabled) return null;

  return (
    <div 
      className="absolute inset-0 cursor-crosshair"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {selecting && startCoord && currentCoord && (
        <div 
          className="absolute border-2 border-purple-500 bg-purple-500/20 pointer-events-none"
          style={{
            left: Math.min(startCoord.x, currentCoord.x),
            top: Math.min(startCoord.y, currentCoord.y),
            width: Math.abs(currentCoord.x - startCoord.x),
            height: Math.abs(currentCoord.y - startCoord.y)
          }}
        />
      )}
      {selectedCoords && (
        <div 
          className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-neutral-900 rounded-lg p-4 border border-neutral-700 z-50"
          onMouseDown={(e) => e.stopPropagation()}
          onMouseMove={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
        >
          <p className="text-white mb-4 font-mono">Clear {selectedCoords.length} pixels?</p>
          <div className="flex gap-4">
            <button
              onClick={() => {
                setSelecting(false);
                setStartCoord(null);
                setCurrentCoord(null);
                setSelectedCoords(null);
              }}
              className="px-4 py-2 bg-neutral-700 text-white rounded hover:bg-neutral-600"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmClear}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}; 