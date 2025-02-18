'use client';

import React, { useState } from 'react';
import billboardLogo from './images/logo.png';

const GRID_SIZE = 400;
const SCALE_FACTOR = 4;
const SHARE_SIZE = GRID_SIZE * SCALE_FACTOR;
const LOGO_HEIGHT = 60 * SCALE_FACTOR;
const TOTAL_HEIGHT = SHARE_SIZE + LOGO_HEIGHT;

export function ShareCanvas() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const handleGeneratePreview = async () => {
    setIsGenerating(true);
    try {
      console.log('Creating share canvas...');
      const canvas = new OffscreenCanvas(SHARE_SIZE, TOTAL_HEIGHT);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No context');

      // Enable image smoothing
      ctx.imageSmoothingEnabled = false;

      // Scale everything up
      ctx.scale(SCALE_FACTOR, SCALE_FACTOR);

      // Draw dark background for logo area
      ctx.fillStyle = '#1F2937';
      ctx.fillRect(0, 0, GRID_SIZE, LOGO_HEIGHT / SCALE_FACTOR);

      // Load and draw the logo image
      const logoImg = new Image();
      try {
        await new Promise((resolve, reject) => {
          logoImg.onload = resolve;
          logoImg.onerror = (e) => reject(new Error(`Failed to load logo: ${e}`));
          logoImg.src = billboardLogo.src;
        });
      } catch (logoError) {
        console.error('Logo loading error:', logoError);
        throw logoError;
      }

      // Calculate logo dimensions maintaining aspect ratio
      const logoAspectRatio = logoImg.width / logoImg.height;
      const maxLogoHeight = (LOGO_HEIGHT / SCALE_FACTOR) * 0.7; // Reduced to 70% to allow for spacing
      const maxLogoWidth = GRID_SIZE * 0.9;
      
      let logoWidth, logoHeight;
      
      if (maxLogoWidth / maxLogoHeight > logoAspectRatio) {
        logoHeight = maxLogoHeight;
        logoWidth = logoHeight * logoAspectRatio;
      } else {
        logoWidth = maxLogoWidth;
        logoHeight = logoWidth / logoAspectRatio;
      }

      // Center horizontally and add equal spacing vertically
      const logoX = (GRID_SIZE - logoWidth) / 2;
      const verticalPadding = ((LOGO_HEIGHT / SCALE_FACTOR) - logoHeight) / 2;
      const logoY = verticalPadding;
      
      try {
        ctx.drawImage(logoImg, logoX, logoY, logoWidth, logoHeight);
      } catch (drawError) {
        console.error('Draw error:', drawError);
        throw drawError;
      }

      // Draw white background for canvas area
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, LOGO_HEIGHT / SCALE_FACTOR, GRID_SIZE, GRID_SIZE);

      // Get and draw pixels
      console.log('Fetching pixels...');
      const response = await fetch('/api/pixels');
      if (!response.ok) {
        throw new Error(`Failed to fetch pixels: ${response.status} ${response.statusText}`);
      }
      const pixels = await response.json();
      console.log(`Got ${pixels.length} pixels`);

      ctx.translate(0, LOGO_HEIGHT / SCALE_FACTOR);
      pixels.forEach((pixel: any) => {
        ctx.fillStyle = pixel.color;
        ctx.fillRect(pixel.x, pixel.y, 1, 1);
      });

      // Convert to blob with max quality
      console.log('Converting to blob...');
      const blob = await canvas.convertToBlob({ 
        type: 'image/png',
        quality: 1
      });
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      console.log('Preview URL created');

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
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              URL.revokeObjectURL(previewUrl);
              setPreviewUrl(null);
            }
          }}
        >
          <div className="bg-gray-800 p-4 rounded-lg max-w-md w-full mx-4">
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