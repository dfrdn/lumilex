import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { logAudit, getClientIP } from '@/lib/audit';
import { validateBody, corporationStepTaskSchema } from '@/lib/validation';
import { rowToCorporation } from '@/lib/corporation-row';
import { CORPORATION_SELECT } from '@/lib/corporations/matter-links';
import { companyName } from '@/lib/corporations/obligations';
import { mintId } from '@/lib/ids';
import { TASK_STATUS } from '@/lib/task-status';
import { isCorporationStep, matterForStep, matterTeamOr, stepLabel, stepOptions, stepTaskName } from '@/lib/corporations/step-tasks';

const COLUMNS = 'notion_id, name, status, done, due_date, assignee_ids, corporation_step, created_time';
/** How many finished tasks the page lists under the open ones. */
const DONE_SHOWN = 10;

/** A task as the company's page lists it. */
function toEntry(r: Record<string, unknown>, names: Map<string, string>) {
  const step = r.corporation_step as string | null;
  return {
    id: r.notion_id as string,
    name: r.name as string,
    status: r.status as string,
    done: r.done as boolean,
    due: (r.due_date as string | null) ?? null,
    assignees: ((r.assignee_ids as string[] | null) ?? []).map((p) => names.get(p)).filter((n): n is string => !!n),
    step: isCorporationStep(step) ? stepLabel(step) : null,
  };
}

async function teamNames(supabase: Awaited<ReturnType<typeof getSupabaseServerAuthClient>>, ids: string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const { data } = await supabase.from('team').select('person_id, name').in('person_id', ids);
  return new Map((data ?? []).map((t) => [t.person_id as string, t.name as string]));
}

async function loadCompany(id: string) {
  const supabase = await getSupabaseServerAuthClient();
  const { data: row } = await supabase.from('corporations').select(CORPORATION_SELECT).eq('id', id).maybeSingle();
  return { supabase, corporation: row ? rowToCorporation(row) : null };
}

/**
 * GET /api/corporation/[id]/tasks
 * The company's tasks — open ones, then the latest finished — and the
 * registrations a task can still be started for.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const { supabase, corporation } = await loadCompany(id);
  if (!corporation) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [open, finished] = await Promise.all([
    supabase.from('tasks').select(COLUMNS).eq('subject_id', id).eq('done', false)
      .order('due_date', { ascending: true, nullsFirst: false }).limit(100),
    supabase.from('tasks').select(COLUMNS).eq('subject_id', id).eq('done', true)
      .order('created_time', { ascending: false }).limit(DONE_SHOWN),
  ]);
  const error = open.error ?? finished.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = [...(open.data ?? []), ...(finished.data ?? [])];
  const names = await teamNames(supabase, [...new Set(rows.flatMap((r) => (r.assignee_ids as string[] | null) ?? []))]);
  const openSteps = (open.data ?? []).map((r) => r.corporation_step as string | null).filter((s): s is string => !!s);

  return NextResponse.json({
    tasks: rows.map((r) => toEntry(r, names)),
    options: stepOptions(corporation, openSteps).map((o) => ({ ...o, name: stepTaskName(corporation, o.step) })),
  });
}

/**
 * POST /api/corporation/[id]/tasks — start the task for a registration,
 * assigned to the person starting it, under the step's matter. Recording the
 * registration on the company closes it.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const validation = await validateBody(req, corporationStepTaskSchema);
  if (!validation.success) return validation.response;
  const { step } = validation.data;

  const { id } = await params;
  const { supabase, corporation } = await loadCompany(id);
  if (!corporation) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!stepOptions(corporation).some((o) => o.step === step)) {
    return NextResponse.json({ error: 'That registration is not open on this company' }, { status: 409 });
  }

  const matterId = matterForStep(step, corporation);
  if (!matterId) return NextResponse.json({ error: 'Link the company to a matter first' }, { status: 409 });
  const { data: matterRow } = await supabase.from('matters').select('name, team_person_ids').eq('notion_id', matterId).maybeSingle();
  const matterName = (matterRow?.name as string) ?? '';

  const me = session.user.notionUserId;
  const name = stepTaskName(corporation, step);
  const notionId = mintId('task');
  const now = new Date().toISOString();
  const { data: created, error } = await supabase.from('tasks').insert({
    firm_id: session.firmId,
    notion_id: notionId,
    notion_url: '',
    name,
    matter_id: matterId,
    matter_name: matterName,
    subject_id: id,
    corporation_step: step,
    due_date: null,
    status: TASK_STATUS.NOT_STARTED,
    priority: 'Medium',
    done: false,
    assignee_ids: matterTeamOr(matterRow?.team_person_ids as string[] | null, me),
    notes: '',
    created_time: now,
    notion_last_edited_at: now,
    synced_at: now,
  }).select(COLUMNS).single();
  if (error?.code === '23505') return NextResponse.json({ error: 'That registration already has an open task' }, { status: 409 });
  if (error || !created) return NextResponse.json({ error: error?.message ?? 'Could not create the task' }, { status: 500 });

  logAudit({
    firmId: session.firmId,
    entityType: 'Corporation',
    entityId: id,
    entityName: companyName(corporation) || undefined,
    action: 'task_created',
    fieldChanged: step,
    newValue: name,
    performedBy: me,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true, task: toEntry(created, await teamNames(supabase, [me])) });
}
