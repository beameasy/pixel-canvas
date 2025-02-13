'use client';

import { useEffect, useState } from 'react';

interface FlashMessageProps {
  message: string;
  onComplete: () => void;
}

export default function FlashMessage({ message, onComplete }: FlashMessageProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    setIsVisible(true);
    const timer = setTimeout(() => {
      setIsVisible(false);
      onComplete();
    }, 5000);

    return () => clearTimeout(timer);
  }, [message, onComplete]);

  return (
    <div className={`transition-opacity duration-500 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
      <div className="font-mono text-[#FFD700] text-sm bg-slate-900/90 px-4 py-2 rounded-lg">
        {message}
      </div>
    </div>
  );
} 