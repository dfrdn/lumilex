import type { PillTone } from '@/components/ui/tone';
import { DELIVERABLE_STATUS_TONE } from '@/lib/deliverable-status';

/**
 * Every work-item status the firm uses, as one of the kit's tones, so a
 * status reads the same on a list, a board, a matter's sections and the
 * dashboard. Deliverables and filings share the deliverable workflow.
 */
const TONES: Record<string, PillTone> = {
  ...Object.fromEntries(Object.entries(DELIVERABLE_STATUS_TONE).map(([k, v]) => [k.toLowerCase(), v])),
  // Tasks
  'in progress': 'blue',
  done: 'emerald',
  // Hearings
  scheduled: 'blue',
  attended: 'emerald',
  completed: 'emerald',
  postponed: 'amber',
  cancelled: 'muted',
  filed: 'emerald',
  // Matters
  ongoing: 'blue',
  closed: 'neutral',
  // Priority
  high: 'rose',
  medium: 'amber',
  low: 'neutral',
};

export function statusTone(status: string | null | undefined): PillTone {
  return TONES[(status ?? '').trim().toLowerCase()] ?? 'neutral';
}
