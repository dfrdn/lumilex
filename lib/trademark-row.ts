// Shared row → object mapping for trademarks. Used by listing/detail queries
// and the API routes so we have one canonical conversion in/out of the DB.

import type {
  ExtensionDecision, GpoaStatus, InternationalRegistration, OfficeActionKind, Trademark, TrademarkFile, TrademarkFileStep, TrademarkLocalDeadline,
  TrademarkOfficeAction, TrademarkOrigin, TrademarkStatus, TrademarkType,
} from '@/types/notion';

/** A mark's international registrations (as basic mark) and its hand-entered local deadlines. */
const MADRID_EMBEDS =
  'trademark_local_deadlines(id, label, due_date, filed_date), ' +
  'international_registrations!international_registrations_base_trademark_id_fkey(id, ir_no, ir_date, application_filed_date, renewal_filing_date, ceased_date, notes)';

/** A designation abroad's international registration, with the Philippine mark it rests on. */
const PARENT_EMBED =
  'parent_registration:international_registrations!trademarks_ir_id_fkey(id, ir_no, ir_date, application_filed_date, renewal_filing_date, ceased_date, notes, ' +
  'base_mark:trademarks!international_registrations_base_trademark_id_fkey(id, mark, status))';

/**
 * Select a mark with its Office Actions and Madrid records. `rowToTrademark`
 * needs the embeds — a mark read without them would look as if it had never
 * had one, and their deadlines would silently vanish.
 */
export const TRADEMARK_SELECT = `*, trademark_office_actions(*), ${MADRID_EMBEDS}, ${PARENT_EMBED}`;

/**
 * The columns and embeds that say whether a mark is a Madrid designation and
 * carry its dates, its international registrations and its local deadlines.
 * Every read that feeds the deadline math selects them, or a designation's
 * deadlines would be counted as a national application's.
 */
export const MADRID_COLUMNS =
  'origin, ir_date, designation_date, dau_5_due_date, renewal_due_date, renewal_dau_due_date, renewal_dau_5_due_date, ' +
  `ir_id, local_agent, refusal_period_months, ${MADRID_EMBEDS}`;

type MadridFields = Pick<
  Trademark,
  | 'origin' | 'irDate' | 'designationDate' | 'dau5DueDate' | 'renewalDueDate' | 'renewalDauDueDate' | 'renewalDau5DueDate'
  | 'irId' | 'localAgent' | 'refusalPeriodMonths' | 'localDeadlines' | 'internationalRegistrations'
>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function madridFields(row: any): MadridFields {
  if (!('origin' in row) || !Array.isArray(row.trademark_local_deadlines) || !Array.isArray(row.international_registrations)) {
    throw new Error('Select MADRID_COLUMNS with the mark, or a designation reads as a national application');
  }
  return {
    origin: (row.origin as TrademarkOrigin | null) ?? 'national',
    irDate: row.ir_date ?? null,
    designationDate: row.designation_date ?? null,
    dau5DueDate: row.dau_5_due_date ?? null,
    renewalDueDate: row.renewal_due_date ?? null,
    renewalDauDueDate: row.renewal_dau_due_date ?? null,
    renewalDau5DueDate: row.renewal_dau_5_due_date ?? null,
    irId: row.ir_id ?? null,
    localAgent: row.local_agent ?? null,
    refusalPeriodMonths: row.refusal_period_months === 12 || row.refusal_period_months === 18 ? row.refusal_period_months : null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    localDeadlines: [...row.trademark_local_deadlines].sort((a: any, b: any) => a.due_date.localeCompare(b.due_date)).map(rowToLocalDeadline),
    internationalRegistrations: row.international_registrations.map(rowToInternationalRegistration),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToLocalDeadline(row: any): TrademarkLocalDeadline {
  return { id: row.id, label: row.label, dueDate: row.due_date, filedDate: row.filed_date ?? null };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToInternationalRegistration(row: any): InternationalRegistration {
  return {
    id: row.id,
    irNo: row.ir_no ?? null,
    irDate: row.ir_date ?? null,
    applicationFiledDate: row.application_filed_date ?? null,
    renewalFilingDate: row.renewal_filing_date ?? null,
    ceasedDate: row.ceased_date ?? null,
    notes: row.notes ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToOfficeAction(row: any): TrademarkOfficeAction {
  return {
    id: row.id,
    trademarkId: row.trademark_id,
    kind: (row.kind as OfficeActionKind) ?? 'office_action',
    title: row.title ?? null,
    mailingDate: row.mailing_date,
    receivedDate: row.received_date ?? null,
    respondBy: row.respond_by ?? null,
    motex: !!row.motex,
    motexDecision: (row.motex_decision as ExtensionDecision | null) ?? null,
    motexDecidedOn: row.motex_decided_on ?? null,
    responseFiledDate: row.response_filed_date ?? null,
  };
}

/** Oldest first: by mailing date, then by when they were recorded. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowsToOfficeActions(rows: any[]): TrademarkOfficeAction[] {
  return [...rows]
    .sort((a, b) => a.mailing_date.localeCompare(b.mailing_date) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
    .map(rowToOfficeAction);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToTrademarkFile(row: any): TrademarkFile {
  return {
    id: row.id,
    trademarkId: row.trademark_id,
    name: row.name,
    storagePath: row.storage_path,
    mimeType: row.mime_type ?? null,
    sizeBytes: row.size_bytes ?? null,
    uploadedBy: row.uploaded_by ?? null,
    uploadedAt: row.uploaded_at,
    step: (row.step as TrademarkFileStep | null) ?? null,
    officeActionId: row.office_action_id ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToTrademark(row: any): Trademark {
  if (!Array.isArray(row.trademark_office_actions)) {
    throw new Error('rowToTrademark needs the trademark_office_actions embed — select with TRADEMARK_SELECT');
  }
  return {
    id: row.id,
    matterId: row.matter_id ?? null,
    matterName: row.matter_name ?? '',
    clientId: row.client_id ?? null,
    clientName: row.client_name ?? '',
    clientCode: row.client_code ?? null,
    clientIndex: row.client_index ?? 0,

    mark: row.mark ?? '',
    type: (row.type as TrademarkType | null) ?? null,
    classes: row.classes ?? [],
    goodsServices: row.goods_services ?? {},
    country: row.country ?? 'PH',
    owner: row.owner ?? null,
    contactEmail: row.contact_email ?? null,
    regIrNo: row.reg_ir_no ?? null,
    ...madridFields(row),
    parentRegistration: row.parent_registration
      ? {
        ...rowToInternationalRegistration(row.parent_registration),
        baseMark: row.parent_registration.base_mark
          ? { id: row.parent_registration.base_mark.id, mark: row.parent_registration.base_mark.mark ?? '', status: row.parent_registration.base_mark.status }
          : null,
      }
      : null,

    markImagePath: row.mark_image_path ?? null,

    gpoaStatus: (row.gpoa_status as GpoaStatus) ?? 'To Follow',
    gpoaFiledDate: row.gpoa_filed_date ?? null,
    portalVisible: !!row.portal_visible,
    gpoaFilePath: row.gpoa_file_path ?? null,

    status: (row.status as TrademarkStatus) ?? 'Prelim',

    filingDate: row.filing_date ?? null,
    noiDate: row.noi_date ?? null,
    noiReceivedDate: row.noi_received_date ?? null,
    noiPaymentDate: row.noi_payment_date ?? null,
    issuanceNoticeDate: row.issuance_notice_date ?? null,
    issuanceNoticeReceivedDate: row.issuance_notice_received_date ?? null,
    issuanceFeePaidDate: row.issuance_fee_paid_date ?? null,
    publishedDate: row.published_date ?? null,
    oppositionFiledDate: row.opposition_filed_date ?? null,
    regDate: row.reg_date ?? null,
    corReportedDate: row.cor_reported_date ?? null,

    officeActions: rowsToOfficeActions(row.trademark_office_actions),

    abandonmentMailingDate: row.abandonment_mailing_date ?? null,
    abandonmentReceivedDate: row.abandonment_received_date ?? null,
    revivalFiledDate: row.revival_filed_date ?? null,
    revivalDeclined: !!row.revival_declined,
    revivalCount: row.revival_count ?? 0,
    statusBeforeAbandonment: (row.status_before_abandonment as TrademarkStatus | null) ?? null,

    dau3FilingDate: row.dau_3_filing_date ?? null,
    dau3Motex: !!row.dau_3_motex,
    dau3MotexDecision: (row.dau_3_motex_decision as ExtensionDecision | null) ?? null,
    dau3MotexDecidedOn: row.dau_3_motex_decided_on ?? null,
    dau5FilingDate: row.dau_5_filing_date ?? null,
    renewalFilingDate: row.renewal_filing_date ?? null,
    renewalDauFiledDate: row.renewal_dau_filed_date ?? null,
    renewalDau5FiledDate: row.renewal_dau_5_filed_date ?? null,

    nudge1: !!row.nudge_1,
    nudge2: !!row.nudge_2,
    nudge3: !!row.nudge_3,

    notes: row.notes ?? null,
    billingInstructions: row.billing_instructions ?? null,
    lastIncident: row.last_incident ?? null,

    createdAt: row.created_at ?? '',
    updatedAt: row.updated_at ?? '',
  };
}
