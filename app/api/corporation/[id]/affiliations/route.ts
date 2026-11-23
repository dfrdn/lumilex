import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { rowToAffiliation } from '@/lib/corporation-row';
import { logAudit, getClientIP } from '@/lib/audit';

/** Intercompany affiliations — the parent/subsidiary block on GIS page 1. */

const RELATIONS = new Set(['Parent', 'Subsidiary', 'Affiliate']);

const COLUMNS: Record<string, string> = {
  relation: 'relation',
  name: 'name',
  secRegistrationNo: 'sec_registration_no',
  address: 'address',
  sortOrder: 'sort_order',
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const { data } = await getServiceDbForFirm(session.firmId)
    .from('corporation_affiliations')
    .select('*')
    .eq('corporation_id', id)
    .order('sort_order');
  return NextResponse.json({ affiliations: (data ?? []).map((r) => rowToAffiliation(r as Record<string, unknown>)) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? '').trim();
  const relation = String(body?.relation ?? 'Affiliate');
  if (!name) return NextResponse.json({ error: 'A company name is required.' }, { status: 400 });
  if (!RELATIONS.has(relation)) return NextResponse.json({ error: 'Invalid relation' }, { status: 400 });

  const supabase = getServiceDbForFirm(session.firmId);

  // The GIS has exactly one parent slot.
  if (relation === 'Parent') {
    const { count } = await supabase
      .from('corporation_affiliations')
      .select('id', { count: 'exact', head: true })
      .eq('corporation_id', id)
      .eq('relation', 'Parent');
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { error: 'A parent company is already recorded. Edit or remove it first.', code: 'parent_exists' },
        { status: 409 },
      );
    }
  }

  const { count: total } = await supabase
    .from('corporation_affiliations')
    .select('id', { count: 'exact', head: true })
    .eq('corporation_id', id);

  const { data, error } = await supabase
    .from('corporation_affiliations')
    .insert({
      corporation_id: id,
      relation,
      name,
      sec_registration_no: body?.secRegistrationNo ?? null,
      address: body?.address ?? null,
      sort_order: total ?? 0,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAudit({
    firmId: session.firmId,
    entityType: 'Corporation',
    entityId: id,
    action: 'affiliation_added',
    fieldChanged: relation,
    newValue: name,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ affiliation: rowToAffiliation(data as Record<string, unknown>) });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const affiliationId = Number(body?.affiliationId);
  if (!Number.isInteger(affiliationId)) {
    return NextResponse.json({ error: 'affiliationId is required' }, { status: 400 });
  }
  if (body?.relation !== undefined && !RELATIONS.has(String(body.relation))) {
    return NextResponse.json({ error: 'Invalid relation' }, { status: 400 });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    const col = COLUMNS[k];
    if (col) update[col] = k === 'name' ? String(v ?? '').trim() : v;
  }
  if (update.name === '') return NextResponse.json({ error: 'A company name is required.' }, { status: 400 });

  const { data, error } = await getServiceDbForFirm(session.firmId)
    .from('corporation_affiliations')
    .update(update)
    .eq('id', affiliationId)
    .eq('corporation_id', id)
    .select('*')
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Not found' }, { status: 500 });

  return NextResponse.json({ affiliation: rowToAffiliation(data as Record<string, unknown>) });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const affiliationId = Number(new URL(req.url).searchParams.get('affiliationId'));
  if (!Number.isInteger(affiliationId)) {
    return NextResponse.json({ error: 'affiliationId is required' }, { status: 400 });
  }

  const { error } = await getServiceDbForFirm(session.firmId)
    .from('corporation_affiliations')
    .delete()
    .eq('id', affiliationId)
    .eq('corporation_id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAudit({
    firmId: session.firmId,
    entityType: 'Corporation',
    entityId: id,
    action: 'affiliation_removed',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true });
}
