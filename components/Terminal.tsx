'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

interface TerminalMessage {
  id: string;
  message: string;
  wallet_address: string;
  message_type: string;
  created_at: string;
  farcaster_user?: {
    username: string;
    display_name: string;
  };
}

export default function Terminal() {
  const [messages, setMessages] = useState<TerminalMessage[]>([]);

  useEffect(() => {
    // Load initial messages
    loadMessages();

    // Subscribe to new messages
    const subscription = supabase
      .channel('terminal_messages')
      .on('postgres_changes', 
        { event: 'INSERT', schema: 'public', table: 'terminal_messages' },
        (payload) => {
          setMessages(prev => [...prev, payload.new as TerminalMessage].slice(-50));
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const loadMessages = async () => {
    const { data } = await supabase
      .from('terminal_messages')
      .select(`
        *,
        farcaster_users (
          username,
          display_name
        )
      `)
      .order('created_at', { ascending: false })
      .limit(50);

    if (data) {
      setMessages(data.reverse());
    }
  };

  const getMessageColor = (type: string) => {
    switch (type) {
      case 'user_joined':
        return 'text-blue-400';
      case 'pixel_placed':
        return 'text-green-400';
      default:
        return 'text-gray-400';
    }
  };

  return (
    <div className="bg-black text-green-400 p-4 rounded-lg h-64 overflow-y-auto font-mono text-sm">
      {messages.map((msg) => (
        <div key={msg.id} className="mb-1">
          <span className="opacity-50">[{new Date(msg.created_at).toLocaleTimeString()}]</span>{' '}
          <span className="text-yellow-400">
            {msg.farcaster_user?.username || msg.wallet_address.slice(0, 6)}
          </span>{' '}
          <span className={getMessageColor(msg.message_type)}>
            {msg.message}
          </span>
        </div>
      ))}
    </div>
  );
} 