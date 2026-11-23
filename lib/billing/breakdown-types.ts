/**
 * The data shape of a billing breakdown — one client, one billing month, every
 * fee and expense line behind the letter's headline figure.
 *
 * Assembled by lib/billing/build-breakdown-params.ts (preview) and
 * lib/billing/persist-invoice.ts (the real invoice), rendered by
 * lib/pdf/billing-breakdown.ts.
 */

export interface LawyerEntry {
  date: string;            // YYYY-MM-DD; rendered as dd-mmm
  hours: number;           // decimal hours (e.g. 0.2)
  description: string;     // particulars text
  hourlyRate: number;      // rate used in the per-entry amount
  /** Waived (goodwill): shown struck-through, billed at ₱0, excluded from every subtotal/total. */
  waived?: boolean;
  /** Matter the entry was rendered on — drives the per-matter grouping inside
   *  each lawyer block. Absent on invoices generated before matter capture,
   *  in which case the renderer falls back to a flat, ungrouped table. */
  matterId?: string | null;
  matterName?: string | null;
  matterCode?: string | null;
}

export interface LawyerBlock {
  name: string;
  initials?: string;       // appended in parens after name when present
  position?: string;       // shown next to name in italic small
  entries: LawyerEntry[];
}

export interface ExpenseEntry {
  date: string;
  description: string;
  amount: number;
  /** Waived (goodwill): shown struck-through, billed at ₱0, excluded from the expense total. */
  waived?: boolean;
  photocopyDetail?: {
    costPerPage: number;
    numberOfSets: number;
    pagesPerSet: number;
    totalCopies: number;
  };
}

export interface AcceptanceFee {
  clientOrMatter: string;
  caseDescription: string;
  amount: number;
}

/** Non-DTR billing line — the newer billing types (fixed_fee, per-action
 *  aggregates, per-milestone fees, and informational hours for fixed-retainer
 *  matters). Acceptance and retainer kinds are handled via the existing
 *  `acceptanceFees` / `monthlyRetainer` slots, so they aren't expected here. */
export interface BreakdownFeeLine {
  kind: 'fixed_fee' | 'action' | 'milestone' | 'informational_hours' | 'discount' | 'adhoc';
  matterName: string | null;
  description: string;
  /** Negative for discount lines (a credit against the bill). */
  amount: number;
  quantity?: number;
}

export interface BillingBreakdownParams {
  firmAddress: string;
  firmAddress2: string;
  firmTIN: string;
  billingPeriod: string;          // e.g. "February 2026"
  monthlyRetainer: number;
  /** Retainer HOURS cap. Absorption of within-cap hours only happens when this
   *  is set (> 0). A flat monthly retainer with no cap bills every hour on top. */
  retainerHoursCap?: number | null;
  acceptanceFees?: AcceptanceFee[];
  withinRetainer: LawyerBlock[];
  beyondRetainer: LawyerBlock[];
  expenses: ExpenseEntry[];
  includeVAT: boolean;
  vatRate?: number;               // default 0.12
  previousBalance?: number;
  previousBalanceLabel?: string;
  /** Non-DTR fee lines (fixed fees, per-action aggregates, milestones,
   *  informational hours), rendered in dedicated sections. */
  feeLines?: BreakdownFeeLine[];
}
