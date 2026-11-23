import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies, headers } from 'next/headers';

/**
 * Return a user-scoped Supabase client suitable for RLS-protected queries.
 *
 * Two paths:
 *   - `Authorization: Bearer <access_token>` present (mobile / Expo dev
 *     client): build a plain supabase-js client that pins the user's JWT
 *     onto every REST request. PostgREST reads it from the Authorization
 *     header and evaluates RLS against `auth.uid()` derived from that JWT.
 *   - Otherwise (browser): use the SSR cookie-backed client, which lets
 *     `@supabase/ssr` refresh expired sessions and write the new cookies
 *     back through Next's response.
 *
 * Either way, downstream `.from('...')` calls run AS the signed-in user
 * with RLS active. Pair with `getSupabase()` (service role) only for the
 * narrow set of operations that legitimately need to bypass RLS — see
 * CLAUDE.md → RLS migration playbook.
 */
export async function getSupabaseServerAuthClient() {
  const hdrs = await headers();
  const authHeader = hdrs.get('authorization');
  if (authHeader && /^Bearer\s+/i.test(authHeader)) {
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
  }

  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // No-op inside Server Components — middleware refreshes the cookie instead.
          }
        },
      },
    },
  );
}
