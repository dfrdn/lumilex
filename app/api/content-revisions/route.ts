import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { validateBody } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { canEditFeeSchedules } from '@/lib/fee-schedule/access';
import { sanitizeHandbookHtml } from '@/lib/sanitize-html';
import { canRestoreKind } from '@/lib/library/model';
import { reembedLibraryPage } from '@/lib/library/embed';
import { isOutOfScope } from '@/lib/library/scope';
import {
  listRevisions, getRevision, recordRevision, type RevisionEntityType,
} from '@/lib/content-revisions';
import { STANDARD_BLOCKS, wordingProblem } from '@/lib/billing/letter-blocks';
import { EMAIL_BLOCKS } from '@/lib/billing/email-blocks';
import { REPORT_WORDING_EDIT_ROLES, WORDING_BLOCKS, wordingProblem as reportWordingProblem } from '@/lib/trademarks/report-wording';

const ENTITY_TYPES = ['kb_page', 'fee_schedule', 'billing_letter_block', 'billing_paragraph', 'trademark_report_wording'] as const satisfies readonly RevisionEntityType[];

/**
 * Where each entity type restores into. The key column is not always `id`:
 * fee_schedules is upserted by slug and its id is a uuid, so the revision's
 * entity_id is the slug and a numeric-id assumption breaks the restore.
 */
const TARGET: Record<RevisionEntityType, { table: string; keyColumn: string; numericKey: boolean }> = {
  kb_page: { table: 'kb_pages', keyColumn: 'id', numericKey: true },
  fee_schedule: { table: 'fee_schedules', keyColumn: 'slug', numericKey: false },
  billing_letter_block: { table: 'billing_letter_blocks', keyColumn: 'key', numericKey: false },
  // Keyed by document and key together; the revision's entity_id is "document:key".
  billing_paragraph: { table: 'billing_paragraphs', keyColumn: 'key', numericKey: false },
  trademark_report_wording: { table: 'trademark_report_wording', keyColumn: 'key', numericKey: false },
};

/**
 * Wording kept against built-in defaults: a block or paragraph left at its
 * default has no row, so who may read and restore its history is a role
 * question rather than a row the caller can see.
 */
const WORDING_TYPES = new Set<RevisionEntityType>(['billing_letter_block', 'billing_paragraph', 'trademark_report_wording']);
/** The billing letter's wording is read by finance and the partners, and edited by finance. */
const BILLING_READERS = new Set(['finance', 'admin', 'super_user', 'partner']);
const BILLING_EDITORS = new Set(['finance', 'admin', 'super_user']);
/** The trademark reports' wording is the team's to read and the lawyers' to edit. */
const REPORT_WORDING_EDITORS = new Set(REPORT_WORDING_EDIT_ROLES);

function mayReadWording(role: string | undefined, entityType: RevisionEntityType): boolean {
  return entityType === 'trademark_report_wording' ? true : BILLING_READERS.has(role ?? '');
}

function keyOf(entityType: RevisionEntityType, entityId: string): string | number | null {
  if (!TARGET[entityType].numericKey) return entityId;
  const n = Number(entityId);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The row as the caller's own RLS sees it. History is shown to the people who
 * can read the thing it is the history of — a page limited to partners keeps
 * its past versions limited to partners too — so a row the caller cannot read
 * answers 404, exactly like the page itself.
 */
async function readableRow(
  firmId: string,
  entityType: RevisionEntityType,
  key: string | number,
): Promise<Record<string, unknown> | null> {
  const { table, keyColumn } = TARGET[entityType];
  const authed = await getSupabaseServerAuthClient();
  const [document, paragraphKey] = entityType === 'billing_paragraph' ? String(key).split(':') : [null, null];
  const { data } = entityType === 'billing_paragraph'
    ? await authed.from(table).select('*').eq('document', document).eq('key', paragraphKey).maybeSingle()
    : await authed.from(table).select('*').eq(keyColumn, key).maybeSingle();
  if (!data) return null;
  if (entityType === 'kb_page' && (await isOutOfScope(firmId, String(data.kind)))) return null;
  return data as Record<string, unknown>;
}

function mayRestore(role: string | undefined, entityType: RevisionEntityType, row: Record<string, unknown> | null): boolean {
  if (entityType === 'trademark_report_wording') return REPORT_WORDING_EDITORS.has(role ?? '');
  if (WORDING_TYPES.has(entityType)) return BILLING_EDITORS.has(role ?? '');
  return entityType === 'kb_page' ? canRestoreKind(role, String(row?.kind ?? '')) : canEditFeeSchedules(role);
}

// ── GET: history for one entity ──────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const entityType = ENTITY_TYPES.find((t) => t === sp.get('entityType'));
  const entityId = sp.get('entityId')?.trim();
  if (!entityType || !entityId) {
    return NextResponse.json({ error: 'entityType and entityId are required' }, { status: 400 });
  }
  const key = keyOf(entityType, entityId);
  if (key == null) return NextResponse.json({ error: 'Invalid entityId' }, { status: 400 });

  // A billing paragraph left at its default has no row yet, so its history is
  // gated on who may read the billing wording rather than on the row.
  const wording = WORDING_TYPES.has(entityType);
  const row = wording ? null : await readableRow(session.firmId, entityType, key);
  if (wording ? !mayReadWording(session.user.role, entityType) : !row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const revisions = await listRevisions(session.firmId, entityType, entityId);
  return NextResponse.json({ revisions, canRestore: mayRestore(session.user.role, entityType, row) });
}

const restoreSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  revisionId: z.number().int().positive(),
});

// ── POST: restore a revision ─────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const validation = await validateBody(req, restoreSchema);
  if (!validation.success) return validation.response;
  const { entityType, revisionId } = validation.data;

  const revision = await getRevision(session.firmId, entityType, revisionId);
  if (!revision) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const key = keyOf(entityType, revision.entity_id);
  if (key == null) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const wording = WORDING_TYPES.has(entityType);
  if (wording && !mayRestore(session.user.role, entityType, null)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { table, keyColumn } = TARGET[entityType];
  const db = getServiceDbForFirm(session.firmId);
  let current = await readableRow(session.firmId, entityType, key);
  if (entityType === 'trademark_report_wording') {
    const problem = reportWordingProblem(String(revision.snapshot.body ?? ''));
    if (problem) return NextResponse.json({ error: `That version can't be restored: ${problem}` }, { status: 400 });
    // A block put back to its default has no row; restoring an edit recreates it.
    const def = WORDING_BLOCKS.find((b) => b.key === key);
    if (!current && def) {
      current = { key, body: def.body };
      const { error: insertError } = await db.from(table).insert({ ...current, updated_by: session.user.notionUserId });
      if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
  } else if (wording) {
    const problem = wordingProblem(String(revision.snapshot.body ?? '').replace(/\{\{\s*\w+\s*\}\}/g, ''));
    if (problem) return NextResponse.json({ error: `That version can't be restored: ${problem}` }, { status: 400 });
    // A standard line put back to its default has no row; restoring an edit
    // recreates it.
    const def = entityType === 'billing_letter_block'
      ? STANDARD_BLOCKS.find((b) => b.key === key) ?? EMAIL_BLOCKS.find((b) => b.key === key)
      : undefined;
    if (!current && def) {
      current = { key, kind: 'standard', label: null, body: def.body, position: null, archived: false };
      const { error: insertError } = await db.from(table).insert({ ...current, updated_by: session.user.notionUserId });
      if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
  }
  if (!current) return NextResponse.json({ error: 'The page no longer exists' }, { status: 404 });
  if (!mayRestore(session.user.role, entityType, current)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const patch: Record<string, unknown> = { ...revision.snapshot, updated_at: new Date().toISOString() };
  if (entityType === 'kb_page' && ('content_md' in revision.snapshot || 'title' in revision.snapshot)) {
    patch.version = Number(current.version ?? 1) + 1;
  }
  // A snapshot can predate sanitizing on write; it goes back in clean.
  if (entityType === 'kb_page' && current.content_format === 'html' && typeof patch.content_md === 'string') {
    patch.content_md = sanitizeHandbookHtml(patch.content_md);
  }

  // The authorization decision is made; the write goes through the firm-scoped
  // service client, as fee schedules are always written (their policy is
  // narrower than the roles that may edit them in the app).
  const [document, paragraphKey] = entityType === 'billing_paragraph' ? String(key).split(':') : [null, null];
  const { error } = entityType === 'billing_paragraph'
    ? await db.from(table).update(patch).eq('document', document).eq('key', paragraphKey)
    : await db.from(table).update(patch).eq(keyColumn, key);
  if (error) {
    console.error('[content-revisions] restore failed:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Restoring is itself an edit: snapshot what was replaced, so a restore to
  // the wrong revision is as recoverable as the edit that prompted it.
  await recordRevision({
    firmId: session.firmId,
    entityType,
    entityId: revision.entity_id,
    before: current,
    after: patch,
    editedBy: session.user.notionUserId,
  });

  // A restored page's content changed, so its embeddings are stale and search
  // would keep serving the text that was just replaced.
  if (entityType === 'kb_page' && 'content_md' in revision.snapshot) {
    await reembedLibraryPage(session.firmId, Number(key)).catch((e) =>
      console.error('[content-revisions] re-embed failed:', e instanceof Error ? e.message : e),
    );
  }

  logAudit({
    firmId: session.firmId,
    entityType: entityType === 'kb_page' ? 'LibraryPage' : entityType === 'fee_schedule' ? 'FeeSchedule'
      : entityType === 'trademark_report_wording' ? 'TrademarkReportWording' : 'BillingLetterParagraph',
    entityId: revision.entity_id,
    action: 'restored',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ restored: true, entityId: revision.entity_id });
}
