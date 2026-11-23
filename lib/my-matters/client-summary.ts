import { addDays, daysBetween, toManilaDay, type DayString } from '@/lib/dates';
import type { PartnerMatterView } from '@/lib/queries/partner-matters';

/** An ongoing matter counts as idle once nothing has happened on it for this long. */
export const IDLE_DAYS = 30;
/** Hearings this close count toward a client's "coming up". */
export const HEARING_WINDOW_DAYS = 14;

type SummaryInput = Pick<
  PartnerMatterView,
  'clientId' | 'clientName' | 'status' | 'lastActivityAt' | 'pendingDeliverables' | 'upcomingHearings'
>;

export interface ClientSummary {
  clientId: string;
  clientName: string;
  matters: number;
  overdue: number;
  hearingsSoon: number;
  idle: number;
}

/** How much a client needs looking at: overdue work first, then idle matters. */
function attention(c: ClientSummary): number {
  return c.overdue * 3 + c.idle * 2 + c.hearingsSoon;
}

/** One row per client, the ones needing a look first. */
export function summarizeClients(matters: SummaryInput[], today: DayString): ClientSummary[] {
  const horizon = addDays(today, HEARING_WINDOW_DAYS);
  const byClient = new Map<string, ClientSummary>();
  for (const m of matters) {
    let c = byClient.get(m.clientId);
    if (!c) {
      c = { clientId: m.clientId, clientName: m.clientName, matters: 0, overdue: 0, hearingsSoon: 0, idle: 0 };
      byClient.set(m.clientId, c);
    }
    c.matters += 1;
    c.overdue += m.pendingDeliverables.filter((d) => d.overdue).length;
    c.hearingsSoon += m.upcomingHearings.filter((h) => h.date && h.date <= horizon).length;
    if (m.status === 'Ongoing') {
      const quiet = m.lastActivityAt ? daysBetween(toManilaDay(m.lastActivityAt), today) : null;
      if (quiet === null || quiet >= IDLE_DAYS) c.idle += 1;
    }
  }
  return [...byClient.values()].sort(
    (a, b) => attention(b) - attention(a) || a.clientName.localeCompare(b.clientName),
  );
}

