import { toDecimal } from '@/lib/dtr-utils';
import type { DTRSnapshot } from '@/lib/queries/effective-dtr';
import { fanOutAll } from '@/lib/billing/fan-out';
import { getSeniorityRank } from '@/lib/billing/seniority';
import { resolveBundleRetainerParams } from '@/lib/billing/cap-split';

// ── Types ──────────────────────────────────────────────

export interface MatterBillingConfig {
  matter_id: string;
  /** Which billing model the matter is on. When omitted, defaults to
   *  litigation-style (everything hourly) for backward compatibility. */
  billing_type?:
    | 'litigation'
    | 'retainer'
    | 'fixed_retainer'
    | 'fixed_fee'
    | 'acceptance_per_action'
    | 'acceptance_per_milestone'
    | null;
  retainer_hours_cap: number | null;
  hourly_rate_override: number | null;
  monthly_retainer: number | null;
}

/** Which billing types charge nothing via DTRs (hours are tracked for the
 *  audit trail but the bill comes from a flat retainer, fixed fee, action
 *  entries, or milestones — not from hourly time). */
const NON_DTR_BILLED_TYPES = new Set([
  'fixed_retainer',
  'fixed_fee',
  'acceptance_per_action',
  'acceptance_per_milestone',
]);

export interface BundleFees {
  /** Total = monthlyRetainer + hourlyExcess (the bottom line on the invoice). */
  totalLegalFees: number;
  /** Flat monthly retainer charge, if the client has a retainer arrangement. */
  monthlyRetainer: number;
  /** Sum of (hours × rate) for hours either over the retainer cap, or all hours when there's no cap. */
  hourlyExcess: number;
  /** Total billable decimal hours (within + beyond), excluding non-billable rows. */
  totalHours: number;
  /** Hours absorbed by the retainer cap (no extra hourly charge). */
  withinRetainerHours: number;
  /** Hours over the retainer cap, billed hourly at the position rate (or matter override). */
  beyondRetainerHours: number;
  retainerHoursCap: number | null;
  currency: 'PHP';
  /** Attendees who matched no `team` row, so their position — and the rate the
   *  figures above used for them — was a fallback, not a fact. Empty on a clean
   *  bundle. The invoice path refuses outright (UnresolvedLawyerError); a
   *  preview still renders, but must say the number is provisional. */
  unresolvedLawyers: string[];
}

export interface ComputeBundleFeesInput {
  /** Effective snapshots (post-revisions). Non-billable rows are filtered out internally. */
  snapshots: DTRSnapshot[];
  configsByMatter: Map<string, MatterBillingConfig>;
  ratesByPosition: Record<string, number>;
  positionByLawyerName: Record<string, string>;
}

// ── Helper ─────────────────────────────────────────────

/** Position for a fanned entry's attendee. A name with no `team` row has no
 *  position and therefore no rate; it falls back to the junior card so the rest
 *  of the bundle still computes, and the name is collected so the caller can
 *  say the total is provisional. */
function positionFor(
  s: DTRSnapshot,
  positionByLawyerName: Record<string, string>,
  unresolved: Set<string>,
): string {
  const position = positionByLawyerName[s.lawyerName];
  if (!position) {
    if (s.lawyerName) unresolved.add(s.lawyerName);
    return 'Junior Associate';
  }
  return position;
}

function rateFor(
  s: DTRSnapshot,
  configsByMatter: Map<string, MatterBillingConfig>,
  ratesByPosition: Record<string, number>,
  position: string,
): number {
  const cfg = s.matterId ? configsByMatter.get(s.matterId) : null;
  const override = cfg?.hourly_rate_override != null ? Number(cfg.hourly_rate_override) : null;
  if (override != null && !isNaN(override) && override > 0) return override;
  return ratesByPosition[position] ?? 0;
}

// ── Main ──────────────────────────────────────────────

/**
 * Computes what the client would be billed for this (month, client_name) bundle
 * using the effective snapshots, mirroring the math in `dtr-export` and the
 * billing breakdown spreadsheet:
 *
 *   total = monthlyRetainer + sum(hours over cap × rate)
 *
 * Each DTR is fanned out so every attendee in `with_names` bills their own
 * hours at their own rate (a 1h meeting × 3 attendees = 3 entries).
 *
 * Cap-split prefers senior lawyers — their hours absorb the retainer cap before
 * juniors' hours spill into hourly excess. Within a seniority tier, entries
 * sort by name, then chronologically.
 *
 * Non-billable rows (e.g. status reports) are excluded from all sums.
 */
export function computeBundleFees(input: ComputeBundleFeesInput): BundleFees {
  const { snapshots, configsByMatter, ratesByPosition, positionByLawyerName } = input;
  const billable = snapshots.filter((s) => !s.nonBillable);
  // Waive is per-attendee: fanOut sets each fanned line's lawyerName to the
  // attendee, so drop only the waived attendee's line (₱0, goodwill) — co-attendees
  // on the same DTR still bill. Keeps this preview in step with the invoice.
  // Match trim-tolerant: fanOutByAttendees trims the attendee name but waived_with
  // is stored verbatim, so compare trimmed on both sides.
  const fanned = fanOutAll(billable).filter(
    (f) => !(f.waivedWith ?? []).some((w) => w.trim() === f.lawyerName.trim()),
  );

  // ── 1) Per-entry derived fields (carry position for seniority sort) ──
  // Drop entries whose matter is on a billing model that doesn't bill via
  // DTRs (fixed_retainer, fixed_fee, acceptance_per_action,
  // acceptance_per_milestone). For those, hours are tracked for the audit
  // trail but the actual charges come from the matter config + feeLines.
  const dtrBillableFanned = fanned.filter((s) => {
    if (!s.matterId) return true; // unassigned — assume billable until proven otherwise
    const cfg = configsByMatter.get(s.matterId);
    const type = cfg?.billing_type ?? null;
    return !type || !NON_DTR_BILLED_TYPES.has(type);
  });

  const unresolved = new Set<string>();
  const entries = dtrBillableFanned.map((s) => {
    const position = positionFor(s, positionByLawyerName, unresolved);
    const rate = rateFor(s, configsByMatter, ratesByPosition, position);
    const hours = toDecimal(s.hours ?? 0, s.minutes ?? 0);
    return { date: s.date ?? '', name: s.lawyerName, matterId: s.matterId, hours, rate, amount: hours * rate, position };
  });

  // ── 2) Pull retainer params for this client. Scan ALL configs (not via
  // entries) so a client whose only matter is fixed_retainer still gets its
  // monthly_retainer surfaced even though its entries were filtered out
  // above. Shared with dtr-export so both paths agree on which cap applies.
  const { retainerHoursCap, monthlyRetainer } = resolveBundleRetainerParams(
    configsByMatter.values(),
  );

  // ── 3) Cap-split sorted entries (senior first, then by name, then by date) ──
  // Must match splitLineItemsAtCap exactly: the preview and the invoice absorb
  // the cap in the same order, or finance clears one number and the client gets
  // another. The name tiebreak keeps two same-position lawyers from ordering on
  // nothing.
  const sorted = [...entries].sort((a, b) => {
    const s = getSeniorityRank(a.position) - getSeniorityRank(b.position);
    if (s !== 0) return s;
    const n = a.name.localeCompare(b.name, 'en');
    if (n !== 0) return n;
    return a.date.localeCompare(b.date);
  });
  let withinHours = 0;
  let beyondHours = 0;
  let hourlyExcess = 0;

  // A cap only absorbs hours when there's a monthly retainer to absorb them
  // into; a cap with no retainer (₱0) is treated as no cap so every hour bills.
  if (retainerHoursCap == null || monthlyRetainer <= 0) {
    for (const e of sorted) {
      beyondHours += e.hours;
      hourlyExcess += e.amount;
    }
  } else {
    let cum = 0;
    const cap = retainerHoursCap;
    for (const e of sorted) {
      const before = cum;
      const after = cum + e.hours;
      if (after <= cap) {
        withinHours += e.hours;
      } else if (before >= cap) {
        beyondHours += e.hours;
        hourlyExcess += e.amount;
      } else {
        // Straddle the cap — split proportionally.
        const within = cap - before;
        const beyond = e.hours - within;
        withinHours += within;
        beyondHours += beyond;
        hourlyExcess += beyond * e.rate;
      }
      cum = after;
    }
  }

  const totalLegalFees = monthlyRetainer + hourlyExcess;

  return {
    totalLegalFees,
    monthlyRetainer,
    hourlyExcess,
    totalHours: withinHours + beyondHours,
    withinRetainerHours: withinHours,
    beyondRetainerHours: beyondHours,
    retainerHoursCap,
    currency: 'PHP',
    unresolvedLawyers: [...unresolved].sort(),
  };
}
