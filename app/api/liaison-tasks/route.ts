import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import {
  getAllLiaisonTasks,
  getLiaisonTasksForPerson,
} from '@/lib/queries/liaison';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  const me = session.user.notionUserId;

  const scope = req.nextUrl.searchParams.get('scope') ?? 'all';

  // Liaison officers only see their own tasks regardless of scope.
  if (role === 'liaison_officer') {
    const tasks = await getLiaisonTasksForPerson(session.firmId, me);
    return NextResponse.json({ tasks });
  }

  if (scope === 'mine') {
    const tasks = await getLiaisonTasksForPerson(session.firmId, me);
    return NextResponse.json({ tasks });
  }

  // Chief, admin, partner, finance, super_user see all.
  const allowed =
    role === 'chief_liaison_officer' ||
    role === 'admin' ||
    role === 'partner' ||
    role === 'finance' ||
    role === 'super_user';
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const tasks = await getAllLiaisonTasks(session.firmId);
  return NextResponse.json({ tasks });
}

export async function POST(req: NextRequest) {
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

  const body = await req.json();
  const {
    title,
    purpose,
    description,
    priority,
    zone_id,
    scheduled_for,
    due_date,
    assigned_to,
    client_id,
    matter_id,
    deliverable_id,
    bill_at_internal,
  } = body;

  if (!title || typeof title !== 'string') {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }
  if (!assigned_to || typeof assigned_to !== 'string') {
    return NextResponse.json({ error: 'assigned_to is required' }, { status: 400 });
  }
  if (!client_id || typeof client_id !== 'string') {
    return NextResponse.json({ error: 'client_id is required' }, { status: 400 });
  }
  if (!matter_id || typeof matter_id !== 'string') {
    return NextResponse.json({ error: 'matter_id is required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();

  // Look up assignee — must be an active liaison.
  const { data: assignee } = await supabase
    .from('team')
    .select('person_id, name, role, active')
    .eq('person_id', assigned_to)
    .single();
  if (
    !assignee ||
    !assignee.active ||
    (assignee.role !== 'liaison_officer' && assignee.role !== 'chief_liaison_officer')
  ) {
    return NextResponse.json(
      { error: 'assigned_to must be an active liaison officer' },
      { status: 400 },
    );
  }

  // Verify matter belongs to client; pull both names in one go.
  const { data: matter } = await supabase
    .from('matters')
    .select('notion_id, name, client_id, client_name')
    .eq('notion_id', matter_id)
    .single();
  if (!matter) {
    return NextResponse.json({ error: 'matter not found' }, { status: 400 });
  }
  if (matter.client_id && matter.client_id !== client_id) {
    return NextResponse.json(
      { error: 'matter does not belong to the selected client' },
      { status: 400 },
    );
  }

  // Optional deliverable name lookup (must belong to the same matter).
  let deliverable_name = '';
  if (deliverable_id) {
    const { data: d } = await supabase
      .from('deliverables')
      .select('notion_id, name, matter_id')
      .eq('notion_id', deliverable_id)
      .single();
    if (!d || d.matter_id !== matter_id) {
      return NextResponse.json(
        { error: 'deliverable does not belong to the selected matter' },
        { status: 400 },
      );
    }
    deliverable_name = d.name ?? '';
  }

  const { data, error } = await supabase
    .from('liaison_tasks')
    .insert({
      firm_id: session.firmId,
      title: title.trim(),
      purpose: (purpose ?? '').trim(),
      description: (description ?? '').trim(),
      priority: priority ?? 'normal',
      zone_id: zone_id ?? null,
      scheduled_for: scheduled_for || null,
      due_date: due_date || null,
      assigned_to,
      assigned_to_name: assignee.name ?? '',
      assigned_by: session.user.notionUserId,
      assigned_by_name: session.user.name ?? '',
      client_id,
      client_name: matter.client_name ?? '',
      matter_id,
      matter_name: matter.name ?? '',
      deliverable_id: deliverable_id || null,
      deliverable_name,
      bill_at_internal: !!bill_at_internal,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[liaison-tasks:create]', error.message);
    return NextResponse.json({ error: 'Failed to create errand' }, { status: 500 });
  }

  return NextResponse.json({ id: data!.id });
}
