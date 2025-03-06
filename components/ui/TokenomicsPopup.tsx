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
      className="fixed inset-0 z-100 flex items-center justify-center p-2 sm:p-4 bg-black/70 backdrop-blur-sm overflow-y-auto"
      ref={popupRef}
      onClick={(e) => {
        // Prevent click event from propagating when clicking inside the popup content
        if (e.target === e.currentTarget) {
          onClose();
          localStorage.setItem('tokenomicsPopupClosed', 'true');
        }
      }}
    >
      <div 
        className="bg-slate-800 border border-slate-700 rounded-lg max-w-[95vw] sm:max-w-md md:max-w-lg lg:max-w-2xl w-full max-h-[90vh] sm:max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()} // Prevent clicks inside the popup from closing it
      >
        <div className="sticky top-0 z-10 bg-slate-900 px-3 py-2 sm:p-3 flex justify-between items-center border-b border-slate-700">
          <h1 className="text-[#FFD700] text-base sm:text-lg font-mono">Welcome to Billboard on Base!</h1>
          <button 
            onClick={() => {
              onClose();
              localStorage.setItem('tokenomicsPopupClosed', 'true');
            }}
            className="text-slate-400 hover:text-white ml-2"
            aria-label="Close popup"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
          
        <div className="p-3 sm:p-6 space-y-3 sm:space-y-4 text-slate-300 font-mono text-xs sm:text-sm">
          <p className="mb-2">
            Holding $BILLBOARD tokens provides benefits for pixel placement:
          </p>
          
          <div className="bg-slate-800/50 p-2 sm:p-3 border border-slate-700 rounded-md mb-3 sm:mb-4">
            <p className="text-emerald-300 mb-2">Protection System:</p>
            <p>
              When you place a pixel, it's protected for the time shown in your tier. During this time, only users with <span className="text-yellow-300">more tokens than you currently hold</span> can overwrite your pixel.
            </p>
            <p className="mt-2">
              <span className="text-amber-300">Dynamic Protection:</span> If you buy more tokens, your pixels immediately gain stronger protection.
            </p>
          </div>
          
          <h2 className="text-[#FFD700] text-base sm:text-lg font-mono mb-2 pt-1">$BILLBOARD Token Tiers</h2>
          
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
              case "Ultimate": tierColor = "text-purple-400 font-bold"; break;
              case "Legendary": tierColor = "text-emerald-400"; break;
              case "Diamond": tierColor = "text-[#FFD700]"; break;
              case "Platinum": tierColor = "text-[#E5E4E2]"; break;
              case "Gold": tierColor = "text-[#FFD700]"; break;
              case "Silver": tierColor = "text-[#C0C0C0]"; break;
              case "Bronze": tierColor = "text-[#CD7F32]"; break;
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
          
          <div className="flex justify-center mt-4 sm:mt-6">
            <button
              onClick={() => {
                onClose();
                localStorage.setItem('tokenomicsPopupClosed', 'true');
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white font-mono text-sm px-6 py-2 rounded-md"
            >
              Let's start placing pixels!
            </button>
          </div>
        </div>
      </div>
    </div>
  );
} 