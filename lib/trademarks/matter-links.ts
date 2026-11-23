import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Which matters cover a mark, and in what role — read from matter_subjects,
 * like a company's. One mark can be covered by its filing matter, a later
 * DAU/renewal matter, an opposition, and a retainer at once.
 */
export const MARK_SCOPES = ['trademark', 'trademark_maintenance', 'opposition', 'retainer'] as const;
export type MarkScope = (typeof MARK_SCOPES)[number];

export const MARK_SCOPE_LABEL: Record<MarkScope, string> = {
  trademark: 'Filing',
  trademark_maintenance: 'DAU & renewal',
  opposition: 'Opposition / cancellation',
  retainer: 'Retainer',
};

export interface MarkMatterLink {
  scope: MarkScope;
  matterId: string;
  matterName: string;
  matterCode: string | null;
}

export async function markMatterLinks(supabase: Pick<SupabaseClient, 'from'>, markId: string): Promise<MarkMatterLink[]> {
  const { data: links } = await supabase.from('matter_subjects').select('matter_id, scope').eq('subject_id', markId);
  const ids = (links ?? []).map((l) => l.matter_id as string);
  const { data: matters } = ids.length
    ? await supabase.from('matters').select('notion_id, name, matter_code').in('notion_id', ids)
    : { data: [] };
  const byId = new Map((matters ?? []).map((m) => [m.notion_id as string, m]));
  return (links ?? [])
    .filter((l) => (MARK_SCOPES as readonly string[]).includes(l.scope as string))
    .map((l) => ({
      scope: l.scope as MarkScope,
      matterId: l.matter_id as string,
      matterName: ((byId.get(l.matter_id as string)?.name as string | null) ?? '') || (l.matter_id as string),
      matterCode: (byId.get(l.matter_id as string)?.matter_code as string | null) ?? null,
    }))
    .sort((a, b) => MARK_SCOPES.indexOf(a.scope) - MARK_SCOPES.indexOf(b.scope));
}
