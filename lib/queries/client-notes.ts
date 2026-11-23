import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

export interface ClientPartnerNote {
  id: number;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Shared partner notes for a client, newest first. Author display names are
 * resolved via a service-role team lookup (names aren't sensitive); the notes
 * themselves are partner-only via RLS on the write/read API paths.
 */
export async function getClientNotes(firmId: string, clientId: string): Promise<ClientPartnerNote[]> {
  const supabase = getServiceDbForFirm(firmId);

  const { data, error } = await supabase
    .from('client_partner_notes')
    .select('id, body, author_id, created_at, updated_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  if (!data || data.length === 0) return [];

  const authorIds = [...new Set(data.map((n) => n.author_id))];
  const { data: team } = await supabase
    .from('team')
    .select('person_id, name')
    .in('person_id', authorIds);
  const nameMap = new Map<string, string>();
  for (const t of team ?? []) nameMap.set(t.person_id, t.name ?? 'Unknown');

  return data.map((n) => ({
    id: n.id,
    body: n.body,
    authorId: n.author_id,
    authorName: nameMap.get(n.author_id) ?? 'Unknown',
    createdAt: n.created_at,
    updatedAt: n.updated_at,
  }));
}
