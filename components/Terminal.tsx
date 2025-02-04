'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { RealtimeChannel } from '@supabase/supabase-js';
import Image from 'next/image';

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

// Update the flashing animation keyframes to be more pronounced
const flashingStyle = `
  @keyframes flash {
    0% { color: rgb(255, 255, 0); }
    50% { color: rgba(255, 255, 0, 0.3); }
    100% { color: rgb(255, 255, 0); }
  }

  .flash-animation {
    animation: flash 1s infinite;
  }
`;

function formatTimeSince(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function getTimeStyle(seconds: number): string {
  if (seconds < 60) return 'flash-animation';  // Yellow flashing for < 1 minute
  if (seconds < 300) return 'text-orange-400'; // Orange for < 5 minutes
  if (seconds < 900) return 'text-yellow-500'; // Yellow for < 15 minutes
  if (seconds < 3600) return 'text-green-400'; // Green for < 1 hour
  if (seconds < 86400) return 'text-blue-400'; // Blue for < 1 day
  return 'text-gray-400'; // Gray for >= 1 day
}

const MAX_MESSAGES = 100; // Adjust based on performance needs

function AddressDisplay({ address, farcasterUser }: { 
  address: string, 
  farcasterUser: { username: string; pfpUrl: string | null } | null 
}) {
  if (farcasterUser?.username) {
    return (
      <a 
        href={`https://warpcast.com/${farcasterUser.username}`}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:underline"
      >
        {farcasterUser.username}
      </a>
    );
  }
  
  return (
    <a 
      href={`https://basescan.org/address/${address}`}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:underline"
    >
      {address.slice(0, 6)}
    </a>
  );
}

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
    <div className="h-full bg-neutral-900/900 flex flex-col rounded-lg">
      <style>{flashingStyle}</style>
      <div 
        className="flex-1 overflow-y-auto px-4 py-8 font-mono text-sm text-white"
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: '#666666 #1a1a1a',
          overscrollBehavior: 'contain'
        }}
      >
        {messages.map((message: Message, index) => {
          const coords = message.message.match(/\((\d+),\s*(\d+)\)/);
          const x = coords?.[1] || '';
          const y = coords?.[2] || '';
          
          // Extract color from message
          const colorMatch = message.message.match(/a (#[A-Fa-f0-9]{6}) pixel/);
          const pixelColor = colorMatch?.[1] || '#000000';
          
          return (
            <div 
              key={message.id} 
              className={`whitespace-pre font-mono flex items-center gap-2`}
            >
              <span 
                style={{ display: 'inline-block', width: '4ch', textAlign: 'right', marginRight: '8px' }}
                className={getTimeStyle(Math.floor((Date.now() - new Date(message.created_at).getTime()) / 1000))}
              >
                {formatTimeSince(Math.floor((Date.now() - new Date(message.created_at).getTime()) / 1000))}
              </span>
              <span> </span>
              
              {/* User Identity Section - Fixed width container */}
              <div className="w-48 flex items-center justify-center gap-2">
                {message.farcaster_pfp ? (
                  <div className="w-4 h-4 rounded-full overflow-hidden relative bg-gray-800 flex-shrink-0">
                    <Image 
                      src={message.farcaster_pfp}
                      alt="profile"
                      width={16}
                      height={16}
                      className="object-cover rounded-full"
                      style={{ width: '100%', height: '100%' }}
                    />
                  </div>
                ) : null}
                
                <span style={{ color: '#4488ff' }} className="truncate text-center">
                  <AddressDisplay 
                    address={message.wallet_address} 
                    farcasterUser={message.farcaster_username ? { 
                      username: message.farcaster_username, 
                      pfpUrl: message.farcaster_pfp || null 
                    } : null} 
                  />
                </span>
              </div>

              {/* Rest of the message with consistent positioning */}
              <span>placed </span>
              <span style={{ color: pixelColor }}>pixel</span>
              <span> at </span>
              <span className="text-black">({x}, {y})</span>
            </div>
          );
        })}
      </div>
    </div>
  );
} 