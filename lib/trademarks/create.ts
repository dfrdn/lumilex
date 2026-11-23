import type { SupabaseClient } from '@supabase/supabase-js';
import { TRADEMARK_SELECT } from '@/lib/trademark-row';
import type { OfficeActionKind } from '@/types/notion';

/**
 * Insert a trademark under the next per-client index. Race-safe: if a
 * concurrent insert takes the same index, the unique constraint refuses it and
 * the next index is tried, up to three times. The firm is stamped whatever
 * client the caller hands in.
 */
export async function insertTrademark(
  supabase: SupabaseClient,
  firmId: string,
  row: Record<string, unknown> & { client_id: string | null },
): Promise<{ data: Record<string, unknown> | null; error: { code?: string; message: string } | null }> {
  async function nextClientIndex(): Promise<number> {
    if (!row.client_id) return 0;
    const { data } = await supabase
      .from('trademarks')
      .select('client_index')
      .eq('client_id', row.client_id)
      .order('client_index', { ascending: false })
      .limit(1);
    return ((data?.[0]?.client_index as number | undefined) ?? 0) + 1;
  }

  let lastError: { code?: string; message: string } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const idx = await nextClientIndex();
    const { data, error } = await supabase
      .from('trademarks')
      .insert({ firm_id: firmId, ...row, client_index: idx })
      .select(TRADEMARK_SELECT)
      .single();
    if (!error && data) return { data: data as Record<string, unknown>, error: null };
    lastError = error ?? null;
    if (error?.code !== '23505') break;
  }
  return { data: null, error: lastError ?? { message: 'Insert failed' } };
}

/**
 * Where a new mark starts. Most start before filing; a mark the firm takes
 * over from other counsel, or picks up mid-prosecution, starts where it is,
 * with the dates of the steps already taken so its deadlines count from them.
 */
export const START_STAGES = ['new', 'for_filing', 'examination', 'office_action', 'allowed', 'published', 'registered'] as const;
export type StartStage = (typeof START_STAGES)[number];

export const START_STAGE_LABELS: Record<StartStage, string> = {
  new: 'Waiting on instructions',
  for_filing: 'Ready to file',
  examination: 'Under examination',
  office_action: 'Office Action open',
  allowed: 'Allowed',
  published: 'Published',
  registered: 'Registered',
};

export interface TrademarkStart {
  stage: StartStage;
  applicationNo?: string;
  filingDate?: string;
  oaMailingDate?: string;
  oaReceivedDate?: string;
  oaKind?: 'office_action' | 'final_rejection';
  oaTitle?: string;
  noiDate?: string;
  noiPaymentDate?: string;
  publishedDate?: string;
  regDate?: string;
  dau3FilingDate?: string;
}

export interface StartingPoint {
  /** Columns for the trademarks row. */
  row: Record<string, unknown>;
  /** The open round to record with it, at the Office Action (or refusal) stage. */
  officeAction: {
    kind: OfficeActionKind;
    title: string | null;
    mailing_date: string;
    received_date: string | null;
    respond_by?: string;
  } | null;
}

/** Why steps given in the order they happen are dated out of that order, or null. */
function sequenceProblem(steps: [string, string | undefined][]): string | null {
  const dated = steps.filter((s): s is [string, string] => !!s[1]);
  for (let i = 1; i < dated.length; i++) {
    const [earlier, before] = dated[i - 1];
    const [later, after] = dated[i];
    if (after < before) return `The ${later} is dated before the ${earlier}.`;
  }
  return null;
}

/** The row a mark starts with at `start`, or why the dates don't hold together. */
export function startingPoint(start: TrademarkStart, today: string): StartingPoint | { error: string } {
  if (start.stage === 'new') return { row: { status: 'Prelim' }, officeAction: null };
  if (start.stage === 'for_filing') return { row: { status: 'For Filing' }, officeAction: null };

  const at = START_STAGES.indexOf(start.stage);
  const from = (s: StartStage) => at >= START_STAGES.indexOf(s);
  const dates: [string, string | undefined][] = [
    ['filing date', start.filingDate],
    ['Office Action date', start.stage === 'office_action' ? start.oaMailingDate : undefined],
    ['day the Office Action was received', start.stage === 'office_action' ? start.oaReceivedDate : undefined],
    ['Notice of Allowance date', from('allowed') ? start.noiDate : undefined],
    ['1st publication fee payment', from('allowed') ? start.noiPaymentDate : undefined],
    ['publication date', from('published') ? start.publishedDate : undefined],
    ['registration date', start.stage === 'registered' ? start.regDate : undefined],
    ['3rd-year DAU filing', start.dau3FilingDate],
  ];
  for (const [label, d] of dates) if (d && d > today) return { error: `The ${label} is in the future.` };
  if (!start.filingDate) return { error: 'Give the filing date — the deadlines count from it.' };
  for (const [label, d] of dates.slice(1)) {
    if (d && d < start.filingDate) return { error: `The ${label} is before the filing date.` };
  }
  if (start.stage === 'office_action' && !start.oaMailingDate) return { error: 'Give the date on the Office Action.' };
  if (start.oaReceivedDate && start.oaMailingDate && start.oaReceivedDate < start.oaMailingDate) {
    return { error: 'The Office Action was received before its date.' };
  }
  if (start.stage === 'allowed' && !start.noiDate) return { error: 'Give the date of the Notice of Allowance.' };
  if (start.stage === 'published' && !start.publishedDate) return { error: 'Give the publication date.' };
  if (start.stage === 'registered' && !start.regDate) return { error: 'Give the registration date on the certificate.' };
  const inOrder = sequenceProblem([
    ['Notice of Allowance', from('allowed') ? start.noiDate : undefined],
    ['1st publication fee payment', from('allowed') ? start.noiPaymentDate : undefined],
    ['publication', from('published') ? start.publishedDate : undefined],
    ['registration', start.stage === 'registered' ? start.regDate : undefined],
  ]);
  if (inOrder) return { error: inOrder };

  const row: Record<string, unknown> = {
    status: start.stage === 'registered' ? 'Registered' : start.stage === 'office_action' ? 'Pending - OA' : 'Pending',
    filing_date: start.filingDate,
    reg_ir_no: start.applicationNo?.trim() || null,
    dau_3_filing_date: start.dau3FilingDate ?? null,
  };
  if (from('allowed')) {
    row.noi_date = start.noiDate ?? null;
    row.noi_payment_date = start.noiPaymentDate ?? null;
  }
  if (from('published')) row.published_date = start.publishedDate ?? null;
  if (start.stage === 'registered') row.reg_date = start.regDate;

  return {
    row,
    officeAction: start.stage === 'office_action'
      ? {
        kind: start.oaKind ?? 'office_action',
        title: start.oaTitle?.trim() || null,
        mailing_date: start.oaMailingDate!,
        received_date: start.oaReceivedDate ?? null,
      }
      : null,
  };
}

/**
 * Where a designation of the Philippines starts. The firm takes it up as
 * local counsel when IPOPHL is notified of it, so it is never "new": it is
 * under examination, refused provisionally, published, or protected.
 */
export const DESIGNATION_STAGES = ['examination', 'refusal', 'published', 'registered'] as const;
export type DesignationStage = (typeof DESIGNATION_STAGES)[number];

export const DESIGNATION_STAGE_LABELS: Record<DesignationStage, string> = {
  examination: 'Under examination',
  refusal: 'Provisional refusal open',
  published: 'Published',
  registered: 'Protection granted',
};

export interface DesignationStartInput {
  stage: DesignationStage;
  irNo?: string;
  irDate?: string;
  designationDate?: string;
  refusalMailingDate?: string;
  refusalReceivedDate?: string;
  refusalRespondBy?: string;
  refusalKind?: 'provisional_refusal' | 'final_rejection';
  refusalTitle?: string;
  publishedDate?: string;
  grantDate?: string;
  dau3FilingDate?: string;
}

/** The row a designation starts with, or why its dates don't hold together. */
export function designationStartingPoint(start: DesignationStartInput, today: string): StartingPoint | { error: string } {
  const at = DESIGNATION_STAGES.indexOf(start.stage);
  const from = (s: DesignationStage) => at >= DESIGNATION_STAGES.indexOf(s);
  const refused = start.stage === 'refusal';
  const dates: [string, string | undefined][] = [
    ['international registration date', start.irDate],
    ['designation date', start.designationDate],
    ['date on the refusal', refused ? start.refusalMailingDate : undefined],
    ['day the refusal was received', refused ? start.refusalReceivedDate : undefined],
    ['publication date', from('published') ? start.publishedDate : undefined],
    ['date of the grant of protection', start.stage === 'registered' ? start.grantDate : undefined],
    ['3rd-year DAU filing', start.dau3FilingDate],
  ];
  for (const [label, d] of dates) if (d && d > today) return { error: `The ${label} is in the future.` };
  if (!start.irDate) return { error: 'Give the international registration date — the deadlines count from it.' };
  if (start.designationDate && start.designationDate < start.irDate) {
    return { error: 'The designation date is before the international registration.' };
  }
  const begins = start.designationDate ?? start.irDate;
  for (const [label, d] of dates.slice(2)) {
    if (d && d < begins) return { error: `The ${label} is before the Philippines was designated.` };
  }
  if (refused) {
    if (!start.refusalMailingDate) return { error: 'Give the date on the refusal.' };
    if (start.refusalReceivedDate && start.refusalReceivedDate < start.refusalMailingDate) {
      return { error: 'The refusal was received before its date.' };
    }
    if (!start.refusalRespondBy) return { error: 'Give the response date stated on the refusal.' };
    if (start.refusalRespondBy <= start.refusalMailingDate) return { error: 'The response date must be after the date on the refusal.' };
  }
  if (start.stage === 'published' && !start.publishedDate) return { error: 'Give the publication date.' };
  if (start.stage === 'registered' && !start.grantDate) return { error: 'Give the date on the statement of grant of protection.' };
  const inOrder = sequenceProblem([
    ['publication', from('published') ? start.publishedDate : undefined],
    ['grant of protection', start.stage === 'registered' ? start.grantDate : undefined],
  ]);
  if (inOrder) return { error: inOrder };

  const row: Record<string, unknown> = {
    origin: 'madrid_in',
    status: start.stage === 'registered' ? 'Registered' : refused ? 'Pending - OA' : 'Pending',
    reg_ir_no: start.irNo?.trim() || null,
    ir_date: start.irDate,
    designation_date: start.designationDate ?? null,
    dau_3_filing_date: start.dau3FilingDate ?? null,
  };
  if (from('published')) row.published_date = start.publishedDate ?? null;
  if (start.stage === 'registered') row.reg_date = start.grantDate;

  return {
    row,
    officeAction: refused
      ? {
        kind: start.refusalKind ?? 'provisional_refusal',
        title: start.refusalTitle?.trim() || null,
        mailing_date: start.refusalMailingDate!,
        received_date: start.refusalReceivedDate ?? null,
        respond_by: start.refusalRespondBy!,
      }
      : null,
  };
}
