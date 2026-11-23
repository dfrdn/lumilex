import { StatusPill } from '@/components/ui/primitives';
import type { PillTone } from '@/components/ui/tone';

export const TRADEMARK_STATUS_TONE: Record<string, PillTone> = {
  Prelim: 'neutral',
  'For Filing': 'amber',
  Pending: 'blue',
  'Pending - OA': 'rose',
  Registered: 'emerald',
  Abandoned: 'muted',
};

/** What each status means in plain words — shown as the pill's tooltip and on the list tabs. */
export const TRADEMARK_STATUS_HINTS: Record<string, string> = {
  Prelim:         'Waiting on the client’s instructions',
  'For Filing':   'Instructed — ready to file with IPOPHL',
  Pending:        'Filed and under examination',
  'Pending - OA': 'An Office Action needs a response',
  Registered:     'Registered — DAU and renewal obligations running',
  Abandoned:      'No longer being prosecuted',
};

export function TrademarkStatusPill({ status, size }: { status: string; size?: 'sm' | 'md' }) {
  return <StatusPill size={size} label={status} tone={TRADEMARK_STATUS_TONE[status] ?? 'neutral'} hint={TRADEMARK_STATUS_HINTS[status]} />;
}
