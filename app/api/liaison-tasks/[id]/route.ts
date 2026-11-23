import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  const me = session.user.notionUserId;

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const { data: task } = await supabase
    .from('liaison_tasks')
    .select('id, assigned_to, status')
    .eq('id', id)
    .single();
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Chief, admin, and super_user can edit everything; owner can only flip
  // status to in_progress on their own errand.
  const canManage =
    role === 'chief_liaison_officer' || role === 'admin' || role === 'super_user';
  const isOwner = task.assigned_to === me;
  if (!canManage && !isOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();

  // Completing an errand must go through POST /complete so the transportation
  // tariff is recorded in both ledgers (liaison reimbursement + client billing).
  // Flipping status here would silently skip that pipeline.
  if (body.status === 'completed') {
    return NextResponse.json(
      { error: 'Use the completion flow to mark an errand completed.' },
      { status: 400 },
    );
  }

  // A completed errand has posted reimbursement + matter_expense rows. Reopening
  // or cancelling it here would orphan those financial entries, so block status
  // changes on completed errands (finance must reverse the expenses first).
  if (task.status === 'completed' && body.status && body.status !== 'completed') {
    return NextResponse.json(
      { error: 'Completed errands cannot be reopened or cancelled here.' },
      { status: 400 },
    );
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (canManage) {
    const ALLOWED = [
      'title',
      'purpose',
      'description',
      'priority',
      'zone_id',
      'scheduled_for',
      'due_date',
      'status',
      'bill_at_internal',
    ] as const;
    for (const k of ALLOWED) {
      if (k in body) update[k] = body[k];
    }
    if (body.assigned_to && typeof body.assigned_to === 'string') {
      const { data: a } = await supabase
        .from('team')
        .select('person_id, name, role, active')
        .eq('person_id', body.assigned_to)
        .single();
      if (
        a?.active &&
        (a.role === 'liaison_officer' || a.role === 'chief_liaison_officer')
      ) {
        update.assigned_to = a.person_id;
        update.assigned_to_name = a.name ?? '';
      }
    }
    // Client / matter must stay consistent — if either changes, validate together.
    let effectiveMatterId: string | null = null;
    if ('client_id' in body || 'matter_id' in body) {
      const clientId = body.client_id ?? null;
      const matterId = body.matter_id ?? null;
      if (!clientId || !matterId) {
        return NextResponse.json(
          { error: 'client_id and matter_id are both required' },
          { status: 400 },
        );
      }
      const { data: matter } = await supabase
        .from('matters')
        .select('notion_id, name, client_id, client_name')
        .eq('notion_id', matterId)
        .single();
      if (!matter || (matter.client_id && matter.client_id !== clientId)) {
        return NextResponse.json(
          { error: 'matter does not belong to the selected client' },
          { status: 400 },
        );
      }
      update.client_id = clientId;
      update.client_name = matter.client_name ?? '';
      update.matter_id = matterId;
      update.matter_name = matter.name ?? '';
      effectiveMatterId = matterId;
      // Changing matter invalidates any prior deliverable link unless caller
      // also supplied a new one (handled in the deliverable block below).
      if (!('deliverable_id' in body)) {
        update.deliverable_id = null;
        update.deliverable_name = '';
      }
    }

    if ('deliverable_id' in body) {
      const did = body.deliverable_id;
      if (!did) {
        update.deliverable_id = null;
        update.deliverable_name = '';
      } else {
        // Need to know the matter the deliverable must belong to. Prefer the
        // matter set in this same PATCH; fall back to the existing task row.
        let targetMatter = effectiveMatterId;
        if (!targetMatter) {
          const { data: t2 } = await supabase
            .from('liaison_tasks')
            .select('matter_id')
            .eq('id', id)
            .single();
          targetMatter = t2?.matter_id ?? null;
        }
        const { data: d } = await supabase
          .from('deliverables')
          .select('notion_id, name, matter_id')
          .eq('notion_id', did)
          .single();
        if (!d || (targetMatter && d.matter_id !== targetMatter)) {
          return NextResponse.json(
            { error: 'deliverable does not belong to the selected matter' },
            { status: 400 },
          );
        }
        update.deliverable_id = did;
        update.deliverable_name = d.name ?? '';
      }
    }
  } else if (body.status === 'in_progress') {
    update.status = 'in_progress';
  } else {
    return NextResponse.json(
      { error: 'Only the chief can edit; liaison may mark in_progress' },
      { status: 403 },
    );
  }

  const { error } = await supabase.from('liaison_tasks').update(update).eq('id', id);
  if (error) {
    console.error('[liaison-tasks:patch]', error.message);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  if (
    role !== 'chief_liaison_officer' &&
    role !== 'admin' &&
    role !== 'super_user'
  ) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const { error } = await supabase.from('liaison_tasks').delete().eq('id', id);
  if (error) {
    console.error('[liaison-tasks:delete]', error.message);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
