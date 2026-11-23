import Link from 'next/link';
import { ArrowLeft, CalendarDays, Check, Hand, Upload, Users } from 'lucide-react';
import type { PortalMarkDetail } from '@/lib/portal/trademarks';
import { markStatusCopy, stateChip, whenFromToday } from '@/lib/portal/company-wording';
import { shortDate } from '@/lib/corporations/status';
import { formatDate } from '@/lib/portal/dates';
import Avatar from '@/components/Avatar';
import ClientButton from '@/components/client-ui/Button';
import { ClientPage } from '@/components/client-ui/Shell';
import { Card, Chip, EmptyState, SectionTitle } from '@/components/client-ui/Primitives';
import { MarkImage } from '../PortalTrademarksView';

/** The steps of a mark's life, and where this one is. */
const STEPS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'prepare', label: 'Preparing', statuses: ['Prelim', 'For Filing'] },
  { key: 'exam', label: 'Under examination', statuses: ['Pending', 'Pending - OA'] },
  { key: 'registered', label: 'Registered', statuses: ['Registered'] },
];

/** A Madrid designation's steps, in its own words: designated, examined, protected. */
const DESIGNATION_LABELS: Record<string, string> = { prepare: 'Designated', exam: 'Under examination', registered: 'Protected' };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">{label}</dt>
      <dd className="mt-0.5 text-sm text-foreground">{children}</dd>
    </div>
  );
}

export default function PortalTrademarkView({ data, basePath, today }: { data: PortalMarkDetail; basePath: string; today: string }) {
  const { mark: m, items, requests } = data;
  const status = markStatusCopy(m.status, !!m.madrid);
  const steps = m.madrid ? STEPS.map((s) => ({ ...s, label: DESIGNATION_LABELS[s.key] })) : STEPS;
  const step = steps.findIndex((s) => s.statuses.includes(m.status));

  return (
    <ClientPage>
      <Link href={`${basePath}/trademarks`} className="group inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-foreground mb-6">
        <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
        All trademarks
      </Link>

      <section className="rise-in mb-8 pb-8 border-b border-gold-200/40 dark:border-gold-400/15">
        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          <MarkImage mark={m.mark} url={m.imageUrl} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="font-serif text-3xl md:text-4xl text-foreground tracking-tight text-balance">{m.mark}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Chip tone={status.tone} className="text-[11px] px-2.5 py-1">{status.label}</Chip>
              {m.madrid && <Chip>Madrid · {m.madrid.country}</Chip>}
              {m.type && <Chip>{m.type}</Chip>}
              {m.classes.map((c) => (
                <Chip key={c} mono>Class {c}</Chip>
              ))}
            </div>
          </div>
        </div>

        {step >= 0 && (
          <ol className="mt-7 grid grid-cols-3 gap-2">
            {steps.map((s, i) => {
              const reached = i <= step;
              const current = i === step;
              return (
                <li key={s.key} className="rise-in" style={{ '--i': i + 1 } as React.CSSProperties}>
                  <div className="h-1 rounded-full bg-subtle overflow-hidden">
                    {reached && (
                      <div
                        className={`grow-x h-full rounded-full ${current ? 'bg-gold-500 dark:bg-gold-400' : 'bg-navy-700 dark:bg-gold-400/60'}`}
                        style={{ '--i': i * 3 } as React.CSSProperties}
                      />
                    )}
                  </div>
                  <p className={`mt-2 text-xs ${current ? 'font-semibold text-foreground' : reached ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'}`}>
                    {i < step && <Check className="inline w-3 h-3 mr-1 -mt-0.5 text-emerald-600 dark:text-emerald-400" />}
                    {s.label}
                  </p>
                </li>
              );
            })}
          </ol>
        )}

        <dl className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
          {m.madrid ? (
            <>
              <Fact label={m.madrid.designatedOn ? 'Designated' : 'International registration'}>
                {m.madrid.designatedOn ?? m.madrid.irDate ? shortDate((m.madrid.designatedOn ?? m.madrid.irDate)!) : '—'}
              </Fact>
              <Fact label="Protected since">{m.regDate ? shortDate(m.regDate) : '—'}</Fact>
              <Fact label="In force until">{m.registeredUntil ? shortDate(m.registeredUntil) : '—'}</Fact>
              <Fact label="IR No.">{m.regNo ? <span className="font-mono text-[13px]">{m.regNo}</span> : '—'}</Fact>
            </>
          ) : (
            <>
              <Fact label="Filed">{m.filingDate ? shortDate(m.filingDate) : '—'}</Fact>
              <Fact label="Registered">{m.regDate ? shortDate(m.regDate) : '—'}</Fact>
              <Fact label="Registered until">{m.registeredUntil ? shortDate(m.registeredUntil) : '—'}</Fact>
              <Fact label="Reg. / App. No.">{m.regNo ? <span className="font-mono text-[13px]">{m.regNo}</span> : '—'}</Fact>
            </>
          )}
        </dl>
      </section>

      <div className="space-y-6">
        {requests.length > 0 && (
          <Card tone="gold" as="section" className="rise-in" padding="none">
            <div className="px-5 pt-4 pb-2">
              <SectionTitle icon={Hand}>Waiting on you</SectionTitle>
              <p className="text-sm text-[var(--text-secondary)] mt-1">We need these from you to keep things moving.</p>
            </div>
            <ul className="divide-y divide-gold-200/50 dark:divide-gold-400/15">
              {requests.map((r, i) => (
                <li key={r.id} className="rise-in px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-3" style={{ '--i': i + 1 } as React.CSSProperties}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{r.description}</p>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                      {r.matterName}
                      {r.dueAt && <> · by {formatDate(r.dueAt)}</>}
                    </p>
                  </div>
                  <ClientButton size="sm" href={`${basePath}/matters/${encodeURIComponent(r.matterId)}?send=${encodeURIComponent(r.id)}`} icon={<Upload />} className="press">
                    Send documents
                  </ClientButton>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card as="section" padding="none" className="overflow-hidden">
          <div className="px-5 pt-4 pb-3">
            <SectionTitle icon={CalendarDays} trailing={items.length ? `${items.length} ahead` : undefined}>
              What’s ahead
            </SectionTitle>
            <p className="text-xs text-[var(--text-muted)] mt-1">What the Office requires to keep your mark moving and registered — we file each one for you.</p>
          </div>
          {items.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState compact icon={Check} title="Nothing ahead right now" />
            </div>
          ) : (
            <ul className="border-t border-[var(--border-color)] divide-y divide-[var(--border-color)]">
              {items.map((it, i) => {
                const chip = stateChip(it.state);
                return (
                  <li key={it.key} className="rise-in px-5 py-3 flex items-center gap-3" style={{ '--i': i } as React.CSSProperties}>
                    <span className={`w-2 h-2 rounded-full shrink-0 ${it.state === 'in_progress' ? 'bg-navy-500 dark:bg-gold-400' : it.state === 'waiting_on_client' ? 'bg-gold-500 soft-pulse' : 'bg-[var(--border-hover)]'}`} />
                    <p className="min-w-0 flex-1 text-sm text-foreground truncate">{it.label}</p>
                    {chip && <Chip tone={chip.tone}>{chip.label}</Chip>}
                    {it.dueDate && (
                      <span className="w-28 text-right shrink-0">
                        <span className="block text-xs tabular-nums text-foreground">{whenFromToday(it.dueDate, today)}</span>
                        <span className="block text-[11px] text-[var(--text-muted)] tabular-nums">{shortDate(it.dueDate)}</span>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {m.team.length > 0 && (
          <section className="rise-in flex flex-wrap items-center gap-x-4 gap-y-2 pt-2">
            <SectionTitle icon={Users}>Your team</SectionTitle>
            {m.team.map((t) => (
              <span key={t.name} className="inline-flex items-center gap-2 text-sm text-foreground">
                <Avatar avatarUrl={t.avatarUrl} initials={t.initials} name={t.name} size={26} />
                {t.name}
              </span>
            ))}
          </section>
        )}
        {m.updatedAt && (
          <p className="text-[11px] text-[var(--text-muted)]">
            Status as of {new Date(m.updatedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })}
          </p>
        )}
      </div>
    </ClientPage>
  );
}
