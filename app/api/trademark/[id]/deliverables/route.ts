import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { logAudit, getClientIP } from '@/lib/audit';
import { validateBody, trademarkDeliverableSchema } from '@/lib/validation';
import { TRADEMARK_SELECT, rowToTrademark } from '@/lib/trademark-row';
import { markMatterLinks } from '@/lib/trademarks/matter-links';
import { markTrademarkMatterIds } from '@/lib/trademarks/trademark-matters';
import { manilaToday, addDays } from '@/lib/dates';
import { mintId } from '@/lib/ids';
import { STATUS_REPORT_TYPE } from '@/lib/status-report-auto';
import { pgInList } from '@/lib/postgrest';
import {
  deliverableName, deliverableOptions, isDeliverableAction, markDeliverableClassification, matterForStep, stepLabel,
} from '@/lib/trademarks/deliverables';
import { CLOSED_STATUSES, DELIVERABLE_STATUS, DELIVERABLE_STATUS as S, isFinalized } from '@/lib/deliverable-status';

const COLUMNS = 'notion_id, name, status, external_due_date, date_done, trademark_action, trademark_office_action_id, type, currently_with_ids, created_time';

/** A deliverable as the mark's page lists it. */
function toEntry(r: Record<string, unknown>, label: string | null) {
  return {
    id: r.notion_id as string,
    name: r.name as string,
    status: r.status as string,
    due: (r.external_due_date as string | null) ?? null,
    doneOn: (r.date_done as string | null) ?? null,
    action: (r.trademark_action as string | null) ?? null,
    officeActionId: (r.trademark_office_action_id as string | null) ?? null,
    // A status report is Lumilex's 'Status Report' type; the page asks for it by this kind.
    kind: r.type === STATUS_REPORT_TYPE ? 'status_report' : null,
    step: label,
  };
}

async function loadMark(id: string) {
  const supabase = await getSupabaseServerAuthClient();
  const { data: row } = await supabase.from('trademarks').select(TRADEMARK_SELECT).eq('id', id).maybeSingle();
  return { supabase, mark: row ? rowToTrademark(row) : null };
}

/** GET /api/trademark/[id]/deliverables — the work on the mark, and the steps work can still be started for. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const { supabase, mark } = await loadMark(id);
  if (!mark) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // The status reports on the mark's own trademark matters belong here too, unless one names another subject.
  const statusReports = async () => {
    const matterIds = [...await markTrademarkMatterIds(supabase, id)];
    if (matterIds.length === 0) return { data: [], error: null };
    return supabase
      .from('deliverables').select(COLUMNS).in('matter_id', matterIds).eq('type', STATUS_REPORT_TYPE).is('subject_id', null)
      .neq('status', S.ARCHIVED).order('created_time', { ascending: false }).limit(200);
  };
  const [{ data, error }, { data: reports, error: reportsError }, links] = await Promise.all([
    supabase
      .from('deliverables').select(COLUMNS).eq('subject_id', id).neq('status', S.ARCHIVED)
      .order('created_time', { ascending: false }).limit(200),
    statusReports(),
    markMatterLinks(supabase, id),
  ]);
  if (error || reportsError) return NextResponse.json({ error: (error ?? reportsError)!.message }, { status: 500 });

  const rows = [...(data ?? []), ...(reports ?? [])]
    .sort((a, b) => String(b.created_time ?? '').localeCompare(String(a.created_time ?? '')));
  const deliverables = rows.map((r) => {
    const action = r.trademark_action as string | null;
    if (action && isDeliverableAction(action)) return toEntry(r, stepLabel(mark, action, r.trademark_office_action_id as string | null));
    return toEntry(r, r.type === STATUS_REPORT_TYPE ? 'Status report' : null);
  });
  const open = deliverables
    .filter((d) => d.action && !isFinalized(d.status))
    .map((d) => ({ action: d.action!, officeActionId: d.officeActionId }));
  // Each option carries what the confirm shows: the name it will get and the matter it will sit under.
  const options = deliverableOptions(mark, manilaToday(), open).map((o) => ({
    ...o,
    name: deliverableName(mark, o.label),
    matterName: matterForStep(o.action, links)?.matterName ?? null,
  }));
  return NextResponse.json({ deliverables, options });
}

/**
 * POST /api/trademark/[id]/deliverables — start the deliverable for one step
 * of the mark: named for the mark and the step, due on the step's bar date,
 * under the engagement that covers it, with the person starting it as drafter.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const validation = await validateBody(req, trademarkDeliverableSchema);
  if (!validation.success) return validation.response;
  const { action, officeActionId = null } = validation.data;

  const { id } = await params;
  const { supabase, mark } = await loadMark(id);
  if (!mark) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: existing } = await supabase
    .from('deliverables').select(COLUMNS).eq('subject_id', id).eq('trademark_action', action)
    .not('status', 'in', pgInList(CLOSED_STATUSES));
  const taken = (existing ?? []).find((r) => ((r.trademark_office_action_id as string | null) ?? null) === officeActionId);
  if (taken) {
    return NextResponse.json({ error: 'That step already has a deliverable', deliverable: toEntry(taken, null) }, { status: 409 });
  }

  const today = manilaToday();
  const option = deliverableOptions(mark, today).find((o) => o.action === action && o.officeActionId === officeActionId);
  if (!option) return NextResponse.json({ error: 'That step is not open on this mark' }, { status: 409 });

  const matter = matterForStep(action, await markMatterLinks(supabase, id));
  if (!matter) {
    return NextResponse.json({ error: 'Link the mark to a matter first (Covered by)' }, { status: 409 });
  }
  const { data: matterRow } = await supabase.from('matters').select('name, client_name').eq('notion_id', matter.matterId).maybeSingle();

  const me = session.user.notionUserId;
  const name = deliverableName(mark, option.label);
  const notionId = mintId('deliverable');
  const now = new Date().toISOString();
  const { data: created, error } = await supabase.from('deliverables').insert({
    firm_id: session.firmId,
    notion_id: notionId,
    notion_url: '',
    name,
    ...markDeliverableClassification(mark),
    status: DELIVERABLE_STATUS.NOT_STARTED,
    matter_id: matter.matterId,
    matter_name: (matterRow?.name as string) ?? '',
    client_name: (matterRow?.client_name as string) ?? '',
    subject_id: id,
    trademark_action: action,
    trademark_office_action_id: officeActionId,
    priority: option.due && option.due <= addDays(today, 14) ? 'High' : 'Medium',
    external_due_date: option.due,
    drafter_ids: [me],
    currently_with_ids: [me],
    created_time: now,
    notion_last_edited_at: now,
  }).select(COLUMNS).single();
  if (error?.code === '23505') return NextResponse.json({ error: 'That step already has a deliverable' }, { status: 409 });
  if (error || !created) return NextResponse.json({ error: error?.message ?? 'Could not create the deliverable' }, { status: 500 });

  logAudit({
    firmId: session.firmId,
    entityType: 'Trademark',
    entityId: id,
    entityName: mark.mark || undefined,
    action: 'deliverable_created',
    fieldChanged: action,
    newValue: name,
    performedBy: me,
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true, deliverable: toEntry(created, option.label) });
}
