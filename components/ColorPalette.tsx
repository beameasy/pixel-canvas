'use client';

interface ColorPaletteProps {
  selectedColor: string;
  onColorSelect: (color: string) => void;
}

const COLORS = [
  '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF',
  '#FFFF00', '#FF00FF', '#00FFFF', '#FFA500', '#800080'
];

export default function ColorPalette({ selectedColor, onColorSelect }: ColorPaletteProps) {
  return (
    <div className="flex gap-2 flex-wrap max-w-[300px] justify-center">
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