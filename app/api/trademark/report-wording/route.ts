import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { validateBody, trademarkReportWordingSchema } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { recordRevision } from '@/lib/content-revisions';
import {
  BLOCK_FIELDS, REPORT_WORDING_EDIT_ROLES as EDIT_ROLES, WORDING_BLOCKS, WORDING_FIELDS, isWordingKey, wordingProblem,
} from '@/lib/trademarks/report-wording';

/**
 * GET /api/trademark/report-wording — every block of the reports' standard
 * wording as it now reads, with its default, who last changed it, and the
 * fields it may use.
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = await getSupabaseServerAuthClient();
  const { data: rows, error } = await supabase.from('trademark_report_wording').select('key, body, updated_at, updated_by');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const editorIds = [...new Set((rows ?? []).map((r) => r.updated_by).filter((v): v is string => !!v))];
  const names = new Map<string, string>();
  if (editorIds.length) {
    const { data: team } = await supabase.from('team').select('person_id, name').in('person_id', editorIds);
    for (const t of team ?? []) if (t.person_id && t.name) names.set(t.person_id, t.name);
  }
  const saved = new Map((rows ?? []).map((r) => [r.key, r]));
  return NextResponse.json({
    blocks: WORDING_BLOCKS.map((b) => {
      const row = saved.get(b.key);
      return {
        ...b,
        defaultBody: b.body,
        body: row?.body?.trim() ? row.body : b.body,
        edited: !!row?.body?.trim(),
        updatedAt: row?.updated_at ?? null,
        updatedBy: row?.updated_by ? names.get(row.updated_by) ?? null : null,
      };
    }),
    fields: WORDING_FIELDS,
    blockFields: BLOCK_FIELDS,
    canEdit: EDIT_ROLES.includes(session.user.role ?? ''),
  });
}

/** PUT — save one block. The text it replaces is kept as a revision. */
export async function PUT(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!EDIT_ROLES.includes(session.user.role ?? '')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const validation = await validateBody(req, trademarkReportWordingSchema);
  if (!validation.success) return validation.response;
  const { key, body } = validation.data;
  if (!isWordingKey(key)) return NextResponse.json({ error: 'Unknown block' }, { status: 400 });
  const problem = wordingProblem(body);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();
  const { data: current } = await supabase.from('trademark_report_wording').select('key, body').eq('key', key).maybeSingle();
  const before = current ?? { key, body: WORDING_BLOCKS.find((b) => b.key === key)!.body };
  const row = { firm_id: session.firmId, key, body, updated_at: new Date().toISOString(), updated_by: session.user.notionUserId };
  const { error } = await supabase.from('trademark_report_wording').upsert(row, { onConflict: 'firm_id,key' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordRevision({ firmId: session.firmId, entityType: 'trademark_report_wording', entityId: key, before, after: row, editedBy: session.user.notionUserId });
  logAudit({
    firmId: session.firmId,
    entityType: 'TrademarkReportWording',
    entityId: key,
    action: 'updated',
    fieldChanged: 'body',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true, updatedAt: row.updated_at });
}

/** DELETE ?key= — put one block back to its default. */
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!EDIT_ROLES.includes(session.user.role ?? '')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const key = new URL(req.url).searchParams.get('key') ?? '';
  if (!isWordingKey(key)) return NextResponse.json({ error: 'Unknown block' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();
  const { data: current } = await supabase.from('trademark_report_wording').select('key, body').eq('key', key).maybeSingle();
  if (!current) return NextResponse.json({ ok: true });
  const { error } = await supabase.from('trademark_report_wording').delete().eq('key', key);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordRevision({ firmId: session.firmId,
    entityType: 'trademark_report_wording', entityId: key, before: current,
    after: { body: WORDING_BLOCKS.find((b) => b.key === key)!.body }, editedBy: session.user.notionUserId,
  });
  logAudit({
    firmId: session.firmId,
    entityType: 'TrademarkReportWording',
    entityId: key,
    action: 'updated',
    fieldChanged: 'body',
    newValue: '(default)',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true });
}
