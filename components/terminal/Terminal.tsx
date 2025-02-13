'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';
import Image from 'next/image';

// Add the formatTimeSince function
function formatTimeSince(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

// Move interface to a types file or define it here
interface Message {
  id: string;
  message: string;
  wallet_address: string;
  created_at: string;
  color?: string;
  message_type: string;
  farcaster_username?: string | null;
  farcaster_pfp?: string | null;
}

const MAX_MESSAGES = 100; // Adjust based on performance needs

export default function Terminal() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0);

  // Move backfill function inside component to access setMessages
  const backfillFarcasterData = async (messages: Message[]) => {
    const messagesNeedingBackfill = messages.filter(m => !m.farcaster_username);
    if (!messagesNeedingBackfill.length) return;

    console.log(`Backfilling Farcaster data for ${messagesNeedingBackfill.length} messages...`);
    
    const uniqueAddresses = [...new Set(messagesNeedingBackfill.map(m => m.wallet_address))];
    
    for (const address of uniqueAddresses) {
      try {
        const response = await fetch(`/api/farcaster?address=${address}`);
        const data = await response.json();
        
        if (data.success && data.data) {
          const { error: updateError } = await supabase
            .from('terminal_messages')
            .update({
              farcaster_username: data.data.username,
              farcaster_pfp: data.data.pfpUrl
            })
            .eq('wallet_address', address)
            .is('farcaster_username', null);

          if (updateError) {
            console.error(`Error updating messages for ${address}:`, updateError);
          } else {
            console.log(`Updated messages for ${address} with username ${data.data.username}`);
            
            // Now we can access setMessages properly
            setMessages(current => 
              current.map(msg => 
                msg.wallet_address === address 
                  ? {
                      ...msg,
                      farcaster_username: data.data.username,
                      farcaster_pfp: data.data.pfpUrl
                    }
                  : msg
              )
            );
          }
        }
      } catch (error) {
        console.error(`Error backfilling address ${address}:`, error);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  };

  // Load initial messages and set up subscription
  useEffect(() => {
    let channel: RealtimeChannel;

    const setupRealtimeSubscription = async () => {
      // First load initial messages
      const { data: initialMessages, error: initialError } = await supabase
        .from('terminal_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(MAX_MESSAGES);

      if (initialError) {
        console.error('Error loading initial messages:', initialError);
      } else {
        console.log('Initial messages loaded:', initialMessages?.length);
        setMessages(initialMessages || []);
        
        // Trigger backfill for messages without Farcaster data
        if (initialMessages) {
          backfillFarcasterData(initialMessages);
        }
      }

      // Set up subscription for new messages
      channel = supabase.channel('any')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'terminal_messages',
          },
          async (payload) => {
            console.log('Realtime message received:', payload);
            const newMessage = payload.new as Message;
            setMessages((current) => {
              const newMessages = [newMessage, ...current];
              // Keep only the most recent messages
              return newMessages.slice(0, MAX_MESSAGES);
            });
            
            // Backfill for new message if needed
            if (!newMessage.farcaster_username) {
              await backfillFarcasterData([newMessage]);
            }
          }
        )
        .subscribe((status) => {
          console.log('Subscription status:', status);
          setLoading(false);
        });
    };

    setupRealtimeSubscription();

    // Cleanup subscription
    return () => {
      if (channel) {
        console.log('Cleaning up subscription');
        channel.unsubscribe();
      }
    };
  }, []);

  // Update timestamps every second
  useEffect(() => {
    const timer = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  if (loading) {
    return <div className="text-white h-full">Loading messages...</div>;
  }

  return (
    <div className="font-mono text-sm">
      {messages.map((message: Message) => {
        const coords = message.message.match(/\((\d+),\s*(\d+)\)/);
        const x = coords?.[1] || '';
        const y = coords?.[2] || '';
        
        const colorMatch = message.message.match(/a (#[A-Fa-f0-9]{6}) pixel/);
        const pixelColor = colorMatch?.[1] || '#000000';
        
        const timeSince = formatTimeSince(Math.floor((Date.now() - new Date(message.created_at).getTime()) / 1000));

        return (
          <div 
            key={message.id}
            className="px-2 sm:px-6 py-2 sm:py-3"
          >
            <div className="max-w-2xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-2 items-center text-xs sm:text-sm">
              {/* Time */}
              <div className="text-center">
                {timeSince}
              </div>
              
              {/* User */}
              <div className="flex items-center justify-center gap-1 sm:gap-2">
                {message.farcaster_pfp && (
                  <div className="w-5 h-5 rounded-full overflow-hidden flex-shrink-0">
                    <Image 
                      src={message.farcaster_pfp}
                      alt=""
                      width={20}
                      height={20}
                      className="object-cover"
                    />
                  </div>
                )}
                <a 
                  href={message.farcaster_username 
                    ? `https://warpcast.com/${message.farcaster_username}`
                    : `https://basescan.org/address/${message.wallet_address}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300"
                >
                  {message.farcaster_username 
                    ? `@${message.farcaster_username}`
                    : `${message.wallet_address.slice(0, 6)}...${message.wallet_address.slice(-4)}`
                  }
                </a>
              </div>
              
              {/* Color - Hide on mobile */}
              <div className="hidden sm:flex items-center justify-center gap-2">
                <div 
                  className="w-4 h-4 rounded-sm border border-slate-700"
                  style={{ backgroundColor: pixelColor }}
                />
                <span className="text-slate-300">{pixelColor}</span>
              </div>
              
              {/* Position */}
              <div className="text-center">
                ({x}, {y})
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
} 