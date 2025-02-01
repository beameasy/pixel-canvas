'use client';

interface CoordinatesDisplayProps {
  x: number;
  y: number;
}

export default function CoordinatesDisplay({ x, y }: CoordinatesDisplayProps) {
  return (
    <div className="fixed bottom-4 right-4 bg-black/75 text-white px-4 py-2 rounded-full">
      ({x}, {y})
    </div>
  );
} 