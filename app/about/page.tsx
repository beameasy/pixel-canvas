'use client';

export default function AboutPage() {
  return (
    <div className="bg-slate-800 p-4 min-h-screen flex flex-col">
      <div className="max-w-[800px] mx-auto w-full pb-20">
        <h1 className="text-[#FFD700] text-2xl font-mono mb-6">About Billboard</h1>
        
        <div className="space-y-8">
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
        </div>
      </div>
    </div>
  );
} 