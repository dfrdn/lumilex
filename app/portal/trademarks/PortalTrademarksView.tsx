import Link from 'next/link';
import { ArrowRight, Hand, Stamp } from 'lucide-react';
import type { PortalMark } from '@/lib/portal/trademarks';
import { markStatusCopy, stateChip, whenFromToday } from '@/lib/portal/company-wording';
import { shortDate } from '@/lib/corporations/status';
import { ClientPage } from '@/components/client-ui/Shell';
import { Chip, EmptyState, PageIntro } from '@/components/client-ui/Primitives';

export function MarkImage({ mark, url, size = 'md' }: { mark: string; url: string | null; size?: 'md' | 'lg' }) {
  const dims = size === 'lg' ? 'w-24 h-24 rounded-2xl' : 'w-14 h-14 rounded-xl';
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={mark} className={`${dims} shrink-0 bg-white border border-[var(--border-color)] object-contain p-1`} />
  ) : (
    <span className={`${dims} shrink-0 inline-flex items-center justify-center bg-gradient-to-br from-navy-800 to-navy-950 text-gold-300 font-serif ${size === 'lg' ? 'text-2xl' : 'text-base'} ring-1 ring-gold-400/30`}>
      {(mark || '?').trim().slice(0, 2).toUpperCase()}
    </span>
  );
}

/** Every mark the client has with the firm. */
export default function PortalTrademarksView({ marks, basePath, today }: { marks: PortalMark[]; basePath: string; today: string }) {
  const waiting = marks.filter((m) => m.waitingOnClient).length;
  return (
    <ClientPage>
      <PageIntro
        eyebrow="Your trademarks"
        title="Trademarks"
        lede="Where each of your marks stands at the Intellectual Property Office, and what keeps it registered."
        aside={
          waiting > 0 ? (
            <span className="soft-pulse inline-flex items-center gap-1.5 rounded-full bg-gold-50 dark:bg-gold-400/10 text-gold-800 dark:text-gold-300 px-3 py-1.5 text-xs font-medium">
              <Hand className="w-3.5 h-3.5" />
              {waiting === 1 ? 'One mark needs something from you' : `${waiting} marks need something from you`}
            </span>
          ) : undefined
        }
      />
      {marks.length === 0 ? (
        <EmptyState icon={Stamp} title="No trademarks to show yet" body="When we start looking after a mark for you, it will appear here." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {marks.map((m, i) => {
            const status = markStatusCopy(m.status, !!m.madrid);
            const nextChip = m.next ? stateChip(m.next.state) : null;
            return (
              <li key={m.id} className="rise-in" style={{ '--i': i } as React.CSSProperties}>
                <Link
                  href={`${basePath}/trademarks/${encodeURIComponent(m.id)}`}
                  className="lift group block h-full rounded-2xl border border-[var(--border-color)] bg-card p-5 hover:border-gold-300/70 dark:hover:border-gold-400/30"
                >
                  <div className="flex items-start gap-4">
                    <MarkImage mark={m.mark} url={m.imageUrl} />
                    <div className="min-w-0 flex-1">
                      <p className="font-serif text-lg text-foreground leading-snug truncate">{m.mark}</p>
                      <p className="text-xs text-[var(--text-secondary)] mt-0.5 truncate">
                        {[m.madrid ? `Madrid · ${m.madrid.country}` : null, m.type, m.classes.length ? `Class${m.classes.length > 1 ? 'es' : ''} ${m.classes.join(', ')}` : null].filter(Boolean).join(' · ')}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Chip tone={status.tone}>{status.label}</Chip>
                        {m.waitingOnClient && <Chip tone="gold" className="soft-pulse">Needs you</Chip>}
                      </div>
                    </div>
                  </div>
                  {m.registeredUntil && (
                    <p className="mt-4 text-xs text-[var(--text-secondary)]">
                      {m.madrid ? 'Protected until' : 'Registered until'} <span className="text-foreground">{shortDate(m.registeredUntil)}</span>
                      {m.regNo && <span className="font-mono text-[var(--text-muted)]"> · {m.madrid ? 'IR No.' : 'Reg. No.'} {m.regNo}</span>}
                    </p>
                  )}
                  {m.next && (
                    <div className="mt-3 pt-3 border-t border-[var(--border-color)] flex items-center gap-2 text-xs">
                      <span className="text-[var(--text-muted)] shrink-0">Next</span>
                      <span className="text-foreground truncate flex-1">{m.next.label}</span>
                      {m.next.dueDate ? (
                        <span className="shrink-0 tabular-nums text-[var(--text-secondary)]" title={shortDate(m.next.dueDate)}>
                          {whenFromToday(m.next.dueDate, today)}
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
