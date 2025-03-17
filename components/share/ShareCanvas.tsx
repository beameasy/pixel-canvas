'use client';

import React, { useState, useEffect } from 'react';

const GRID_SIZE = 400;
const SCALE_FACTOR = 4;
const LOGO_HEIGHT = 60 * SCALE_FACTOR;
const LOGO_PATH = '/images/logo.png';

interface ShareCanvasProps {
  canvasRef: React.RefObject<{
    resetView: () => void;
    clearCanvas: () => void;
    shareCanvas: () => Promise<string>;
  } | null>;
}

export function ShareCanvas({ canvasRef }: ShareCanvasProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGeneratePreview = async () => {
    if (!canvasRef?.current) {
      console.error('No canvas reference available');
      return;
    }
    setIsGenerating(true);

    try {
      // Get the canvas snapshot
      const canvasDataUrl = await canvasRef.current.shareCanvas();
      
      // Create a new canvas with space for the logo
      const finalCanvas = document.createElement('canvas');
      const ctx = finalCanvas.getContext('2d');
      if (!ctx) throw new Error('Could not get context');

      // Load the canvas image to get its dimensions
      const canvasImg = new Image();
      await new Promise<void>((resolve, reject) => {
        canvasImg.onload = () => resolve();
        canvasImg.onerror = reject;
        canvasImg.src = canvasDataUrl;
      });

      // Set canvas size to include logo area
      finalCanvas.width = canvasImg.width;
      finalCanvas.height = canvasImg.height + LOGO_HEIGHT;

      // Draw dark background for logo area
      ctx.fillStyle = '#1F2937';
      ctx.fillRect(0, 0, finalCanvas.width, LOGO_HEIGHT);

      // Load and draw the logo
      const logoImg = new Image();
      try {
        await new Promise<void>((resolve, reject) => {
          logoImg.onload = () => resolve();
          logoImg.onerror = (e) => {
            console.error('Logo load error details:', e);
            reject(new Error('Failed to load logo'));
          };
          logoImg.src = LOGO_PATH;
        });

        // Calculate logo dimensions
        const logoAspectRatio = logoImg.width / logoImg.height;
        const maxLogoHeight = LOGO_HEIGHT * 0.7; // 70% of logo area
        const maxLogoWidth = finalCanvas.width * 0.9; // 90% of canvas width
        
        let logoWidth, logoHeight;
        if (maxLogoWidth / maxLogoHeight > logoAspectRatio) {
          logoHeight = maxLogoHeight;
          logoWidth = logoHeight * logoAspectRatio;
        } else {
          logoWidth = maxLogoWidth;
          logoHeight = logoWidth / logoAspectRatio;
        }

        // Center logo
        const logoX = (finalCanvas.width - logoWidth) / 2;
        const logoY = (LOGO_HEIGHT - logoHeight) / 2;
        
        // Draw logo
        ctx.drawImage(logoImg, logoX, logoY, logoWidth, logoHeight);
      } catch (logoError) {
        console.error('Failed to load or draw logo:', logoError);
        throw logoError;
      }

      // Draw the canvas snapshot below the logo
      ctx.drawImage(canvasImg, 0, LOGO_HEIGHT);

      // Convert to blob with optimal settings
      const blob = await new Promise<Blob>((resolve, reject) => {
        finalCanvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Failed to create blob'));
          },
          'image/png',
          1.0 // Use maximum quality for PNG
        );
      });

      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);

    } catch (error) {
      console.error('Failed to generate preview:', error);
      alert('Failed to generate preview. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const copyImage = async () => {
    if (!previewUrl) return;
    try {
      const response = await fetch(previewUrl);
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type]: blob
        })
      ]);
      alert('Image copied to clipboard!');
    } catch (err) {
      console.error('Failed to copy image:', err);
      // Fallback to download if copy fails
      downloadImage();
    }
  };

  const downloadImage = () => {
    if (!previewUrl) return;
    const link = document.createElement('a');
    link.href = previewUrl;
    link.download = 'billboard-canvas.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleShare = (platform: 'twitter' | 'farcaster') => {
    // Create platform-specific text
    const twitterText = encodeURIComponent(
      "🖌️ Just placed a pixel on Billboard on Base!\n\n" +
      "Express your creativity, advertise, work together, all one pixel at a time.\n\n" +
      "🔗 billboardonbase.fun\n\n" +
      "@billboardonbase $BILLBOARD"
    );

    const farcasterText = encodeURIComponent(
      "🖌️ Just placed a pixel on Billboard on Base!\n\n" +
      "Express your creativity, advertise, work together, all one pixel at a time.\n\n" +
      "🔗 billboardonbase.fun\n\n" +
      "https://warpcast.com/~/channel/billboardonbase $BILLBOARD"
    );

    // Open share dialog with platform-specific URL
    const shareUrl = platform === 'twitter' 
      ? `https://twitter.com/intent/tweet?text=${twitterText}`
      : `https://warpcast.com/~/compose?text=${farcasterText}`;

    window.open(shareUrl, '_blank');
  };

  return (
    <>
      <button
        onClick={handleGeneratePreview}
        disabled={isGenerating}
        className="bg-purple-500 hover:bg-purple-600 text-white px-2 py-0.5 rounded font-mono text-xs"
      >
        {isGenerating ? 'Generating...' : 'Share Canvas'}
      </button>

      {previewUrl && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              URL.revokeObjectURL(previewUrl);
              setPreviewUrl(null);
            }
          }}
        >
          <div className="bg-gray-800 p-4 rounded-lg max-w-md w-full mx-4 relative z-[10000]">
            <img src={previewUrl} alt="Canvas preview" className="w-full rounded mb-4" />
            <div className="flex flex-col gap-4">
              <div className="flex justify-center gap-2">
                <button
                  onClick={copyImage}
                  className="bg-gray-600 hover:bg-gray-500 text-white px-4 py-2 rounded font-mono text-sm"
                >
                  Copy Image
                </button>
                <button
                  onClick={downloadImage}
                  className="bg-gray-600 hover:bg-gray-500 text-white px-4 py-2 rounded font-mono text-sm"
                >
                  Download Image
                </button>
              </div>
              
              <div className="text-center text-gray-400 text-sm">
                Copy or download your image first, then share it:
              </div>

              <div className="flex justify-center gap-2">
                <button
                  onClick={() => handleShare('twitter')}
                  className="bg-[#1DA1F2] hover:bg-[#1a8cd8] text-white px-4 py-2 rounded font-mono text-sm"
                >
                  Share on X
                </button>
                <button
                  onClick={() => handleShare('farcaster')}
                  className="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded font-mono text-sm"
                >
                  Share on Warpcast
                </button>
              </div>

              <button
                onClick={() => {
                  URL.revokeObjectURL(previewUrl);
                  setPreviewUrl(null);
                }}
                className="text-gray-400 hover:text-white text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
} 