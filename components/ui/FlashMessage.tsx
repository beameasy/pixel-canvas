'use client';

import { useEffect, useState } from 'react';

interface FlashMessageProps {
  message: string;
  onComplete: () => void;
  hasLink?: boolean;
  duration?: number; // Add optional duration parameter with default in milliseconds
}

export default function FlashMessage({ 
  message, 
  onComplete, 
  hasLink = false,
  duration = 10000 // Default to 10 seconds instead of 5
}: FlashMessageProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    // Reset visibility when message changes
    setIsVisible(true);
    
    // Auto-dismiss after the specified duration (default 10 seconds)
    const dismissTimeout = setTimeout(() => {
      setIsVisible(false);
      onComplete();
    }, duration);

    return () => {
      clearTimeout(dismissTimeout);
    };
  }, [message, onComplete, duration]); // Add duration to dependencies

  // Only render when visible
  if (!isVisible) return null;

  // Animation fade-in and fade-out
  return (
    <div className={`transition-all duration-300 animate-fadeIn ${hasLink ? 'hover:scale-105' : ''}`}>
      <div className={`font-mono text-sm bg-slate-900/95 border px-4 py-2.5 rounded-lg shadow-lg backdrop-blur-sm ${
        hasLink 
          ? 'border-yellow-500/50 text-yellow-300 hover:border-yellow-400 hover:bg-slate-800/90' 
          : 'border-[#FFD700]/30 text-[#FFD700]'
      }`}>
        {hasLink ? (
          <div dangerouslySetInnerHTML={{ __html: message }} />
        ) : (
          message
        )}
      </div>
    </div>
  );
} 