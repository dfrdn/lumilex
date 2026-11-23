/**
 * Splits the lawyer-grouped DTR line items into "within retainer cap" and
 * "beyond retainer cap" buckets, mirroring the math in compute-bundle-fees.ts:
 *
 *   • Sort all entries by seniority (most senior first), then chronological.
 *   • Walk through accumulating hours.
 *   • Entries fully under the cap → "within" (absorbed by the flat retainer).
 *   • Entries fully over the cap → "beyond" (billed at the lawyer's hourly rate).
 *   • Entry straddling the cap → split into two — within portion + beyond portion.
 *   • Re-group by lawyer so the breakdown renders one block per lawyer per bucket.
 *
 * When cap is null/0, returns everything as "within" (caller will treat it as
 * a no-retainer "Professional Fees" section).
 */

import { getSeniorityRank } from '@/lib/billing/seniority';
import type { LawyerBlock, LawyerEntry } from '@/lib/billing/breakdown-types';

// ── Input shape ─────────────────────────────────────────────────────
// Mirrors the lawyer-grouped lineItems coming from `fetchBillingData`.
// Loose typing on purpose so this helper can be called from JS callers
// without friction.

interface LineItemEntry {
  date: string;
  remarks?: string;
  task?: string;
  description?: string;
  /** Whole hours and minutes — informational; only `decimalHours` is used by
   *  the splitter. Optional so callers that already have decimal hours don't
   *  need to round-trip. */
  hours?: number;
  minutes?: number;
  decimalHours: number;
  rawDtrId?: string | null;
  matterId?: string | null;
  /** Matter identity for the per-matter grouping in the breakdown. */
  matterName?: string | null;
  matterCode?: string | null;
  /** Per-entry rate override (e.g. matter `hourly_rate_override`). When set,
   *  takes precedence over the lawyer-level `hourlyRate`. */
  hourlyRate?: number;
  /** Waived (goodwill): shown but billed at ₱0 — excluded from charges and from
   *  retainer-cap consumption. */
  waived?: boolean;
}

interface LineItem {
  lawyerName?: string;
  name?: string;
  position?: string;
  hourlyRate?: number;
  totalHours?: number;
  amount?: number;
  entries?: LineItemEntry[];
  /** Optional initials carried through to the resulting LawyerBlock. */
  initials?: string;
}

interface CapSplitResult {
  within: LawyerBlock[];
  beyond: LawyerBlock[];
}

/** Default LawyerBlock conversion — used when there's no cap to split against.
 *  Sorted most-senior-first so the breakdown blocks match the cap-split path
 *  (regroupByLawyer also sorts by seniority). */
const nameOf = (l: LineItem): string => l.lawyerName ?? l.name ?? '—';

export function buildLawyerBlocks(lineItems: LineItem[]): LawyerBlock[] {
  return [...lineItems]
    .sort((a, b) => {
      const s = getSeniorityRank(a.position) - getSeniorityRank(b.position);
      if (s !== 0) return s;
      return nameOf(a).localeCompare(nameOf(b), 'en');
    })
    .map((l) => ({
    name: l.lawyerName ?? l.name ?? '—',
    initials: l.initials,
    position: l.position,
    entries: (l.entries ?? [])
      .map((e) => ({
        date: e.date,
        hours: e.decimalHours ?? 0,
        description: e.description || e.remarks || e.task || '',
        hourlyRate: e.hourlyRate ?? l.hourlyRate ?? 0,
        waived: e.waived ?? false,
        matterId: e.matterId ?? null,
        matterName: e.matterName ?? null,
        matterCode: e.matterCode ?? null,
      }))
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')),
  }));
}

export function splitLineItemsAtCap(
  lineItems: LineItem[],
  retainerHoursCap: number | null | undefined,
): CapSplitResult {
  if (!retainerHoursCap || retainerHoursCap <= 0) {
    return { within: buildLawyerBlocks(lineItems), beyond: [] };
  }

  interface Flat {
    lawyerName: string;
    initials?: string;
    position: string;
    hourlyRate: number;
    date: string;
    hours: number;
    description: string;
    waived: boolean;
    matterId: string | null;
    matterName: string | null;
    matterCode: string | null;
  }
  const flat: Flat[] = [];
  for (const l of lineItems) {
    const lawyerName = l.lawyerName ?? l.name ?? '—';
    const position = l.position ?? '';
    const lawyerRate = l.hourlyRate ?? 0;
    for (const e of l.entries ?? []) {
      const hours = e.decimalHours ?? 0;
      if (hours <= 0) continue;
      flat.push({
        lawyerName,
        initials: l.initials,
        position,
        hourlyRate: e.hourlyRate ?? lawyerRate,
        date: e.date ?? '',
        hours,
        description: e.description || e.remarks || e.task || '',
        waived: e.waived ?? false,
        matterId: e.matterId ?? null,
        matterName: e.matterName ?? null,
        matterCode: e.matterCode ?? null,
      });
    }
  }

  // Most senior first (cap is absorbed by senior hours), then by name, then
  // chronological. Two people at the same position tie on seniority, and a tie
  // left to sort stability absorbs the cap in whatever order the entries
  // arrived — the name keeps it deterministic. computeBundleFees sorts the same
  // way so the preview and the invoice absorb the cap identically.
  flat.sort((a, b) => {
    const s = getSeniorityRank(a.position) - getSeniorityRank(b.position);
    if (s !== 0) return s;
    const n = a.lawyerName.localeCompare(b.lawyerName, 'en');
    if (n !== 0) return n;
    return a.date.localeCompare(b.date);
  });

  let cum = 0;
  const cap = retainerHoursCap;
  const withinFlat: Flat[] = [];
  const beyondFlat: Flat[] = [];
  for (const e of flat) {
    // Waived hours are goodwill — they neither consume the cap nor get charged.
    // They keep their place in the seniority/date walk, so a waived entry
    // rendered after the cap was crossed sits among the beyond-cap rows (still
    // struck through, still ₱0) instead of jumping back into the within section.
    if (e.waived) {
      (cum >= cap ? beyondFlat : withinFlat).push(e);
      continue;
    }
    const after = cum + e.hours;
    if (after <= cap) {
      withinFlat.push(e);
    } else if (cum >= cap) {
      beyondFlat.push(e);
    } else {
      // Straddles the cap — split the entry into two.
      const withinPortion = cap - cum;
      const beyondPortion = e.hours - withinPortion;
      withinFlat.push({ ...e, hours: withinPortion });
      beyondFlat.push({ ...e, hours: beyondPortion });
    }
    cum = after;
  }

  return {
    within: regroupByLawyer(withinFlat),
    beyond: regroupByLawyer(beyondFlat),
  };
}

function regroupByLawyer(flat: Array<{
  lawyerName: string;
  initials?: string;
  position: string;
  hourlyRate: number;
  date: string;
  hours: number;
  description: string;
  waived: boolean;
  matterId: string | null;
  matterName: string | null;
  matterCode: string | null;
}>): LawyerBlock[] {
  const groups = new Map<string, LawyerBlock & { __rate: number }>();
  for (const e of flat) {
    let g = groups.get(e.lawyerName);
    if (!g) {
      g = {
        name: e.lawyerName,
        initials: e.initials,
        position: e.position,
        entries: [],
        __rate: e.hourlyRate,
      };
      groups.set(e.lawyerName, g);
    }
    const out: LawyerEntry = {
      date: e.date,
      hours: Math.round(e.hours * 100) / 100,
      description: e.description,
      hourlyRate: e.hourlyRate,
      waived: e.waived,
      matterId: e.matterId,
      matterName: e.matterName,
      matterCode: e.matterCode,
    };
    g.entries.push(out);
  }
  const result = [...groups.values()].sort((a, b) => {
    const s = getSeniorityRank(a.position) - getSeniorityRank(b.position);
    if (s !== 0) return s;
    return a.name.localeCompare(b.name, 'en');
  });
  // Strip the internal __rate field before returning.
  return result.map(({ __rate: _r, ...rest }) => rest);
}

/**
 * Pulls retainer cap + monthly retainer from a collection of matter billing
 * configs (typically every config for one client). First non-null/positive
 * value wins for each field — matches the legacy "first matching config"
 * behavior used historically by compute-bundle-fees and dtr-export so they
 * stay in agreement.
 */
export function resolveBundleRetainerParams(
  configs: Iterable<{
    retainer_hours_cap: number | null;
    monthly_retainer: number | null;
  }>,
): { retainerHoursCap: number | null; monthlyRetainer: number } {
  let retainerHoursCap: number | null = null;
  let monthlyRetainer = 0;
  for (const cfg of configs) {
    if (retainerHoursCap == null && cfg.retainer_hours_cap != null) {
      const cap = Number(cfg.retainer_hours_cap);
      if (!isNaN(cap) && cap > 0) retainerHoursCap = cap;
    }
    if (monthlyRetainer === 0 && cfg.monthly_retainer != null) {
      const r = Number(cfg.monthly_retainer);
      if (!isNaN(r) && r > 0) monthlyRetainer = r;
    }
    if (retainerHoursCap != null && monthlyRetainer > 0) break;
  }
  return { retainerHoursCap, monthlyRetainer };
}

/**
 * Cap-aware legal-fee roll-up shared by the Generate preview (fetch-billing-data)
 * and the persisted invoice (persist-invoice) so the two can't drift apart.
 * Given the lawyer-grouped line items, the retainer hours cap, the resolved
 * monthly retainer, and the fee lines, returns the within/beyond cap split plus:
 *   - chargedHourly: beyond-cap hourly (cap set) or all hours (no cap)
 *   - nonRetainerFeeLineTotal: fee lines excluding the `retainer` kind (it's
 *     represented once via monthlyRetainer)
 *   - legalFees: monthlyRetainer + chargedHourly + nonRetainerFeeLineTotal
 */
export function computeCapAwareFees(
  lineItems: LineItem[],
  retainerHoursCap: number | null | undefined,
  monthlyRetainer: number,
  feeLines: Array<{ kind: string; amount?: number | null }>,
): {
  within: LawyerBlock[];
  beyond: LawyerBlock[];
  chargedHourly: number;
  monthlyRetainer: number;
  nonRetainerFeeLineTotal: number;
  legalFees: number;
} {
  // An hours cap only absorbs hours when there's a flat monthly retainer for
  // them to be absorbed INTO. A cap with no retainer (₱0) is meaningless — the
  // hours would otherwise be billed at ₱0 with nothing offsetting them — so we
  // treat it as no cap and charge every hour.
  const hasCap = retainerHoursCap != null && retainerHoursCap > 0 && monthlyRetainer > 0;
  const { within, beyond } = splitLineItemsAtCap(lineItems, hasCap ? retainerHoursCap : null);
  // Waived entries carry hours×rate for display but bill at ₱0, so they're
  // excluded from every charged total. With a cap, only beyond-cap hours are
  // charged (waived never land there). Without a cap, subtract the waived portion
  // from the group-level amounts — preserving the exact non-waived total (no
  // per-entry rounding drift) so behavior is unchanged when nothing is waived.
  const noCapWaived = lineItems.reduce(
    (s, l) => s + (l.entries ?? []).reduce(
      (es, e) => es + (e.waived ? (e.decimalHours ?? 0) * (e.hourlyRate ?? l.hourlyRate ?? 0) : 0), 0),
    0);
  const chargedHourly = hasCap
    ? beyond.reduce((s, blk) => s + blk.entries.reduce((es, e) => es + (e.waived ? 0 : e.hours * (e.hourlyRate ?? 0)), 0), 0)
    : Math.round((lineItems.reduce((s, l) => s + (l.amount ?? 0), 0) - noCapWaived) * 100) / 100;
  const nonRetainerFeeLineTotal = (feeLines ?? [])
    .filter((f) => f.kind !== 'retainer')
    .reduce((s, f) => s + (f.amount ?? 0), 0);
  const legalFees = monthlyRetainer + chargedHourly + nonRetainerFeeLineTotal;
  return { within, beyond, chargedHourly, monthlyRetainer, nonRetainerFeeLineTotal, legalFees };
}
