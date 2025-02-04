import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://vnhvfywxkjspkeztftjr.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZuaHZmeXd4a2pzcGtlenRmdGpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzg0MjA4MjAsImV4cCI6MjA1Mzk5NjgyMH0.vYLMijOLmbb4l61lCMuprs3dxxXdJ_LvPfm4QttiFWE';

export const supabase = createClient(supabaseUrl, supabaseKey); 