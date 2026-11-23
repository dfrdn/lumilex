import type { SupabaseClient } from '@supabase/supabase-js';
import type { MarkScope } from '@/lib/trademarks/matter-links';

type Db = Pick<SupabaseClient, 'from'>;

/**
 * The roles in which a matter is an engagement for the mark itself — its
 * filing, its DAUs and renewal, an opposition — not a retainer or an
 * incorporation that also covers it.
 *
 * Which matters those are is the firm's own record: the team links a mark to
 * a matter in one of these roles under "Covered by". Nothing here reads a
 * matter type or its code, which differ from firm to firm.
 */
const MARK_ENGAGEMENT_SCOPES: MarkScope[] = ['trademark', 'trademark_maintenance', 'opposition'];

/**
 * Of these matters, the trademark matters: those engaged for a mark. A
 * retainer or an incorporation that also covers a mark is not one — its other
 * work isn't the mark's.
 */
export async function trademarkMatterIds(supabase: Db, matterIds: string[]): Promise<Set<string>> {
  if (matterIds.length === 0) return new Set();
  const { data: links } = await supabase
    .from('matter_subjects').select('matter_id').in('matter_id', matterIds).in('scope', MARK_ENGAGEMENT_SCOPES);
  return new Set((links ?? []).map((l) => l.matter_id as string));
}

/** The trademark matters engaged for this mark — not ones that hold it on retainer, nor another mark's. */
export async function markTrademarkMatterIds(supabase: Db, markId: string): Promise<Set<string>> {
  const { data: links } = await supabase
    .from('matter_subjects').select('matter_id').eq('subject_id', markId).in('scope', MARK_ENGAGEMENT_SCOPES);
  return new Set((links ?? []).map((l) => l.matter_id as string));
}
