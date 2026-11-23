import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { mintId } from '@/lib/ids';
import { TASK_STATUS } from '@/lib/task-status';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { name, matterId, dueDate, priority, assigneeIds } = await req.json();

  if (!name) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  try {
    const supabase = await getSupabaseServerAuthClient();

    // Resolve matter name
    let matterName = '';
    if (matterId) {
      const { data: matterRow } = await supabase
        .from('matters')
        .select('name')
        .eq('notion_id', matterId)
        .single();
      matterName = matterRow?.name ?? '';
    }

    const tempId = mintId('task');
    const { error: dbErr } = await supabase
      .from('tasks')
      .insert({
        firm_id: session.firmId,
        notion_id: tempId,
        notion_url: '',
        name,
        matter_id: matterId ?? null,
        matter_name: matterName,
        due_date: dueDate ?? null,
        status: TASK_STATUS.NOT_STARTED,
        priority: priority ?? '',
        done: false,
        assignee_ids: assigneeIds ?? [],
        notes: '',
        created_time: new Date().toISOString(),
        notion_last_edited_at: new Date().toISOString(),
        synced_at: new Date().toISOString(),
      });

    if (dbErr) {
      console.error('[task] Supabase insert error:', dbErr.message);
      return NextResponse.json({ error: dbErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[task] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH — toggle a task's `done` flag.
 *
 * Authorization is assignee-based (or a managing role): a task can be assigned to
 * someone who isn't on its matter's team, so the RLS matter-access gate on `tasks`
 * would wrongly 404 the assignee's own read/write. We therefore authorize in-app
 * against `assignee_ids` and run the DB ops on the service-role client.
 */
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id, done } = await req.json();
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }
  if (typeof done !== 'boolean') {
    return NextResponse.json({ error: 'done must be boolean' }, { status: 400 });
  }

  const supabase = getServiceDbForFirm(session.firmId);
  const { data: existing, error: fetchErr } = await supabase
    .from('tasks')
    .select('notion_id, assignee_ids, status')
    .eq('notion_id', id)
    .single();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  const requester = session.user.notionUserId;
  const assignees: string[] = existing.assignee_ids ?? [];
  const isAssignee = assignees.includes(requester);
  const role = session.user.role;
  const canManage = role === 'admin' || role === 'super_user' || role === 'partner';
  if (!isAssignee && !canManage) {
    return NextResponse.json(
      { error: "You can't update this task — you're not one of its assignees." },
      { status: 403 },
    );
  }

  const nextStatus = done ? 'Done' : (existing.status === 'Done' ? 'In progress' : existing.status);

  const { error: updateErr } = await supabase
    .from('tasks')
    .update({ done, status: nextStatus, notion_last_edited_at: new Date().toISOString() })
    .eq('notion_id', id);

  if (updateErr) {
    console.error('[task] Supabase update error:', updateErr.message);
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, done });
}
