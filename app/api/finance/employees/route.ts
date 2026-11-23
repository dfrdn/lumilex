import { getSession } from '@/lib/session';
import { NextRequest, NextResponse } from 'next/server';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { logAudit, getClientIP } from '@/lib/audit';

const EDITABLE_FIELDS = ['monthly_salary', 'start_date', 'end_date'] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

async function assertFinance() {
  const session = await getSession();
  const role = session?.user?.role;
  if (!session?.user?.notionUserId || (role !== 'finance' && role !== 'super_user')) {
    return null;
  }
  return session;
}

function isIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

export async function GET() {
  const session = await assertFinance();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Service role after assertFinance: salary is read through the service
  // role, ready for monthly_salary to be withheld from user JWTs.
  const supabase = getServiceDbForFirm(session.firmId);
  const { data, error } = await supabase
    .from('team')
    .select('person_id, notion_id, name, initials, position, role, active, start_date, end_date, monthly_salary')
    .order('active', { ascending: false })
    .order('name', { ascending: true });

  if (error) {
    console.error('[finance-employees]', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function PATCH(req: NextRequest) {
  const session = await assertFinance();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { personId, field, value } = await req.json();

  if (!personId || typeof personId !== 'string') {
    return NextResponse.json({ error: 'personId is required' }, { status: 400 });
  }

  if (!EDITABLE_FIELDS.includes(field as EditableField)) {
    return NextResponse.json(
      { error: `field must be one of: ${EDITABLE_FIELDS.join(', ')}` },
      { status: 400 },
    );
  }

  let normalised: number | string | null;
  if (field === 'monthly_salary') {
    if (value === null || value === '' || value === undefined) {
      normalised = null;
    } else {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json(
          { error: 'monthly_salary must be a non-negative number or null' },
          { status: 400 },
        );
      }
      normalised = Math.round(n * 100) / 100;
    }
  } else {
    if (value === null || value === '' || value === undefined) {
      normalised = null;
    } else if (typeof value !== 'string' || !isIsoDate(value)) {
      return NextResponse.json(
        { error: `${field} must be a YYYY-MM-DD date or null` },
        { status: 400 },
      );
    } else {
      normalised = value;
    }
  }

  // Service role for the read and the write: through finance's own JWT,
  // team_self_update matched only their own row (so edits to anyone else saved
  // nothing), and team_guard_self_update refuses a salary change to it.
  const supabase = getServiceDbForFirm(session.firmId);

  const { data: existing } = await supabase
    .from('team')
    .select('notion_id, name, monthly_salary, start_date, end_date')
    .eq('person_id', personId)
    .limit(1)
    .single();

  if (!existing) {
    return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
  }

  if (field === 'end_date' && normalised && existing.start_date) {
    if (String(normalised) < String(existing.start_date)) {
      return NextResponse.json(
        { error: 'End date cannot be before start date' },
        { status: 400 },
      );
    }
  }
  if (field === 'start_date' && normalised && existing.end_date) {
    if (String(normalised) > String(existing.end_date)) {
      return NextResponse.json(
        { error: 'Start date cannot be after end date' },
        { status: 400 },
      );
    }
  }

  const { error } = await supabase
    .from('team')
    .update({ [field]: normalised })
    .eq('person_id', personId);

  if (error) {
    console.error('[finance-employees]', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  const oldValue = (existing as Record<string, unknown>)[field];
  logAudit({
    firmId: session.firmId,
    entityType: 'team',
    entityId: existing.notion_id,
    entityName: existing.name,
    action: 'update',
    fieldChanged: field,
    oldValue: oldValue == null ? undefined : String(oldValue),
    newValue: normalised == null ? undefined : String(normalised),
    performedBy: session.user.notionUserId,
    performedByName: session.user.name ?? undefined,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true });
}
