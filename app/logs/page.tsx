'use client';

import { usePrivy } from '@privy-io/react-auth';
import Link from 'next/link';
import TerminalWrapper from '@/components/TerminalWrapper';

export default function LogsPage() {
  const { authenticated } = usePrivy();

  return (
    <div className="min-h-screen bg-slate-800 overflow-y-auto">
      <main className="w-full max-w-[1200px] mx-auto p-5 pb-20 flex flex-col items-center">
        {/* Header */}
        <div className="w-full flex justify-between items-center mb-8">
          <Link 
            href="/" 
            className="text-[#FFD700] hover:text-[#FFC700] font-mono transition-colors"
          >
            ← Back to Canvas
          </Link>
        </div>

        {/* Logs Table */}
        <div className="w-[800px] bg-slate-800 rounded-lg p-4">
          <h1 className="text-[#FFD700] font-mono text-xl mb-4 text-center">Pixel Placement Logs</h1>
          <div className="h-[70vh] overflow-y-auto bg-[#1e293b] rounded-lg">
            <TerminalWrapper />
          </div>
        </div>
      </main>
    </div>
  );
} 