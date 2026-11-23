'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CalendarDays, Check, ChevronDown, Download, Eye, FileText, FolderOpen, Hand, Upload, Users } from 'lucide-react';
import type { PortalCompanyDetail, PortalCompanyItem } from '@/lib/portal/companies';
import { PHASE_COPY, TRACK_COPY, standing, stateChip, trackLine, whenFromToday } from '@/lib/portal/company-wording';
import type { Phase, TrackKey } from '@/lib/corporations/status';
import { shortDate } from '@/lib/corporations/status';
import { formatDate } from '@/lib/portal/dates';
import { downloadFile } from '@/lib/download-file';
import type { FileAttachment } from '@/types/notion';
import FilePreviewModal from '@/components/FilePreviewModal';
import Avatar from '@/components/Avatar';
import ClientButton from '@/components/client-ui/Button';
import { ClientPage } from '@/components/client-ui/Shell';
import { Card, Chip, EmptyState, SectionTitle, Segmented } from '@/components/client-ui/Primitives';
import { CompanyMonogram, TrackBar } from '../parts';

const PHASES: Phase[] = ['application', 'post_registration', 'ongoing'];
const COLLAPSED = 8;

/** A team-side note that reads as blame or as a data gap to a client. */
const internalDetail = (d: string | null) => !d || /on record/i.test(d);

export default function PortalCompanyView({
  data,
  basePath,
  today,
  preview = false,
}: {
  data: PortalCompanyDetail;
  basePath: string;
  today: string;
  preview?: boolean;
}) {
  const { company: c, items, requests, documents } = data;
  const s = standing(c);
  const [track, setTrack] = useState<'all' | TrackKey>('all');
  const [expanded, setExpanded] = useState(false);
  const [modal, setModal] = useState<{ files: FileAttachment[]; index: number } | null>(null);
  const signEndpoint = preview ? '/api/file-sign' : '/api/portal/file-sign';

  const tracksPresent = useMemo(() => [...new Set(items.map((i) => i.track))], [items]);
  const ahead = useMemo(() => {
    // The loader hands these over in reading order: what is under way, then by date.
    return items.filter((i) => i.state !== 'done' && i.state !== 'filed' && (track === 'all' || i.track === track));
  }, [items, track]);
  const shown = expanded ? ahead : ahead.slice(0, COLLAPSED);
  const attachments: FileAttachment[] = documents.map((d) => ({ name: d.name, url: '', path: d.storagePath }));
  const phaseIndex = c.phase ? PHASES.indexOf(c.phase) : -1;

  return (
    <ClientPage>
      <Link
        href={`${basePath}/companies`}
        className="group inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-foreground mb-6"
      >
        <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
        All companies
      </Link>

      {/* Who and where */}
      <section className="rise-in mb-8 pb-8 border-b border-gold-200/40 dark:border-gold-400/15">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <CompanyMonogram name={c.name} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="font-serif text-3xl md:text-4xl text-foreground tracking-tight text-balance">{c.name}</h1>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              {[c.companyType, c.identifier && `SEC Reg. No. ${c.identifier}`].filter(Boolean).join(' · ')}
            </p>
          </div>
          <Chip tone={s.tone} className={`self-start sm:self-center text-[11px] px-2.5 py-1 ${c.waitingOnClient ? 'soft-pulse' : ''}`}>
            {s.label}
          </Chip>
        </div>

        {c.phase && c.phase !== 'dissolved' && (
          <div className="mt-7">
            <ol className="grid grid-cols-3 gap-2">
              {PHASES.map((p, i) => {
                const reached = i <= phaseIndex;
                const current = i === phaseIndex;
                return (
                  <li key={p} className="rise-in" style={{ '--i': i + 1 } as React.CSSProperties}>
                    <div className="h-1 rounded-full bg-subtle overflow-hidden">
                      {reached && (
                        <div
                          className={`grow-x h-full rounded-full ${current ? 'bg-gold-500 dark:bg-gold-400' : 'bg-navy-700 dark:bg-gold-400/60'}`}
                          style={{ '--i': i * 3 } as React.CSSProperties}
                        />
                      )}
                    </div>
                    <p className={`mt-2 text-xs ${current ? 'font-semibold text-foreground' : reached ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'}`}>
                      {i < phaseIndex && <Check className="inline w-3 h-3 mr-1 -mt-0.5 text-emerald-600 dark:text-emerald-400" />}
                      {PHASE_COPY[p].title}
                    </p>
                  </li>
                );
              })}
            </ol>
            <p className="mt-3 text-sm text-[var(--text-secondary)] max-w-2xl leading-relaxed">{PHASE_COPY[c.phase].body}</p>
          </div>
        )}
      </section>

      <div className="space-y-6">
        {/* What we need from you */}
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
                  <ClientButton
                    size="sm"
                    href={`${basePath}/matters/${encodeURIComponent(r.matterId)}?send=${encodeURIComponent(r.id)}`}
                    icon={<Upload />}
                    className="press"
                  >
                    Send documents
                  </ClientButton>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* How each part is going */}
        {c.tracks.length > 0 && (
          <section>
            <SectionTitle className="mb-3">Progress</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2">
              {c.tracks.map((t, i) => (
                <Card key={t.key} className="lift" padding="sm">
                  <div className="rise-in" style={{ '--i': i } as React.CSSProperties}>
                    <p className="text-sm font-semibold text-foreground">{TRACK_COPY[t.key].title}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5 mb-3">{TRACK_COPY[t.key].blurb}</p>
                    <TrackBar label={trackLine(t)} done={t.done} total={t.total} health={t.health} index={i} />
                  </div>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* What's ahead */}
        <Card as="section" padding="none" className="overflow-hidden">
          <div className="px-5 pt-4 pb-3 space-y-3">
            <SectionTitle icon={CalendarDays} trailing={ahead.length ? `${ahead.length} open` : undefined}>
              What’s ahead
            </SectionTitle>
            {tracksPresent.length > 1 && (
              <Segmented
                size="sm"
                value={track}
                onChange={(v) => { setTrack(v); setExpanded(false); }}
                options={[
                  { key: 'all' as const, label: 'All' },
                  ...tracksPresent.map((k) => ({ key: k, label: TRACK_COPY[k].title })),
                ]}
              />
            )}
          </div>
          {ahead.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState compact icon={Check} title="Nothing open right now" body="Everything we track for this company is done or filed." />
            </div>
          ) : (
            <ul className="border-t border-[var(--border-color)] divide-y divide-[var(--border-color)]">
              {shown.map((it, i) => (
                <AheadRow key={`${track}-${it.key}`} item={it} today={today} index={i} />
              ))}
            </ul>
          )}
          {ahead.length > COLLAPSED && (
            <div className="border-t border-[var(--border-color)] px-5 py-2.5 flex justify-center">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className="press inline-flex items-center gap-1 text-xs font-medium text-gold-700 dark:text-gold-400 hover:underline"
              >
                {expanded ? 'Show fewer' : `Show all ${ahead.length}`}
                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
              </button>
            </div>
          )}
        </Card>

        {/* Papers */}
        <Card as="section" padding="none" className="overflow-hidden">
          <div className="px-5 pt-4 pb-3">
            <SectionTitle icon={FolderOpen} trailing={documents.length ? `${documents.length}` : undefined}>
              Company documents
            </SectionTitle>
          </div>
          {documents.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState compact icon={FileText} title="No documents shared yet" body="Certificates, permits and filings appear here once we share them with you." />
            </div>
          ) : (
            <ul className="border-t border-[var(--border-color)] divide-y divide-[var(--border-color)]">
              {documents.map((d, i) => (
                <li key={d.id} className="rise-in px-5 py-3 flex items-center gap-3" style={{ '--i': i } as React.CSSProperties}>
                  <button type="button" onClick={() => setModal({ files: attachments, index: i })} className="group min-w-0 flex-1 flex items-center gap-3 text-left">
                    <span className="w-9 h-9 rounded-lg bg-subtle flex items-center justify-center shrink-0 transition-colors group-hover:bg-gold-50 dark:group-hover:bg-gold-400/10">
                      <FileText className="w-4 h-4 text-[var(--text-secondary)] transition-colors group-hover:text-gold-700 dark:group-hover:text-gold-400" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground truncate group-hover:text-gold-700 dark:group-hover:text-gold-400 transition-colors">{d.name}</span>
                      <span className="block text-xs text-[var(--text-secondary)] mt-0.5 truncate">
                        {d.category}
                        {d.filingYear ? ` · ${d.filingYear}` : ''} · {formatDate(d.uploadedAt)}
                      </span>
                    </span>
                  </button>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button type="button" onClick={() => setModal({ files: attachments, index: i })} title="Preview" aria-label={`Preview ${d.name}`} className="press p-1.5 rounded-md text-[var(--text-muted)] hover:text-foreground hover:bg-subtle transition-colors">
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void downloadFile({ name: d.name, url: '', path: d.storagePath }, { signEndpoint })}
                      title="Download"
                      aria-label={`Download ${d.name}`}
                      className="press p-1.5 rounded-md text-[var(--text-muted)] hover:text-foreground hover:bg-subtle transition-colors"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {c.team.length > 0 && (
          <section className="rise-in flex flex-wrap items-center gap-x-4 gap-y-2 pt-2">
            <SectionTitle icon={Users}>Your team</SectionTitle>
            {c.team.map((m) => (
              <span key={m.name} className="inline-flex items-center gap-2 text-sm text-foreground">
                <Avatar avatarUrl={m.avatarUrl} initials={m.initials} name={m.name} size={26} />
                {m.name}
              </span>
            ))}
          </section>
        )}
        {c.updatedAt && (
          <p className="text-[11px] text-[var(--text-muted)]">
            Status as of {new Date(c.updatedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })}
          </p>
        )}
      </div>

      <FilePreviewModal open={!!modal} onClose={() => setModal(null)} files={modal?.files ?? []} initialIndex={modal?.index ?? 0} signEndpoint={signEndpoint} />
    </ClientPage>
  );
}

function AheadRow({ item, today, index }: { item: PortalCompanyItem; today: string; index: number }) {
  const chip = stateChip(item.state);
  const when = whenFromToday(item.dueDate, today);
  return (
    <li className="rise-in px-5 py-3 flex items-center gap-3" style={{ '--i': index } as React.CSSProperties}>
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${
          item.state === 'waiting_on_client' ? 'bg-gold-500 soft-pulse' : item.state === 'in_progress' ? 'bg-navy-500 dark:bg-gold-400' : 'bg-[var(--border-hover)]'
        }`}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground truncate">{item.label}</p>
        <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
          {TRACK_COPY[item.track].title}
          {!internalDetail(item.detail) && ` · ${item.detail}`}
          {item.provisional && ' · date to be confirmed'}
        </p>
      </div>
      {chip && <Chip tone={chip.tone}>{chip.label}</Chip>}
      {item.dueDate && (
        <span className="w-28 text-right shrink-0">
          <span className="block text-xs tabular-nums text-foreground">{when}</span>
          <span className="block text-[11px] text-[var(--text-muted)] tabular-nums">{shortDate(item.dueDate)}</span>
        </span>
      )}
    </li>
  );
}
