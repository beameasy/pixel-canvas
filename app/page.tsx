'use client';

import Canvas from '@/components/canvas/CanvasV2';
import PixelLogo from '@/components/ui/PixelLogo';
import Controls from '@/components/layout/Controls';
import { usePrivy } from '@privy-io/react-auth';
import { useState, useRef, useEffect } from 'react';

export default function Home() {
  const { authenticated } = usePrivy();
  const [selectedColor, setSelectedColor] = useState('#000000');
  const [showError, setShowError] = useState(false);
  const [mousePos, setMousePos] = useState({ x: -1, y: -1 });
  const [touchMode, setTouchMode] = useState<'place' | 'view'>('place');
  const canvasRef = useRef<{
    resetView: () => void;
    clearCanvas: () => void;
    shareCanvas: () => void;
  }>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const handleAuthError = () => {
    setShowError(true);
    setTimeout(() => setShowError(false), 3000);
  };

  const handleResetView = () => {
    canvasRef.current?.resetView();
  };

  const handleShare = () => {
    canvasRef.current?.shareCanvas();
  };

  return (
    <div className="min-h-screen bg-slate-800 overflow-y-auto">
      <main className="w-full max-w-[1200px] mx-auto p-4 pt-8 flex flex-col items-center">
        <div className="mb-8 flex justify-center">
          <PixelLogo />
        </div>
        
        <div className="flex flex-col items-center">
          {!authenticated && showError && (
            <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 z-50">
              <div className="font-mono text-red-500 text-sm animate-pulse bg-slate-900/90 px-4 py-2 rounded-lg">
                connect wallet to place pixels
              </div>
            </div>
          )}

          <Controls 
            coordinates={mousePos}
            onResetView={handleResetView}
            selectedColor={selectedColor}
            onColorSelect={setSelectedColor}
            touchMode={touchMode}
            onTouchModeChange={setTouchMode}
            canvasRef={canvasRef}
            flashMessage={null}
          />
          
          <Canvas 
            ref={canvasRef}
            selectedColor={selectedColor}
            onColorSelect={setSelectedColor}
            authenticated={authenticated}
            onAuthError={handleAuthError}
            onMousePosChange={(pos) => pos ? setMousePos(pos) : setMousePos({ x: -1, y: -1 })}
            touchMode={touchMode}
            onTouchModeChange={setTouchMode}
          />
        </div>
      </main>
    </div>
  );
} 