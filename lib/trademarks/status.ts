import { pendingDeadlines, type DeadlineKind, type ExtensionBasis, type ExtensionState, type TrademarkLifecycle } from '@/lib/trademark-deadlines';
import { DUE_SOON_DAYS, shortDate, type Health, type ItemState, type Phase, type TrackKey } from '@/lib/corporations/status';
import { addDays } from '@/lib/dates';
import { deadlineLabel } from '@/lib/trademarks/actions';

/**
 * A mark's status, in the same shape the stored read model holds for
 * companies (subject_status / subject_status_items), so the list, the
 * deadline dashboard and the portal read marks the way they read companies.
 *
 * Prosecution deadlines (the issuance fees, each Office Action response, a
 * revival) sit on the `application` track; everything owed to keep a
 * registration alive (DAUs, renewal) on `compliance`.
 */

export interface TrademarkStatusItem {
  key: string;
  kind: DeadlineKind;
  track: TrackKey;
  label: string;
  state: ItemState;
  dueDate: string;
  detail: string | null;
  opens: string | null;
  extendedDue: string | null;
  extensionBasis: ExtensionBasis | null;
  /** The round an `OA Response` answers, so a one-click button can name it. */
  officeAction: { id: string; final: boolean } | null;
  /** Where a request to extend it stands, when one was filed. */
  extension: ExtensionState | null;
}

export interface TrademarkStatus {
  phase: Phase;
  health: Health;
  overdue: number;
  dueSoon: number;
  waitingOnClient: boolean;
  items: TrademarkStatusItem[];
  next: TrademarkStatusItem | null;
}

const PROSECUTION = new Set<DeadlineKind>(['1st Publication Fee', 'Issuance Fee', 'OA Response', 'Revival']);

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export function buildTrademarkStatus(
  t: TrademarkLifecycle & { status: string },
  { today, waitingOnClient = false }: { today: string; waitingOnClient?: boolean },
): TrademarkStatus {
  const owed = pendingDeadlines(t);
  // Abandoned with nothing left to do; a revival still open keeps it in play.
  if (t.status === 'Abandoned' && owed.length === 0) {
    return { phase: 'dissolved', health: 'grey', overdue: 0, dueSoon: 0, waitingOnClient: false, items: [], next: null };
  }
  const soon = addDays(today, DUE_SOON_DAYS);
  const items: TrademarkStatusItem[] = owed.map((d) => {
    const overdue = d.due < today;
    const notYetOpen = !!d.opens && d.opens > today;
    return {
      // A round's id keeps two Office Actions due the same day apart.
      key: `${slug(d.kind)}:${d.officeAction?.id ?? d.localDeadlineId ?? d.irId ?? d.due}`,
      kind: d.kind,
      track: PROSECUTION.has(d.kind) ? 'application' : 'compliance',
      label: d.title ?? deadlineLabel(d.kind, d.officeAction),
      state: overdue ? 'overdue' : waitingOnClient ? 'waiting_on_client' : 'not_started',
      dueDate: d.due,
      detail: notYetOpen
        ? `Window opens ${shortDate(d.opens!)}`
        : d.extension === 'pending'
          ? 'Extended — awaiting IPOPHL’s decision'
          : d.extension === 'denied'
            ? 'Extension denied — original period'
            : d.extendedDue
          ? `${d.extensionBasis === 'surcharge' ? 'With surcharge until' : 'Extendible to'} ${shortDate(d.extendedDue)}`
          : null,
      opens: d.opens,
      extendedDue: d.extendedDue,
      extensionBasis: d.extensionBasis,
      officeAction: d.officeAction ?? null,
      extension: d.extension ?? null,
    };
  });
  const overdue = items.filter((i) => i.state === 'overdue').length;
  const dueSoon = items.filter((i) => i.state !== 'overdue' && i.dueDate <= soon).length;
  return {
    phase: t.status === 'Registered' ? 'ongoing' : 'application',
    health: overdue ? 'red' : dueSoon || waitingOnClient ? 'amber' : 'green',
    overdue,
    dueSoon,
    waitingOnClient,
    items,
    next: items[0] ?? null,
  };
}
