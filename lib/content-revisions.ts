import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

// Version history for editable firm content — the Library pages (the handbook,
// the clause positions, the playbooks), the fee schedules and the billing
// letter's wording. Each of those is policy someone wrote by hand, and a save
// that overwrites it silently loses a firm decision.
//
// The snapshot stored is the row as it was BEFORE the edit, so the first edit
// of a seeded page preserves the seeded text and there is always something to
// go back to. content_revisions has no policies: every read and write here
// goes through the firm-scoped service client, behind the handler's checks.

export type RevisionEntityType = 'kb_page' | 'fee_schedule' | 'billing_letter_block' | 'billing_paragraph' | 'trademark_report_wording';

/** Fields worth keeping per entity. Anything not listed is noise in a diff. */
const TRACKED_FIELDS: Record<RevisionEntityType, string[]> = {
  kb_page: ['title', 'summary', 'content_md', 'status', 'kind', 'jurisdiction', 'pinned', 'external_url', 'visible_to_roles'],
  fee_schedule: ['name', 'content', 'is_active', 'sort_order'],
  billing_letter_block: ['label', 'body', 'position', 'archived'],
  billing_paragraph: ['label', 'body', 'rule', 'choice', 'archived'],
  trademark_report_wording: ['body'],
};

function pick(row: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) if (f in row) out[f] = row[f];
  return out;
}

/** Which tracked fields the edit actually changes. Empty means nothing to record. */
export function changedFields(
  entityType: RevisionEntityType,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  return TRACKED_FIELDS[entityType].filter((f) => {
    if (!(f in after)) return false;
    // JSON-compare so a jsonb column doesn't register a change on identical content.
    return JSON.stringify(before[f] ?? null) !== JSON.stringify(after[f] ?? null);
  });
}

/**
 * Record the pre-edit state of a row. A failure to write history must never
 * block the edit itself, but it is logged loudly because silent loss of
 * history is the exact failure this exists to prevent.
 *
 * Returns the revision id, or null when nothing tracked changed.
 */
export async function recordRevision(input: {
  firmId: string;
  entityType: RevisionEntityType;
  entityId: string | number;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  editedBy: string | null;
}): Promise<number | null> {
  const fields = changedFields(input.entityType, input.before, input.after);
  if (fields.length === 0) return null;

  try {
    const { data, error } = await getServiceDbForFirm(input.firmId)
      .from('content_revisions')
      .insert({
        entity_type: input.entityType,
        entity_id: String(input.entityId),
        snapshot: pick(input.before, TRACKED_FIELDS[input.entityType]),
        changed_fields: fields,
        edited_by: input.editedBy,
      })
      .select('id')
      .single();
    if (error) {
      console.error('[content-revisions] insert failed:', error.message);
      return null;
    }
    return (data?.id as number) ?? null;
  } catch (err) {
    console.error('[content-revisions] insert threw:', err instanceof Error ? err.message : err);
    return null;
  }
}

export interface RevisionRow {
  id: number;
  entity_id: string;
  snapshot: Record<string, unknown>;
  changed_fields: string[];
  edited_by: string | null;
  editor_name?: string | null;
  created_at: string;
}

/** History for one entity, newest first, with editor names resolved. */
export async function listRevisions(
  firmId: string,
  entityType: RevisionEntityType,
  entityId: string | number,
  limit = 50,
): Promise<RevisionRow[]> {
  const db = getServiceDbForFirm(firmId);
  const { data } = await db
    .from('content_revisions')
    .select('id, entity_id, snapshot, changed_fields, edited_by, created_at')
    .eq('entity_type', entityType)
    .eq('entity_id', String(entityId))
    .order('created_at', { ascending: false })
    .limit(limit);

  const rows = (data ?? []) as RevisionRow[];
  const ids = [...new Set(rows.map((r) => r.edited_by).filter(Boolean))] as string[];
  if (ids.length) {
    const { data: team } = await db.from('team').select('person_id, name').in('person_id', ids);
    const names = new Map((team ?? []).map((t: { person_id: string; name: string }) => [t.person_id, t.name]));
    for (const r of rows) r.editor_name = r.edited_by ? names.get(r.edited_by) ?? null : null;
  }
  return rows;
}

/** One revision, for previewing or restoring. */
export async function getRevision(
  firmId: string,
  entityType: RevisionEntityType,
  revisionId: number,
): Promise<RevisionRow | null> {
  const { data } = await getServiceDbForFirm(firmId)
    .from('content_revisions')
    .select('id, entity_id, snapshot, changed_fields, edited_by, created_at')
    .eq('entity_type', entityType)
    .eq('id', revisionId)
    .maybeSingle();
  return (data as RevisionRow) ?? null;
}
