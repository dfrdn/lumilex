'use client';

import { shortDate, type CorporationStatus } from '@/lib/corporations/status';
import type { Corporation } from '@/types/corporations';
import Stepper, { type Step as StepView } from '@/components/ui/Stepper';
import { TRACK_TAB } from './tracks';

type Step = {
  key: 'application' | 'post_registration' | 'ongoing';
  label: string;
  sub: string;
  state: 'done' | 'current' | 'upcoming' | 'skipped';
  tab: (typeof TRACK_TAB)[keyof typeof TRACK_TAB];
};

/**
 * The company's life in three phases — applied for, set up, kept up — with
 * where it is now. Finished phases tick off; the cards below show only the
 * phase in hand.
 */
export default function LifecycleStepper({
  corporation: c,
  status,
  onOpen,
}: {
  corporation: Corporation;
  status: CorporationStatus;
  onOpen: (tab: Step['tab']) => void;
}) {
  if (status.phase === 'dissolved') return null;
  const track = (k: string) => status.tracks.find((t) => t.key === k)!;
  const reg = track('registrations');
  const recurring = [track('housekeeping'), track('compliance')];
  const overdue = recurring.reduce((n, t) => n + t.items.filter((i) => i.state === 'overdue').length, 0);
  const regCarried = reg.total > 0;

  const steps: Step[] = [
    {
      key: 'application',
      label: 'Application',
      sub: c.secRegistrationDate ? `Registered ${shortDate(c.secRegistrationDate)}` : `${track('application').done} of ${track('application').total} ready`,
      state: status.phase === 'application' ? 'current' : 'done',
      tab: 'overview',
    },
    {
      key: 'post_registration',
      label: 'Post-registration',
      sub:
        status.phase === 'application'
          ? 'BIR, permits, employer numbers'
          : !regCarried
            ? 'Not handled by the firm'
            : status.phase === 'post_registration'
              ? `${reg.done} of ${reg.total} done`
              : 'Set up',
      state:
        status.phase === 'application' ? 'upcoming' : !regCarried ? 'skipped' : status.phase === 'post_registration' ? 'current' : 'done',
      tab: 'registrations',
    },
    {
      key: 'ongoing',
      label: 'Housekeeping & compliance',
      sub:
        status.phase === 'application'
          ? 'Yearly meetings and filings'
          : overdue
            ? `${overdue} overdue`
            : status.phase === 'ongoing'
              ? 'All current'
              : 'Running alongside set-up',
      state: status.phase === 'ongoing' ? 'current' : 'upcoming',
      tab: 'compliance',
    },
  ];

  return (
    <Stepper
      steps={steps.map(
        (s): StepView => ({
          key: s.key,
          label: s.label,
          sub: s.sub,
          state: s.state,
          warn: s.key === 'ongoing' && overdue > 0 && status.phase !== 'application',
          onOpen: () => onOpen(s.tab),
        }),
      )}
    />
  );
}
