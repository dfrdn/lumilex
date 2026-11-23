import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { rowToCorporationPerson } from '@/lib/corporation-row';
import { logAudit, getClientIP } from '@/lib/audit';

/**
 * Edit a person's own details — name, nationality, IDs, address — once, for
 * every role they hold in any company. A rename here renames the person;
 * renaming one role row instead (PATCH people/[roleId]) moves only that role.
 */
const DETAIL_COLUMNS: Record<string, string> = {
  isJuridical: 'is_juridical',
  firstName: 'first_name',
  lastName: 'last_name',
  nationality: 'nationality',
  gender: 'gender',
  residentialAddress: 'residential_address',
  tin: 'tin',
  passportNumber: 'passport_number',
  esapNo: 'esap_no',
  entityName: 'entity_name',
  entityType: 'entity_type',
  entityRegistrationNo: 'entity_registration_no',
  representativeName: 'representative_name',
  representativeTitle: 'representative_title',
};

interface Ctx {
  params: Promise<{ id: string; personRecordId: string }>;
}

export async function PATCH(req: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, personRecordId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

  const update: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    const col = DETAIL_COLUMNS[k];
    if (col) update[col] = col === 'first_name' || col === 'last_name' ? (v ?? '') : v;
  }
  if (!Object.keys(update).length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  update.updated_at = new Date().toISOString();

  const supabase = await getSupabaseServerAuthClient();
  // Only someone who holds a role in this company is editable from its page.
  const { data: holds } = await supabase
    .from('corporation_roles')
    .select('id')
    .eq('corporation_id', id)
    .eq('person_id', personRecordId)
    .limit(1);
  if (!holds?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { error } = await supabase.from('people').update(update).eq('id', personRecordId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data } = await supabase
    .from('corporation_persons')
    .select('*')
    .eq('corporation_id', id)
    .eq('person_id', personRecordId);
  const roles = (data ?? []).map((r) => rowToCorporationPerson(r as Record<string, unknown>));
  const p = roles[0];
  logAudit({
    firmId: session.firmId,
    entityType: 'Corporation',
    entityId: id,
    action: 'person_updated',
    fieldChanged: Object.keys(body as Record<string, unknown>).join(', '),
    newValue: p ? (p.isJuridical ? p.entityName : [p.firstName, p.lastName].filter(Boolean).join(' ')) || undefined : undefined,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true, people: roles });
}
