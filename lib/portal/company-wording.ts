import { type Health, type ItemState, type Phase, type TrackKey } from '@/lib/corporations/status';

/**
 * How the portal says the firm's status in the client's words. The team's
 * vocabulary ("overdue", "not ours", "housekeeping") is shorthand for people
 * who do the work; a client wants to know what it is, when, and whether
 * anything is needed from them.
 */

export const TRACK_COPY: Record<TrackKey, { title: string; blurb: string }> = {
  application: { title: 'Incorporation', blurb: 'Registering the company with the SEC' },
  registrations: { title: 'Registrations', blurb: 'BIR, business permit, SSS, PhilHealth and Pag-IBIG' },
  housekeeping: { title: 'Corporate records', blurb: 'Board and stockholders’ meetings, minutes and books' },
  compliance: { title: 'Annual filings', blurb: 'GIS, audited financial statements, income tax and permits' },
};

export const PHASE_COPY: Record<Phase, { title: string; body: string }> = {
  application: { title: 'Being registered', body: 'We are preparing and filing the papers that bring the company into existence.' },
  post_registration: { title: 'Getting set up', body: 'The company is registered. We are completing the registrations it needs to operate.' },
  ongoing: { title: 'In good standing', body: 'Set-up is done. We keep the annual filings and corporate records on schedule.' },
  dissolved: { title: 'Dissolved', body: 'The company has been dissolved.' },
};

export type ClientTone = 'red' | 'amber' | 'gold' | 'green' | 'navy' | 'neutral';

/** A filing's state, as a short chip. `null` means the item is not shown to the client: past-due items and ones the firm doesn't handle. */
export function stateChip(state: ItemState): { label: string; tone: ClientTone } | null {
  switch (state) {
    case 'overdue': return null; // the team chases these; the client never sees them
    case 'waiting_on_client': return { label: 'Needs you', tone: 'gold' };
    case 'in_progress': return { label: 'In progress', tone: 'navy' };
    case 'filed': return { label: 'Filed', tone: 'green' };
    case 'done': return { label: 'Done', tone: 'green' };
    case 'not_started': return { label: 'Scheduled', tone: 'neutral' };
    case 'not_ours': return null;
  }
}

/** One line for how a track is going — never the team's own summary, which speaks in firm shorthand. */
export function trackLine(t: { health: Health; done: number; total: number }): string {
  if (t.total > 0 && t.done >= t.total) return 'All done';
  if (t.health === 'amber') return 'Something is due soon';
  if (t.health === 'green') return 'On track';
  return t.done === 0 ? 'Not started yet' : 'In progress';
}

/** One line for a company's overall standing. */
export function standing(input: { health: Health | null; dueSoon: number; waitingOnClient: boolean; phase: Phase | null }): {
  label: string;
  tone: ClientTone;
} {
  if (input.phase === 'dissolved') return { label: 'Dissolved', tone: 'neutral' };
  if (input.waitingOnClient) return { label: 'Waiting on you', tone: 'gold' };
  if (input.dueSoon > 0) return { label: 'Something due soon', tone: 'amber' };
  if (input.health === 'green') return { label: 'On track', tone: 'green' };
  return { label: 'In progress', tone: 'navy' };
}

/**
 * "In 12 days", "Today", "In 3 months" — relative to Manila's today. A past
 * date gives nothing: the stored status can lag the calendar by a day, and a
 * client is never told something is late (see `forClient`).
 */
export function whenFromToday(due: string | null, today: string): string | null {
  if (!due) return null;
  const d = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (d < 0) return null;
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d < 45) return `In ${d} days`;
  const months = Math.round(d / 30);
  return months <= 1 ? 'In a month' : `In ${months} months`;
}

/** A mark's deadline, by its kind, in the client's words. */
export const MARK_DEADLINE_COPY: Record<string, string> = {
  '1st Publication Fee': 'Publication fee',
  'Issuance Fee': 'Issuance fee',
  'OA Response': 'Response to the examiner (Office Action)',
  Revival: 'Reviving the application',
  '3-DAU': 'Declaration of Actual Use — 3rd year',
  '5-DAU': 'Declaration of Actual Use — 5th year',
  Renewal: 'Renewal of the registration',
  'Renewal DAU': 'Declaration of Actual Use after renewal',
  'Renewal 5-DAU': 'Declaration of Actual Use — 5th year after renewal',
  'Local Filing': 'A filing the designated country requires',
  'IR Renewal': 'Renewal of the international registration (through WIPO)',
};

/** A Madrid designation's own words: its objections are refusals, and it is protected rather than registered. */
const DESIGNATION_DEADLINE_COPY: Record<string, string> = {
  'OA Response': 'Response to the refusal',
};

/** A mark's deadline in the client's words, by its kind. */
export function markDeadlineCopy(kind: string, designation: boolean): string | undefined {
  return (designation ? DESIGNATION_DEADLINE_COPY[kind] : undefined) ?? MARK_DEADLINE_COPY[kind];
}

/** Where a mark stands, as the client reads it. */
export const MARK_STATUS_COPY: Record<string, { label: string; tone: ClientTone }> = {
  Prelim: { label: 'Preparing the application', tone: 'neutral' },
  'For Filing': { label: 'Ready to file', tone: 'navy' },
  Pending: { label: 'Under examination', tone: 'navy' },
  'Pending - OA': { label: 'Responding to the examiner', tone: 'navy' },
  Registered: { label: 'Registered', tone: 'green' },
  Abandoned: { label: 'Abandoned', tone: 'neutral' },
};

const DESIGNATION_STATUS_COPY: Record<string, { label: string; tone: ClientTone }> = {
  'Pending - OA': { label: 'Responding to the refusal', tone: 'navy' },
  Registered: { label: 'Protected', tone: 'green' },
};

/** Where a mark stands, as the client reads it — a designation's protection in its own words. */
export function markStatusCopy(status: string, designation: boolean): { label: string; tone: ClientTone } {
  return (designation ? DESIGNATION_STATUS_COPY[status] : undefined) ?? MARK_STATUS_COPY[status] ?? { label: status, tone: 'neutral' };
}
