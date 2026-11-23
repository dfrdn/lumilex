/**
 * Shared invoice persistence: builds the DOCX/XLSX/PDF, uploads them to
 * Supabase Storage, and either inserts a new invoices row or updates an
 * existing one (regenerate). Reverses and re-applies the billed flags on
 * DTR / reimbursements / matter_expenses so a regenerate cleanly
 * picks up any revisions finance made between the original and the new run.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import { firmStoragePath, getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { generateBillingLetterDocx } from '@/lib/docx/billing-letter';
import { loadDocxBrand } from '@/lib/docx/brand';
import type { AcceptanceFee, BreakdownFeeLine } from '@/lib/billing/breakdown-types';
import { uploadAndConvertToPdf, GraphNotConfiguredError } from '@/lib/microsoft-graph';
import { isFeatureAvailable } from '@/lib/firm/features';
import { getFirmConfig, documentRoot } from '@/lib/firm/config';
import { pesoSymbol, resolveFontSet } from '@/lib/pdf/fonts';
import type { BillingLetterParams, LetterAddressee } from '@/lib/billing/letter-content';
import { loadLetterWording } from '@/lib/billing/wording-store';
import { letterFacts, letterFields, systemTexts } from '@/lib/billing/letter-content';
import type { LetterBasis } from '@/lib/billing/email-blocks';
import { computeEarlyPaymentOffer, type EarlyPaymentOffer } from '@/lib/billing/early-payment';
import { addDays, manilaToday } from '@/lib/dates';
import { billingLetterSigner, type LetterSigner } from '@/lib/billing/signer';
import { generateBillingBreakdownPdf } from '@/lib/pdf/billing-breakdown';
import { loadFirmBrand } from '@/lib/pdf/firm-brand';
import { computeCapAwareFees } from '@/lib/billing/cap-split';
import { formatLetterDate, normalizeLetterDate } from '@/lib/billing/letter-format';
import { invoiceGrossDue } from '@/lib/finance/invoice-amounts';
import { computeDepositSettlement } from '@/lib/finance/deposit-settlement';

export interface InvoiceSettingsSnapshot {
  clientAddress?: string;
  attnName?: string;
  attnTitle?: string;
  throughName?: string;
  engagementDate?: string;
  retainerCap?: number;
  retainerHoursCap?: number;
  monthlyRetainer?: number;
  acceptanceFees?: AcceptanceFee[];
  previousBalance?: number;
  previousBalanceLabel?: string;
  depositOnHand?: number;
  /** When true, this bill settles against the client's advance deposit: the
   *  documents show the deduction and the send flow auto-applies it. */
  settleFromDeposit?: boolean;
  /** Frozen at generation: amount of depositOnHand this bill draws down /
   *  what remains in trust after. The send flow applies exactly this figure. */
  depositApplied?: number;
  depositRemaining?: number;
  includeVAT?: boolean;
  includeLessenFeesNote?: boolean;
  bankName?: string;
  bankAccountNo?: string;
  bankAccountName?: string;
  /** Who signed the letter — the Managing Partner, set at generation. Before
   *  that it carries the firm's configured signer, the fallback when the
   *  roster has no single Managing Partner. */
  signerName?: string;
  /** Write "Atty." before the signatory's name (the firm's setting at generation). */
  signerAtty?: boolean;
  /** What the letter said, frozen for the email (lib/billing/email-blocks.ts). */
  letterBasis?: LetterBasis;
  firmAddress?: string;
  firmAddress2?: string;
  firmTIN?: string;
  /** Recipient overrides — picked up by /api/finance/batch-send. When blank,
   *  falls back to clients.contact_email. */
  clientEmail?: string;
  ccEmails?: string;
  /** Discount inputs (percent). Applied in persist-invoice via line-item
   *  rate adjustment / final total reduction. */
  hourlyDiscountPercent?: string;
  totalDiscountPercent?: string;
  /** Whom the letter is addressed to: a company with an Attention line (the
   *  default), or a person by name. */
  letterAddressee?: LetterAddressee;
  /** Opens the letter as an initial billing statement. */
  initialStatement?: boolean;
  /** Keys of finance's optional paragraphs this letter carries. */
  optionalParagraphs?: string[];
  /** Early-payment discount inputs, from the matter or the bundle override:
   *  percent off the period's legal fees, and how many days after the letter
   *  the client has to pay to earn it. Either blank means no offer. */
  earlyPaymentDiscountPercent?: string;
  earlyPaymentDays?: string;
  /** Frozen at generation: the offer the letter states and a timely payment
   *  later earns (see lib/billing/early-payment.ts). Absent when none. */
  earlyPayment?: EarlyPaymentOffer;
  /** The due date the letter states (YYYY-MM-DD), frozen so the email quotes the same day. */
  dueDate?: string;
  /** Greeting line on the letter. Blank falls back to "Gentlemen/Mesdames:". */
  salutation?: string;
  /** What the bill is for, in place of the billing month ("our billing
   *  statement for …"). Set on off-cycle invoices, which bill named fees rather
   *  than a period. */
  billingPeriodLabel?: string;
}

export interface FeeLinePayload {
  kind: 'retainer' | 'fixed_fee' | 'acceptance' | 'action' | 'milestone' | 'informational_hours' | 'discount' | 'adhoc';
  matterId: string | null;
  matterName: string | null;
  description: string;
  /** Negative for discount lines (a credit against the bill). */
  amount: number;
  quantity?: number;
  sourceIds?: number[];
}

export interface PersistInvoiceParams {
  /** Firm the invoice belongs to — scopes the number allocator and the
   *  storage prefix. Pass a firm-scoped client alongside it. */
  firmId: string;
  clientName: string;
  month: string; // YYYY-MM
  matterId?: string | null;
  matterName?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lineItems: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expenses: any[];
  /** Non-DTR fee lines: retainer, fixed_fee, acceptance, action, milestone. */
  feeLines?: FeeLinePayload[];
  settings: InvoiceSettingsSnapshot;
  generatedByEmail: string;
  /** Stamped on insert only; a regenerate never changes an invoice's kind. */
  invoiceKind?: 'monthly' | 'off_cycle';
  /**
   * If provided, update this invoice in place instead of inserting a new one.
   * The flags on the OLD line_items / expense_items are reversed first, then
   * the row is updated and the new flags applied. Status drops to 'draft'.
   */
  existingInvoice?: {
    id: number;
    invoice_number: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    line_items: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expense_items: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fee_lines?: any[];
    /** Original send date, used to set previously_sent_at on first regen-after-send. */
    sent_date?: string | null;
    previously_sent_at?: string | null;
    revision_count?: number;
  };
}

export interface PersistInvoiceResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoice: any;
  downloadUrls: {
    docx: string | null;
    pdf: string | null;
    breakdownPdf: string | null;
  };
  oneDriveUrl: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dtrIdsFromLineItems(items: any[]): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return items.flatMap((l: any) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (l.entries ?? []).map((e: any) => e.rawDtrId ?? e.id),
  ).filter(Boolean);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function reimbursementIdsFromExpenses(items: any[]): string[] {
  return items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((e: any) => e.source === 'reimbursement' || !e.source)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((e: any) => e.id)
    .filter((id: string) => id && !String(id).startsWith('mexp-'));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function matterExpenseIdsFromExpenses(items: any[]): number[] {
  return items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((e: any) => e.source === 'finance' || (e.id && String(e.id).startsWith('mexp-')))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((e: any) => parseInt(String(e.id).replace('mexp-', '')))
    .filter((id: number) => !isNaN(id));
}

/**
 * Mark every entry of an invoice billed/unbilled — `billed` (dtr / matter
 * expenses / reimbursements), `invoiced` (action entries / milestones), and
 * `acceptance_fee_paid` (matter config) all reflect "is the invoice SENT". A
 * draft leaves them false; marking the invoice sent flips them true; reverting
 * to draft flips them back. Keyed off the invoice's stored snapshots, so this
 * is the ONE place that owns the billed-on-send invariant.
 *
 * Note: reimbursements track client billing on `billed` (like matter_expenses),
 * independent of `reimbursed` (staff paid back). We never touch `reimbursed`
 * here — reimbursing a lawyer/liaison and billing the client are separate acts.
 */
export async function setInvoiceBilledFlags(
  supabase: SupabaseClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoice: { line_items?: any[] | null; expense_items?: any[] | null; fee_lines?: any[] | null },
  sent: boolean,
): Promise<void> {
  const dtrIds = dtrIdsFromLineItems(invoice.line_items ?? []);
  if (dtrIds.length > 0) await supabase.from('dtr').update({ billed: sent }).in('notion_id', dtrIds);

  const reimbIds = reimbursementIdsFromExpenses(invoice.expense_items ?? []);
  if (reimbIds.length > 0) await supabase.from('reimbursements').update({ billed: sent }).in('notion_id', reimbIds);

  const mexpIds = matterExpenseIdsFromExpenses(invoice.expense_items ?? []);
  if (mexpIds.length > 0) await supabase.from('matter_expenses').update({ billed: sent }).in('id', mexpIds);

  const feeLines = invoice.fee_lines ?? [];
  const actionIds = feeLinesByKind(feeLines, 'action')
    .flatMap((f) => f.sourceIds ?? [])
    .filter((id: unknown): id is number => typeof id === 'number');
  if (actionIds.length > 0) await supabase.from('matter_action_entries').update({ invoiced: sent }).in('id', actionIds);

  const msIds = feeLinesByKind(feeLines, 'milestone')
    .flatMap((f) => f.sourceIds ?? [])
    .filter((id: unknown): id is number => typeof id === 'number');
  if (msIds.length > 0) await supabase.from('matter_billing_milestones').update({ invoiced: sent }).in('id', msIds);

  const acceptanceMatterIds = feeLinesByKind(feeLines, 'acceptance')
    .map((f) => f.matterId)
    .filter((id: unknown): id is string => !!id);
  if (acceptanceMatterIds.length > 0) await supabase.from('matter_billing_configs').update({ acceptance_fee_paid: sent }).in('matter_id', acceptanceMatterIds);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function feeLinesByKind(items: any[], kind: string): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (items ?? []).filter((f: any) => f && f.kind === kind);
}

async function generateInvoiceNumber(
  supabase: SupabaseClient,
  firmId: string,
  month: string,
): Promise<string> {
  // Allocate atomically via a per-(firm, month) counter. A count-based number
  // read outside a lock collided two ways: parallel batch runs minted the same
  // number, and any gap made count+1 land on an already-used number.
  const { data, error } = await supabase.rpc('allocate_invoice_number', {
    p_firm_id: firmId,
    p_month: month,
  });
  if (error) {
    throw new Error(`Failed to allocate invoice number: ${error.message}`);
  }
  if (typeof data !== 'string' || !data) {
    throw new Error('Invoice number allocation returned no value');
  }
  return data;
}

/**
 * The client a bundle's matters belong to. A bundle is billed by client name
 * and gathers the matters filed under it; each of those carries its client's
 * id, so the invoice takes that id rather than matching the name to a client
 * record — which failed silently on names that matched none or several, and
 * left the invoice out of the client's portal. Matters that disagree mean the
 * bundle mixes two clients' work, so it isn't billed until that is fixed.
 */
export function clientIdFromMatters(clientName: string, matterClientIds: (string | null)[]): string | null {
  const ids = [...new Set(matterClientIds.filter((id): id is string => !!id))];
  if (ids.length > 1) {
    throw new Error(`The matters billed under "${clientName}" belong to ${ids.length} different client records. Fix the matters' client before generating this invoice.`);
  }
  return ids[0] ?? null;
}

export async function resolveInvoiceClientId(supabase: SupabaseClient, clientName: string): Promise<string | null> {
  const { data: matters, error } = await supabase
    .from('matters')
    .select('client_id')
    .eq('client_name', clientName);
  if (error) throw new Error(`Failed to read the client's matters: ${error.message}`);
  const fromMatters = clientIdFromMatters(clientName, (matters ?? []).map((m) => m.client_id as string | null));
  if (fromMatters) return fromMatters;

  // No matter names a client: fall back to the one client record carrying the
  // name, by either spelling. Two separate eq filters rather than an or()
  // string, so nothing in the name can rewrite the filter.
  const [byName, byFullName] = await Promise.all([
    supabase.from('clients').select('notion_id').eq('name', clientName).limit(2),
    supabase.from('clients').select('notion_id').eq('full_company_name', clientName).limit(2),
  ]);
  const ids = new Set(
    [...(byName.data ?? []), ...(byFullName.data ?? [])].map((c) => c.notion_id as string),
  );
  return ids.size === 1 ? [...ids][0] : null;
}

/**
 * The Managing Partner signs every billing letter (see billingLetterSigner):
 * the one active member of this firm's roster holding that position, or the
 * firm's configured signer when there is no single one.
 */
async function letterSigner(firmId: string, fallbackName: string | undefined): Promise<LetterSigner | null> {
  const { data } = await getServiceDbForFirm(firmId).from('team').select('name, position, active');
  const roster = (data ?? []) as { name: string | null; position: string | null; active: boolean | null }[];
  const signer = billingLetterSigner(roster, fallbackName);
  if (signer && signer.position !== 'Managing Partner') {
    console.warn(`[persist-invoice] No single active Managing Partner on the roster; letter signed by the firm's configured signer (${signer.name}).`);
  }
  return signer;
}

export async function persistInvoice(
  supabase: SupabaseClient,
  params: PersistInvoiceParams,
): Promise<PersistInvoiceResult> {
  const {
    firmId, clientName, month, matterId, matterName, lineItems, expenses,
    feeLines, settings, generatedByEmail, existingInvoice, invoiceKind,
  } = params;
  const feeLinesArr = feeLines ?? [];

  // client_id scopes the portal billing RLS policy and the profitability
  // client filter, so it comes from the bundle's matters — see
  // resolveInvoiceClientId. Resolved first: a bundle that mixes two clients'
  // matters is refused before anything is allocated, rendered or written.
  const resolvedClientId = await resolveInvoiceClientId(supabase, clientName);

  const isRegenerate = !!existingInvoice;
  const invoiceNumber = isRegenerate
    ? existingInvoice!.invoice_number
    : await generateInvoiceNumber(supabase, firmId, month);

  // ── Revision tracking. We only count it as a revision when the invoice was
  // previously sent — regenerating a draft is a refresh, not a revision.
  const wasPreviouslySent = isRegenerate && !!existingInvoice!.sent_date;
  const previouslySentAt = isRegenerate
    ? (existingInvoice!.previously_sent_at ?? (wasPreviouslySent ? existingInvoice!.sent_date! : null))
    : null;
  const newRevisionCount = isRegenerate
    ? (existingInvoice!.revision_count ?? 0) + (wasPreviouslySent ? 1 : 0)
    : 0;

  let revisionNotice = '';
  if (newRevisionCount > 0 && previouslySentAt) {
    const sentDateDisplay = formatLetterDate(new Date(previouslySentAt + 'T00:00:00'));
    revisionNotice = `Revised version (R${newRevisionCount}) of invoice originally sent on ${sentDateDisplay}`;
  }

  // ── Discount inputs (percent strings; treat blank/0/invalid as no discount).
  const parsePct = (v: string | undefined): number => {
    if (!v) return 0;
    const n = parseFloat(v);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(100, n);
  };
  const hourlyDiscountPct = parsePct(settings.hourlyDiscountPercent);
  const totalDiscountPct = parsePct(settings.totalDiscountPercent);
  const hourlyDiscountFactor = 1 - hourlyDiscountPct / 100;

  // ── Apply hourly-rate discount to each lineItem before totaling. We mutate
  // the per-lawyer `amount` and per-entry `hourlyRate` so the PDF/XLSX
  // breakdown reflects the discounted rate the client will actually be billed.
  if (hourlyDiscountPct > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const l of lineItems as any[]) {
      if (typeof l.hourlyRate === 'number') {
        l.hourlyRate = Math.round(l.hourlyRate * hourlyDiscountFactor * 100) / 100;
      }
      if (Array.isArray(l.entries)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const e of l.entries as any[]) {
          if (typeof e.hourlyRate === 'number') {
            e.hourlyRate = Math.round(e.hourlyRate * hourlyDiscountFactor * 100) / 100;
          }
        }
      }
      if (typeof l.amount === 'number') {
        l.amount = Math.round(l.amount * hourlyDiscountFactor * 100) / 100;
      }
    }
  }

  // ── Cap-aware fee roll-up (after the discount mutation so it sees discounted
  // rates). Hours within the retainer cap are absorbed by the flat monthly
  // retainer; only hours beyond the cap bill hourly. The same within/beyond
  // split feeds the breakdown below, and the same shared helper backs the
  // Generate preview — so the stored total, the breakdown, and the preview agree.
  // Retainer comes from settings (config-driven), falling back to a retainer fee
  // line; that line is excluded from the total so it isn't double-counted.
  const retainerFromFeeLine = feeLinesArr
    .filter((f) => f.kind === 'retainer')
    .reduce((s, f) => s + (f.amount ?? 0), 0);
  const monthlyRetainerCharge = Number(settings.monthlyRetainer) > 0
    ? Number(settings.monthlyRetainer)
    : retainerFromFeeLine;
  const capFees = computeCapAwareFees(lineItems, settings.retainerHoursCap, monthlyRetainerCharge, feeLinesArr);
  const { within: withinRetainer, beyond: beyondRetainer } = capFees;

  // ── Compute totals
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalHours = lineItems.reduce((s: number, l: any) => s + (l.totalHours ?? 0), 0);
  const subtotalFees = capFees.legalFees;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalExpenses = (expenses ?? []).reduce((s: number, e: any) => s + (e.waived ? 0 : (e.amount ?? 0)), 0);
  const subtotalGrand = subtotalFees + totalExpenses;
  // Total discount applies to (fees + expenses) — i.e., the full bill before
  // VAT / previous balance. Persisted as a fee-line so it survives renders.
  const totalDiscountAmount = totalDiscountPct > 0
    ? Math.round(subtotalGrand * (totalDiscountPct / 100) * 100) / 100
    : 0;
  if (totalDiscountAmount > 0) {
    feeLinesArr.push({
      kind: 'discount',
      matterId: null,
      matterName: null,
      description: `Less: Discount (${totalDiscountPct}% off)`,
      amount: -totalDiscountAmount,
    });
  }
  const totalFees = subtotalFees + (totalDiscountAmount > 0 ? -totalDiscountAmount : 0);

  const [year, mon] = month.split('-');
  const monthDisplay = settings.billingPeriodLabel || new Date(parseInt(year), parseInt(mon) - 1).toLocaleDateString('en-US', {
    month: 'long', year: 'numeric',
  });

  const letterDay = manilaToday();
  const dueDay = addDays(letterDay, 7);
  const dueDateStr = normalizeLetterDate(dueDay);
  settings.dueDate = dueDay;

  const actualHoursAmount = settings.retainerCap
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? lineItems.reduce((s: number, l: any) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        s + (l.entries ?? []).reduce((es: number, e: any) =>
          es + (e.decimalHours ?? 0) * (l.hourlyRate ?? 0), 0),
        0)
    : undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const breakdownExpenses = (expenses ?? []).map((e: any) => ({
    date: e.date,
    description: e.expense ?? e.description ?? e.category ?? '',
    amount: e.amount ?? 0,
    waived: e.waived ?? false,
    photocopyDetail: e.photocopyDetail ?? undefined,
  }));

  // The letter's headline figure — and its "including VAT" sentence — must equal
  // the breakdown's GRAND TOTAL and the amount tracked in receivables. All three
  // go through invoiceGrossDue() so they can never diverge. Previous balance is
  // added after VAT, exactly as the breakdown does.
  const includeVAT = settings.includeVAT ?? false;
  const letterTotal = invoiceGrossDue({
    total_amount: totalFees,
    total_expenses: totalExpenses,
    billing_settings: { includeVAT },
  });
  const totalWithBalance = settings.previousBalance
    ? Math.round((letterTotal + settings.previousBalance) * 100) / 100
    : undefined;

  // Deposit settlement — frozen into the snapshot so the send flow applies
  // exactly the figure the documents show. Applied against the CURRENT bill
  // only; a carried previous balance stays with its own invoices.
  const settlement = settings.settleFromDeposit
    ? computeDepositSettlement(letterTotal, settings.depositOnHand ?? 0)
    : null;
  if (settlement) {
    settings.depositApplied = settlement.applied;
    settings.depositRemaining = settlement.remaining;
  } else {
    delete settings.depositApplied;
    delete settings.depositRemaining;
  }
  const netAmountDue = settlement
    ? Math.round(((totalWithBalance ?? letterTotal) - settlement.applied) * 100) / 100
    : undefined;

  // Early-payment discount, frozen like the settlement so the letter, the email
  // and the payment that later earns it all read one figure. Not offered on a
  // bill the advance deposit already settles: there is nothing to pay early.
  const earlyPayment = computeEarlyPaymentOffer({
    percent: settings.earlyPaymentDiscountPercent,
    days: settings.earlyPaymentDays,
    legalFees: totalFees,
    includeVAT,
    letterDate: letterDay,
    dueDate: dueDay,
    settledFromDeposit: (settlement?.applied ?? 0) > 0.005,
  });
  if (earlyPayment) settings.earlyPayment = earlyPayment;
  else delete settings.earlyPayment;

  // Recorded on the snapshot too, so the invoice says who signed it.
  const signer = await letterSigner(firmId, settings.signerName);
  settings.signerName = signer?.name ?? '';

  const docxBrand = await loadDocxBrand(firmId);
  const firmConfig = await getFirmConfig(firmId);
  // Read on the firm-scoped service client: the wording is finance's, and the
  // caller generating the invoice (a partner approving a bundle, a cron) may
  // not be someone whose own policy reads it.
  const wording = await loadLetterWording(getServiceDbForFirm(firmId));
  const letterParams: BillingLetterParams = {
    pesoSymbol: pesoSymbol(resolveFontSet(firmConfig.branding.fontSet)),
    firmName: docxBrand.firmName,
    date: formatLetterDate(),
    invoiceNumber,
    addressee: settings.letterAddressee,
    clientName,
    clientAddress: settings.clientAddress,
    attnName: settings.attnName ?? clientName,
    attnTitle: settings.attnTitle,
    throughName: settings.throughName,
    salutation: settings.salutation,
    billingPeriod: monthDisplay,
    // A raw YYYY-MM-DD from the matter's engagement_date column renders as an
    // ISO string otherwise; normalize it to the letter's "DD Month YYYY" style.
    engagementDate: normalizeLetterDate(settings.engagementDate),
    retainerCap: settings.retainerCap,
    retainerHoursCap: settings.retainerHoursCap,
    actualHoursAmount,
    totalAmount: letterTotal,
    totalExpenses,
    previousBalance: settings.previousBalance,
    previousBalanceLabel: settings.previousBalanceLabel,
    depositOnHand: settings.depositOnHand,
    depositApplied: settlement?.applied,
    depositRemaining: settlement?.remaining,
    netAmountDue,
    totalWithBalance,
    includeVAT,
    bankName: settings.bankName ?? '',
    bankAccountNo: settings.bankAccountNo ?? '',
    bankAccountName: settings.bankAccountName ?? '',
    dueDate: dueDateStr,
    signerName: signer?.name ?? '',
    signerPosition: signer?.position,
    signerAtty: settings.signerAtty ?? false,
    includeLessenFeesNote: settings.includeLessenFeesNote ?? false,
    revisionNotice,
    initialStatement: settings.initialStatement ?? false,
    optionalParagraphs: settings.optionalParagraphs ?? [],
    wording,
    earlyPayment,
  };

  // What the letter said — its figures, the facts its paragraphs were chosen
  // by, and the app-worded paragraph — frozen for the email, so the two agree.
  settings.letterBasis = {
    fields: letterFields(letterParams, wording),
    facts: letterFacts(letterParams),
    system: systemTexts(letterParams),
  };

  // ── Build files. The DOCX is built here, on the firm's letterhead; the PDF
  // is converted by Microsoft Graph where the firm has it, which also files the
  // DOCX in the firm's finance folder for the client. Conversion is remote and
  // can fail — the invoice still saves, with the DOCX, and the PDF can be
  // regenerated or uploaded signed.
  const docxBuffer = await generateBillingLetterDocx(firmId, letterParams);
  let pdfBuffer: Buffer | null = null;
  let oneDriveUrl: string | null = null;

  // Graph conversion is optional per firm; without it the invoice carries the
  // DOCX and finance uploads the signed PDF. A firm that HAS the feature and
  // still can't reach Graph is a misconfiguration and stays loud.
  if (await isFeatureAvailable(firmId, 'docx_pdf')) {
    try {
      const clientFolder = clientName.replace(/[^a-zA-Z0-9 ._-]/g, '_');
      const converted = await uploadAndConvertToPdf(
        firmId,
        docxBuffer,
        `${documentRoot(firmConfig, 'finance')}/${clientFolder}`,
        `${invoiceNumber} - Billing Letter.docx`,
      );
      pdfBuffer = converted.pdfBuffer;
      oneDriveUrl = converted.docxWebUrl;
    } catch (convertErr) {
      if (convertErr instanceof GraphNotConfiguredError) throw convertErr;
      console.warn('[persist-invoice] Billing letter PDF conversion failed:', convertErr instanceof Error ? convertErr.message : convertErr);
    }
  }

  // Acceptance kind feeLines → the existing acceptanceFees slot in the
  // breakdown params (XLSX has formal support for that section).
  const acceptanceFromFeeLines: AcceptanceFee[] = feeLinesArr
    .filter((f) => f.kind === 'acceptance')
    .map((f) => ({
      clientOrMatter: f.matterName ?? clientName,
      caseDescription: '',
      amount: f.amount,
    }));
  const mergedAcceptanceFees = [
    ...(settings.acceptanceFees ?? []),
    ...acceptanceFromFeeLines,
  ];

  // Params for the client-facing breakdown PDF. feeLines (excluding acceptance
  // + retainer, which are surfaced via their dedicated slots above) flow through
  // so the renderer can itemize the new billing types: fixed_fee, action
  // aggregates, milestones, etc.
  // Narrow to the BreakdownFeeLine shape so TS knows the kind is renderable.
  const renderableFeeLines: BreakdownFeeLine[] = feeLinesArr
    .filter((f): f is FeeLinePayload & { kind: BreakdownFeeLine['kind'] } =>
      f.kind === 'fixed_fee' || f.kind === 'action' ||
      f.kind === 'milestone' || f.kind === 'informational_hours' ||
      f.kind === 'discount' || f.kind === 'adhoc',
    )
    .map((f) => ({
      kind: f.kind,
      matterName: f.matterName,
      description: f.description,
      amount: f.amount,
      quantity: f.quantity,
    }));
  const breakdownParams = {
    firmAddress: settings.firmAddress ?? '',
    firmAddress2: settings.firmAddress2 ?? '',
    firmTIN: settings.firmTIN ?? '',
    billingPeriod: monthDisplay,
    monthlyRetainer: settings.monthlyRetainer ?? 0,
    acceptanceFees: mergedAcceptanceFees,
    withinRetainer,
    beyondRetainer,
    expenses: breakdownExpenses,
    includeVAT: settings.includeVAT ?? false,
    previousBalance: settings.previousBalance,
    previousBalanceLabel: settings.previousBalanceLabel,
    depositApplied: settlement?.applied,
    depositRemaining: settlement?.remaining,
    feeLines: renderableFeeLines,
    // Absorption is driven by the hours cap, not the flat retainer, so a
    // flat-retainer-no-cap client bills every hour on top instead of showing the
    // hours as absorbed. Cap also surfaces in the within-retainer section header
    // ("Within Retainer Hours (cap: 10h)").
    retainerHoursCap: settings.retainerHoursCap ?? null,
  };

  const breakdownPdfBuffer = await generateBillingBreakdownPdf(await loadFirmBrand(firmId), {
    ...breakdownParams,
    clientName,
    invoiceNumber,
  }).catch((err) => {
    // Don't fail the entire invoice if the breakdown PDF fails — the letter
    // still carries the headline figures. Log and continue with no breakdown.
    console.warn('[persist-invoice] Breakdown PDF generation failed:', err instanceof Error ? err.message : err);
    return null;
  });

  if (!docxBuffer || docxBuffer.length === 0) {
    throw new Error('DOCX generation produced an empty file');
  }

  // ── Upload (storage upsert is on). New objects are firm-prefixed; existing
  // invoices keep whatever path their row stores.
  const basePath = firmStoragePath(firmId, `invoices/${month}/${clientName.replace(/[^a-zA-Z0-9]/g, '_')}`);
  const docxPath = `${basePath}/${invoiceNumber}.docx`;
  const pdfPath = `${basePath}/${invoiceNumber}.pdf`;

  const breakdownPdfPath = `${basePath}/${invoiceNumber}-breakdown.pdf`;
  const hasBreakdownPdf = !!(breakdownPdfBuffer && breakdownPdfBuffer.length > 0);

  // Storage writes go through the service-role client: the `files` bucket has
  // no INSERT/SELECT policy for authenticated users, so an authed client's
  // uploads are silently rejected by RLS. (DB writes below stay on the passed-in
  // client.) See CLAUDE.md — storage ops are a sanctioned getSupabase() use.
  const storage = getSupabase();

  const [docxUpload] = await Promise.all([
    storage.storage.from('files').upload(docxPath, docxBuffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: true,
    }),
    pdfBuffer && pdfBuffer.length > 0
      ? storage.storage.from('files').upload(pdfPath, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: true,
        })
      : Promise.resolve(null),
    hasBreakdownPdf
      ? storage.storage.from('files').upload(breakdownPdfPath, breakdownPdfBuffer, {
          contentType: 'application/pdf',
          upsert: true,
        })
      : Promise.resolve(null),
  ]);

  // Fail loudly if the letter didn't land — never persist an invoice row that
  // points at storage paths with no objects behind them (the bug that left every
  // post-RLS-lockdown invoice unpreviewable). The PDFs stay best-effort: the
  // DOCX letter carries the essential data.
  if (docxUpload?.error) {
    throw new Error(`Failed to upload invoice DOCX to storage: ${docxUpload.error.message}`);
  }

  // ── If regenerating, reverse OLD flags before applying new ones. Doing this
  // BEFORE the row update means the old set is unambiguous.
  if (isRegenerate) {
    // Drop the spreadsheet breakdown this invoice number carried before the
    // format was retired, so the row's cleared path doesn't leave the object
    // behind. Best-effort: a missing object is the normal case.
    await storage.storage.from('files').remove([`${basePath}/${invoiceNumber}.xlsx`]);

    const oldDtrIds = dtrIdsFromLineItems(existingInvoice!.line_items ?? []);
    if (oldDtrIds.length > 0) {
      const { error } = await supabase
        .from('dtr')
        .update({ billed: false })
        .in('notion_id', oldDtrIds);
      if (error) {
        console.error('[persist-invoice] Failed to clear DTR billed flags on regenerate:', error.message);
      }
    }
    const oldReimbIds = reimbursementIdsFromExpenses(existingInvoice!.expense_items ?? []);
    if (oldReimbIds.length > 0) {
      const { error } = await supabase
        .from('reimbursements')
        .update({ billed: false, invoice_id: null })
        .in('notion_id', oldReimbIds);
      if (error) {
        console.error('[persist-invoice] Failed to clear reimbursements on regenerate:', error.message);
      }
    }
    const oldMexpIds = matterExpenseIdsFromExpenses(existingInvoice!.expense_items ?? []);
    if (oldMexpIds.length > 0) {
      const { error } = await supabase
        .from('matter_expenses')
        .update({ billed: false, invoice_id: null })
        .in('id', oldMexpIds);
      if (error) {
        console.error('[persist-invoice] Failed to clear matter_expenses on regenerate:', error.message);
      }
    }

    // Reverse action-entry + milestone flags for fee lines from the prior invoice.
    const oldFeeLines = existingInvoice!.fee_lines ?? [];
    const oldActionIds = feeLinesByKind(oldFeeLines, 'action')
      .flatMap((f) => f.sourceIds ?? [])
      .filter((id) => typeof id === 'number');
    if (oldActionIds.length > 0) {
      const { error } = await supabase
        .from('matter_action_entries')
        .update({ invoiced: false, invoice_id: null })
        .in('id', oldActionIds);
      if (error) {
        console.error('[persist-invoice] Failed to clear action entries on regenerate:', error.message);
      }
    }
    const oldMilestoneIds = feeLinesByKind(oldFeeLines, 'milestone')
      .flatMap((f) => f.sourceIds ?? [])
      .filter((id) => typeof id === 'number');
    if (oldMilestoneIds.length > 0) {
      const { error } = await supabase
        .from('matter_billing_milestones')
        .update({ invoiced: false, invoice_id: null })
        .in('id', oldMilestoneIds);
      if (error) {
        console.error('[persist-invoice] Failed to clear milestones on regenerate:', error.message);
      }
    }
    // Acceptance-fee lines flipped acceptance_fee_paid=true on the matter
    // config; undo per matter so a regen with the matter removed will leave
    // it unpaid again.
    const oldAcceptanceMatterIds = feeLinesByKind(oldFeeLines, 'acceptance')
      .map((f) => f.matterId)
      .filter((id): id is string => !!id);
    if (oldAcceptanceMatterIds.length > 0) {
      const { error } = await supabase
        .from('matter_billing_configs')
        .update({ acceptance_fee_paid: false })
        .in('matter_id', oldAcceptanceMatterIds);
      if (error) {
        console.error('[persist-invoice] Failed to clear acceptance_fee_paid on regenerate:', error.message);
      }
    }
  }

  // ── Insert or update the invoices row

  const baseRow = {
    invoice_number: invoiceNumber,
    client_id: resolvedClientId,
    client_name: clientName,
    matter_id: matterId ?? null,
    matter_name: matterName ?? null,
    billing_month: month,
    total_hours: totalHours,
    total_amount: totalFees,
    total_expenses: totalExpenses,
    currency: 'PHP',
    docx_storage_path: docxPath,
    // The spreadsheet breakdown was retired — the PDF breakdown is the one
    // client-facing rendering. Cleared here so a regenerated invoice never
    // points at the stale spreadsheet from its previous run.
    xlsx_storage_path: null,
    pdf_storage_path: pdfBuffer && pdfBuffer.length > 0 ? pdfPath : null,
    breakdown_pdf_storage_path: hasBreakdownPdf ? breakdownPdfPath : null,
    onedrive_url: oneDriveUrl ?? null,
    line_items: lineItems,
    expense_items: expenses ?? [],
    fee_lines: feeLinesArr,
    billing_settings: settings,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let invoice: any;
  if (isRegenerate) {
    const { data, error } = await supabase
      .from('invoices')
      .update({
        ...baseRow,
        // Force back to draft so finance must re-confirm before re-sending.
        status: 'draft',
        sent_date: null,
        revision_count: newRevisionCount,
        previously_sent_at: previouslySentAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingInvoice!.id)
      .select()
      .single();
    // Rethrow as an Error: a bare PostgrestError fails `instanceof Error` in the
    // callers' catch blocks, which recorded every failure as the useless
    // "Invoice generation failed" and hid an RLS refusal for a day.
    if (error) throw new Error(`Failed to update invoice row: ${error.message}${error.code ? ` (${error.code})` : ''}`);
    invoice = data;
  } else {
    // firm_id is stamped here and not in baseRow: the update branch above must
    // not rewrite an existing invoice's tenancy column. Two of the five caller
    // paths (dtr-review/generate, batch-generate) reach this on the authed
    // client, which does not stamp it the way getServiceDbForFirm does.
    const { data, error } = await supabase
      .from('invoices')
      .insert({
        ...baseRow,
        firm_id: firmId,
        status: 'draft',
        generated_by: generatedByEmail,
        invoice_kind: invoiceKind ?? 'monthly',
      })
      .select()
      .single();
    if (error) throw new Error(`Failed to insert invoice row: ${error.message}${error.code ? ` (${error.code})` : ''}`);
    invoice = data;
  }

  // ── Link the new entries to this invoice. `invoice_id` means "on this invoice"
  // (draft or sent); the billed/invoiced/acceptance flags mean "on a
  // SENT invoice" and are owned by setInvoiceBilledFlags (flipped from the
  // invoices PATCH route when finance marks the invoice sent). This invoice is a
  // DRAFT, so we link the entries but DON'T mark them billed here.
  const newMexpIds = matterExpenseIdsFromExpenses(expenses ?? []);
  if (newMexpIds.length > 0) {
    const { error } = await supabase
      .from('matter_expenses')
      .update({ invoice_id: invoice.id })
      .in('id', newMexpIds);
    if (error) {
      console.error(`[persist-invoice] Failed to link ${newMexpIds.length} matter_expenses to invoice:`, error.message);
    }
  }

  const newReimbIds = reimbursementIdsFromExpenses(expenses ?? []);
  if (newReimbIds.length > 0) {
    const { error } = await supabase
      .from('reimbursements')
      .update({ invoice_id: invoice.id })
      .in('notion_id', newReimbIds);
    if (error) {
      console.error(`[persist-invoice] Failed to link ${newReimbIds.length} reimbursements to invoice:`, error.message);
    }
  }

  const newActionIds = feeLinesByKind(feeLinesArr, 'action')
    .flatMap((f) => f.sourceIds ?? [])
    .filter((id): id is number => typeof id === 'number');
  if (newActionIds.length > 0) {
    const { error } = await supabase
      .from('matter_action_entries')
      .update({ invoice_id: invoice.id })
      .in('id', newActionIds);
    if (error) {
      console.error(`[persist-invoice] Failed to link ${newActionIds.length} action entries to invoice:`, error.message);
    }
  }

  const newMilestoneIds = feeLinesByKind(feeLinesArr, 'milestone')
    .flatMap((f) => f.sourceIds ?? [])
    .filter((id): id is number => typeof id === 'number');
  if (newMilestoneIds.length > 0) {
    const { error } = await supabase
      .from('matter_billing_milestones')
      .update({ invoice_id: invoice.id })
      .in('id', newMilestoneIds);
    if (error) {
      console.error(`[persist-invoice] Failed to link ${newMilestoneIds.length} milestones to invoice:`, error.message);
    }
  }

  // Ensure the draft's entries are all UNBILLED (covers re-drafting a previously
  // sent invoice via regenerate). They flip to billed only when the invoice is
  // marked sent.
  await setInvoiceBilledFlags(
    supabase,
    { line_items: lineItems, expense_items: expenses ?? [], fee_lines: feeLinesArr },
    false,
  );

  // ── Signed download URLs
  const [{ data: docxUrl }, { data: pdfUrl }, breakdownPdfUrlResult] = await Promise.all([
    storage.storage.from('files').createSignedUrl(docxPath, 3600),
    storage.storage.from('files').createSignedUrl(pdfPath, 3600),
    hasBreakdownPdf
      ? storage.storage.from('files').createSignedUrl(breakdownPdfPath, 3600)
      : Promise.resolve({ data: null }),
  ]);

  return {
    invoice,
    downloadUrls: {
      docx: docxUrl?.signedUrl ?? null,
      pdf: pdfUrl?.signedUrl ?? null,
      breakdownPdf: breakdownPdfUrlResult?.data?.signedUrl ?? null,
    },
    oneDriveUrl,
  };
}
