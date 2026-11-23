import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { rowToCorporationPerson } from '@/lib/corporation-row';
import { logAudit, getClientIP } from '@/lib/audit';
import { duplicatePersonMessage } from '@/lib/corporations/person-duplicate';

const PATCH_COLUMNS: Record<string, string> = {
  role: 'role',
  firstName: 'first_name',
  lastName: 'last_name',
  nationality: 'nationality',
  gender: 'gender',
  residentialAddress: 'residential_address',
  tin: 'tin',
  passportNumber: 'passport_number',
  esapNo: 'esap_no',
  isJuridical: 'is_juridical',
  entityName: 'entity_name',
  entityType: 'entity_type',
  entityRegistrationNo: 'entity_registration_no',
  representativeName: 'representative_name',
  representativeTitle: 'representative_title',
  shareClass: 'share_class',
  sharesSubscribedCount: 'shares_subscribed_count',
  sharesSubscribedAmount: 'shares_subscribed_amount',
  sharesPaidAmount: 'shares_paid_amount',
  positionTitle: 'position_title',
  termStart: 'term_start',
  termEnd: 'term_end',
  isCurrent: 'is_current',
  sortOrder: 'sort_order',
};

interface Ctx {
  params: Promise<{ id: string; personId: string }>;
}

export async function PATCH(req: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, personId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

  const update: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    const col = PATCH_COLUMNS[k];
    if (col) update[col] = v;
  }

  const supabase = await getSupabaseServerAuthClient();
  // The role must be this company's (RLS has already confined it to the firm).
  const { data: current } = await supabase
    .from('corporation_persons')
    .select('id')
    .eq('id', Number(personId))
    .eq('corporation_id', id)
    .maybeSingle();
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { error: rpcError } = await supabase.rpc('corporation_person_update', { p_id: Number(personId), p_patch: update });
  if (rpcError?.code === '23505') {
    return NextResponse.json({ error: duplicatePersonMessage(body as Record<string, unknown>) }, { status: 409 });
  }
  const { data, error } = rpcError
    ? { data: null, error: rpcError }
    : await supabase.from('corporation_persons').select('*').eq('id', Number(personId)).single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 });
  logAudit({
    firmId: session.firmId,
    entityType: 'Corporation',
    entityId: id,
    action: 'person_updated',
    fieldChanged: Object.keys(body as Record<string, unknown>).join(', '),
    newValue: ((data.entity_name as string | null) ?? [data.first_name, data.last_name].filter(Boolean).join(' ')) || undefined,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true, person: rowToCorporationPerson(data as Record<string, unknown>) });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id, personId } = await params;
  const supabase = await getSupabaseServerAuthClient();
  const { data: deleted } = await supabase
    .from('corporation_persons')
    .select('first_name, last_name, entity_name')
    .eq('id', Number(personId))
    .eq('corporation_id', id);
  if (!deleted?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await supabase.rpc('corporation_person_delete', { p_id: Number(personId) });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const row = deleted?.[0];
  logAudit({
    firmId: session.firmId,
    entityType: 'Corporation',
    entityId: id,
    action: 'person_deleted',
    fieldChanged: row
      ? ((row.entity_name as string | null) ?? [row.first_name, row.last_name].filter(Boolean).join(' ')) || undefined
      : undefined,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true });
}
