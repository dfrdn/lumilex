import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { TRADEMARK_SELECT, rowToTrademark } from '@/lib/trademark-row';
import { logAudit, getClientIP } from '@/lib/audit';
import { validateBody, trademarkActionSchema } from '@/lib/validation';
import { openOfficeActions, prosecutionStatusFor } from '@/lib/trademarks/office-actions';
import { ABROAD_ACTIONS, EXTENSION_DECISIONS, NATIONAL_ONLY, NOTICE_ACTIONS, receiptDay, type TrademarkAction } from '@/lib/trademarks/actions';
import { designationStart, isAbroad, isNational } from '@/lib/trademark-deadlines';
import type { TrademarkStatus } from '@/types/notion';
import { manilaToday } from '@/lib/dates';

const PROSECUTING: TrademarkStatus[] = ['Pending', 'Pending - OA'];

// Allowed source statuses per action. Empty array = any status.
const ALLOWED_FROM: Record<TrademarkAction, TrademarkStatus[]> = {
  instructions_received: ['Prelim'],
  mark_as_filed:         ['Prelim', 'For Filing'],
  noi_received:          PROSECUTING,
  noi_paid:              PROSECUTING,
  issuance_received:     PROSECUTING,
  issuance_paid:         PROSECUTING,
  cor_received:          PROSECUTING,
  // Another round can arrive while one is open, and after allowance (Rule 701).
  oa_received:           PROSECUTING,
  oa_response_filed:     PROSECUTING,
  oa_response_motex:     PROSECUTING,
  // IPOPHL's answer can come after the mark was declared abandoned for want of a response.
  oa_motex_granted:      [...PROSECUTING, 'Abandoned'],
  oa_motex_denied:       [...PROSECUTING, 'Abandoned'],
  published:             PROSECUTING,
  opposition_filed:      PROSECUTING,
  // A registered mark can be declared abandoned for an unpaid issuance fee (Rule 703).
  abandonment_notice:    ['Pending', 'Pending - OA', 'Registered'],
  revival_filed:         ['Abandoned'],
  revival_declined:      ['Abandoned'],
  // The 3-year DAU runs from the filing date, so it can fall due before registration.
  dau_3_filed:           ['Pending', 'Pending - OA', 'Registered'],
  dau_3_motex_filed:     ['Pending', 'Pending - OA', 'Registered'],
  dau_3_motex_granted:   ['Pending', 'Pending - OA', 'Registered'],
  dau_3_motex_denied:    ['Pending', 'Pending - OA', 'Registered'],
  dau_5_filed:           ['Registered'],
  renewal_filed:         ['Registered'],
  renewal_dau_filed:     ['Registered'],
  renewal_dau_5_filed:   ['Registered'],
  abandon:               ['Prelim', 'For Filing', 'Pending', 'Pending - OA', 'Registered'],
  // A designation's statement of grant of protection: its registration in the Philippines.
  protection_granted:    PROSECUTING,
};

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const validation = await validateBody(req, trademarkActionSchema);
  if (!validation.success) return validation.response;
  const body = validation.data;
  const { action } = body;
  const { id } = await params;

  // The day the event happened — the person may be recording it after the
  // fact. Defaults to today; a future date is refused.
  const today = manilaToday();
  for (const [key, v] of [['date', body.date], ['regDate', body.regDate], ['mailingDate', body.mailingDate]] as const) {
    if (v && v > today) return bad(`That date is in the future (${key})`);
  }
  const on = body.date ?? today;
  const receipt = receiptDay(action, on, body.receivedUnconfirmed);
  if (!receipt.ok) return bad(receipt.error);
  const { received } = receipt;
  if (NOTICE_ACTIONS.has(action)) {
    if (!body.mailingDate) return bad('Give the date on the document');
    if (received && body.mailingDate > received) return bad('The date on the document is after the day it was received');
  }
  if (body.respondBy && body.mailingDate && body.respondBy <= body.mailingDate) {
    return bad('The response date must be after the date on the document');
  }

  const supabase = await getSupabaseServerAuthClient();
  const { data: currentRow, error: getErr } = await supabase
    .from('trademarks').select(TRADEMARK_SELECT).eq('id', id).single();
  if (getErr || !currentRow) return bad('Not found', 404);
  const current = rowToTrademark(currentRow);

  // Either kind of designation: the Philippines in a foreign IR, or a country in one of ours.
  const designation = !isNational(current);
  if (designation && NATIONAL_ONLY.has(action)) {
    return bad('That step is for an application filed with IPOPHL, not a designation under the Madrid Protocol.', 409);
  }
  if (isAbroad(current) && !ABROAD_ACTIONS.has(action)) {
    return bad('That step is Philippine prosecution or upkeep; a country designated abroad records its own filings as local deadlines.', 409);
  }
  if (!designation && action === 'protection_granted') {
    return bad('Only a designation under the Madrid Protocol is granted protection — record the COR instead.', 409);
  }
  const designatedOn = designation ? designationStart(current) : null;
  if (action === 'protection_granted' && designatedOn && body.mailingDate && body.mailingDate < designatedOn) {
    return bad(`The grant of protection is dated before ${isAbroad(current) ? 'the country' : 'the Philippines'} was designated.`);
  }
  if (action === 'oa_received') {
    if (designation && body.kind === 'office_action') return bad('A designation is refused provisionally — record a provisional refusal.');
    if (!designation && body.kind === 'provisional_refusal') return bad('A provisional refusal is for a designation under the Madrid Protocol.');
    // No Philippine period for answering a designation's refusal is on record yet, so it comes off the notice.
    if (designation && !body.respondBy) return bad('Give the response date stated on the notice.');
  }

  const allowed = ALLOWED_FROM[action];
  if (!allowed.includes(current.status)) {
    return bad(`Action "${action}" not allowed from status "${current.status}"`, 409);
  }

  // The round a response or extension is for: the one named, or the only one open.
  let roundId: string | null = null;
  if (action === 'oa_response_filed' || action === 'oa_response_motex') {
    const open = openOfficeActions(current.officeActions);
    const round = body.officeActionId
      ? current.officeActions.find((o) => o.id === body.officeActionId)
      : open.length === 1 ? open[0] : null;
    if (!round) {
      return bad(open.length > 1 ? 'More than one Office Action is open — say which one this is for.' : 'No open Office Action to record this against.', 409);
    }
    if (round.responseFiledDate) return bad('That Office Action has already been answered.', 409);
    roundId = round.id;
  }

  // IPOPHL's answer to a request for extension: only to one on record, and only once.
  const decided = EXTENSION_DECISIONS[action];
  if (decided?.of === 'oa') {
    const awaiting = current.officeActions.filter((o) => o.motex && !o.motexDecision);
    const round = body.officeActionId
      ? current.officeActions.find((o) => o.id === body.officeActionId)
      : awaiting.length === 1 ? awaiting[0] : null;
    if (!round) {
      return bad(awaiting.length > 1 ? 'More than one extension is awaiting a decision — say which one this is for.' : 'No extension request is on record for this.', 409);
    }
    if (!round.motex) return bad('No extension was filed for that Office Action.', 409);
    if (round.motexDecision) return bad(`IPOPHL’s decision on that extension is already recorded (${round.motexDecision}).`, 409);
    if (on < round.mailingDate) return bad('IPOPHL’s order is dated before the Office Action it extends.');
    roundId = round.id;
  }
  if (decided?.of === 'dau_3') {
    if (!current.dau3Motex) return bad('No extension was filed for the 3-year DAU.', 409);
    if (current.dau3MotexDecision) return bad(`IPOPHL’s decision on the 3-year DAU extension is already recorded (${current.dau3MotexDecision}).`, 409);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: Record<string, any> = { updated_at: new Date().toISOString() };

  switch (action) {
    case 'instructions_received':
      updates.status = 'For Filing';
      break;
    case 'mark_as_filed':
      updates.filing_date = on;
      updates.status = 'Pending';
      break;
    case 'noi_received':
      updates.noi_date = body.mailingDate;
      updates.noi_received_date = received;
      break;
    case 'noi_paid':
      updates.noi_payment_date = on;
      break;
    case 'issuance_received':
      updates.issuance_notice_date = body.mailingDate;
      updates.issuance_notice_received_date = received;
      break;
    case 'issuance_paid':
      updates.issuance_fee_paid_date = on;
      break;
    case 'published':
      updates.published_date = on;
      break;
    case 'opposition_filed':
      updates.opposition_filed_date = on;
      break;
    case 'cor_received':
      updates.cor_reported_date = on;
      // The registration date printed on the certificate anchors every DAU and
      // renewal deadline, so take it when given rather than the receipt date.
      if (body.regDate) updates.reg_date = body.regDate;
      else if (!current.regDate) updates.reg_date = on;
      updates.status = 'Registered';
      break;
    case 'protection_granted':
      // Every later deadline counts from the date on the statement.
      updates.reg_date = body.mailingDate;
      updates.cor_reported_date = on;
      updates.status = 'Registered';
      break;
    case 'oa_received': {
      const { data: inserted, error } = await supabase
        .from('trademark_office_actions')
        .insert({
          trademark_id: id,
          firm_id: session.firmId,
          kind: body.kind ?? (designation ? 'provisional_refusal' : 'office_action'),
          title: body.title || null,
          mailing_date: body.mailingDate,
          received_date: received,
          respond_by: body.respondBy ?? null,
          created_by: session.user.notionUserId,
        })
        .select('id')
        .single();
      if (error || !inserted) return bad(error?.message ?? 'Could not record the Office Action', 500);
      roundId = inserted.id as string;
      updates.status = 'Pending - OA';
      break;
    }
    case 'oa_response_filed': {
      const { error } = await supabase
        .from('trademark_office_actions')
        .update({ response_filed_date: on, updated_at: updates.updated_at })
        .eq('id', roundId!);
      if (error) return bad(error.message, 500);
      updates.status = prosecutionStatusFor(
        current.officeActions.map((o) => (o.id === roundId ? { ...o, responseFiledDate: on } : o)),
      );
      break;
    }
    case 'oa_response_motex': {
      const { error } = await supabase
        .from('trademark_office_actions')
        .update({ motex: true, updated_at: updates.updated_at })
        .eq('id', roundId!);
      if (error) return bad(error.message, 500);
      break;
    }
    case 'oa_motex_granted':
    case 'oa_motex_denied': {
      const { error } = await supabase
        .from('trademark_office_actions')
        .update({ motex_decision: decided!.decision, motex_decided_on: on, updated_at: updates.updated_at })
        .eq('id', roundId!);
      if (error) return bad(error.message, 500);
      break;
    }
    case 'dau_3_motex_granted':
    case 'dau_3_motex_denied':
      updates.dau_3_motex_decision = decided!.decision;
      updates.dau_3_motex_decided_on = on;
      break;
    case 'abandonment_notice':
      updates.status = 'Abandoned';
      updates.status_before_abandonment = current.status;
      updates.abandonment_mailing_date = body.mailingDate;
      updates.abandonment_received_date = received;
      updates.revival_filed_date = null;
      updates.revival_declined = false;
      break;
    case 'revival_filed':
      if (!current.abandonmentMailingDate) return bad('There is no notice of abandonment to revive from.', 409);
      updates.revival_filed_date = on;
      updates.revival_count = current.revivalCount + 1;
      updates.status =
        current.statusBeforeAbandonment && current.statusBeforeAbandonment !== 'Abandoned'
          ? current.statusBeforeAbandonment
          : current.regDate ? 'Registered' : prosecutionStatusFor(current.officeActions);
      break;
    case 'revival_declined':
      if (!current.abandonmentMailingDate) return bad('There is no notice of abandonment to decline a revival of.', 409);
      updates.revival_declined = true;
      break;
    case 'dau_3_filed':
      updates.dau_3_filing_date = on;
      break;
    case 'dau_3_motex_filed':
      updates.dau_3_motex = true;
      break;
    case 'dau_5_filed':
      updates.dau_5_filing_date = on;
      break;
    case 'renewal_filed':
      updates.renewal_filing_date = on;
      break;
    case 'renewal_dau_filed':
      updates.renewal_dau_filed_date = on;
      break;
    case 'renewal_dau_5_filed':
      updates.renewal_dau_5_filed_date = on;
      break;
    case 'abandon':
      updates.status = 'Abandoned';
      updates.status_before_abandonment = current.status;
      break;
  }

  const { data, error } = await supabase
    .from('trademarks').update(updates).eq('id', id).select(TRADEMARK_SELECT).single();
  if (error || !data) return bad(error?.message ?? 'Update failed', 500);

  logAudit({
    firmId: session.firmId,
    entityType: 'Trademark',
    entityId: id,
    entityName: current.mark || undefined,
    action: 'updated',
    fieldChanged: action,
    oldValue: current.status,
    newValue: JSON.stringify({ ...updates, updated_at: undefined, ...(roundId ? { officeActionId: roundId } : {}) }),
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true, trademark: rowToTrademark(data), officeActionId: roundId });
}
