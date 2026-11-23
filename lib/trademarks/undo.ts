import type { Trademark, TrademarkOfficeAction, TrademarkStatus } from '@/types/notion';
import { ROUND_ACTIONS, type TrademarkAction } from './actions';
import { officeActionName, prosecutionStatusFor } from './office-actions';
import { isNational } from '@/lib/trademark-deadlines';

/** The columns an undo may write, with the values it writes. */
export type UndoUpdates = Partial<{
  status: TrademarkStatus;
  filing_date: null;
  noi_date: null;
  noi_received_date: null;
  noi_payment_date: null;
  issuance_notice_date: null;
  issuance_notice_received_date: null;
  issuance_fee_paid_date: null;
  published_date: null;
  opposition_filed_date: null;
  cor_reported_date: null;
  reg_date: null;
  abandonment_mailing_date: null;
  abandonment_received_date: null;
  status_before_abandonment: null;
  revival_filed_date: null;
  revival_declined: false;
  revival_count: number;
  dau_3_filing_date: null;
  dau_3_motex: false;
  dau_3_motex_decision: null;
  dau_3_motex_decided_on: null;
  dau_5_filing_date: null;
  renewal_filing_date: null;
  renewal_dau_filed_date: null;
  renewal_dau_5_filed_date: null;
}>;

/** What an undo does to an Office Action round: remove it, or clear what was recorded on it. */
export type RoundChange =
  | { id: string; delete: true }
  | { id: string; set: Partial<{ response_filed_date: null; motex: false; motex_decision: null; motex_decided_on: null }> };

export type UndoPlan =
  | { ok: true; updates: UndoUpdates; round?: RoundChange }
  | { ok: false; error: string };

/** What each step is called when telling someone to undo it first. */
const STEP_NAME: Record<TrademarkAction, string> = {
  instructions_received: 'instructions',
  mark_as_filed: 'filing',
  noi_received: 'Notice of Allowance',
  noi_paid: '1st publication fee payment',
  issuance_received: 'Notice of Issuance',
  issuance_paid: 'issuance fee payment',
  cor_received: 'registration',
  oa_received: 'Office Action',
  oa_response_filed: 'OA response',
  oa_response_motex: 'OA extension',
  oa_motex_granted: 'grant of the OA extension',
  oa_motex_denied: 'denial of the OA extension',
  published: 'publication',
  opposition_filed: 'opposition',
  abandonment_notice: 'notice of abandonment',
  revival_filed: 'revival',
  revival_declined: 'decision not to revive',
  dau_3_filed: '3-year DAU',
  dau_3_motex_filed: '3-year DAU extension',
  dau_3_motex_granted: 'grant of the 3-year DAU extension',
  dau_3_motex_denied: 'denial of the 3-year DAU extension',
  dau_5_filed: '5-year DAU',
  renewal_filed: 'renewal',
  renewal_dau_filed: 'renewal DAU',
  renewal_dau_5_filed: 'renewal 5-year DAU',
  abandon: 'abandonment',
  protection_granted: 'grant of protection',
};

const ok = (updates: UndoUpdates, round?: RoundChange): UndoPlan => ({ ok: true, updates, ...(round ? { round } : {}) });
const refuse = (error: string): UndoPlan => ({ ok: false, error });

/** Steps recorded after `action` that rest on it, in the order to undo them. */
function later(tm: Trademark, action: TrademarkAction, oa: TrademarkOfficeAction | null): string[] {
  const on: [boolean, string][] = (() => {
    switch (action) {
      case 'mark_as_filed':
        return [
          [!!tm.corReportedDate || tm.status === 'Registered', STEP_NAME.cor_received],
          [!!tm.oppositionFiledDate, STEP_NAME.opposition_filed],
          [!!tm.issuanceFeePaidDate, STEP_NAME.issuance_paid],
          [!!tm.issuanceNoticeDate, STEP_NAME.issuance_received],
          [!!tm.publishedDate, STEP_NAME.published],
          [!!tm.noiPaymentDate, STEP_NAME.noi_paid],
          [!!tm.noiDate, STEP_NAME.noi_received],
          ...[...tm.officeActions].reverse().map((o): [boolean, string] => [true, officeActionName(tm.officeActions, o)]),
          [!!tm.dau3FilingDate, STEP_NAME.dau_3_filed],
          [!!tm.dau3MotexDecision, 'decision on the 3-year DAU extension'],
          [tm.dau3Motex, STEP_NAME.dau_3_motex_filed],
        ];
      case 'noi_received':
        return [[!!tm.noiPaymentDate, STEP_NAME.noi_paid]];
      case 'oa_received':
        return oa ? [[!!oa.responseFiledDate, 'response'], [!!oa.motexDecision, 'decision on the extension'], [oa.motex, 'extension']] : [];
      case 'oa_response_motex':
        return oa ? [[!!oa.motexDecision, 'decision on the extension']] : [];
      case 'dau_3_motex_filed':
        return [[!!tm.dau3MotexDecision, 'decision on the 3-year DAU extension']];
      case 'published':
        return [
          [!!tm.corReportedDate || tm.status === 'Registered', STEP_NAME.cor_received],
          [!!tm.issuanceNoticeDate, STEP_NAME.issuance_received],
          [!!tm.oppositionFiledDate, STEP_NAME.opposition_filed],
        ];
      case 'issuance_received':
        return [[!!tm.corReportedDate || tm.status === 'Registered', STEP_NAME.cor_received]];
      case 'cor_received':
      case 'protection_granted':
        return [
          [!!tm.renewalDau5FiledDate, STEP_NAME.renewal_dau_5_filed],
          [!!tm.renewalDauFiledDate, STEP_NAME.renewal_dau_filed],
          [!!tm.renewalFilingDate, STEP_NAME.renewal_filed],
          [!!tm.dau5FilingDate, STEP_NAME.dau_5_filed],
        ];
      case 'abandonment_notice':
        return [[!!tm.revivalFiledDate, STEP_NAME.revival_filed], [tm.revivalDeclined, STEP_NAME.revival_declined]];
      case 'renewal_filed':
        return [[!!tm.renewalDau5FiledDate, STEP_NAME.renewal_dau_5_filed], [!!tm.renewalDauFiledDate, STEP_NAME.renewal_dau_filed]];
      default:
        return [];
    }
  })();
  return on.filter(([done]) => done).map(([, name]) => name);
}

/** The status a mark returns to when it stops being abandoned and nothing better is known. */
function restoredStatus(tm: Trademark): TrademarkStatus {
  if (tm.regDate || tm.corReportedDate) return 'Registered';
  if (tm.filingDate || !isNational(tm)) return prosecutionStatusFor(tm.officeActions);
  return 'For Filing';
}

/**
 * How to take back a recorded step, worked out from the mark as it stands:
 * the step's date or flag is cleared and the status goes back to where the
 * step found it. A step that a later one rests on (the filing under an
 * Office Action, the registration under a 5-year DAU) is refused until that
 * one is undone.
 *
 * An Office Action step names its round (`officeActionId`); undoing the
 * receipt removes the round, and the status follows the rounds still open.
 *
 * `previousStatus` is what the mark was before the step, when the caller
 * still knows it (the toast right after recording); otherwise the status is
 * worked out from the record.
 */
export function planUndo(
  action: TrademarkAction,
  tm: Trademark,
  previousStatus?: TrademarkStatus | null,
  officeActionId?: string | null,
): UndoPlan {
  const round = action === 'oa_received' || ROUND_ACTIONS.has(action)
    ? tm.officeActions.find((o) => o.id === officeActionId) ?? null
    : null;
  if ((action === 'oa_received' || ROUND_ACTIONS.has(action)) && !round) {
    return refuse('That Office Action is no longer on record.');
  }
  const blockers = later(tm, action, round);
  if (blockers.length > 0) {
    const what = round ? `${officeActionName(tm.officeActions, round)}` : STEP_NAME[action];
    return refuse(`Undo the ${blockers[0]} first — it was recorded after the ${what}.`);
  }
  const abandoned = tm.status === 'Abandoned';
  const statusChange = (expected: TrademarkStatus[], to: TrademarkStatus): UndoPlan | UndoUpdates => {
    if (expected.includes(tm.status)) return { status: to };
    return refuse(abandoned ? 'Restore the mark first — it is abandoned.' : `The mark has moved on since the ${STEP_NAME[action]}.`);
  };
  const withStatus = (expected: TrademarkStatus[], to: TrademarkStatus, rest: UndoUpdates): UndoPlan => {
    const s = statusChange(expected, to);
    return 'ok' in s ? s : ok({ ...rest, ...s });
  };
  /** A round changed: a prosecuting mark's status follows the rounds left open. */
  const withRound = (change: RoundChange, after: Pick<TrademarkOfficeAction, 'responseFiledDate'>[]): UndoPlan => {
    if (abandoned) return refuse('Restore the mark first — it is abandoned.');
    const prosecuting = tm.status === 'Pending' || tm.status === 'Pending - OA';
    return ok(prosecuting ? { status: prosecutionStatusFor(after) } : {}, change);
  };

  switch (action) {
    case 'instructions_received':
      return withStatus(['For Filing'], 'Prelim', {});
    case 'mark_as_filed':
      return withStatus(
        ['Pending', 'Pending - OA'],
        previousStatus === 'Prelim' ? 'Prelim' : 'For Filing',
        { filing_date: null },
      );
    case 'noi_received':
      return ok({ noi_date: null, noi_received_date: null });
    case 'noi_paid':
      return ok({ noi_payment_date: null });
    case 'issuance_received':
      return ok({ issuance_notice_date: null, issuance_notice_received_date: null });
    case 'issuance_paid':
      return ok({ issuance_fee_paid_date: null });
    case 'published':
      return ok({ published_date: null });
    case 'opposition_filed':
      return ok({ opposition_filed_date: null });
    case 'cor_received':
    case 'protection_granted':
      return withStatus(['Registered'], prosecutionStatusFor(tm.officeActions), { cor_reported_date: null, reg_date: null });
    case 'oa_received':
      return withRound({ id: round!.id, delete: true }, tm.officeActions.filter((o) => o.id !== round!.id));
    case 'oa_response_filed':
      return withRound(
        { id: round!.id, set: { response_filed_date: null } },
        tm.officeActions.map((o) => (o.id === round!.id ? { ...o, responseFiledDate: null } : o)),
      );
    case 'oa_response_motex':
      return ok({}, { id: round!.id, set: { motex: false } });
    case 'oa_motex_granted':
    case 'oa_motex_denied':
      if (!round!.motexDecision) return refuse('No decision on that extension is on record.');
      return ok({}, { id: round!.id, set: { motex_decision: null, motex_decided_on: null } });
    case 'abandonment_notice': {
      if (!abandoned) return refuse('The mark is not abandoned.');
      return ok({
        status: tm.statusBeforeAbandonment && tm.statusBeforeAbandonment !== 'Abandoned' ? tm.statusBeforeAbandonment : restoredStatus(tm),
        abandonment_mailing_date: null,
        abandonment_received_date: null,
        status_before_abandonment: null,
      });
    }
    case 'revival_filed':
      if (abandoned || !tm.revivalFiledDate) return refuse('No revival is on record.');
      return ok({ status: 'Abandoned', revival_filed_date: null, revival_count: Math.max(0, tm.revivalCount - 1) });
    case 'revival_declined':
      return ok({ revival_declined: false });
    case 'dau_3_filed':
      return ok({ dau_3_filing_date: null });
    case 'dau_3_motex_filed':
      return ok({ dau_3_motex: false });
    case 'dau_3_motex_granted':
    case 'dau_3_motex_denied':
      if (!tm.dau3MotexDecision) return refuse('No decision on the 3-year DAU extension is on record.');
      return ok({ dau_3_motex_decision: null, dau_3_motex_decided_on: null });
    case 'dau_5_filed':
      return ok({ dau_5_filing_date: null });
    case 'renewal_filed':
      return ok({ renewal_filing_date: null });
    case 'renewal_dau_filed':
      return ok({ renewal_dau_filed_date: null });
    case 'renewal_dau_5_filed':
      return ok({ renewal_dau_5_filed_date: null });
    case 'abandon': {
      if (!abandoned) return refuse('The mark is not abandoned.');
      if (tm.abandonmentMailingDate) return planUndo('abandonment_notice', tm);
      const to: TrademarkStatus =
        previousStatus && previousStatus !== 'Abandoned' ? previousStatus
          : tm.statusBeforeAbandonment && tm.statusBeforeAbandonment !== 'Abandoned' ? tm.statusBeforeAbandonment
          : restoredStatus(tm);
      return ok({ status: to, status_before_abandonment: null });
    }
  }
}
