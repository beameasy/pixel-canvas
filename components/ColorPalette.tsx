'use client';

interface ColorPaletteProps {
  selectedColor: string;
  onColorSelect: (color: string) => void;
}

const COLORS = [
  // Reds & Pinks
  '#6d001a', '#be0039', '#ff4500', '#de107f', '#ff3881', '#ff99aa',
  // Oranges & Yellows
  '#ffa800', '#ffd635', '#fff8b8',
  // Greens
  '#00a368', '#00cc78', '#7eed56',
  // Teals
  '#00756f', '#009eaa', '#00ccc0',
  // Blues
  '#2450a4', '#3690ea', '#51e9f4', '#94b3ff',
  // Purples
  '#493ac1', '#6a5cff', '#811e9f', '#b44ac0', '#e4abff',
  // Browns
  '#6d482f', '#9c6926', '#ffb470',
  // Grayscale
  '#000000', '#515252', '#898d90', '#d4d7d9', '#ffffff'
];

export default function ColorPalette({ selectedColor, onColorSelect }: ColorPaletteProps) {
  return (
    <div className="flex gap-2 flex-wrap max-w-[300px] justify-center bg-gray-100 p-2 rounded border-2 border-gray-300">
      {COLORS.map((color) => (
        <button
          key={color}
          className={`w-8 h-8 rounded-full border-2 ${
            color === selectedColor ? 'border-blue-500' : 'border-gray-300'
          }`}
          style={{ backgroundColor: color }}
          onClick={() => onColorSelect(color)}
        />
      ))}
    </div>
  );
} 