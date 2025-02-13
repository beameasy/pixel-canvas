'use client';

import React from 'react';
import SideColorPicker from '@/components/ui/SideColorPicker';

interface ControlsProps {
  coordinates: { x: number; y: number };
  onResetView: () => void;
  selectedColor: string;
  onColorSelect: (color: string) => void;
  className?: string;
  flashMessage?: string | null;
}

export default function Controls({ coordinates, onResetView, selectedColor, onColorSelect, className, flashMessage }: ControlsProps) {
  return (
    <div className="mb-2 sm:mb-4 flex flex-col gap-2 sm:gap-4 w-full max-w-[600px]">
      {flashMessage && (
        <div className="flex justify-center">
          <div className="font-mono text-[#FFD700] text-xs sm:text-sm">
            {flashMessage}
          </div>
        </div>
      )}
      <div className="flex justify-center">
        <button
          onClick={onResetView}
          className="px-4 py-0.5 bg-[#FFD700] text-black font-mono rounded text-xs 
                   hover:bg-[#FFC700] transition-colors inline-flex items-center"
        >
          Reset View
        </button>
      </div>
      <div className="w-full">
        <SideColorPicker 
          selectedColor={selectedColor}
          onColorSelect={onColorSelect}
        />
      </div>
    </div>
  );
} 