import { useEffect, useState, useRef } from 'react';
import { TokenTier } from '@/lib/server/tiers.config';

interface TokenomicsPopupProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function TokenomicsPopup({ isOpen, onClose }: TokenomicsPopupProps) {
  const [tiers, setTiers] = useState<TokenTier[]>([]);
  const popupRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    // Need to fetch tiers client-side to avoid server/client mismatch
    import('@/lib/server/tiers.config').then(module => {
      setTiers(module.TIERS);
    });
  }, []);
  
  // Add global click handler to close popup when clicking anywhere
  useEffect(() => {
    if (!isOpen) return;
    
    const handleGlobalClick = (e: MouseEvent) => {
      // Always close the popup on any click when open
      onClose();
      
      // Store in localStorage that the user has seen and closed the popup
      localStorage.setItem('tokenomicsPopupClosed', 'true');
    };
    
    // Add the global event listener
    document.addEventListener('click', handleGlobalClick);
    
    // Clean up
    return () => {
      document.removeEventListener('click', handleGlobalClick);
    };
  }, [isOpen, onClose]);
  
  // Prevent background page from scrolling/zooming when popup is open
  useEffect(() => {
    if (isOpen) {
      // Save the current scroll position
      const scrollY = window.scrollY;
      
      // Disable scrolling on the background
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';
      document.body.style.overflowY = 'hidden';
      
      return () => {
        // Re-enable scrolling when popup closes
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        document.body.style.overflowY = '';
        
        // Restore scroll position
        window.scrollTo(0, scrollY);
      };
    }
  }, [isOpen]);

  // Function to format large numbers with "B" or "M" suffix
  const formatTokenAmount = (amount: number) => {
    if (amount === 0) return '0';
    if (amount >= 1_000_000_000) {
      return `${(amount / 1_000_000_000).toFixed(2)}B`;
    }
    return `${amount / 1_000_000}M`;
  };

  if (!isOpen) return null;
  
  return (
    <div 
      className="fixed top-[120px] inset-x-0 bottom-0 bg-slate-900 flex flex-col z-[90] overflow-y-auto"
      ref={popupRef}
    >
      <div 
        className="w-full max-w-screen-md mx-auto flex-1 overflow-y-auto"
      >
        <div className="relative p-4 pt-6">
          <button 
            onClick={() => {
              onClose();
              localStorage.setItem('tokenomicsPopupClosed', 'true');
            }}
            className="absolute top-2 right-2 text-slate-400 hover:text-white"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          
          <h1 className="text-[#FFD700] text-xl sm:text-2xl font-mono mb-6 text-center">
            Welcome to Billboard on Base!
          </h1>
          
          <div className="space-y-4 text-slate-300 font-mono text-xs sm:text-sm">
            <p className="mb-5">
              Holding $BILLBOARD tokens provides benefits for pixel placement:
            </p>
            
            <div className="bg-slate-800/50 p-3 border border-slate-700 rounded-md mb-6">
              <p className="text-emerald-300 mb-2">Protection System:</p>
              <p>
                When you place a pixel, it's protected for the time shown in your tier. During this time, only users with <span className="text-yellow-300">more tokens than you had at placement time</span> can overwrite your pixel. This helps preserve artwork while still allowing for canvas evolution.
              </p>
            </div>
            
            <h2 className="text-[#FFD700] text-lg font-mono mb-2 pt-1">$BILLBOARD Token Tiers</h2>
            
            {/* Table header with centered text */}
            <div className="grid grid-cols-3 text-center border-b border-slate-700 py-2">
              <div className="text-emerald-400 px-1">Tokens</div>
              <div className="text-emerald-400 px-1">Cooldown</div>
              <div className="text-emerald-400 px-1">Protection</div>
            </div>
            
            {tiers.map((tier, index) => {
              // Get the color for the tokens amount based on tier
              let tierColor = "";
              switch(tier.name) {
                case "Diamond": tierColor = "text-[#FFD700]"; break;
                case "Platinum": tierColor = "text-[#E5E4E2]"; break;
                case "Gold": tierColor = "text-[#FFD700]"; break;
                case "Silver": tierColor = "text-[#C0C0C0]"; break;
                case "Bronze": tierColor = "text-[#CD7F32]"; break;
                case "Legendary": 
                case "Legend": tierColor = "text-white"; break;
                default: tierColor = "text-white";
              }
              
              return (
                <div 
                  key={tier.name} 
                  className={`grid grid-cols-3 text-center py-2 ${
                    index < tiers.length - 1 ? "border-b border-slate-700/50" : ""
                  }`}
                >
                  <div className={`${tierColor} px-1`}>{formatTokenAmount(tier.minTokens)}</div>
                  <div className="px-1">{tier.cooldownSeconds}s</div>
                  <div className="px-1">
                    {tier.protectionTime > 0 ? `${tier.protectionTime}h` : 'None'}
                  </div>
                </div>
              );
            })}
            
            <div className="flex justify-center mt-8 mb-4">
              <button
                onClick={() => {
                  onClose();
                  localStorage.setItem('tokenomicsPopupClosed', 'true');
                }}
                className="bg-slate-700 hover:bg-slate-600 text-white font-mono text-sm px-8 py-3 rounded-md"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 