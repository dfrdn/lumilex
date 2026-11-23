import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Which matters cover a company, read from `matter_subjects` (a company is a
 * subject; its matters are engagements that cover it in a role). Before the
 * subjects model these were four columns on `corporations`; one retainer can
 * now cover several companies without a column per company.
 */

export const CORPORATE_SCOPES = ['incorporation', 'post_incorporation', 'housekeeping', 'retainer'] as const;
export type CorporateScope = (typeof CORPORATE_SCOPES)[number];

export type CorporateMatterLinks = Record<CorporateScope, string | null>;

/**
 * Select a corporation row with its matter links embedded. Every query that
 * feeds `rowToCorporation` uses this — a row read with plain `*` has no links,
 * and `rowToCorporation` refuses it rather than report a company with no
 * matters (lib/corporations/matter-links.test.ts holds the codebase to it).
 */
export const CORPORATION_SELECT = '*, subject:subjects!corporations_subject_fkey(matter_subjects(matter_id, scope))';

export class MissingMatterLinksError extends Error {
  constructor(id: unknown) {
    super(`Corporation ${String(id)} was read without its matter links — select CORPORATION_SELECT`);
  }
}

/** The links embedded by CORPORATION_SELECT, by scope. */
export function linksFromRow(row: Record<string, unknown>): CorporateMatterLinks {
  if (!('subject' in row)) throw new MissingMatterLinksError(row.id);
  const subject = row.subject as { matter_subjects?: { matter_id: string; scope: string }[] } | null;
  const links: CorporateMatterLinks = { incorporation: null, post_incorporation: null, housekeeping: null, retainer: null };
  for (const l of subject?.matter_subjects ?? []) {
    if ((CORPORATE_SCOPES as readonly string[]).includes(l.scope)) links[l.scope as CorporateScope] = l.matter_id;
  }
  return links;
}

/**
 * Point a subject's `scope` at `matterId`, or clear it with null. One matter
 * per scope per subject — setting replaces. (Marks use their own scopes:
 * lib/trademarks/matter-links.ts.) Goes through set_matter_link: a case may
 * have several matters on its 'case' scope, so the one-per-scope rule is a
 * partial index, which PostgREST's upsert can't target.
 */
export async function setMatterLink(
  supabase: Pick<SupabaseClient, 'rpc'>,
  firmId: string,
  subjectId: string,
  scope: string,
  matterId: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('set_matter_link', { p_firm_id: firmId, p_subject_id: subjectId, p_scope: scope, p_matter_id: matterId });
  if (error) throw new Error(`Linking ${scope} matter failed: ${error.message}`);
}

/** Companies a matter covers, any scope — for "which company is this matter's?". */
export async function subjectsOnMatter(supabase: Pick<SupabaseClient, 'from'>, matterId: string): Promise<{ subjectId: string; scope: string }[]> {
  const { data } = await supabase.from('matter_subjects').select('subject_id, scope').eq('matter_id', matterId);
  return (data ?? []).map((r) => ({ subjectId: r.subject_id as string, scope: r.scope as string }));
}
