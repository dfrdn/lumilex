import type { OfficeActionKind, TrademarkFileStep } from '@/types/notion';

export type TrademarkAction =
  | 'instructions_received' | 'mark_as_filed' | 'noi_received' | 'noi_paid'
  | 'issuance_received' | 'issuance_paid'
  | 'cor_received' | 'oa_received' | 'oa_response_filed' | 'oa_response_motex'
  | 'oa_motex_granted' | 'oa_motex_denied'
  | 'published' | 'opposition_filed'
  | 'abandonment_notice' | 'revival_filed' | 'revival_declined'
  | 'dau_3_filed' | 'dau_3_motex_filed' | 'dau_3_motex_granted' | 'dau_3_motex_denied' | 'dau_5_filed'
  | 'renewal_filed' | 'renewal_dau_filed' | 'renewal_dau_5_filed' | 'abandon'
  | 'protection_granted';

export const TRADEMARK_ACTIONS: ReadonlySet<TrademarkAction> = new Set<TrademarkAction>([
  'instructions_received', 'mark_as_filed', 'noi_received', 'noi_paid',
  'issuance_received', 'issuance_paid',
  'cor_received', 'oa_received', 'oa_response_filed', 'oa_response_motex',
  'oa_motex_granted', 'oa_motex_denied',
  'published', 'opposition_filed',
  'abandonment_notice', 'revival_filed', 'revival_declined',
  'dau_3_filed', 'dau_3_motex_filed', 'dau_3_motex_granted', 'dau_3_motex_denied', 'dau_5_filed',
  'renewal_filed', 'renewal_dau_filed', 'renewal_dau_5_filed', 'abandon',
  'protection_granted',
]);

/**
 * The steps a country designated abroad takes: its office refuses or
 * protects it, and it can be given up. Everything else is Philippine
 * prosecution or upkeep; its own filings are deadlines entered by hand.
 */
export const ABROAD_ACTIONS: ReadonlySet<TrademarkAction> = new Set<TrademarkAction>([
  'oa_received', 'oa_response_filed', 'protection_granted', 'abandon',
]);

/** Steps only a national application takes: a designation is filed through WIPO and pays its fees there. */
export const NATIONAL_ONLY: ReadonlySet<TrademarkAction> = new Set<TrademarkAction>([
  'instructions_received', 'mark_as_filed', 'noi_received', 'noi_paid', 'issuance_received', 'issuance_paid', 'cor_received',
]);

/** Actions recording something IPOPHL sent: they carry the date on the document as well as the day it arrived. */
export const NOTICE_ACTIONS: ReadonlySet<TrademarkAction> = new Set<TrademarkAction>([
  'oa_received', 'noi_received', 'issuance_received', 'abandonment_notice', 'protection_granted',
]);

/**
 * Notices whose day of receipt may be recorded as not yet confirmed (left blank).
 * Nothing counts from that day — the periods run from the date on the document.
 * A grant of protection is not one: its receipt is the COR reported date.
 */
export const UNCONFIRMED_RECEIPT_ACTIONS: ReadonlySet<TrademarkAction> = new Set<TrademarkAction>(
  [...NOTICE_ACTIONS].filter((a) => a !== 'protection_granted'),
);

/** The day to record a notice as received: the day given, or null while it is unconfirmed. */
export function receiptDay(
  action: TrademarkAction,
  on: string,
  unconfirmed: boolean | undefined,
): { ok: true; received: string | null } | { ok: false; error: string } {
  if (!unconfirmed) return { ok: true, received: on };
  if (!UNCONFIRMED_RECEIPT_ACTIONS.has(action)) return { ok: false, error: 'Only the day a notice was received can be left unconfirmed' };
  return { ok: true, received: null };
}

/** The actions that act on one Office Action round, and so name it. */
export const ROUND_ACTIONS: ReadonlySet<TrademarkAction> = new Set<TrademarkAction>([
  'oa_response_filed', 'oa_response_motex', 'oa_motex_granted', 'oa_motex_denied',
]);

/** IPOPHL's answer to a request for extension: which request, and which way it went. */
export const EXTENSION_DECISIONS: Partial<Record<TrademarkAction, { of: 'oa' | 'dau_3'; decision: 'granted' | 'denied' }>> = {
  oa_motex_granted: { of: 'oa', decision: 'granted' },
  oa_motex_denied: { of: 'oa', decision: 'denied' },
  dau_3_motex_granted: { of: 'dau_3', decision: 'granted' },
  dau_3_motex_denied: { of: 'dau_3', decision: 'denied' },
};

/** The action that records IPOPHL's answer, `decision`, to the extension request on `of`. */
export function extensionDecisionAction(of: 'oa' | 'dau_3', decision: 'granted' | 'denied'): TrademarkAction {
  const found = (Object.keys(EXTENSION_DECISIONS) as TrademarkAction[])
    .find((a) => EXTENSION_DECISIONS[a]!.of === of && EXTENSION_DECISIONS[a]!.decision === decision);
  return found!;
}

/** The two buttons that record IPOPHL's answer to an extension request, dated by its order. */
export function extensionDecisionSpecs(of: 'oa' | 'dau_3', officeActionId?: string): ActionSpec[] {
  return (['granted', 'denied'] as const).map((decision) => ({
    action: extensionDecisionAction(of, decision),
    label: decision === 'granted' ? 'Extension granted' : 'Extension denied',
    dateMode: 'one' as const,
    dateLabel: 'Date on IPOPHL’s order',
    primary: false,
    officeActionId,
  }));
}

/**
 * How an action asks for its date: not at all, one date, the COR's two, or —
 * for anything IPOPHL sends — the date on the document (which its periods
 * count from) and the day the firm received it.
 */
export type DateMode = 'none' | 'one' | 'cor' | 'notice';

export interface ActionSpec {
  action: TrademarkAction;
  label: string;
  dateMode: DateMode;
  /** Label for the date field, e.g. "Filed on". */
  dateLabel?: string;
  primary?: boolean;
  /** The round a response or extension is for. */
  officeActionId?: string;
  /** For a new round: the kinds to choose between, the first preselected. */
  roundKinds?: OfficeActionKind[];
  /** For a new round: the response date must be given, as stated on the notice. */
  respondByRequired?: boolean;
}

/** The timeline step a paper uploaded while recording an action is filed under. */
export const ACTION_FILE_STEP: Partial<Record<TrademarkAction, TrademarkFileStep>> = {
  mark_as_filed: 'filing',
  oa_received: 'office_action',
  oa_response_filed: 'oa_response',
  oa_response_motex: 'oa_motex',
  oa_motex_granted: 'oa_motex_decision',
  oa_motex_denied: 'oa_motex_decision',
  noi_received: 'noi',
  noi_paid: 'noi_payment',
  published: 'publication',
  opposition_filed: 'opposition',
  issuance_received: 'issuance',
  issuance_paid: 'issuance_payment',
  cor_received: 'cor',
  protection_granted: 'cor',
  abandonment_notice: 'abandonment',
  revival_filed: 'revival',
  dau_3_filed: 'dau_3',
  dau_3_motex_filed: 'dau_3_motex',
  dau_3_motex_granted: 'dau_3_motex_decision',
  dau_3_motex_denied: 'dau_3_motex_decision',
  dau_5_filed: 'dau_5',
  renewal_filed: 'renewal',
  renewal_dau_filed: 'renewal_dau',
  renewal_dau_5_filed: 'renewal_dau_5',
};

/** The issuance and 2nd publication fees paid — on the Notice of Issuance, or in advance on allowance. */
export const ISSUANCE_PAID: ActionSpec = { action: 'issuance_paid', label: 'Issuance fees paid', dateMode: 'one', dateLabel: 'Paid on', primary: true };

/**
 * The action that satisfies a deadline, by the deadline's label as
 * `upcomingDeadlines` / the deadline dashboard name it. An Office Action
 * response names the round it answers.
 */
export function actionForDeadline(kind: string, officeAction?: { id: string; final: boolean }): ActionSpec | null {
  const filed = (action: TrademarkAction, label: string): ActionSpec =>
    ({ action, label, dateMode: 'one', dateLabel: 'Filed on', primary: true });
  switch (kind) {
    case '1st Publication Fee': return { action: 'noi_paid', label: '1st publication fee paid', dateMode: 'one', dateLabel: 'Paid on', primary: true };
    case 'Issuance Fee':  return ISSUANCE_PAID;
    case 'OA Response':
      return {
        ...filed('oa_response_filed', officeAction?.final ? 'Appeal or compliance filed' : 'Response filed'),
        officeActionId: officeAction?.id,
      };
    case 'Revival':       return filed('revival_filed', 'Revival filed');
    case '3-DAU':         return filed('dau_3_filed', '3-DAU filed');
    case '5-DAU':         return filed('dau_5_filed', '5-DAU filed');
    case 'Renewal':       return filed('renewal_filed', 'Renewal filed');
    case 'Renewal DAU':   return filed('renewal_dau_filed', 'Renewal DAU filed');
    case 'Renewal 5-DAU': return filed('renewal_dau_5_filed', 'Renewal 5-DAU filed');
    default:              return null;
  }
}

/** What a deadline is called in lists, with a final rejection's answer named for what it is. */
export function deadlineLabel(kind: string, officeAction?: { final: boolean }): string {
  if (kind === 'OA Response') return officeAction?.final ? 'Final rejection — appeal or comply' : 'Office Action response';
  if (kind === '1st Publication Fee') return '1st publication fee';
  if (kind === 'Issuance Fee') return 'Issuance and 2nd publication fees';
  if (kind === 'Revival') return 'Revival of the application';
  if (kind === 'IR Renewal') return 'Renewal of the international registration';
  return kind;
}
