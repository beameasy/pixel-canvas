'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useEffect, useState, useRef } from 'react';
import Canvas from '@/components/Canvas';
import Terminal from '@/components/Terminal';
import { supabase } from '@/lib/supabaseClient';
import { getFarcasterUser } from '@/lib/neynar';

export default function Home() {
  const { login, authenticated, user } = usePrivy();
  const [selectedColor, setSelectedColor] = useState('#000000');
  const canvasRef = useRef<{ resetView: () => void; clearCanvas: () => void }>(null);

  useEffect(() => {
    if (user?.wallet?.address) {
      handleUserConnection();
    }
  }, [user?.wallet?.address]);

  const handleUserConnection = async () => {
    if (!user?.wallet?.address) return;

    try {
      // Get Farcaster data
      const farcasterUser = await getFarcasterUser(user.wallet.address);
      
      if (farcasterUser) {
        // Update Farcaster user data
        await supabase
          .from('farcaster_users')
          .upsert({
            wallet_address: user.wallet.address,
            fid: farcasterUser.fid,
            username: farcasterUser.username,
            display_name: farcasterUser.displayName,
            avatar_url: farcasterUser.pfp.url,
            profile_image_url: farcasterUser.pfp.url,
            last_updated: new Date().toISOString()
          });
      }

      // Create connection message
      await supabase
        .from('terminal_messages')
        .insert({
          message: 'connected wallet',
          wallet_address: user.wallet.address,
          message_type: 'user_joined'
        });

    } catch (error) {
      console.error('Error handling user connection:', error);
    }
  };

  return (
    <main className="w-full max-w-[1200px] h-full flex flex-col items-center p-5 bg-[#1a1a1a]">
      <div className="header w-full flex flex-col items-center gap-1 mb-2">
        <div className="header-content w-full max-w-[900px] flex items-center justify-between gap-8 px-3 relative mb-3">
          <div className="logo text-3xl text-[#646cff] font-['Press_Start_2P'] tracking-wider leading-5">
            BILLBOARD
          </div>
          <div className="wallet-section flex items-center gap-2 flex-shrink-1 min-w-0 mr-1 h-5">
            {!authenticated ? (
              <button
                onClick={login}
                className="bg-[#646cff] border-none px-4 py-2 rounded-lg text-white font-['Press_Start_2P'] text-xs cursor-pointer"
              >
                Connect Wallet
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <p className="text-white">
                  {user?.wallet?.address.slice(0, 6)}...{user?.wallet?.address.slice(-4)}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="workspace w-[908px] flex gap-2 justify-center items-start flex-1 mx-auto">
        <div className="canvas-container w-[600px] h-[600px] bg-white rounded-lg overflow-hidden relative flex-shrink-0">
          <Canvas 
            ref={canvasRef}
            selectedColor={selectedColor}
            onColorSelect={setSelectedColor}
          />
        </div>
        <div className="terminal-wrapper w-[300px] h-[600px] bg-[#1a1a1a] border border-[#333] rounded-lg overflow-hidden flex-shrink-0">
          <Terminal />
        </div>
      </div>
    </main>
  );
} 