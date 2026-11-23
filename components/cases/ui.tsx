import { StatusPill } from '@/components/ui/primitives';
import type { PillTone } from '@/components/ui/tone';
import type { CaseStatus } from '@/lib/cases/view';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';

export const CASE_STATUS: Record<CaseStatus, { label: string; tone: PillTone; hint: string }> = {
  evaluation: { label: 'Evaluation', tone: 'amber', hint: 'Being studied — nothing filed yet' },
  active: { label: 'Active', tone: 'blue', hint: 'A proceeding is still open' },
  closed: { label: 'Closed', tone: 'neutral', hint: 'Resolved, settled or not pursued' },
};

/** A filing's draft status as a tone: in the works, waiting on the client, or ready to go out. */
export function filingTone(status: string): PillTone {
  if (status === DELIVERABLE_STATUS.AWAITING_CLIENT) return 'amber';
  if (status === DELIVERABLE_STATUS.OUTBOX) return 'emerald';
  if (status === DELIVERABLE_STATUS.NOT_STARTED || !status) return 'neutral';
  return 'blue';
}

export function CaseStatusPill({ status, size }: { status: CaseStatus; size?: 'sm' | 'md' }) {
  const s = CASE_STATUS[status];
  return <StatusPill label={s.label} tone={s.tone} hint={s.hint} size={size} />;
}

export function casesHref(params: Record<string, string | undefined>, patch: Record<string, string | undefined>): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) next.set(k, v);
  const qs = next.toString();
  return `/dashboard/cases${qs ? `?${qs}` : ''}`;
}

/** "Mon 19 Oct, 9:00 AM" in Manila. */
export function hearingWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
  });
}

/** The Manila calendar day of a timestamp, for the due chips. */
export function manilaDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}
