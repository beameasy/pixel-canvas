'use client';

interface SideColorPickerProps {
  selectedColor: string;
  onColorSelect: (color: string) => void;
}

const COLORS = [
  { hex: '#000000', name: 'Black' },
  // Keep all the same colors but organize them in rainbow order
  { hex: '#ff4500', name: 'Red' },
  { hex: '#be0039', name: 'Dark Red' },
  { hex: '#ff3881', name: 'Pink' },
  { hex: '#ff99aa', name: 'Light Pink' },
  { hex: '#ffa800', name: 'Orange' },
  { hex: '#ffd635', name: 'Yellow' },
  { hex: '#fff8b8', name: 'Cream' },
  { hex: '#00cc78', name: 'Green' },
  { hex: '#7eed56', name: 'Light Green' },
  { hex: '#00ccc0', name: 'Teal' },
  { hex: '#3690ea', name: 'Blue' },
  { hex: '#51e9f4', name: 'Light Blue' },
  { hex: '#493ac1', name: 'Purple' },
  { hex: '#811e9f', name: 'Deep Purple' },
  { hex: '#b44ac0', name: 'Magenta' },
  { hex: '#6d482f', name: 'Brown' },
  { hex: '#515252', name: 'Dark Gray' },
  { hex: '#ffffff', name: 'White' }
];

export default function SideColorPicker({ selectedColor, onColorSelect }: SideColorPickerProps) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="font-['Press_Start_2P'] text-white text-xs">Pick your color:</span>
      <div className="flex gap-2">
        {COLORS.map((color) => (
          <button
            key={color.hex}
            onClick={() => onColorSelect(color.hex)}
            title={color.name}
            className={`w-8 h-8 transition-transform hover:scale-110 ${
              color.hex === selectedColor ? 'ring-2 ring-white scale-110' : ''
            }`}
            style={{
              backgroundColor: color.hex,
              border: '1px solid rgba(0,0,0,0.1)'
            }}
          />
        ))}
      </div>
    </div>
  );
} 