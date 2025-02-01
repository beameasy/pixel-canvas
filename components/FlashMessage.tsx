'use client';

interface FlashMessageProps {
  message: {
    type: string;
    message: string;
  };
  onClose: () => void;
}

export function FlashMessage({ message, onClose }: FlashMessageProps) {
  return (
    <div 
      className={`fixed top-4 right-4 p-4 rounded-lg shadow-lg ${
        message.type === 'error' ? 'bg-red-500' : 'bg-green-500'
      } text-white font-['Press_Start_2P'] text-xs`}
    >
      {message.message}
      <button 
        onClick={onClose}
        className="ml-4 opacity-70 hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
} 