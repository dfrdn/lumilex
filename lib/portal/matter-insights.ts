import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';
import { isFiledDeliverable, isSentStatusReport } from '@/lib/portal/deliverable-visibility';
import { MATTER_STATUS } from '@/lib/matter-status';
// ── Pure helpers behind the portal matters dashboard ──────────────────
//
// Related-case groups mirror the firm-side matter groups (lib/queries/
// matter-groups.ts): connected components over `related_matter_ids` +
// `parent_matter_id`, restricted to the matters the client can already see.
// Edges pointing outside that set are ignored, so a client never learns that
// a matter links to something they can't view.

export interface PortalMatterLike {
  notion_id: string;
  name: string;
  matter_code: string | null;
  status: string | null;
  outcome: string | null;
  is_case: boolean | null;
  related_matter_ids: string[] | null;
  parent_matter_id: string | null;
}

// ── Client-facing vocabulary ──────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  Ongoing: 'Active',
  Done: 'Concluded',
  Archived: DELIVERABLE_STATUS.ARCHIVED,
};

export function portalStatusLabel(status: string | null): string {
  if (!status) return '';
  return STATUS_LABELS[status] ?? status;
}

export type OutcomeKey = 'Win' | 'Settled' | 'Terminated' | 'Loss';

export const OUTCOME_LABELS: Record<OutcomeKey, string> = {
  Win: 'Won',
  Settled: 'Settled',
  Terminated: 'Terminated',
  Loss: 'Lost',
};

// ── Outcome & engagement stats ────────────────────────────────────────

export interface PortalMatterStats {
  total: number;
  active: number;
  concluded: number;
  courtCases: number;
  outcomes: Record<OutcomeKey, number>;
  /** Matters with any recorded outcome. */
  decided: number;
  /** Won or settled. */
  favorable: number;
}

export function computeMatterStats(rows: PortalMatterLike[]): PortalMatterStats {
  const outcomes: Record<OutcomeKey, number> = { Win: 0, Settled: 0, Terminated: 0, Loss: 0 };
  let active = 0;
  let concluded = 0;
  let courtCases = 0;
  for (const row of rows) {
    if (row.status === MATTER_STATUS.ONGOING) active++;
    else if (row.status === MATTER_STATUS.DONE || row.status === MATTER_STATUS.ARCHIVED) concluded++;
    if (row.is_case) courtCases++;
    const outcome = (row.outcome ?? '').trim() as OutcomeKey;
    if (outcome && outcome in outcomes) outcomes[outcome]++;
  }
  const decided = outcomes.Win + outcomes.Settled + outcomes.Terminated + outcomes.Loss;
  return {
    total: rows.length,
    active,
    concluded,
    courtCases,
    outcomes,
    decided,
    favorable: outcomes.Win + outcomes.Settled,
  };
}

// ── Work delivered (engagement-wide) ──────────────────────────────────

export interface WorkDeliveredInput {
  deliverables: { status: string | null; type: string | null }[];
  hearings: { date: string | null; type: string | null; status: string | null }[];
  meetings: { date_start: string | null }[];
}

export interface WorkDelivered {
  filings: number;
  statusReports: number;
  hearingsAttended: number;
  meetingsHeld: number;
}


export function computeWorkDelivered(input: WorkDeliveredInput, nowMs: number): WorkDelivered {
  let filings = 0;
  let statusReports = 0;
  for (const d of input.deliverables) {
    if (isSentStatusReport(d)) statusReports++;
    else if (isFiledDeliverable(d)) filings++;
  }

  // Hearing statuses are mostly blank, so "attended" means: already past,
  // not cancelled, and not a filing-deadline row masquerading as a hearing.
  let hearingsAttended = 0;
  for (const h of input.hearings) {
    if (!h.date || new Date(h.date).getTime() >= nowMs) continue;
    if (h.status === 'Cancelled') continue;
    if ((h.type ?? '').toLowerCase().includes('filing')) continue;
    hearingsAttended++;
  }

  let meetingsHeld = 0;
  for (const m of input.meetings) {
    if (m.date_start && new Date(m.date_start).getTime() < nowMs) meetingsHeld++;
  }

  return { filings, statusReports, hearingsAttended, meetingsHeld };
}

// ── Related-case groups (connected components) ────────────────────────

export interface PortalMatterGroup {
  /** Canonical id = min(notion_id) of the component — stable across loads. */
  id: string;
  /** Name of the most recently opened member (highest matter-code sequence). */
  name: string;
  memberIds: string[];
}

class DSU {
  private parent = new Map<string, string>();
  find(x: string): string {
    const p = this.parent.get(x);
    if (!p || p === x) {
      this.parent.set(x, x);
      return x;
    }
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (ra < rb) this.parent.set(rb, ra);
    else this.parent.set(ra, rb);
  }
}

/** Trailing number of a matter code ("103-20-9" → 9); -Infinity when absent. */
function matterCodeSequence(code: string | null): number {
  if (!code) return -Infinity;
  const nums = code.match(/\d+/g);
  if (!nums || nums.length === 0) return -Infinity;
  return Number(nums[nums.length - 1]);
}

/**
 * Groups of two or more interrelated matters, largest first. Singletons are
 * not returned — a "group" of one is just a matter.
 */
export function computePortalGroups(rows: PortalMatterLike[]): PortalMatterGroup[] {
  const present = new Set(rows.map((r) => r.notion_id));
  const dsu = new DSU();
  for (const row of rows) {
    for (const other of row.related_matter_ids ?? []) {
      if (present.has(other)) dsu.union(row.notion_id, other);
    }
    if (row.parent_matter_id && present.has(row.parent_matter_id)) {
      dsu.union(row.notion_id, row.parent_matter_id);
    }
  }

  const byRoot = new Map<string, PortalMatterLike[]>();
  for (const row of rows) {
    const root = dsu.find(row.notion_id);
    const list = byRoot.get(root) ?? [];
    list.push(row);
    byRoot.set(root, list);
  }

  const groups: PortalMatterGroup[] = [];
  for (const [root, members] of byRoot) {
    if (members.length < 2) continue;
    const best = [...members].sort(
      (a, b) => matterCodeSequence(b.matter_code) - matterCodeSequence(a.matter_code),
    )[0];
    groups.push({
      id: root,
      name: best?.name || members[0].name,
      memberIds: members.map((m) => m.notion_id).sort(),
    });
  }
  groups.sort((a, b) => b.memberIds.length - a.memberIds.length || a.name.localeCompare(b.name));
  return groups;
}

/** matterId → group, for badge lookups on cards. */
export function groupMembershipIndex(groups: PortalMatterGroup[]): Map<string, PortalMatterGroup> {
  const index = new Map<string, PortalMatterGroup>();
  for (const g of groups) {
    for (const id of g.memberIds) index.set(id, g);
  }
  return index;
}
