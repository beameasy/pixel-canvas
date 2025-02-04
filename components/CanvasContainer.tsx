'use client';

interface CanvasContainerProps {
  children: React.ReactNode;
}

export default function CanvasContainer({ children }: CanvasContainerProps) {
  return (
    <div className="w-[600px] h-[600px] bg-white rounded-lg overflow-visible relative flex-shrink-0">
      {children}
    </div>
  );
} 