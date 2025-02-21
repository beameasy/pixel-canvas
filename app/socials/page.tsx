'use client';

export default function SocialsPage() {
  return (
    <div className="bg-slate-800 p-4 min-h-screen flex flex-col">
      <div className="max-w-[800px] mx-auto w-full pb-20">
        <h1 className="text-[#FFD700] text-2xl font-mono mb-6">Socials</h1>
        
        <div className="space-y-8">
          {/* Links */}
          <section className="bg-slate-900/50 rounded-lg p-6 border border-slate-700">
            <h2 className="text-[#FFD700] text-lg font-mono mb-4">Links</h2>
            <div className="space-y-2 font-mono text-sm">
              <p className="text-slate-300">
                <span className="text-emerald-400">Twitter:</span>{' '}
                <a 
                  href="https://twitter.com/billboardonbase"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300"
                >
                  @billboardonbase
                </a>
              </p>
              <p className="text-slate-300">
                <span className="text-emerald-400">Warpcast:</span>{' '}
                <a 
                  href="https://warpcast.com/~/channel/billboardonbase"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300"
                >
                  /billboardonbase
                </a>
              </p>
              <p className="text-slate-300">
                <span className="text-emerald-400">Telegram:</span>{' '}
                <a 
                  href="https://t.me/billboardonbase"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300"
                >
                  @billboardonbase
                </a>
              </p>
            </div>
          </section>

          {/* Creator */}
          <section className="bg-slate-900/50 rounded-lg p-6 border border-slate-700">
            <h2 className="text-[#FFD700] text-lg font-mono mb-4">Creator</h2>
            <div className="space-y-2 font-mono text-sm">
              <p className="text-slate-300">
                <span className="text-emerald-400">Twitter:</span>{' '}
                <a 
                  href="https://twitter.com/beam_easy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300"
                >
                  @beam_easy
                </a>
              </p>
              <p className="text-slate-300">
                <span className="text-emerald-400">Warpcast:</span>{' '}
                <a 
                  href="https://warpcast.com/iamtaylor"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300"
                >
                  @iamtaylor
                </a>
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
} 