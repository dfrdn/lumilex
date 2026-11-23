'use client';

import { useMemo } from 'react';
import QuickActions from '@/components/QuickActions';
import { manilaHour, formatManila } from '@/lib/dates';

interface Props {
  userName: string;
}

export default function AdminGreeting({ userName }: Props) {
  const { greeting, displayName, subtitle } = useMemo(() => {
    const hour = manilaHour();
    const g = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const name = userName.split(' ')[0] || 'there';
    const dayName = formatManila(new Date(), { weekday: 'long' });
    const subtitleMap = {
      morning:   `A fresh ${dayName}. Let's keep the records sharp.`,
      afternoon: `Afternoon check-in. Review, update, and stay organized.`,
      evening:   `Wrapping up ${dayName}. Any records to finalize?`,
    };
    const s = subtitleMap[hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'];
    return { greeting: g, displayName: name, subtitle: s };
  }, [userName]);

  return (
    <div className="mb-8">
      <h1 className="font-serif text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
        {greeting}, {displayName}
      </h1>
      <div className="greeting-accent mt-2" />
      <p className="text-sm text-[var(--text-secondary)] mt-2.5">
        {subtitle}
      </p>
      <div className="mt-4">
        <QuickActions />
      </div>
    </div>
  );
}
