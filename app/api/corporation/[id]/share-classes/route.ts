import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { rowToShareClass } from '@/lib/corporation-row';
import { logAudit, getClientIP } from '@/lib/audit';

/**
 * Share classes for a corporation — the authorized-capital half of the GIS
 * capital structure. Subscribed and paid-up are not stored here: they are
 * derived from the shareholder list, so there is nothing to keep in sync.
 */

const COLUMNS: Record<string, string> = {
  className: 'class_name',
  parValue: 'par_value',
  authorizedShares: 'authorized_shares',
  sortOrder: 'sort_order',
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const { data } = await getServiceDbForFirm(session.firmId)
    .from('corporation_share_classes')
    .select('*')
    .eq('corporation_id', id)
    .order('sort_order');
  return NextResponse.json({ shareClasses: (data ?? []).map((r) => rowToShareClass(r as Record<string, unknown>)) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const className = String(body?.className ?? '').trim();
  if (!className) return NextResponse.json({ error: 'A class name is required.' }, { status: 400 });

  const supabase = getServiceDbForFirm(session.firmId);
  const { count } = await supabase
    .from('corporation_share_classes')
    .select('id', { count: 'exact', head: true })
    .eq('corporation_id', id);

  const { data, error } = await supabase
    .from('corporation_share_classes')
    .insert({
      corporation_id: id,
      class_name: className,
      par_value: body?.parValue ?? null,
      authorized_shares: body?.authorizedShares ?? null,
      sort_order: count ?? 0,
    })
    .select('*')
    .single();

  if (error) {
    // The unique index is per corporation, case-insensitive.
    const duplicate = error.code === '23505';
    return NextResponse.json(
      { error: duplicate ? `"${className}" already exists on this corporation.` : error.message },
      { status: duplicate ? 409 : 500 },
    );
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'Corporation',
    entityId: id,
    action: 'share_class_added',
    fieldChanged: className,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ shareClass: rowToShareClass(data as Record<string, unknown>) });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const classId = Number(body?.classId);
  if (!Number.isInteger(classId)) return NextResponse.json({ error: 'classId is required' }, { status: 400 });

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    const col = COLUMNS[k];
    if (col) update[col] = k === 'className' ? String(v ?? '').trim() : v;
  }
  if (update.class_name === '') return NextResponse.json({ error: 'A class name is required.' }, { status: 400 });

  const { data, error } = await getServiceDbForFirm(session.firmId)
    .from('corporation_share_classes')
    .update(update)
    .eq('id', classId)
    .eq('corporation_id', id)
    .select('*')
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Not found' }, { status: 500 });

  return NextResponse.json({ shareClass: rowToShareClass(data as Record<string, unknown>) });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const classId = Number(new URL(req.url).searchParams.get('classId'));
  if (!Number.isInteger(classId)) return NextResponse.json({ error: 'classId is required' }, { status: 400 });

  const supabase = getServiceDbForFirm(session.firmId);
  const { data: existing } = await supabase
    .from('corporation_share_classes')
    .select('class_name')
    .eq('id', classId)
    .eq('corporation_id', id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Holdings reference the class by name, so removing a class that people hold
  // would strand those holdings on a class the form no longer declares.
  const { count } = await supabase
    .from('corporation_persons')
    .select('id', { count: 'exact', head: true })
    .eq('corporation_id', id)
    .eq('share_class', existing.class_name as string);
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        error: `${count} ${count === 1 ? 'holder holds' : 'holders hold'} "${existing.class_name}". Reassign them before removing the class.`,
        code: 'class_in_use',
      },
      { status: 409 },
    );
  }

  const { error } = await supabase
    .from('corporation_share_classes')
    .delete()
    .eq('id', classId)
    .eq('corporation_id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAudit({
    firmId: session.firmId,
    entityType: 'Corporation',
    entityId: id,
    action: 'share_class_removed',
    fieldChanged: existing.class_name as string,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true });
}
