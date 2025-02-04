'use client';

interface CoordinatesDisplayProps {
  x: number;
  y: number;
}

const CoordinatesDisplay = ({ x, y }: CoordinatesDisplayProps) => {
  return (
    <div style={{ color: '#FFD700' }} className="font-mono">
      ({x}, {y})
    </div>
  );
};

export default CoordinatesDisplay; 