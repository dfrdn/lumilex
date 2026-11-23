import { getSupabase } from '@/lib/supabase';
import { demoAccessId } from '@/lib/demo/access';
import type { DemoAccessRequest } from '@/lib/demo/access';

/*
 * The IO half of lib/demo/access.ts. `demo_access_requests` is a global table
 * (no firm_id, service-role only), so it is read through the raw client — the
 * same reason as firms or ph_holidays, and listed with them in eslint.config.mjs.
 */

/** Whether this cookie value names a stored access request. */
export async function hasDemoAccess(cookie: string | undefined | null): Promise<boolean> {
  const id = demoAccessId(cookie);
  if (!id) return false;
  const { data } = await getSupabase().from('demo_access_requests').select('id').eq('id', id).maybeSingle();
  return !!data;
}

/** Stores a request and returns its id, the value of the access cookie. */
export async function recordDemoAccessRequest(
  request: Omit<DemoAccessRequest, 'website'>,
  source: string | null,
): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from('demo_access_requests')
    .insert({
      name: request.name,
      email: request.email,
      position: request.position,
      persona: request.as,
      source: source?.slice(0, 200) ?? null,
    })
    .select('id')
    .single();
  if (error || !data) {
    console.error('[demo-access] could not record the request:', error?.message);
    return null;
  }
  return data.id as string;
}
