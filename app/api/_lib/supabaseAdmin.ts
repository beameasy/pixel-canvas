import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

// Add utility function for getting the correct table name
export const getTableName = (baseTableName: string): string => {
  const isDev = process.env.NODE_ENV === 'development';
  const prefix = isDev ? 'dev_' : '';
  return `${prefix}${baseTableName}`;
};

export const getAdminClient = () => {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}; 