'use client';

import { useEffect, useState } from 'react';
import { TokenTier } from '@/lib/server/tiers.config';

interface TokenomicsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function TokenomicsModal({ isOpen, onClose }: TokenomicsModalProps) {
  const [tiers, setTiers] = useState<TokenTier[]>([]);
  
  useEffect(() => {
    // Need to fetch tiers client-side to avoid server/client mismatch
    import('@/lib/server/tiers.config').then(module => {
      setTiers(module.TIERS);
    });
  }, []);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 overflow-y-auto">
      <div className="bg-slate-800 border border-slate-700 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-slate-900 p-3 flex justify-between items-center border-b border-slate-700">
          <h2 className="text-[#FFD700] text-lg font-mono">Welcome to Billboard!</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        
        <div className="p-6 space-y-6">
          {/* Token Info */}
          <section className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
            <h2 className="text-[#FFD700] text-lg font-mono mb-4">$BILLBOARD Token</h2>
            <div className="space-y-2 font-mono text-sm">
              <p className="text-slate-300">
                <span className="text-emerald-400">Name:</span> BILLBOARD
              </p>
              <p className="text-slate-300">
                <span className="text-emerald-400">Network:</span> Base
              </p>
              <p className="text-slate-300">
                <span className="text-emerald-400">Contract:</span>{' '}
                <a 
                  href="https://basescan.org/address/0x0aB96f7A85f8480c0220296C3332488ce38D9818"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300"
                >
                  <span className="hidden md:inline">0x0aB96f7A85f8480c0220296C3332488ce38D9818</span>
                  <span className="inline md:hidden">0x0aB9...9818</span>
                </a>
              </p>
            </div>
          </section>
          
          {/* Token Tiers */}
          <section className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
            <h2 className="text-[#FFD700] text-lg font-mono mb-4">Token Tiers</h2>
            <div className="space-y-4 text-slate-300 font-mono text-sm">
              <p>
                Holding $BILLBOARD tokens provides benefits for pixel placement:
              </p>
              
              <div className="bg-slate-800/50 p-4 border border-slate-700 rounded-md text-xs md:text-sm">
                <p className="text-emerald-300 mb-2">Protection System:</p>
                <p>
                  When you place a pixel, it's protected for the time shown in your tier. During this time, only users with <span className="text-yellow-300">more tokens than you currently hold</span> can overwrite your pixel.
                </p>
                <p className="mt-2">
                  <span className="text-amber-300">Dynamic Protection:</span> If you buy more tokens, your pixels immediately gain stronger protection. If you sell tokens, your pixels become more vulnerable to being overwritten. This creates a direct relationship between your token holdings and your ability to maintain your artwork on the canvas.
                </p>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-xs md:text-sm">
                  <thead>
                    <tr className="text-left border-b border-slate-700">
                      <th className="py-2 pr-2 text-emerald-400">Tier</th>
                      <th className="py-2 pr-2 text-emerald-400">Tokens Required</th>
                      <th className="py-2 pr-2 text-emerald-400">Cooldown</th>
                      <th className="py-2 text-emerald-400">Protection</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tiers.map((tier, index) => {
                      // Apply color based on tier name
                      let tierColor = "";
                      switch(tier.name) {
                        case "Ultimate": tierColor = "text-purple-400 font-bold"; break;
                        case "Legendary": tierColor = "text-emerald-400"; break;
                        case "Diamond": tierColor = "text-[#FFD700]"; break;
                        case "Platinum": tierColor = "text-[#E5E4E2]"; break;
                        case "Gold": tierColor = "text-[#FFD700]"; break;
                        case "Silver": tierColor = "text-[#C0C0C0]"; break;
                        case "Bronze": tierColor = "text-[#CD7F32]"; break;
                        default: tierColor = "text-white";
                      }
                      
                      return (
                        <tr key={tier.name} className={index < tiers.length - 1 ? "border-b border-slate-700/50" : ""}>
                          <td className={`py-2 pr-2 ${tierColor}`}>{tier.name}</td>
                          <td className="py-2 pr-2">{formatTokenAmount(tier.minTokens)}</td>
                          <td className="py-2 pr-2">{tier.cooldownSeconds} seconds</td>
                          <td className="py-2">
                            {tier.protectionTime > 0 ? `${tier.protectionTime} hours` : 'None'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
          
          <div className="flex justify-center pt-2">
            <button 
              onClick={onClose}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-md font-mono text-sm"
            >
              Let's start placing pixels!
            </button>
          </div>
        </div>
      </div>
    </div>
  );
} 