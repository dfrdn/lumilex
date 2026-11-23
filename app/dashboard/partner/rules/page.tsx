import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import { Gavel } from 'lucide-react';

import RulesManagerClient from './RulesManagerClient';

export const metadata: Metadata = { title: 'Court Rules' };

export const revalidate = 30;

export default async function PartnerRulesPage() {
  await requireRouteAccess('/dashboard/partner/rules');

  return (
    <>
      <div className="mb-6 animate-fade-up">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-navy-50 dark:bg-navy-500/10 flex items-center justify-center ring-1 ring-navy-200/60 dark:ring-navy-500/20">
            <Gavel className="w-5 h-5 text-navy-600 dark:text-navy-400" />
          </div>
          <div>
            <h1 className="font-serif text-xl font-semibold text-foreground">Court Rules</h1>
            <p className="text-sm text-[var(--text-muted)]">Manage deadline rule sets for court proceedings</p>
          </div>
        </div>
      </div>

      <RulesManagerClient />
    </>
  );
}
