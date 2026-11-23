import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import {
  validateBody, billingParagraphCreateSchema, billingParagraphUpdateSchema, billingParagraphOrderSchema,
} from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { recordRevision } from '@/lib/content-revisions';
import { wordingProblem } from '@/lib/billing/letter-blocks';
import { FACTS, paragraphKey, readRule } from '@/lib/billing/paragraphs';
import { ensureParagraphs } from '@/lib/billing/wording-store';

const EDIT_ROLES = ['finance', 'admin', 'super_user'];
const FACT_KEYS = new Set<string>(FACTS.map((f) => f.key));

/**
 * The billing letter's and email's paragraph lists (lib/billing/paragraphs.ts).
 *
 *   POST   add a paragraph        { document, label, body, rule, choice?, after? }
 *   PATCH  change one             { document, key, label?, body?, rule?, choice? }
 *   PUT    reorder a document     { document, keys }
 *   DELETE delete one             { document, key }  — archived, so its history stays
 *
 * Every change keeps what it replaced in content_revisions ('billing_paragraph',
 * entity id "document:key"). The two app-worded paragraphs can be moved but not
 * reworded or deleted.
 */

async function guard() {
  const session = await getSession();
  if (!session?.user?.notionUserId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;
  if (!EDIT_ROLES.includes(session.user.role ?? '')) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const;
  return { session } as const;
}

/** What is wrong with a paragraph's wording; an email's is HTML, read for its text. */
function bodyProblem(document: 'letter' | 'email', body: string): string | null {
  return wordingProblem(document === 'email' ? body.replace(/<[^>]+>/g, ' ') : body);
}

/** Sent as `choice` for a new paragraph that is ticked per client on its own. */
const OWN_CHOICE = '__own';

function ruleProblem(rule: { fact: string }[]): string | null {
  const unknown = rule.filter((t) => !FACT_KEYS.has(t.fact)).map((t) => t.fact);
  return unknown.length ? `Unknown condition: ${unknown.join(', ')}.` : null;
}

export async function POST(req: NextRequest) {
  const g = await guard();
  if ('error' in g) return g.error;
  const validation = await validateBody(req, billingParagraphCreateSchema);
  if (!validation.success) return validation.response;
  const input = validation.data;
  const problem = bodyProblem(input.document, input.body) ?? ruleProblem(input.rule);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();
  await ensureParagraphs(supabase, g.session.firmId, input.document, g.session.user.notionUserId);
  const { data: rows } = await supabase.from('billing_paragraphs').select('key, sort_order, archived').eq('document', input.document);
  const list = (rows ?? []).sort((a, b) => a.sort_order - b.sort_order);
  const key = paragraphKey(input.label, new Set(list.map((r) => r.key)));

  // Placed after the given paragraph by renumbering the list in tens.
  const live = list.filter((r) => !r.archived).map((r) => r.key);
  const at = input.after ? live.indexOf(input.after) + 1 : live.length;
  const order = [...live.slice(0, at || live.length), key, ...live.slice(at || live.length)];

  const now = new Date().toISOString();
  const { error } = await supabase.from('billing_paragraphs').insert({
    firm_id: g.session.firmId,
    document: input.document,
    key,
    label: input.label,
    body: input.body,
    rule: readRule(input.rule),
    // A paragraph can introduce its own client choice, named by its key.
    choice: input.choice === OWN_CHOICE ? key : input.choice || null,
    sort_order: (order.indexOf(key) + 1) * 10,
    updated_at: now,
    updated_by: g.session.user.notionUserId,
  });
  if (error) return NextResponse.json({ error: 'Failed to add the paragraph' }, { status: 500 });
  await renumber(supabase, input.document, order);

  logAudit({ firmId: g.session.firmId, entityType: 'BillingParagraph', entityId: `${input.document}:${key}`, action: 'created', performedBy: g.session.user.notionUserId, ipAddress: getClientIP(req) });
  return NextResponse.json({ key });
}

export async function PATCH(req: NextRequest) {
  const g = await guard();
  if ('error' in g) return g.error;
  const validation = await validateBody(req, billingParagraphUpdateSchema);
  if (!validation.success) return validation.response;
  const input = validation.data;

  const supabase = await getSupabaseServerAuthClient();
  await ensureParagraphs(supabase, g.session.firmId, input.document, g.session.user.notionUserId);
  const { data: current } = await supabase.from('billing_paragraphs').select('*').eq('document', input.document).eq('key', input.key).maybeSingle();
  if (!current || current.archived) return NextResponse.json({ error: 'Paragraph not found' }, { status: 404 });
  if (current.system && (input.body !== undefined || input.rule !== undefined || input.choice !== undefined)) {
    return NextResponse.json({ error: 'This paragraph is worded by the app; it can be moved, not edited.' }, { status: 400 });
  }
  const problem = (input.body !== undefined ? bodyProblem(input.document, input.body) : null) ?? (input.rule ? ruleProblem(input.rule) : null);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: g.session.user.notionUserId };
  if (input.label !== undefined) patch.label = input.label;
  if (input.body !== undefined) patch.body = input.body;
  if (input.rule !== undefined) patch.rule = readRule(input.rule);
  if (input.choice !== undefined) patch.choice = input.choice || null;

  await recordRevision({ firmId: g.session.firmId, entityType: 'billing_paragraph', entityId: `${input.document}:${input.key}`, before: current, after: patch, editedBy: g.session.user.notionUserId });
  const { error } = await supabase.from('billing_paragraphs').update(patch).eq('document', input.document).eq('key', input.key);
  if (error) return NextResponse.json({ error: 'Failed to save the paragraph' }, { status: 500 });

  logAudit({ firmId: g.session.firmId, entityType: 'BillingParagraph', entityId: `${input.document}:${input.key}`, action: 'updated', performedBy: g.session.user.notionUserId, ipAddress: getClientIP(req) });
  return NextResponse.json({ key: input.key });
}

export async function PUT(req: NextRequest) {
  const g = await guard();
  if ('error' in g) return g.error;
  const validation = await validateBody(req, billingParagraphOrderSchema);
  if (!validation.success) return validation.response;
  const supabase = await getSupabaseServerAuthClient();
  await ensureParagraphs(supabase, g.session.firmId, validation.data.document, g.session.user.notionUserId);
  await renumber(supabase, validation.data.document, validation.data.keys);
  logAudit({ firmId: g.session.firmId, entityType: 'BillingParagraph', entityId: validation.data.document, action: 'reordered', performedBy: g.session.user.notionUserId, ipAddress: getClientIP(req) });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const g = await guard();
  if ('error' in g) return g.error;
  const { document, key } = (await req.json().catch(() => ({}))) as { document?: string; key?: string };
  if ((document !== 'letter' && document !== 'email') || !key) return NextResponse.json({ error: 'document and key are required' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();
  await ensureParagraphs(supabase, g.session.firmId, document, g.session.user.notionUserId);
  const { data: current } = await supabase.from('billing_paragraphs').select('*').eq('document', document).eq('key', key).maybeSingle();
  if (!current || current.archived) return NextResponse.json({ error: 'Paragraph not found' }, { status: 404 });
  if (current.system) return NextResponse.json({ error: 'This paragraph is worded by the app and stays in the letter.' }, { status: 400 });

  await recordRevision({ firmId: g.session.firmId, entityType: 'billing_paragraph', entityId: `${document}:${key}`, before: current, after: { archived: true }, editedBy: g.session.user.notionUserId });
  const { error } = await supabase.from('billing_paragraphs')
    .update({ archived: true, updated_at: new Date().toISOString(), updated_by: g.session.user.notionUserId })
    .eq('document', document).eq('key', key);
  if (error) return NextResponse.json({ error: 'Failed to delete the paragraph' }, { status: 500 });

  logAudit({ firmId: g.session.firmId, entityType: 'BillingParagraph', entityId: `${document}:${key}`, action: 'deleted', performedBy: g.session.user.notionUserId, ipAddress: getClientIP(req) });
  return NextResponse.json({ ok: true });
}

/** Sort orders 10, 20, 30… in the given order; paragraphs not named keep theirs after. */
async function renumber(supabase: Awaited<ReturnType<typeof getSupabaseServerAuthClient>>, document: string, keys: string[]) {
  await Promise.all(keys.map((key, i) =>
    supabase.from('billing_paragraphs').update({ sort_order: (i + 1) * 10 }).eq('document', document).eq('key', key)));
}
