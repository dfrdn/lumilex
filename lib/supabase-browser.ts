import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { clearPersistedSWRCache } from '@/lib/swr';

let _client: SupabaseClient | null = null;

export function getSupabaseBrowserAuthClient(): SupabaseClient {
  if (!_client) {
    _client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    );
  }
  return _client;
}

export async function signOut(redirectTo: string = '/login') {
  const supabase = getSupabaseBrowserAuthClient();
  clearPersistedSWRCache();
  await supabase.auth.signOut();
  window.location.href = redirectTo;
}
