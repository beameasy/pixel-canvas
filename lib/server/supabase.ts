import { createClient } from '@supabase/supabase-js';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    }
  }
);

// Add this function to determine table names based on environment
export const getTableName = (baseTableName: string): string => {
  const isDev = process.env.NODE_ENV === 'development';
  const prefix = isDev ? 'dev_' : '';
  return `${prefix}${baseTableName}`;
}; 