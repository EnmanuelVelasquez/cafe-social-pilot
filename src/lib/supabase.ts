import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env['VITE_SUPABASE_URL'];
const supabaseKey =
  import.meta.env['VITE_SUPABASE_PUBLISHABLE_KEY'] ||
  import.meta.env['VITE_SUPABASE_ANON_KEY'];

/** null when the connection settings are missing — callers fall back to sample data instead of crashing. */
export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
