interface ButtonProps {
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}

export default function Button({ onClick, children, className = '' }: ButtonProps) {
  return (
    <button 
      onClick={onClick}
      className={`px-3 py-1 bg-[#FFD700] text-black font-mono rounded hover:bg-[#FFC700] transition-colors text-sm ${className}`}
    >
      {children}
    </button>
  );
} 