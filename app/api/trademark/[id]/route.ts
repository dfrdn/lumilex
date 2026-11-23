import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { TRADEMARK_SELECT, rowToTrademark } from '@/lib/trademark-row';
import { logAudit, getClientIP } from '@/lib/audit';
import { manilaToday } from '@/lib/dates';
import { changePortalVisible, parsePortalSwitch } from '@/lib/portal/switch-access';

// Whitelist of columns the PATCH endpoint will accept. Anything not in this
// list is silently dropped. Status transitions go through the dedicated
// /action endpoint so we can validate them — direct status writes via PATCH
// are NOT allowed.
const PATCHABLE: Record<string, true> = {
  mark: true,
  type: true,
  classes: true,
  goods_services: true,
  country: true,
  owner: true,
  contact_email: true,
  reg_ir_no: true,
  ir_date: true,
  designation_date: true,
  dau_5_due_date: true,
  renewal_due_date: true,
  renewal_dau_due_date: true,
  renewal_dau_5_due_date: true,
  local_agent: true,
  refusal_period_months: true,
  notes: true,
  billing_instructions: true,
  last_incident: true,
  filing_date: true,
  noi_date: true,
  noi_received_date: true,
  noi_payment_date: true,
  issuance_notice_date: true,
  issuance_notice_received_date: true,
  issuance_fee_paid_date: true,
  published_date: true,
  opposition_filed_date: true,
  reg_date: true,
  cor_reported_date: true,
  abandonment_mailing_date: true,
  abandonment_received_date: true,
  revival_filed_date: true,
  dau_3_filing_date: true,
  dau_5_filing_date: true,
  renewal_filing_date: true,
  renewal_dau_filed_date: true,
  renewal_dau_5_filed_date: true,
  nudge_1: true,
  nudge_2: true,
  nudge_3: true,
  dau_3_motex: true,
  gpoa_status: true,
  gpoa_filed_date: true,
  // The mark's own client; its name, code and index follow in the database.
  client_id: true,
};

const DATE_COLUMNS = new Set([
  'filing_date', 'noi_date', 'noi_received_date', 'noi_payment_date', 'published_date', 'opposition_filed_date',
  'issuance_notice_date', 'issuance_notice_received_date', 'issuance_fee_paid_date',
  'reg_date', 'cor_reported_date', 'abandonment_mailing_date', 'abandonment_received_date', 'revival_filed_date',
  'dau_3_filing_date', 'dau_5_filing_date',
  'renewal_filing_date', 'renewal_dau_filed_date', 'renewal_dau_5_filed_date', 'gpoa_filed_date',
  'ir_date', 'designation_date', 'dau_5_due_date', 'renewal_due_date', 'renewal_dau_due_date', 'renewal_dau_5_due_date',
]);

/** A designation's upkeep due dates, entered by hand — the only dates here that lie ahead. */
const DUE_COLUMNS = new Set(['dau_5_due_date', 'renewal_due_date', 'renewal_dau_due_date', 'renewal_dau_5_due_date']);

const CAMEL_TO_SNAKE: Record<string, string> = {
  contactEmail: 'contact_email',
  regIrNo: 'reg_ir_no',
  irDate: 'ir_date',
  designationDate: 'designation_date',
  dau5DueDate: 'dau_5_due_date',
  renewalDueDate: 'renewal_due_date',
  renewalDauDueDate: 'renewal_dau_due_date',
  renewalDau5DueDate: 'renewal_dau_5_due_date',
  localAgent: 'local_agent',
  refusalPeriodMonths: 'refusal_period_months',
  billingInstructions: 'billing_instructions',
  lastIncident: 'last_incident',
  goodsServices: 'goods_services',
  filingDate: 'filing_date',
  noiDate: 'noi_date',
  noiReceivedDate: 'noi_received_date',
  noiPaymentDate: 'noi_payment_date',
  issuanceNoticeDate: 'issuance_notice_date',
  issuanceNoticeReceivedDate: 'issuance_notice_received_date',
  issuanceFeePaidDate: 'issuance_fee_paid_date',
  publishedDate: 'published_date',
  oppositionFiledDate: 'opposition_filed_date',
  regDate: 'reg_date',
  corReportedDate: 'cor_reported_date',
  abandonmentMailingDate: 'abandonment_mailing_date',
  abandonmentReceivedDate: 'abandonment_received_date',
  revivalFiledDate: 'revival_filed_date',
  dau3FilingDate: 'dau_3_filing_date',
  dau5FilingDate: 'dau_5_filing_date',
  renewalFilingDate: 'renewal_filing_date',
  renewalDauFiledDate: 'renewal_dau_filed_date',
  renewalDau5FiledDate: 'renewal_dau_5_filed_date',
  nudge1: 'nudge_1',
  nudge2: 'nudge_2',
  nudge3: 'nudge_3',
  dau3Motex: 'dau_3_motex',
  gpoaStatus: 'gpoa_status',
  gpoaFiledDate: 'gpoa_filed_date',
  clientId: 'client_id',
};

function isGoodsServices(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.entries(v).every(([k, text]) => /^([1-9]|[1-3]\d|4[0-5])$/.test(k) && typeof text === 'string');
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const portalSwitch = parsePortalSwitch(body as Record<string, unknown>);
  if (portalSwitch) {
    if ('error' in portalSwitch) return NextResponse.json({ error: portalSwitch.error }, { status: 400 });
    const authed = await getSupabaseServerAuthClient();
    const { data: mark } = await authed.from('trademarks').select('id').eq('id', id).maybeSingle();
    if (!mark) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const result = await changePortalVisible(
      getServiceDbForFirm(session.firmId),
      'trademark',
      id,
      portalSwitch.visible,
      { firmId: session.firmId, personId: session.user.notionUserId, role: session.user.role },
      getClientIP(req),
    );
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    const { data: switched, error: readError } = await authed.from('trademarks').select(TRADEMARK_SELECT).eq('id', id).single();
    if (readError || !switched) return NextResponse.json({ error: readError?.message ?? 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true, trademark: rowToTrademark(switched) });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: Record<string, any> = {};
  for (const [k, v] of Object.entries(body)) {
    const col = CAMEL_TO_SNAKE[k] ?? k;
    if (!PATCHABLE[col]) continue;
    if (DATE_COLUMNS.has(col) && v !== null && !(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))) {
      return NextResponse.json({ error: `${k} must be a YYYY-MM-DD date` }, { status: 400 });
    }
    if (col === 'goods_services' && !isGoodsServices(v)) {
      return NextResponse.json({ error: 'goodsServices must map class numbers to text' }, { status: 400 });
    }
    if (col === 'refusal_period_months' && v !== 12 && v !== 18) {
      return NextResponse.json({ error: 'refusalPeriodMonths must be 12 or 18' }, { status: 400 });
    }
    if (DATE_COLUMNS.has(col) && !DUE_COLUMNS.has(col) && typeof v === 'string' && v > manilaToday()) {
      return NextResponse.json({ error: 'That date is in the future' }, { status: 400 });
    }
    updates[col] = v;
  }

  if ('client_id' in updates) {
    if (typeof updates.client_id !== 'string' || !updates.client_id) {
      return NextResponse.json({ error: 'Choose a client' }, { status: 400 });
    }
    const { data: client } = await (await getSupabaseServerAuthClient())
      .from('clients').select('notion_id').eq('notion_id', updates.client_id).maybeSingle();
    if (!client) return NextResponse.json({ error: 'That client does not exist' }, { status: 400 });
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();

  // A designation's own dates: none of them belongs on a national application, and it can't be designated before its IR.
  const MADRID_ONLY = ['ir_date', 'designation_date', ...DUE_COLUMNS];
  if (MADRID_ONLY.some((c) => c in updates)) {
    const { data: mark } = await supabase.from('trademarks').select('origin, ir_date, designation_date').eq('id', id).maybeSingle();
    if (!mark) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const own = (col: string) => (mark.origin === 'madrid_in' ? true : col === 'designation_date' && mark.origin !== 'national');
    const misplaced = MADRID_ONLY.find((c) => c in updates && !own(c));
    if (misplaced) {
      return NextResponse.json({ error: 'That date is kept only for a designation of the Philippines under the Madrid Protocol.' }, { status: 400 });
    }
    const irDate = 'ir_date' in updates ? updates.ir_date : mark.ir_date;
    const designated = 'designation_date' in updates ? updates.designation_date : mark.designation_date;
    if (irDate && designated && designated < irDate) {
      return NextResponse.json({ error: 'The designation date is before the international registration.' }, { status: 400 });
    }
  }

  const changedDates = Object.keys(updates).filter((c) => DATE_COLUMNS.has(c));
  const { data: before } = changedDates.length
    ? await supabase.from('trademarks').select(changedDates.join(',')).eq('id', id).maybeSingle()
    : { data: null };

  // A decision answers the extension request, so withdrawing the request takes it too.
  if (updates.dau_3_motex === false) {
    updates.dau_3_motex_decision = null;
    updates.dau_3_motex_decided_on = null;
  }
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('trademarks')
    .update(updates)
    .eq('id', id)
    .select(TRADEMARK_SELECT)
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Not found' }, { status: 404 });
  }

  if ('client_id' in updates) {
    logAudit({
      firmId: session.firmId,
      entityType: 'Trademark',
      entityId: id,
      entityName: data.mark ?? undefined,
      action: 'updated',
      fieldChanged: 'client',
      newValue: data.client_name ?? undefined,
      performedBy: session.user.notionUserId,
      ipAddress: getClientIP(req),
    });
  }

  const prior = (before ?? {}) as Record<string, string | null>;
  for (const col of changedDates) {
    if (prior[col] === updates[col]) continue;
    logAudit({
      firmId: session.firmId,
      entityType: 'Trademark',
      entityId: id,
      entityName: data.mark ?? undefined,
      action: 'updated',
      fieldChanged: col,
      oldValue: prior[col] ?? undefined,
      newValue: updates[col] ?? undefined,
      performedBy: session.user.notionUserId,
      ipAddress: getClientIP(req),
    });
  }

  return NextResponse.json({ ok: true, trademark: rowToTrademark(data) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  if (!role || !['admin', 'super_user', 'partner'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const supabase = await getSupabaseServerAuthClient();
  const { error } = await supabase.from('trademarks').delete().eq('id', id);
  // 23503: the mark is the basic mark of an international registration that still designates countries.
  if (error?.code === '23503') {
    return NextResponse.json({ error: 'This mark carries an international registration — delete its designated countries first.' }, { status: 409 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
