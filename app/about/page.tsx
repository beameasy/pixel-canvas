'use client';

import { useEffect, useState } from 'react';
import { TokenTier } from '@/lib/server/tiers.config';

export default function AboutPage() {
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
  
  return (
    <div className="bg-slate-800 p-4 flex-1 w-full min-h-0">
      <div className="max-w-[800px] mx-auto w-full pb-32 md:pb-24">
        <h1 className="text-[#FFD700] text-2xl font-mono mb-6 pt-2">About Billboard</h1>
        
        <div className="space-y-8 mb-20">
          {/* What is Billboard */}
          <section className="bg-slate-900/50 rounded-lg p-6 border border-slate-700">
            <h2 className="text-[#FFD700] text-lg font-mono mb-4">Billboard on Base</h2>
            <div className="space-y-4 text-slate-300 font-mono text-sm leading-relaxed">
              <p>
                A collaborative art project that allows users to place pixels on a 400x400 canvas.
              </p>
              <p>
                Advertise, meme, and create in a shared space, with instant updates. Watch pixels appear in real-time as the community builds together.
              </p>
              <p>
                Join in creating something unique on Base. Whether you're marking your territory, sharing your art, or just having fun - there's a pixel waiting for you.
              </p>
            </div>
          </section>

          {/* Token Info */}
          <section className="bg-slate-900/50 rounded-lg p-6 border border-slate-700">
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
              <p className="text-slate-300">
                <span className="text-emerald-400">Launch:</span>{' '}
                Launched via{' '}
                <a 
                  href="https://www.clanker.world/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300"
                >
                  Clanker
                </a>
                {' '}on{' '}
                <a 
                  href="https://clank.fun"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300"
                >
                  Clank.fun
                </a>
              </p>
            </div>
          </section>
          
          {/* Token Tiers */}
          <section className="bg-slate-900/50 rounded-lg p-6 border border-slate-700">
            <h2 className="text-[#FFD700] text-lg font-mono mb-4">Token Tiers</h2>
            <div className="space-y-4 text-slate-300 font-mono text-sm">
              <p>
                Holding $BILLBOARD tokens provides benefits for pixel placement:
              </p>
              
              <div className="bg-slate-800/50 p-4 border border-slate-700 rounded-md text-xs md:text-sm">
                <p className="text-emerald-300 mb-2">Protection System:</p>
                <p>
                  When you place a pixel, it's protected for the time shown in your tier. During this time, only users with <span className="text-yellow-300">more tokens than you had at placement time</span> can overwrite your pixel. This helps preserve artwork while still allowing for canvas evolution.
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
        </div>
      </div>
    </div>
  );
} 