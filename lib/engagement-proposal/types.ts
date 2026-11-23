/**
 * Content model for an engagement proposal — the branded letter the firm sends
 * a prospect, which on signature *is* the engagement agreement. There is no
 * separate engagement letter, so the letter carries the scope, the fees, the
 * standard terms, the conflict disclosure, and the conforme block.
 *
 * Rendered by lib/pdf/engagement-proposal.ts and bound with its annexes by
 * lib/pdf/proposal-package.ts:
 *
 *   proposal letter → Annex "A" divider → fee schedules → Annex "B" divider
 *   → firm profile
 *
 * Stored as a single JSONB column on `engagement_proposals`, one row per
 * version, so a superseded draft is never overwritten.
 */

/** A block inside a numbered section of the letter. */
export type ProposalBlock =
  /** Ordinary justified paragraph. `**bold**` renders bold inline. */
  | { kind: 'para'; text: string }
  /** Navy small-caps subheading with a gold hairline, e.g. "Retainer Services". */
  | { kind: 'subheading'; text: string }
  /** Bold lead-in followed by body text — scope items and standard terms. */
  | { kind: 'labelled'; label: string; text: string }
  /** Numbered or bulleted list. */
  | { kind: 'list'; ordered: boolean; items: string[] }
  /** The three-column fee table: what the fee is, how much, when it is billed. */
  | { kind: 'feeTable'; rows: { fee: string; amount: string; when: string }[] };

export interface ProposalSection {
  /** Gold band, numbered automatically in document order. */
  heading: string;
  blocks: ProposalBlock[];
}

export interface ProposalClient {
  /** Entity or person the proposal is addressed to, e.g. "Acme Holdings, Inc." */
  name: string;
  /** Contact person, e.g. "Ms. Juana Dela Cruz". Confirmed by the drafter, never inferred. */
  attnName: string;
  attnTitle: string;
  /**
   * A corporation signs the conforme through an entity block (name, "By:",
   * signature line, then the officer). A natural person signs directly.
   */
  isCorporate: boolean;
}

export interface ProposalSigner {
  firmName: string;
  /** Set in caps in the signature block, e.g. "NAME OF SIGNING PARTNER". */
  name: string;
  /** The signer's actual position — confirmed against `team`, not assumed. */
  position: string;
}

/**
 * The figures the letter quotes, kept as numbers alongside the prose so the
 * fee section can be checked against the live schedule instead of trusted.
 * Absent for arrangements the schedule doesn't price (fixed fee, custom).
 */
export interface ProposalQuote {
  arrangement: 'retainer' | 'hourly' | 'acceptance_completion' | 'litigation' | 'fixed' | 'custom';
  /** Retainer tier quoted, e.g. "Tier II". Must match a tier in the schedule. */
  tierLabel?: string;
  monthlyFee?: number;
  retainerHours?: number;
  /** Initial fee = `initialFeeMonths` × `monthlyFee`. */
  initialFeeMonths?: number;
  initialFee?: number;
  /** Acceptance fee, and a completion fee expressed as a % of transaction value. */
  acceptanceFee?: number;
  completionFeePct?: number;
  /**
   * The sum the completion percentage is taken on: the consideration in a
   * transaction, or the amount claimed or at stake in a contested matter.
   */
  transactionValue?: number;
  completionFee?: number;
  /**
   * `litigation` only: which acceptance fee in the schedule applies, e.g.
   * "Civil cases". Must match a matter the schedule prices.
   */
  caseType?: string;
}

/**
 * The firm's own address and contact lines, printed in the gold band at the
 * foot of the cover. Seeded from the live firm profile when a draft is created
 * and editable per proposal, so a letter that goes out under a different line
 * or office carries that one without the CMS having to change.
 *
 * Optional: drafts created before the field existed fall back to the current
 * firm profile at render time.
 */
export interface ProposalFirmContact {
  addressLines: string[];
  phone: string;
  email: string;
  website: string;
}

/**
 * How the client pays. Seeded from the firm's invoice settings — the same
 * account the invoices carry, because a proposal that names a different one is
 * how a payment goes astray — and editable per proposal for an engagement
 * settled through another account.
 */
export interface ProposalPayment {
  bankName: string;
  accountName: string;
  accountNo: string;
  /** The firm's VAT registration line, as it prints on an invoice. */
  tin: string;
  /** Optional note under the account block, e.g. how to send proof of payment. */
  note: string;
}

export interface ProposalAnnexes {
  /** Fee-schedule slugs bound as Annex "A", in order. */
  feeScheduleSlugs: string[];
  /** Whether the firm profile is bound as Annex "B". */
  includeFirmProfile: boolean;
}

export interface EngagementProposalContent {
  /** ISO date (YYYY-MM-DD); rendered day-month-year, e.g. "22 July 2026". */
  date: string;
  /** Bold small caps above the date, e.g. "Privileged and Confidential". */
  privilegeLine: string;
  client: ProposalClient;
  /** Subject line, e.g. "Engagement Proposal — Retainer Services for X". */
  subject: string;
  /** "Gentlemen/Mesdames:" for a corporate client. */
  salutation: string;
  /** Opening paragraphs: what this is, validity, and that signing forms the agreement. */
  intro: string[];
  validityDays: number;
  sections: ProposalSection[];
  /** Paragraphs above the conforme, after the last numbered section. */
  closing: string[];
  signer: ProposalSigner;
  quote?: ProposalQuote;
  annexes: ProposalAnnexes;
  /** Cover-page label under "Prepared for", e.g. "Retainer Proposal". */
  coverKicker: string;
  /** Cover contact band. Absent on pre-existing drafts — see the interface. */
  firmContact?: ProposalFirmContact;
  /**
   * Payment details, printed as the letter's last numbered section. Absent on
   * drafts created before the section existed — those fall back to the firm's
   * current invoice settings at render time.
   */
  payment?: ProposalPayment;
}

export type ProposalStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'superseded';

/**
 * Who the letter is addressed to. A prospect still in the intake pipeline
 * brings its consultation notes and conflict check with it; an existing client
 * the firm already acts for brings none of that, and the drafter supplies the
 * steer instead. Both resolve to a `clients` row — the intake is what is
 * optional, not the client.
 */
export type ProposalRecipient =
  | { kind: 'prospect'; intakeId: number }
  | { kind: 'client'; clientId: string };

export interface EngagementProposalRow {
  id: string;
  /**
   * One chain of drafts for one proposed engagement. Versions are numbered
   * within a thread, so a second engagement with the same client starts at 1
   * rather than continuing the first one's numbering.
   */
  thread_id: string;
  /** Null when the proposal was raised against an existing client directly. */
  intake_id: number | null;
  client_id: string;
  version: number;
  status: ProposalStatus;
  content: EngagementProposalContent;
  storage_path: string | null;
  file_name: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Day-month-year, the firm's house date format: "22 July 2026". Assembled from
 * the parts rather than via a locale — en-PH formats as "July 22, 2026", which
 * is the American order the style guide rules out.
 */
export function formatProposalDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [, year, month, day] = m;
  const monthName = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ][Number(month) - 1];
  if (!monthName) return iso;
  return `${Number(day)} ${monthName} ${year}`;
}
