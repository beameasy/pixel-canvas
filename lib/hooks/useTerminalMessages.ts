'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import React from 'react';

export interface TerminalMessage {
  id: string;
  message: string;
  wallet_address: string;
  message_type: string;
  created_at: string;
}

export function useTerminalMessages(limit = 100, page = 0, usePagination = true) {
  const [messages, setMessages] = useState<TerminalMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);

  const fetchMessages = React.useCallback(async () => {
    try {
      const query = supabase
        .from('terminal_messages')
        .select('*')
        .order('created_at', { ascending: false });

      if (usePagination) {
        query.range(page * limit, (page + 1) * limit - 1);
      } else {
        query.limit(limit);
      }

      const { data, error } = await query;
      if (error) throw error;
      
      setMessages(data || []);
      setHasMore(data?.length === limit);
      setLoading(false);
    } catch (error) {
      console.error('Error:', error);
      setLoading(false);
    }
  }, [page, limit, usePagination]);

  useEffect(() => {
    fetchMessages();

    // Subscribe to new messages
    const channel = supabase
      .channel('terminal_messages')
      .on('postgres_changes', 
        { event: 'INSERT', schema: 'public', table: 'terminal_messages' },
        (payload) => {
          const newMessage = payload.new as TerminalMessage;
          setMessages(current => [newMessage, ...current.slice(0, limit - 1)]);
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [fetchMessages]);

  return { messages, loading, hasMore };
} 