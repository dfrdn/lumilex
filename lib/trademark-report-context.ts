// Build the placeholder map used to render a trademark client report DOCX
// from a template. Every key listed here is available to template authors
// as `{{key}}` — see TemplateManager docs for the full list.
//
// All values are strings (the placeholder substitution helper requires it);
// missing/null lifecycle dates render as an empty string, NOT "null".

import type { Trademark } from '@/types/notion';
import { oaResponseOwed, refNo, type DeadlineKind } from '@/lib/trademark-deadlines';
import { manilaToday } from '@/lib/dates';

interface ContextInput {
  trademark: Trademark;
  deadlineKind: DeadlineKind;
  deadlineDue: string; // YYYY-MM-DD
  senderName?: string;
  /** The firm's own name, from `branding.documentName`. Blank renders blank. */
  firmName: string;
}

function s(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

/**
 * The Office Action a report is about: for a response deadline, the round
 * that deadline answers; otherwise the latest one on record.
 */
function reportedOfficeAction(t: Trademark, kind: DeadlineKind, due: string) {
  const oas = t.officeActions;
  if (kind === 'OA Response') {
    const match = oas.find((o) => !o.responseFiledDate && oaResponseOwed(o).due === due);
    if (match) return match;
  }
  return oas[oas.length - 1] ?? null;
}

export function buildTrademarkPlaceholders(input: ContextInput): Record<string, string> {
  const { trademark: t, deadlineKind, deadlineDue, senderName, firmName } = input;
  const oa = reportedOfficeAction(t, deadlineKind, deadlineDue);
  return {
    // Mark identity
    mark: s(t.mark),
    mark_classes: t.classes.join(', '),
    country: s(t.country),
    ref_no: refNo(t),
    reg_no: s(t.regIrNo),
    owner: s(t.owner),
    type: s(t.type),

    // Client
    client_name: s(t.clientName),
    client_contact: s(t.contactEmail),
    matter_name: s(t.matterName),

    // Lifecycle dates (raw strings; templates can format if needed)
    filing_date: s(t.filingDate),
    noi_date: s(t.noiDate),
    noi_payment_date: s(t.noiPaymentDate),
    // The Office Action's own date (its mailing date), which its period counts from.
    oa_receipt_date: s(oa?.mailingDate),
    oa_received_date: s(oa?.receivedDate),
    oa_title: s(oa?.title),
    oa_response_filed_date: s(oa?.responseFiledDate),
    published_date: s(t.publishedDate),
    issuance_notice_date: s(t.issuanceNoticeDate),
    issuance_fee_paid_date: s(t.issuanceFeePaidDate),
    reg_date: s(t.regDate),
    cor_reported_date: s(t.corReportedDate),

    // Deadline being reported
    deadline_kind: deadlineKind,
    deadline_due: deadlineDue,

    // Letterhead
    today: manilaToday(),
    firm_name: firmName,
    sender_name: s(senderName),
  };
}

/** Keys this helper auto-fills. Templates referencing other keys must have
 * them supplied explicitly via the modal's per-deadline placeholder editor. */
export const AUTO_FILLED_KEYS: ReadonlySet<string> = new Set([
  'mark', 'mark_classes', 'country', 'ref_no', 'reg_no', 'owner', 'type',
  'client_name', 'client_contact', 'matter_name',
  'filing_date', 'noi_date', 'noi_payment_date',
  'oa_receipt_date', 'oa_received_date', 'oa_title', 'oa_response_filed_date', 'published_date',
  'issuance_notice_date', 'issuance_fee_paid_date',
  'reg_date', 'cor_reported_date',
  'deadline_kind', 'deadline_due',
  'today', 'firm_name', 'sender_name',
]);
