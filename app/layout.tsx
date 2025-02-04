'use client';

import { Providers } from './providers'
import './globals.css'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="overflow-auto">
        <Providers>
          <div className="flex flex-col h-screen bg-slate-800">
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
} 