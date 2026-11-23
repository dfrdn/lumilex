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

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const supabase = await getSupabaseServerAuthClient();
  const { data } = await supabase
    .from('corporation_persons')
    .select('*')
    .eq('corporation_id', id)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  return NextResponse.json({
    people: (data ?? []).map((r) => rowToCorporationPerson(r as Record<string, unknown>)),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.role) return NextResponse.json({ error: 'role is required' }, { status: 400 });

  // The role, in the shape of the corporation_persons view. The firm is the
  // company's, read under the caller's RLS inside the function.
  const row: Record<string, unknown> = { corporation_id: id };
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    const col = PATCH_COLUMNS[k];
    if (col) row[col] = v;
  }
  // A role for someone already on file: the database attaches it to them.
  if (typeof body.personRecordId === 'string') row.person_id = body.personRecordId;

  const supabase = await getSupabaseServerAuthClient();
  const { data: roleId, error: rpcError } = await supabase.rpc('corporation_person_insert', { p_row: row });
  if (rpcError?.code === '23505') {
    return NextResponse.json({ error: duplicatePersonMessage(body as Record<string, unknown>) }, { status: 409 });
  }
  if (rpcError?.code === '42501') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { data, error } = rpcError
    ? { data: null, error: rpcError }
    : await supabase.from('corporation_persons').select('*').eq('id', roleId as number).single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 });
  logAudit({
    firmId: session.firmId,
    entityType: 'Corporation',
    entityId: id,
    action: 'person_added',
    newValue: ((data.entity_name as string | null) ?? [data.first_name, data.last_name].filter(Boolean).join(' ')) || undefined,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true, person: rowToCorporationPerson(data as Record<string, unknown>) });
}
