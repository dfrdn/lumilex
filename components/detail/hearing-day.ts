import type { PillTone } from '@/components/ui/tone';
import { daysFromToday, manilaDay } from '@/lib/list-cards';
import { isDateOnly } from '@/lib/dates';

export type HearingDateStatus = 'past' | 'today' | 'upcoming' | 'none';

/**
 * A hearing's Manila day, how it sits against Manila today, "In 3 days"-style
 * distance, and its time. Shared by the server header and the client body so
 * a date edit shows in the body without a reload.
 */
export function hearingDay(iso: string | null, now: Date = new Date()) {
  if (!iso) return { dateStr: null, status: 'none' as HearingDateStatus, daysLabel: '', timeStr: null };
  const dateStr = manilaDay(iso);
  const diff = daysFromToday(dateStr, now) ?? 0;
  const status: HearingDateStatus = diff < 0 ? 'past' : diff === 0 ? 'today' : 'upcoming';
  const daysLabel =
    diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : diff > 0 ? `In ${diff} days` : `${-diff} days ago`;
  // A hearing entered without a time is stored at Manila midnight (older rows: UTC midnight).
  const timeStr = isDateOnly(iso)
    ? null
    : new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' });
  return { dateStr, status, daysLabel, timeStr };
}

/** What became of the hearing: the attended flag counts even when status is blank. */
export function hearingOutcome(status: string, isAttended: boolean, dateStatus: HearingDateStatus): { label: string; tone: PillTone } {
  const s = status.toLowerCase();
  if (s === 'cancelled' || s === 'canceled') return { label: 'Cancelled', tone: 'muted' };
  if (isAttended || s === 'attended' || s === 'done' || s === 'completed') return { label: 'Attended', tone: 'emerald' };
  if (s === 'postponed' || s === 'reset') return { label: status, tone: 'amber' };
  if (dateStatus === 'past') return { label: 'No outcome recorded', tone: 'rose' };
  if (dateStatus === 'today') return { label: 'Today', tone: 'amber' };
  return { label: status || 'Scheduled', tone: 'blue' };
}
