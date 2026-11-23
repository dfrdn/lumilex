import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { isManagingPartner } from '@/lib/auth/isManagingPartner';
import { logAudit, getClientIP } from '@/lib/audit';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ personId: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mp = await isManagingPartner(session.user.notionUserId, session.firmId);
  if (!mp) {
    return NextResponse.json(
      { error: 'Only the Managing Partner can edit salaries.' },
      { status: 403 },
    );
  }

  const { personId } = await params;
  const body = await req.json().catch(() => ({}));
  const raw = body?.monthlySalary;

  let nextValue: number | null;
  if (raw === null || raw === '' || raw === undefined) {
    nextValue = null;
  } else {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json(
        { error: 'monthlySalary must be a non-negative number or null' },
        { status: 400 },
      );
    }
    nextValue = Math.round(n * 100) / 100;
  }

  const supabase = getServiceDbForFirm(session.firmId);

  const { data: existing } = await supabase
    .from('team')
    .select('notion_id, name, monthly_salary')
    .eq('person_id', personId)
    .limit(1)
    .single();

  if (!existing) {
    return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
  }

  const { error } = await supabase
    .from('team')
    .update({ monthly_salary: nextValue })
    .eq('person_id', personId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'team',
    entityId: existing.notion_id,
    entityName: existing.name,
    action: 'update',
    fieldChanged: 'monthly_salary',
    oldValue: existing.monthly_salary == null ? undefined : String(existing.monthly_salary),
    newValue: nextValue == null ? undefined : String(nextValue),
    performedBy: session.user.notionUserId,
    performedByName: session.user.name ?? undefined,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true, monthlySalary: nextValue });
}
