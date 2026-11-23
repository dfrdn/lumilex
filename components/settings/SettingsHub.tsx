import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { UserRole } from '@/lib/queries/team';
import type { FeatureFlags } from '@/lib/firm/feature-shape';
import { canOpen } from '@/lib/nav/access';
import { HUB_HREFS, hubFor, type HubId, type ResolvedEntry } from '@/lib/nav/hubs';
import { CARD } from '@/components/ui/tone';

/** The hub's cards, one per section, each listing the pages it opens; and a pointer to the other hub when the role may open it. */
export default function SettingsHub({ hub, role, flags }: { hub: HubId; role: UserRole; flags: FeatureFlags }) {
  const sections = hubFor(hub, role, flags);
  const other: HubId = hub === 'firm' ? 'finance' : 'firm';
  const otherHref = HUB_HREFS[other];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        {sections.map((section) => (
          <section key={section.id} id={section.id} className={`${CARD} p-5 scroll-mt-20`}>
            <h2 className="text-[15px] font-semibold text-stone-800 dark:text-stone-100">{section.label}</h2>
            <p className="mt-0.5 text-sm text-stone-500 dark:text-stone-400">{section.description}</p>
            <ul className="mt-3 -mx-2 space-y-0.5">
              {section.entries.map((entry) => (
                <li key={entry.href}>
                  <HubLink entry={entry} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {canOpen(role, otherHref) && (
        <p className="text-sm text-stone-500 dark:text-stone-400">
          {other === 'firm'
            ? 'Firm-wide settings, such as fee schedules, templates and holidays, are in '
            : 'Billing rates, the billing letter and the other finance settings are in '}
          <Link
            href={otherHref}
            className="font-medium text-stone-800 dark:text-stone-100 underline underline-offset-2 hover:text-gold-600 dark:hover:text-gold-400"
          >
            {other === 'firm' ? 'Firm settings' : 'Finance settings'}
          </Link>
          .
        </p>
      )}
    </div>
  );
}

function HubLink({ entry }: { entry: ResolvedEntry }) {
  const Icon = entry.icon;
  return (
    <Link
      href={entry.href}
      prefetch={false}
      className="group flex gap-3 px-2 py-2 rounded-lg hover:bg-stone-50 dark:hover:bg-white/[0.04] transition-colors"
    >
      <Icon className="w-4 h-4 mt-0.5 shrink-0 text-stone-400 dark:text-stone-500 group-hover:text-gold-500" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-stone-800 dark:text-stone-100">{entry.label}</span>
        <span className="block text-[13px] leading-snug text-stone-500 dark:text-stone-400">{entry.description}</span>
      </span>
      <ChevronRight className="w-4 h-4 mt-0.5 shrink-0 text-stone-300 dark:text-stone-600 group-hover:text-stone-500" />
    </Link>
  );
}
