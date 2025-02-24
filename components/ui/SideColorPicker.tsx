'use client';

interface SideColorPickerProps {
  selectedColor: string;
  onColorSelect: (color: string) => void;
  scale?: number;
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
  { hex: '#0052FF', name: 'Coinbase Blue' },
  { hex: '#51e9f4', name: 'Light Blue' },
  { hex: '#493ac1', name: 'Purple' },
  { hex: '#811e9f', name: 'Deep Purple' },
  { hex: '#b44ac0', name: 'Magenta' },
  { hex: '#6d482f', name: 'Brown' },
  { hex: '#515252', name: 'Dark Gray' },
  { hex: '#ffffff', name: 'White' }
];

const SideColorPicker = ({ selectedColor, onColorSelect, scale = 1 }: SideColorPickerProps) => {
  return (
    <div className="flex flex-wrap justify-center gap-1" style={{ transform: `scale(${scale})` }}>
      {COLORS.map((color) => (
        <button
          key={color.hex}
          onClick={() => onColorSelect(color.hex)}
          className={`w-3 h-3 sm:w-4 sm:h-4 rounded-sm transition-transform hover:scale-110 ${
            selectedColor === color.hex ? 'ring-2 ring-white scale-110' : ''
          }`}
          style={{ backgroundColor: color.hex }}
        />
      ))}
    </div>
  );
};

export default SideColorPicker; 