import { useEffect, useState, useRef } from 'react';
import { TokenTier } from '@/lib/server/tiers.config';

interface TokenomicsPopupProps {
  isOpen: boolean;
  onClose: () => void;
  configVersion: string;
}

export default function TokenomicsPopup({ isOpen, onClose, configVersion }: TokenomicsPopupProps) {
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

  // Function to handle popup closing
  const handleClosePopup = () => {
    // Save both the closed state and the current config version
    localStorage.setItem('tokenomicsPopupClosed', 'true');
    localStorage.setItem('tokenomicsConfigVersion', configVersion);
    onClose();
  };

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
      className="fixed inset-x-0 top-24 bottom-0 z-[90] flex items-center justify-center p-2 sm:p-4 bg-black/70 backdrop-blur-sm"
      ref={popupRef}
      onClick={(e) => {
        // Prevent click event from propagating when clicking inside the popup content
        if (e.target === e.currentTarget) {
          handleClosePopup();
        }
      }}
    >
      <div 
        className="bg-slate-800 border border-slate-700 rounded-lg w-[98vw] sm:w-[90vw] md:w-[700px] lg:w-[800px] flex flex-col"
        style={{ maxHeight: 'calc(90vh - 48px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-slate-900 px-3 py-1.5 flex justify-between items-center border-b border-slate-700 rounded-t-lg">
          <div className="w-6"></div> {/* Spacer to balance the close button */}
          <h1 className="text-[#FFD700] text-base font-mono text-center flex-grow">Welcome to Billboard on Base!</h1>
          <button 
            onClick={handleClosePopup}
            className="text-slate-400 hover:text-white ml-2"
            aria-label="Close popup"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
          
        <div className="p-2 sm:p-3 space-y-1.5 text-slate-300 font-mono text-xs flex-grow">
          <p className="mb-0.5">
            Holding $BILLBOARD tokens provides benefits for pixel placement:
          </p>
          
          <div className="bg-slate-800/50 p-1.5 border border-slate-700 rounded-md mb-0.5">
            <p className="text-emerald-300 mb-0.5">Protection System:</p>
            <p className="text-[10px] sm:text-xs leading-tight">
              When you place a pixel, it's protected for the time shown in your tier. During this time, only users with <span className="text-yellow-300">more tokens than you currently hold</span> can overwrite your pixel.
            </p>
            
            <p className="mt-0.5 text-[10px] sm:text-xs leading-tight">
              <span className="text-amber-300">Dynamic Protection:</span> If you buy more tokens, your pixels immediately gain stronger protection, if you sell, they become more vulnerable.
            </p>
          </div>
          
          <h2 className="text-[#FFD700] text-sm font-mono mb-0.5 text-center">$BILLBOARD Token Tiers</h2>
          
          {/* Table header with centered text */}
          <div className="grid grid-cols-3 text-center border-b border-slate-700 py-0.5">
            <div className="text-emerald-400 px-1 text-[10px] sm:text-xs">Tokens</div>
            <div className="text-emerald-400 px-1 text-[10px] sm:text-xs">Cooldown</div>
            <div className="text-emerald-400 px-1 text-[10px] sm:text-xs">Protection</div>
          </div>
          
          {/* No need for scrolling container, show all tiers directly */}
          <div>
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
                  className={`grid grid-cols-3 text-center py-0.5 ${
                    index < tiers.length - 1 ? "border-b border-slate-700/50" : ""
                  }`}
                >
                  <div className={`${tierColor} px-1 text-[10px] sm:text-xs`}>{formatTokenAmount(tier.minTokens)}</div>
                  <div className="px-1 text-[10px] sm:text-xs">{tier.cooldownSeconds}s</div>
                  <div className="px-1 text-[10px] sm:text-xs">
                    {tier.protectionTime > 0 ? `${tier.protectionTime}h` : 'None'}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Display version info more subtly */}
          <div className="text-[9px] sm:text-[10px] text-slate-500 text-center">
            v{configVersion}
          </div>
          
          <div className="flex justify-center mt-1">
            <button
              onClick={handleClosePopup}
              className="bg-blue-600 hover:bg-blue-700 text-white font-mono text-xs px-4 py-1 rounded-md"
            >
              Let's start placing pixels!
            </button>
          </div>
        </div>
      </div>
    </div>
  );
} 