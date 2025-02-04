'use client'

import dynamic from 'next/dynamic'

const DynamicTerminal = dynamic(() => import('./Terminal'), {
  ssr: false,
})

export default function TerminalWrapper() {
  return (
    <div className="h-full">
      <DynamicTerminal />
    </div>
  )
} 