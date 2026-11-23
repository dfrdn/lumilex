/**
 * Content model for the fee-schedule CMS — the firm's published rate cards.
 *
 * One `FeeScheduleContent` maps 1:1 to a branded PDF produced by
 * lib/pdf/fee-schedule.ts, and doubles as the machine-readable source the
 * engagement proposal quotes from. The firm publishes four today:
 *
 *   professional  → retainer tiers, hourly rates, acceptance fees
 *   trademark     → IPOPHL trademark prosecution
 *   patent        → inventions, utility models & industrial designs
 *   copyright     → copyright enrolment & recordation
 *
 * Two body shapes, one chrome. `professional` is *typed* — the tiers and rates
 * are numbers, so the proposal can say "Tier II · P15,000.00 · six (6) hours"
 * and have the figure be the same object the annex renders, not a re-typed
 * one. The IP schedules are presentation tables: their cells carry units and
 * qualifiers ("100.00 (per class)", "Time basis") that no numeric model would
 * survive, and nothing quotes them programmatically.
 *
 * The whole document is stored as a single JSONB column on `fee_schedules`.
 */

/** Slugs the app knows how to reason about; the CMS can hold others. */
export type FeeScheduleSlug = 'professional' | 'trademark' | 'patent' | 'copyright';

export interface FeeScheduleCover {
  /** Wordmark on the primary panel, e.g. "Smith & Reyes". */
  firmName: string;
  /** Big display title, e.g. "FEE SCHEDULE". */
  title: string;
  /** Letterspaced gold line under the title, e.g. "TRADEMARK PROSECUTION". */
  subtitle: string;
  /** Edition line, e.g. "2026 Edition". */
  edition: string;
  /** Jurisdiction + confidentiality, e.g. "Philippines | Strictly Confidential". */
  footnote: string;
  addressLines: string[];
  email: string;
  website: string;
  phone: string;
}

// ── Typed body: the professional schedule ───────────────────────────

export interface RetainerTier {
  /** "Tier I" — also the label the proposal's fee section quotes. */
  label: string;
  /** Monthly cap of legal service hours. Null for the Custom tier. */
  hours: number | null;
  /** Monthly retainer fee in pesos. Null for the Custom tier. */
  monthlyFee: number | null;
  /** Discount off standard hourly + acceptance fees, as a percentage. */
  discountPct: number | null;
  /** Rendered instead of the numeric columns when set, e.g. "Subject to negotiation". */
  note?: string;
}

export interface PositionRate {
  position: string;
  /** Standard (non-retained) hourly rate in pesos. Tier rates are derived. */
  standard: number;
}

export interface AcceptanceFee {
  matter: string;
  /** Standard acceptance fee in pesos. Tier fees are derived. */
  standard: number;
}

export interface ProfessionalBody {
  kind: 'professional';
  /** Lead paragraph above section 1. */
  intro: string;
  retainer: {
    heading: string;
    paragraphs: string[];
    tiers: RetainerTier[];
    /** Initial Fee = this many months of the monthly retainer fee. */
    initialFeeMonths: number;
  };
  hourly: {
    heading: string;
    paragraphs: string[];
    rates: PositionRate[];
  };
  acceptance: {
    heading: string;
    paragraphs: string[];
    fees: AcceptanceFee[];
  };
}

// ── Generic body: the IP schedules ──────────────────────────────────

export interface FeeColumn {
  label: string;
  /** Second header line, e.g. "(USD)" or "Small Entity". */
  sublabel?: string;
  /** Relative width; columns are laid out proportionally. */
  flex: number;
  align: 'left' | 'center';
}

export interface FeeRow {
  /**
   * `row` — a priced line. `subheader` — a bold navy label spanning the table
   * with no figures (e.g. "RECORDAL OF CHANGE OF NAME / ADDRESS").
   */
  kind?: 'row' | 'subheader';
  /** One entry per column. Extra/missing entries render as blank cells. */
  cells: string[];
  /** Indent the description cell, for continuation lines ("For each additional class"). */
  indent?: boolean;
  /** Small grey qualifier under the figure, e.g. "(per class)". Indexed by column. */
  cellNotes?: Record<number, string>;
}

export interface FeeGroup {
  /** Gold band across the table, e.g. "2. APPLICATION". */
  label: string;
  rows: FeeRow[];
}

export interface TableBody {
  kind: 'table';
  intro?: string;
  columns: FeeColumn[];
  groups: FeeGroup[];
}

export type FeeScheduleBody = ProfessionalBody | TableBody;

export interface FeeNote {
  /** Bold lead-in, e.g. "Value-Added Tax." */
  label: string;
  text: string;
}

export interface FeeScheduleContent {
  /** Stable key: how the proposal picks which annexes to attach. */
  slug: string;
  /** Admin-facing name, e.g. "Professional Fee Schedule". */
  name: string;
  /** Running header on the right of every interior page. */
  runningTitle: string;
  /** Calendar year the schedule is effective for, e.g. "2026". */
  year: string;
  cover: FeeScheduleCover;
  body: FeeScheduleBody;
  notesHeading: string;
  notes: FeeNote[];
  /** Small italic line under the notes, e.g. the asterisk gloss. */
  footnotes: string[];
}

export interface FeeScheduleRow {
  id: string;
  slug: string;
  name: string;
  content: FeeScheduleContent;
  is_active: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ── Derived figures ─────────────────────────────────────────────────

/** Apply a tier discount to a standard rate, rounded to centavos. */
export function discounted(standard: number, discountPct: number | null): number {
  if (!discountPct) return standard;
  return Math.round(standard * (100 - discountPct)) / 100;
}

/** Tiers that carry real numbers — the ones a proposal can actually quote. */
export function pricedTiers(body: ProfessionalBody): RetainerTier[] {
  return body.retainer.tiers.filter((t) => t.monthlyFee != null && t.hours != null);
}

/** The Initial Fee a tier implies: N months of its monthly retainer fee. */
export function initialFeeFor(body: ProfessionalBody, tier: RetainerTier): number | null {
  if (tier.monthlyFee == null) return null;
  return tier.monthlyFee * body.retainer.initialFeeMonths;
}
