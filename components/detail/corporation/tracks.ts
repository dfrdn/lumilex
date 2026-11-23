import type { TrackKey } from '@/lib/corporations/status';

/** The tab each track opens. Application lives on the Overview (the intake form before registration). */
export const TRACK_TAB: Record<TrackKey, 'overview' | 'registrations' | 'board-papers' | 'compliance'> = {
  application: 'overview',
  registrations: 'registrations',
  housekeeping: 'board-papers',
  compliance: 'compliance',
};
