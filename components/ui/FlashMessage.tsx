'use client';

import { useEffect, useState } from 'react';

interface FlashMessageProps {
  message: string;
  onComplete: () => void;
}

export default function FlashMessage({ message, onComplete }: FlashMessageProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const handleMouseMove = () => {
      setIsVisible(false);
      onComplete();
    };

    // Add listener after a short delay
    const timeout = setTimeout(() => {
      document.addEventListener('mousemove', handleMouseMove, { once: true });
    }, 1000);

    // Auto-dismiss after 5 seconds
    const dismissTimeout = setTimeout(() => {
      setIsVisible(false);
      onComplete();
    }, 5000);

    return () => {
      clearTimeout(timeout);
      clearTimeout(dismissTimeout);
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, [message]); // Only depend on message

  // Only render once when visible
  if (!isVisible) return null;

  return (
    <div className="transition-opacity duration-500 opacity-100">
      <div className="font-mono text-[#FFD700] text-sm bg-slate-900/90 px-4 py-2 rounded-lg">
        {message}
      </div>
    </div>
  );
} 