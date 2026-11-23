import Link from 'next/link';
import { ArrowRight, Building2, Hand } from 'lucide-react';
import type { PortalCompany } from '@/lib/portal/companies';
import { PHASE_COPY, TRACK_COPY, standing, stateChip, whenFromToday } from '@/lib/portal/company-wording';
import { shortDate } from '@/lib/corporations/status';
import { ClientPage } from '@/components/client-ui/Shell';
import { Chip, EmptyState, PageIntro } from '@/components/client-ui/Primitives';
import { CompanyMonogram, TrackBar } from './parts';

/** Every company the client has with the firm, worst news first. */
export default function PortalCompaniesView({
  companies,
  basePath,
  today,
}: {
  companies: PortalCompany[];
  basePath: string;
  today: string;
}) {
  const waiting = companies.filter((c) => c.waitingOnClient).length;
  return (
    <ClientPage>
      <PageIntro
        eyebrow="Your companies"
        title="Companies"
        lede="Where each of your companies stands — its registrations, annual filings and corporate records — and what falls due next."
        aside={
          waiting > 0 ? (
            <span className="soft-pulse inline-flex items-center gap-1.5 rounded-full bg-gold-50 dark:bg-gold-400/10 text-gold-800 dark:text-gold-300 px-3 py-1.5 text-xs font-medium">
              <Hand className="w-3.5 h-3.5" />
              {waiting === 1 ? 'One company needs something from you' : `${waiting} companies need something from you`}
            </span>
          ) : undefined
        }
      />

      {companies.length === 0 ? (
        <EmptyState icon={Building2} title="No companies to show yet" body="When we start looking after a company for you, it will appear here." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {companies.map((c, i) => {
            const s = standing(c);
            const next = c.next;
            const nextChip = next?.state ? stateChip(next.state) : null;
            return (
              <li key={c.id} className="rise-in" style={{ '--i': i } as React.CSSProperties}>
                <Link
                  href={`${basePath}/companies/${encodeURIComponent(c.id)}`}
                  className="lift group block h-full rounded-2xl border border-[var(--border-color)] bg-card p-5 hover:border-gold-300/70 dark:hover:border-gold-400/30"
                >
                  <div className="flex items-start gap-3">
                    <CompanyMonogram name={c.name} />
                    <div className="min-w-0 flex-1">
                      <p className="font-serif text-lg text-foreground leading-snug truncate">{c.name}</p>
                      <p className="text-xs text-[var(--text-secondary)] mt-0.5 truncate">
                        {[c.companyType, c.identifier && `SEC ${c.identifier}`].filter(Boolean).join(' · ') || ' '}
                      </p>
                    </div>
                    <Chip tone={s.tone === 'neutral' ? 'neutral' : s.tone} className={c.waitingOnClient ? 'soft-pulse' : ''}>
                      {s.label}
                    </Chip>
                  </div>

                  {c.phase && (
                    <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{PHASE_COPY[c.phase].title}</p>
                  )}
                  {c.tracks.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {c.tracks.map((t, j) => (
                        <TrackBar key={t.key} label={TRACK_COPY[t.key].title} done={t.done} total={t.total} health={t.health} index={i + j} compact />
                      ))}
                    </div>
                  )}

                  {next && (
                    <div className="mt-4 pt-3 border-t border-[var(--border-color)] flex items-center gap-2 text-xs">
                      <span className="text-[var(--text-muted)] shrink-0">Next</span>
                      <span className="text-foreground truncate flex-1">{next.label}</span>
                      {next.dueDate ? (
                        <span
                          className="shrink-0 tabular-nums text-[var(--text-secondary)]"
                          title={shortDate(next.dueDate)}
                        >
                          {whenFromToday(next.dueDate, today)}
                        </span>
                      ) : (
                        nextChip && <Chip tone={nextChip.tone}>{nextChip.label}</Chip>
                      )}
                      <ArrowRight className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0 transition-transform group-hover:translate-x-0.5" />
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </ClientPage>
  );
}
