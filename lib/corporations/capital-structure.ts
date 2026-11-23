import type { CorporationPerson } from '@/types/corporations';

/**
 * The GIS capital-structure grid, derived from the share classes and the
 * shareholder list.
 *
 * Subscribed and paid-up capital are never stored: they are a reading of who
 * holds what. Keeping separate totals would give the form a second source of
 * truth that drifts the moment a shareholding is edited.
 */

export interface ShareClass {
  id: number;
  corporationId: string;
  className: string;
  parValue: number | null;
  authorizedShares: number | null;
  sortOrder: number;
}

export interface AuthorizedRow {
  className: string;
  shares: number | null;
  parValue: number | null;
  /** shares × par value, when both are known. */
  amount: number | null;
}

/** One line of the subscribed or paid-up grid: a nationality × share class. */
export interface HoldingRow {
  nationality: string;
  className: string;
  stockholders: number;
  shares: number | null;
  parValue: number | null;
  amount: number;
  /** Share of the total amount in this section, 0-100. */
  percent: number;
}

export interface HoldingSection {
  filipino: HoldingRow[];
  foreign: HoldingRow[];
  total: number;
}

export interface CapitalStructure {
  authorized: AuthorizedRow[];
  authorizedTotal: number | null;
  subscribed: HoldingSection;
  paidUp: HoldingSection;
  /** Foreign share of subscribed capital, 0-100 — the equity cap test. */
  foreignEquityPercent: number;
}

/**
 * SEC treats Filipino equity as one block and every other nationality as its
 * own line, so the split is on the nationality string rather than a flag.
 */
export function isFilipino(nationality: string | null | undefined): boolean {
  const n = (nationality ?? '').trim().toLowerCase();
  return n === 'filipino' || n === 'filipina' || n === 'philippine' || n === 'philippines';
}

/** A person counts toward capital only if they actually hold something. */
function holds(p: CorporationPerson): boolean {
  return (p.sharesSubscribedAmount ?? 0) > 0 || (p.sharesPaidAmount ?? 0) > 0;
}

/**
 * Collapse a person's several role rows into one holding.
 *
 * corporation_persons has a row per role, so summing it directly counts a
 * director-who-is-also-an-incorporator's shares two or three times over — which
 * would silently inflate subscribed capital on a filed form. Keyed on the
 * person record, falling back to TIN, then name.
 */
export function dedupeHoldings(people: CorporationPerson[]): CorporationPerson[] {
  const byKey = new Map<string, CorporationPerson>();
  for (const p of people) {
    if (!holds(p)) continue;
    const name = p.isJuridical ? (p.entityName ?? '') : `${p.firstName} ${p.lastName}`.trim();
    const key = p.personRecordId ?? ((p.tin?.trim() || name.toLowerCase()) || `id-${p.id}`);
    const existing = byKey.get(key);
    if (!existing || (existing.sharesSubscribedAmount ?? 0) < (p.sharesSubscribedAmount ?? 0)) {
      byKey.set(key, p);
    }
  }
  return [...byKey.values()];
}

function buildSection(
  holders: CorporationPerson[],
  classes: ShareClass[],
  amountOf: (p: CorporationPerson) => number,
): HoldingSection {
  const parByClass = new Map(classes.map((c) => [c.className.toLowerCase(), c.parValue]));

  // Group on (nationality, class) — the exact shape of a GIS grid line.
  const groups = new Map<string, HoldingRow>();
  for (const p of holders) {
    const amount = amountOf(p);
    if (amount <= 0) continue;
    const nationality = (p.nationality ?? '').trim() || 'Unspecified';
    const className = (p.shareClass ?? '').trim() || (classes[0]?.className ?? 'Common');
    const key = `${nationality.toLowerCase()}|${className.toLowerCase()}`;

    const row = groups.get(key) ?? {
      nationality,
      className,
      stockholders: 0,
      shares: null,
      parValue: parByClass.get(className.toLowerCase()) ?? null,
      amount: 0,
      percent: 0,
    };
    row.stockholders += 1;
    row.amount += amount;
    if (p.sharesSubscribedCount != null) row.shares = (row.shares ?? 0) + p.sharesSubscribedCount;
    groups.set(key, row);
  }

  const rows = [...groups.values()];
  const total = rows.reduce((n, r) => n + r.amount, 0);
  for (const r of rows) r.percent = total > 0 ? (r.amount / total) * 100 : 0;

  const byAmount = (a: HoldingRow, b: HoldingRow) => b.amount - a.amount;
  return {
    filipino: rows.filter((r) => isFilipino(r.nationality)).sort(byAmount),
    foreign: rows.filter((r) => !isFilipino(r.nationality)).sort(byAmount),
    total,
  };
}

export function buildCapitalStructure(
  classes: ShareClass[],
  people: CorporationPerson[],
): CapitalStructure {
  const ordered = [...classes].sort((a, b) => a.sortOrder - b.sortOrder);

  const authorized: AuthorizedRow[] = ordered.map((c) => ({
    className: c.className,
    shares: c.authorizedShares,
    parValue: c.parValue,
    amount:
      c.authorizedShares != null && c.parValue != null ? c.authorizedShares * c.parValue : null,
  }));

  // Null only when nothing is known — a partially-filled table still totals
  // what it has rather than reporting zero.
  const known = authorized.filter((r) => r.amount != null);
  const authorizedTotal = known.length ? known.reduce((n, r) => n + (r.amount ?? 0), 0) : null;

  const holders = dedupeHoldings(people);
  const subscribed = buildSection(holders, ordered, (p) => p.sharesSubscribedAmount ?? 0);
  const paidUp = buildSection(holders, ordered, (p) => p.sharesPaidAmount ?? 0);

  const foreignSubscribed = subscribed.foreign.reduce((n, r) => n + r.amount, 0);
  const foreignEquityPercent =
    subscribed.total > 0 ? (foreignSubscribed / subscribed.total) * 100 : 0;

  return { authorized, authorizedTotal, subscribed, paidUp, foreignEquityPercent };
}
