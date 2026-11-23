import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

export interface SubjectTeamMember {
  personId: string;
  name: string;
  initials: string;
  avatarUrl: string | null;
  position: string;
}

/**
 * Who is responsible for a company or a mark: the team on the matters that
 * cover it, active members only, de-duplicated across matters. The firm-scoped
 * service client, because a viewer may see the subject without seeing every
 * colleague's row.
 */
export async function teamOnMatters(firmId: string, matterIds: string[]): Promise<SubjectTeamMember[]> {
  if (!matterIds.length) return [];
  const supabase = getServiceDbForFirm(firmId);
  const { data: matters } = await supabase.from('matters').select('team_person_ids').in('notion_id', matterIds);
  const ids = [...new Set((matters ?? []).flatMap((m) => (m.team_person_ids as string[] | null) ?? []))];
  if (!ids.length) return [];
  const { data: people } = await supabase
    .from('team')
    .select('person_id, name, initials, avatar_url, position')
    .in('person_id', ids)
    .eq('active', true);
  return (people ?? [])
    .map((p) => ({
      personId: p.person_id as string,
      name: (p.name as string) ?? '',
      initials: (p.initials as string) || '??',
      avatarUrl: (p.avatar_url as string | null) ?? null,
      position: (p.position as string) ?? '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The team on the matters that cover a mark. */
export async function getTrademarkTeam(firmId: string, trademarkId: string): Promise<SubjectTeamMember[]> {
  const { data: links } = await getServiceDbForFirm(firmId).from('matter_subjects').select('matter_id').eq('subject_id', trademarkId);
  return teamOnMatters(firmId, [...new Set((links ?? []).map((l) => l.matter_id as string))]);
}
