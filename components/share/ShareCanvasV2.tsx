'use client';

import { useState, useEffect } from 'react';

interface ShareCanvasV2Props {
  canvasRef: React.RefObject<HTMLCanvasElement | {
    resetView: () => void;
    clearCanvas: () => void;
    shareCanvas: () => void;
  } | null>;
}

export default function ShareCanvasV2({ canvasRef }: ShareCanvasV2Props) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // Debug mount
  useEffect(() => {
    console.log('ShareCanvasV2 mounted:', {
      hasRef: !!canvasRef,
      ref: canvasRef,
      current: canvasRef?.current,
      anyCanvas: document.querySelector('canvas')
    });
  }, [canvasRef]);

  const handleGeneratePreview = async () => {
    console.log('Generate preview clicked:', {
      hasRef: !!canvasRef,
      ref: canvasRef,
      current: canvasRef?.current,
      anyCanvas: document.querySelector('canvas')
    });

    if (!canvasRef?.current) {
      console.error('No canvas reference available');
      return;
    }
    setIsGenerating(true);

    try {
      const canvas = canvasRef.current;
      if (!(canvas instanceof HTMLCanvasElement)) {
        console.error('Not a canvas element');
        return;
      }
      const rect = canvas.getBoundingClientRect();
      
      // Create a new canvas for the visible portion
      const visibleCanvas = document.createElement('canvas');
      visibleCanvas.width = rect.width;
      visibleCanvas.height = rect.height;
      
      const ctx = visibleCanvas.getContext('2d');
      if (!ctx) {
        throw new Error('Could not get canvas context');
      }

      // Draw the visible portion
      ctx.drawImage(canvas, 0, 0);

      // Convert to blob and create URL
      const blob = await new Promise<Blob>((resolve, reject) => {
        visibleCanvas.toBlob(blob => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to create blob'));
          }
        }, 'image/png');
      });

      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
    } catch (error) {
      console.error('Failed to generate preview:', error);
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
        new ClipboardItem({ 'image/png': blob })
      ]);
    } catch (error) {
      console.error('Failed to copy image:', error);
    }
  };

  const downloadImage = () => {
    if (!previewUrl) return;
    const a = document.createElement('a');
    a.href = previewUrl;
    a.download = 'billboard-canvas.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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

    // Open share dialog with platform-specific text
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
        {isGenerating ? 'Generating...' : 'Share View'}
      </button>

      {previewUrl && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-neutral-900 p-4 rounded-lg max-w-lg w-full mx-4">
            <img 
              src={previewUrl} 
              alt="Canvas preview" 
              className="w-full rounded mb-4"
            />
            <div className="flex gap-2 justify-center mb-4">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(previewUrl);
                }}
                className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded font-mono text-sm"
              >
                Copy Image
              </button>
              <button
                onClick={() => {
                  const a = document.createElement('a');
                  a.href = previewUrl;
                  a.download = 'canvas-preview.png';
                  a.click();
                }}
                className="bg-gray-600 hover:bg-gray-500 text-white px-4 py-2 rounded font-mono text-sm"
              >
                Download
              </button>
            </div>
            <button
              onClick={() => {
                URL.revokeObjectURL(previewUrl);
                setPreviewUrl(null);
              }}
              className="text-gray-400 hover:text-white text-sm w-full"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
} 