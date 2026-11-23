import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { validateBody, billingLetterLineSchema } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { recordRevision } from '@/lib/content-revisions';
import { findFirmInvoiceSettings, findSignerAtty } from '@/lib/billing/firm-defaults';
import { billingLetterSigner } from '@/lib/billing/signer';
import { LETTER_PLACEHOLDERS, STANDARD_BLOCKS, wordingProblem } from '@/lib/billing/letter-blocks';
import { EMAIL_BLOCKS } from '@/lib/billing/email-blocks';
import { FACTS, readParagraphs } from '@/lib/billing/paragraphs';
import { defaultParagraphsFor } from '@/lib/billing/wording-store';

const READ_ROLES = ['finance', 'admin', 'super_user', 'partner'];
const EDIT_ROLES = ['finance', 'admin', 'super_user'];

/** A fixed line of the letter or the email, by key. */
function lineDef(key: string) {
  return STANDARD_BLOCKS.find((b) => b.key === key) ?? EMAIL_BLOCKS.find((b) => b.key === key) ?? null;
}

type Client = Awaited<ReturnType<typeof getSupabaseServerAuthClient>>;

/** Who signs the letter, and how. */
async function letterSignerSummary(supabase: Client, firmId: string) {
  const [firm, atty, { data: team }] = await Promise.all([
    findFirmInvoiceSettings(firmId),
    findSignerAtty(firmId),
    supabase.from('team').select('name, position, active'),
  ]);
  const signer = billingLetterSigner(team ?? [], firm?.signerName);
  return {
    name: signer?.name ?? '',
    position: signer?.position ?? '',
    atty,
  };
}

/**
 * GET /api/finance/letter-template — everything the Billing Letter page edits:
 * the fixed lines of the letter and the email, both paragraph lists, the facts
 * a paragraph's rule can test, the fields, the client choices, and the signer.
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!READ_ROLES.includes(session.user.role ?? '')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = await getSupabaseServerAuthClient();
  const [lineRows, paragraphRows] = await Promise.all([
    supabase.from('billing_letter_blocks').select('key, kind, body, updated_at, updated_by'),
    supabase.from('billing_paragraphs').select('key, document, label, body, rule, choice, system, sort_order, archived, updated_at, updated_by'),
  ]);
  if (lineRows.error) return NextResponse.json({ error: lineRows.error.message }, { status: 500 });
  if (paragraphRows.error) return NextResponse.json({ error: paragraphRows.error.message }, { status: 500 });

  const editorIds = [...new Set([...(lineRows.data ?? []), ...(paragraphRows.data ?? [])].map((r) => r.updated_by).filter((v): v is string => !!v))];
  const names = new Map<string, string>();
  if (editorIds.length > 0) {
    const { data: team } = await supabase.from('team').select('person_id, name').in('person_id', editorIds);
    for (const t of team ?? []) if (t.person_id && t.name) names.set(t.person_id, t.name);
  }
  const savedLines = new Map((lineRows.data ?? []).filter((r) => r.kind === 'standard').map((r) => [r.key, r]));
  const line = (def: { key: string; label: string; when: string; body: string }, document: 'letter' | 'email') => {
    const row = savedLines.get(def.key);
    return {
      document,
      key: def.key,
      label: def.label,
      when: def.when,
      body: row?.body ?? def.body,
      defaultBody: def.body,
      updatedAt: row?.updated_at ?? null,
      updatedBy: row?.updated_by ? names.get(row.updated_by) ?? null : null,
    };
  };
  const meta = new Map((paragraphRows.data ?? []).map((r) => [`${r.document}:${r.key}`, r]));
  // A document the firm has never edited is still its defaults.
  const saved = (document: 'letter' | 'email') =>
    (paragraphRows.data ?? []).some((r) => r.document === document)
      ? readParagraphs(paragraphRows.data ?? [], document)
      : defaultParagraphsFor(document);
  const paragraphs = (document: 'letter' | 'email') =>
    saved(document).map((p) => {
      const row = meta.get(`${document}:${p.key}`);
      return { ...p, updatedAt: row?.updated_at ?? null, updatedBy: row?.updated_by ? names.get(row.updated_by) ?? null : null };
    });

  // A choice is named by the paragraph that introduced it, letter first.
  const choices = new Map<string, string>();
  for (const p of [...paragraphs('letter'), ...paragraphs('email')]) if (p.choice && !choices.has(p.choice)) choices.set(p.choice, p.label);

  return NextResponse.json({
    lines: [...STANDARD_BLOCKS.map((d) => line(d, 'letter')), ...EMAIL_BLOCKS.map((d) => line(d, 'email'))],
    paragraphs: { letter: paragraphs('letter'), email: paragraphs('email') },
    facts: FACTS,
    choices: [...choices].map(([key, label]) => ({ key, label })),
    placeholders: LETTER_PLACEHOLDERS,
    signer: await letterSignerSummary(supabase, session.firmId),
    canEdit: EDIT_ROLES.includes(session.user.role ?? ''),
  });
}

/**
 * PUT /api/finance/letter-template — save one fixed line (the subject, the
 * transmittal line, a closing line, a phrase). The text it replaces is kept
 * as a revision ('billing_letter_block').
 */
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!EDIT_ROLES.includes(session.user.role ?? '')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const validation = await validateBody(req, billingLetterLineSchema);
  if (!validation.success) return validation.response;
  const { key, body } = validation.data;
  const def = lineDef(key);
  if (!def) return NextResponse.json({ error: 'Unknown line' }, { status: 400 });
  const problem = wordingProblem(body);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();
  const { data: current } = await supabase.from('billing_letter_blocks').select('*').eq('key', key).maybeSingle();
  const row = { firm_id: session.firmId, key, kind: 'standard', label: null, body, position: null, archived: false, updated_at: new Date().toISOString(), updated_by: session.user.notionUserId };
  await recordRevision({
    firmId: session.firmId,
    entityType: 'billing_letter_block',
    entityId: key,
    before: current ?? { key, label: def.label, body: def.body, position: null, archived: false },
    after: row,
    editedBy: session.user.notionUserId,
  });
  const { error } = await supabase.from('billing_letter_blocks').upsert(row, { onConflict: 'firm_id,key' });
  if (error) return NextResponse.json({ error: 'Failed to save the line' }, { status: 500 });

  logAudit({ firmId: session.firmId, entityType: 'BillingLetterLine', entityId: key, action: 'updated', performedBy: session.user.notionUserId, ipAddress: getClientIP(req) });
  return NextResponse.json({ key });
}

/** DELETE /api/finance/letter-template — put a fixed line back to its built-in wording. */
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!EDIT_ROLES.includes(session.user.role ?? '')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { key } = (await req.json().catch(() => ({}))) as { key?: string };
  const def = key ? lineDef(key) : null;
  if (!key || !def) return NextResponse.json({ error: 'Unknown line' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();
  const { data: current } = await supabase.from('billing_letter_blocks').select('*').eq('key', key).maybeSingle();
  if (!current) return NextResponse.json({ restored: true });
  await recordRevision({
    firmId: session.firmId,
    entityType: 'billing_letter_block',
    entityId: key,
    before: current,
    after: { label: null, body: def.body, position: null, archived: false },
    editedBy: session.user.notionUserId,
  });
  const { error } = await supabase.from('billing_letter_blocks').delete().eq('key', key);
  if (error) return NextResponse.json({ error: 'Failed to restore the default wording' }, { status: 500 });
  logAudit({ firmId: session.firmId, entityType: 'BillingLetterLine', entityId: key, action: 'restored_default', performedBy: session.user.notionUserId, ipAddress: getClientIP(req) });
  return NextResponse.json({ restored: true, body: def.body });
}

/**
 * PATCH /api/finance/letter-template — the letter-wide setting: whether "Atty."
 * is written before the signatory. Kept with the firm's other invoice settings.
 */
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!EDIT_ROLES.includes(session.user.role ?? '')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { signerAtty } = (await req.json().catch(() => ({}))) as { signerAtty?: unknown };
  const patch: Record<string, boolean> = {};
  if (typeof signerAtty === 'boolean') patch.signer_atty = signerAtty;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('firm_invoice_settings')
    .update({ ...patch, updated_by: session.user.email ?? session.user.notionUserId, updated_at: new Date().toISOString() })
    .eq('firm_id', session.firmId)
    .select('firm_id');
  if (error || !data?.length) {
    console.error('[letter-template] signer setting failed:', error?.message ?? 'no settings row');
    return NextResponse.json({ error: 'Failed to save the signature setting' }, { status: 500 });
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'FirmInvoiceSettings',
    entityId: session.firmId,
    action: Object.entries(patch).map(([k, v]) => `${k}_${v ? 'on' : 'off'}`).join(','),
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true });
}
