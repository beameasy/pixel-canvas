'use client';

import { useState } from 'react';
import Button from '@/components/shared/Button';
import ColorPalette from '@/components/ColorPalette';
import CoordinatesDisplay from '@/components/CoordinatesDisplay';
import SideColorPicker from '@/components/SideColorPicker';

interface ControlsProps {
  coordinates: { x: number; y: number };
  onResetView: () => void;
  selectedColor: string;
  onColorSelect: (color: string) => void;
}

export default function Controls({ coordinates, onResetView, selectedColor, onColorSelect }: ControlsProps) {
  return (
    <div className="mb-4 flex flex-col gap-4">
      <CoordinatesDisplay x={coordinates.x} y={coordinates.y} />
      <button
        onClick={onResetView}
        className="px-3 py-1 bg-[#FFD700] text-black font-mono rounded hover:bg-[#FFC700] transition-colors text-sm"
      >
        Reset View
      </button>
      <div className="w-full">
        <SideColorPicker 
          selectedColor={selectedColor}
          onColorSelect={onColorSelect}
        />
      </div>
    </div>
  );
} 