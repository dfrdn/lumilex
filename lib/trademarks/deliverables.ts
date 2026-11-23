import type { Trademark } from '@/types/notion';
import type { TrademarkAction } from '@/lib/trademarks/actions';
import type { MarkMatterLink, MarkScope } from '@/lib/trademarks/matter-links';
import { isAbroad, isDesignation, isNational, oaResponseDeadline, oaResponseOwed, pendingDeadlines } from '@/lib/trademark-deadlines';
import { officeActionName, openOfficeActions, responseName } from '@/lib/trademarks/office-actions';

/**
 * The steps on a mark that are a paper the firm prepares and files, so can be
 * a deliverable: named by the action that records them. Marking the
 * deliverable filed records the step, and recording the step marks the
 * deliverable filed (`20261030_trademark_deliverables.sql`).
 */
export const DELIVERABLE_ACTIONS = [
  'mark_as_filed', 'oa_response_filed', 'oa_response_motex', 'revival_filed',
  'dau_3_filed', 'dau_3_motex_filed', 'dau_5_filed',
  'renewal_filed', 'renewal_dau_filed', 'renewal_dau_5_filed',
] as const satisfies readonly TrademarkAction[];
export type DeliverableAction = (typeof DELIVERABLE_ACTIONS)[number];

export const isDeliverableAction = (a: string): a is DeliverableAction =>
  (DELIVERABLE_ACTIONS as readonly string[]).includes(a);

/**
 * A filing with IPOPHL, or — for a country designated abroad — with that
 * country's office, through its local agent: external work, in the
 * deliverable vocabulary Lumilex has. Its subtype stays "Other"; the step it
 * files is named by `trademark_action`.
 */
export function markDeliverableClassification(_t: Pick<Trademark, 'origin'>) {
  return { type: 'External', subtype: 'Other' } as const;
}

/** What the work is called, without the round it answers. */
const LABEL: Record<DeliverableAction, string> = {
  mark_as_filed: 'Trademark application',
  oa_response_filed: 'Response to Office Action',
  oa_response_motex: 'Request for extension',
  revival_filed: 'Petition for revival',
  dau_3_filed: '3rd-year DAU',
  dau_3_motex_filed: 'Request for extension — 3rd-year DAU',
  dau_5_filed: '5th-year DAU',
  renewal_filed: 'Renewal',
  renewal_dau_filed: 'Renewal DAU',
  renewal_dau_5_filed: 'Renewal 5th-year DAU',
};

/** The deadline each upkeep step answers, as `pendingDeadlines` names it. */
const DEADLINE: Partial<Record<DeliverableAction, string>> = {
  revival_filed: 'Revival',
  dau_3_filed: '3-DAU',
  dau_3_motex_filed: '3-DAU',
  dau_5_filed: '5-DAU',
  renewal_filed: 'Renewal',
  renewal_dau_filed: 'Renewal DAU',
  renewal_dau_5_filed: 'Renewal 5-DAU',
};

/** DAUs and renewals belong to the maintenance engagement; the rest to the filing. */
const MAINTENANCE: ReadonlySet<DeliverableAction> = new Set([
  'dau_3_filed', 'dau_3_motex_filed', 'dau_5_filed', 'renewal_filed', 'renewal_dau_filed', 'renewal_dau_5_filed',
]);

export interface MarkDeliverableOption {
  action: DeliverableAction;
  officeActionId: string | null;
  /** What the work is, e.g. "Response to Office Action 2". */
  label: string;
  /** The bar date it must be filed by, when the mark has one. */
  due: string | null;
}

/** What a linked deliverable's step is called on the mark's page. */
export function stepLabel(t: Trademark, action: DeliverableAction, officeActionId: string | null): string {
  const oa = officeActionId ? t.officeActions.find((o) => o.id === officeActionId) : null;
  if (!oa) return LABEL[action];
  const name = officeActionName(t.officeActions, oa);
  if (action === 'oa_response_motex') return `Request for extension — ${name}`;
  return oa.kind === 'final_rejection' ? `${responseName(oa)} — ${name}` : `Response to ${name}`;
}

const sameStep = (a: { action: string; officeActionId: string | null }, b: { action: string; officeActionId: string | null }) =>
  a.action === b.action && (a.officeActionId ?? null) === (b.officeActionId ?? null);

/**
 * The steps a deliverable can be started for now, with their due dates —
 * leaving out any that already has open work (`open`).
 */
export function deliverableOptions(
  t: Trademark,
  today: string,
  open: { action: string; officeActionId: string | null }[] = [],
): MarkDeliverableOption[] {
  const out: MarkDeliverableOption[] = [];
  const add = (action: DeliverableAction, due: string | null, officeActionId: string | null = null) => {
    const o = { action, officeActionId, label: stepLabel(t, action, officeActionId), due };
    if (!open.some((x) => sameStep(x, o))) out.push(o);
  };

  if (isNational(t) && (t.status === 'Prelim' || t.status === 'For Filing') && !t.filingDate) add('mark_as_filed', null);

  if (t.status === 'Pending' || t.status === 'Pending - OA') {
    for (const oa of openOfficeActions(t.officeActions)) {
      const w = oaResponseDeadline(oa);
      add('oa_response_filed', oaResponseOwed(oa).due, oa.id);
      // A designation's refusal records no MOTEX, but more time can still be asked for. A refusal
      // abroad is answered by the date on its notice, through the local agent, with no IPOPHL extension.
      if (!isAbroad(t) && !oa.motex && (isDesignation(t) || !oa.respondBy)) add('oa_response_motex', w.due, oa.id);
    }
  }

  const deadlines = pendingDeadlines(t);
  for (const action of DELIVERABLE_ACTIONS) {
    const kind = DEADLINE[action];
    const d = kind && deadlines.find((x) => x.kind === kind);
    if (!d || (d.opens && d.opens > today && action !== 'dau_3_motex_filed')) continue;
    if (action === 'dau_3_motex_filed') {
      // Offered whenever the next step offers to record the extension (journey.ts).
      if (t.dau3Motex) continue;
      add(action, d.due);
    } else {
      add(action, d.due);
    }
  }
  return out;
}

/** The deliverable's name: the mark, then the work. */
export function deliverableName(t: Trademark, label: string): string {
  return `${t.mark.trim() || 'Trademark'} — ${label}`;
}

/** The engagement the work is done under: the step's own matter first, then the retainer, then any other. */
export function matterForStep(action: DeliverableAction, links: MarkMatterLink[]): MarkMatterLink | null {
  const order: MarkScope[] = MAINTENANCE.has(action)
    ? ['trademark_maintenance', 'retainer', 'trademark', 'opposition']
    : ['trademark', 'retainer', 'trademark_maintenance', 'opposition'];
  for (const scope of order) {
    const hit = links.find((l) => l.scope === scope);
    if (hit) return hit;
  }
  return null;
}
