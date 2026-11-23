import { fetchAllRows } from '@/lib/supabase-paginate';
import { readClientProfile } from '@/lib/billing/client-profile';
import { loadClientChoices } from '@/lib/billing/wording-store';
import type { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import type { ClientBillingRow } from '@/components/finance/ClientBillingList';

type Client = Awaited<ReturnType<typeof getSupabaseServerAuthClient>>;

/** Every client with its billing profile, and the names of the client choices — the "By client" view of Billing Configs. */
export async function loadClientBillingRows(supabase: Client): Promise<{ rows: ClientBillingRow[]; paragraphLabels: Record<string, string> }> {
  const [clients, profiles, configured, choices] = await Promise.all([
    fetchAllRows<{ notion_id: string; name: string; status: string | null; contact_email: string | null }>((from, to) =>
      supabase.from('clients').select('notion_id, name, status, contact_email').order('name').range(from, to)),
    fetchAllRows<{ client_id: string; settings: unknown; updated_at: string }>((from, to) =>
      supabase.from('client_billing_profiles').select('client_id, settings, updated_at').range(from, to)),
    fetchAllRows<{ matter_id: string; matters: unknown }>((from, to) =>
      supabase.from('matter_billing_configs').select('matter_id, matters!inner(client_id)').range(from, to)),
    loadClientChoices(supabase),
  ]);

  const profileBy = new Map(profiles.map((p) => [p.client_id, p]));
  // The embedded matter arrives as an object or a one-element array.
  const clientOf = (m: unknown) => ((Array.isArray(m) ? m[0] : m) as { client_id?: string | null } | null)?.client_id ?? null;
  const billed = new Set(configured.map((c) => clientOf(c.matters)).filter((v): v is string => !!v));
  return {
    rows: clients.map((c) => ({
      id: c.notion_id,
      name: c.name,
      status: c.status,
      contactEmail: c.contact_email,
      billed: billed.has(c.notion_id) || profileBy.has(c.notion_id),
      profile: readClientProfile(profileBy.get(c.notion_id)?.settings),
      updatedAt: profileBy.get(c.notion_id)?.updated_at ?? null,
    })),
    paragraphLabels: Object.fromEntries(choices.map((c) => [c.key, c.label])),
  };
}
