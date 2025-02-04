'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useState, useRef } from 'react';
import Canvas from '@/components/Canvas';
import PixelLogo from '@/components/PixelLogo';
import CoordinatesDisplay from '@/components/CoordinatesDisplay';
import SideColorPicker from '@/components/SideColorPicker';
import Header from '@/layout/Header';
import Workspace from '@/layout/Workspace';
import Controls from '@/layout/Controls';
import Link from 'next/link';
import MiniMap from '@/components/MiniMap';
import Ticker from '@/components/Ticker';

export default function Home() {
  const { login, authenticated, user, logout } = usePrivy();
  const [showDisconnect, setShowDisconnect] = useState(false);
  const [selectedColor, setSelectedColor] = useState('#000000');
  const [showError, setShowError] = useState(false);
  const [mousePos, setMousePos] = useState({ x: -1, y: -1 });
  const canvasRef = useRef<{ resetView: () => void; clearCanvas: () => void }>(null);

  const handleError = () => {
    setShowError(true);
    setTimeout(() => setShowError(false), 3000);
  };

  const handleMousePosChange = (x: number, y: number) => {
    setMousePos({ x, y });
  };

  const handleResetView = () => {
    canvasRef.current?.resetView();
  };

  return (
    <div className="min-h-screen bg-slate-800 overflow-y-auto">
      <Ticker />
      <main className="w-full max-w-[1200px] mx-auto p-5 pb-20 flex flex-col pt-8">
        <Header 
          authenticated={authenticated}
          onLogin={login}
          onLogout={logout}
          showError={showError}
        >
          {/* Header with Navigation and Wallet Connection */}
          <div className="w-full flex justify-between items-center px-4 py-2">
            {/* Single navigation bar containing all items */}
            <nav className="flex items-center gap-6">
              <Link 
                href="/" 
                className="text-[#FFD700] hover:text-[#FFC700] font-mono text-sm transition-colors"
              >
                Canvas
              </Link>
              <Link 
                href="/logs" 
                className="text-[#FFD700] hover:text-[#FFC700] font-mono text-sm transition-colors"
              >
                Logs
              </Link>
              {!authenticated ? (
                <button
                  onClick={login}
                  className="text-[#FFD700] hover:text-[#FFC700] font-mono text-sm transition-colors cursor-pointer"
                >
                  Connect Wallet
                </button>
              ) : (
                <button
                  onClick={logout}
                  onMouseEnter={() => setShowDisconnect(true)}
                  onMouseLeave={() => setShowDisconnect(false)}
                  className={`font-mono text-sm transition-colors cursor-pointer ${
                    showDisconnect ? 'text-red-500' : 'text-[#FFD700]'
                  } hover:text-[#FFC700]`}
                >
                  {showDisconnect ? 'click to disconnect' : `${user?.wallet?.address.slice(0, 6)}...${user?.wallet?.address.slice(-4)}`}
                </button>
              )}
            </nav>
            
            {/* Error message */}
            {!authenticated && showError && (
              <div className="font-mono text-red-500 text-sm animate-pulse">
                connect wallet to place pixels
              </div>
            )}
          </div>
        </Header>
        
        <div className="mt-1 mb-6 flex justify-center">
          <div className="inline-block">
            <PixelLogo />
          </div>
        </div>
        
        <Workspace>
          <div className="flex flex-col items-center">
            <Controls 
              coordinates={mousePos}
              onResetView={handleResetView}
              selectedColor={selectedColor}
              onColorSelect={setSelectedColor}
            />
            
            <div className="flex gap-4">
              <div className="relative w-[600px] h-[600px] bg-white rounded-lg overflow-hidden">
                <Canvas 
                  ref={canvasRef}
                  selectedColor={selectedColor}
                  onColorSelect={setSelectedColor}
                  authenticated={authenticated}
                  onAuthError={handleError}
                  onMousePosChange={handleMousePosChange}
                />
                <div className="absolute bottom-4 right-4 z-10">
                  <MiniMap 
                    width={600}
                    height={600}
                    viewportWidth={600}
                    viewportHeight={600}
                    panPosition={{ x: 0, y: 0 }}
                    zoom={1}
                    pixels={new Map()}
                    gridSize={600}
                  />
                </div>
              </div>
            </div>
          </div>
        </Workspace>
      </main>
    </div>
  );
} 