'use client';

import React, { useState, useEffect, useRef } from 'react';
import SideColorPicker from '../ui/SideColorPicker';
import { ShareCanvas } from '../share/ShareCanvas';
import ShareCanvasV2 from '../share/ShareCanvasV2';

interface ControlsProps {
  onResetView: () => void;
  selectedColor: string;
  onColorSelect: (color: string) => void;
  flashMessage: string | null;
  touchMode: 'view' | 'place';
  onTouchModeChange: (mode: 'view' | 'place') => void;
  canvasRef: React.RefObject<{
    resetView: () => void;
    clearCanvas: () => void;
    shareCanvas: () => Promise<string>;
  } | null>;
  coordinates: { x: number; y: number };
}

export default function Controls({ onResetView, selectedColor, onColorSelect, flashMessage, touchMode, onTouchModeChange, canvasRef, coordinates }: ControlsProps) {
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const canvasElementRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setIsTouchDevice(
      ('ontouchstart' in window) ||
      (navigator.maxTouchPoints > 0)
    );
  }, []);

  return (
    <div className="mb-3 sm:mb-4 flex flex-col gap-2 sm:gap-4 w-full max-w-[600px]">
      {flashMessage && (
        <div className="flex justify-center">
          <div className="font-mono text-[#FFD700] text-xs sm:text-sm">
            {flashMessage}
          </div>
        </div>
      )}
      <div className="flex justify-center gap-2">
        <button
          onClick={onResetView}
          className="bg-yellow-400 hover:bg-yellow-500 text-black px-2 py-0.5 rounded font-mono text-xs"
        >
          Reset View
        </button>
        <ShareCanvas />
        <ShareCanvasV2 canvasRef={canvasRef} />
      </div>
      <div className="w-full mb-1 sm:mb-2">
        <SideColorPicker 
          selectedColor={selectedColor}
          onColorSelect={onColorSelect}
        />
      </div>
    </div>
  );
} 