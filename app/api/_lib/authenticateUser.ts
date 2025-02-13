import { headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

export async function authenticateUser(request: Request) {
  const headersList = await headers();
  const token = headersList.get('authorization')?.split(' ')[1];

  if (!token) {
    throw new Error('No authorization token provided');
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    throw new Error('Invalid token');
  }

  return user;
}