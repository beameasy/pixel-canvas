'use client';

import TerminalWrapper from '@/components/terminal/TerminalWrapper';

export default function LogsPage() {
  return (
    <div className="mt-20">
      <main className="w-full max-w-[1000px] mx-auto p-5">
        <h1 className="text-[#FFD700] font-mono text-2xl text-center mb-8">
          Pixel Placement Logs
        </h1>
        <div className="bg-transparent">
          <TerminalWrapper />
        </div>
      </main>
    </div>
  );
} 