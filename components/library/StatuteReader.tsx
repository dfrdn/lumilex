'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Check, ChevronRight, ExternalLink, History, Link2, List as ListIcon, Loader2, Search, ShieldCheck, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import { CopyText, StatusPill } from '@/components/ui/primitives';
import type { PillTone } from '@/components/ui/tone';
import { CHANGE_LABELS, describeChange, diffWords, provisionAnchor, type ProvisionChange, type ProvisionVersion } from '@/lib/codes/model';
import { ruleSectionAnchor } from '@/lib/rules/model';
import type { StatuteDoc, StatuteProvision } from '@/lib/library/statute';
import { toManilaDay } from '@/lib/dates';
import type { ProvisionDetail, ProvisionReview } from '@/app/api/codes/provisions/[id]/route';

const CHANGE_TONE: Record<ProvisionChange, PillTone> = {
  original: 'neutral',
  amended: 'amber',
  inserted: 'teal',
  repealed: 'rose',
  renumbered: 'blue',
};

/** A calendar date ("2019-02-20") as written, or the Manila day a timestamp falls on. */
function fmtDate(iso: string): string {
  const [y, m, d] = toManilaDay(iso).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-PH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

interface TocEntry { anchor: string; label: string; depth: number }

/** One table-of-contents line per division, in reading order, from the paths above the provisions. */
function buildToc(provisions: StatuteProvision[]): TocEntry[] {
  const out: TocEntry[] = [];
  const seen = new Set<string>();
  for (const p of provisions) {
    p.path.forEach((d, depth) => {
      if (seen.has(d.anchor)) return;
      seen.add(d.anchor);
      out.push({ anchor: d.anchor, label: d.label, depth });
    });
  }
  return out;
}

/** Scroll whichever container holds the page (the dashboard scrolls its main pane, not the window). Elements carry scroll-mt for the header. */
function scrollToAnchor(anchor: string, behavior: ScrollBehavior = 'smooth') {
  const el = document.getElementById(anchor);
  if (!el) return false;
  el.scrollIntoView({ block: 'start', behavior });
  return true;
}

interface Props {
  doc: StatuteDoc;
  /** The page's short preface (publication, what the amendments removed). */
  prefaceHtml: string;
  mayReview: boolean;
}

export default function StatuteReader({ doc, prefaceHtml, mayReview }: Props) {
  const toc = useMemo(() => buildToc(doc.provisions), [doc.provisions]);
  const [selected, setSelected] = useState<StatuteProvision | null>(null);
  const [reviewed, setReviewed] = useState<Set<number>>(() => new Set(doc.provisions.filter((p) => p.reviewed).map((p) => p.id)));
  const [activeToc, setActiveToc] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  const select = useCallback((p: StatuteProvision | null, opts: { scroll?: boolean } = {}) => {
    setSelected(p);
    const url = new URL(window.location.href);
    url.hash = p ? p.anchor : '';
    window.history.replaceState(null, '', url.toString());
    if (p && opts.scroll) scrollToAnchor(p.anchor);
  }, []);

  // Opened at a provision (#art-237), or the hash changed: scroll to it and open its panel.
  // Retried briefly, since a redirect lands here before the layout has settled.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      const anchor = decodeURIComponent(window.location.hash.slice(1));
      if (!anchor) return;
      const p = doc.provisions.find((x) => x.anchor === anchor);
      if (p) setSelected(p);
      let tries = 0;
      const tick = () => {
        // Scroll a few times over the first moments: late layout (fonts, the panel's margin) moves the target.
        scrollToAnchor(anchor, 'instant');
        if (tries++ < 6) timer = setTimeout(tick, 150);
      };
      tick();
    };
    open();
    window.addEventListener('hashchange', open);
    return () => { clearTimeout(timer); window.removeEventListener('hashchange', open); };
  }, [doc.provisions]);

  useEffect(() => {
    const container = bodyRef.current;
    if (!container || toc.length === 0) return;
    const onScroll = () => {
      let current = '';
      for (const el of container.querySelectorAll('[data-division]')) {
        if (el.getBoundingClientRect().top <= 120) current = el.id;
        else break;
      }
      setActiveToc(current);
    };
    onScroll();
    // Capture: scroll events from the dashboard's scrolling pane do not bubble to the window.
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, [toc]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') select(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, select]);

  const changedCount = doc.provisions.filter((p) => p.change && p.change !== 'original').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap text-xs text-stone-500 dark:text-stone-400">
        <span>{doc.provisions.length} {doc.unit === 'article' ? 'articles' : 'sections'}</span>
        {doc.kind === 'code' && (
          <>
            <span aria-hidden="true">·</span>
            <span>{changedCount === 0 ? 'No amendments recorded' : `${changedCount} changed since enactment`}</span>
            <span aria-hidden="true">·</span>
            <span className={reviewed.size < doc.provisions.length ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}>
              {reviewed.size === 0 ? 'Not yet reviewed against the source' : `${reviewed.size} of ${doc.provisions.length} reviewed against the source`}
            </span>
          </>
        )}
        {doc.sourceUrl && (
          <>
            <span aria-hidden="true">·</span>
            <a href={doc.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-gold-600 dark:text-gold-400 hover:underline">
              {doc.sourceLabel} <ExternalLink className="w-3 h-3" />
            </a>
          </>
        )}
      </div>

      <FindInCode doc={doc} onPick={(p) => select(p, { scroll: true })} />

      <div className="flex gap-6 items-start">
        <aside className="hidden xl:block w-64 shrink-0 sticky top-24">
          <div className="border border-[var(--border-color)] rounded-xl bg-[var(--card-bg)] p-3 shadow-sm">
            <div className="flex items-center gap-2 mb-2 pb-2 border-b border-[var(--border-color)]">
              <ListIcon className="w-3.5 h-3.5 text-gold-500 dark:text-gold-400" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">Contents</span>
            </div>
            <nav className="space-y-0.5 max-h-[calc(100vh-200px)] overflow-y-auto">
              {toc.map((t) => (
                <button
                  key={t.anchor}
                  type="button"
                  onClick={() => scrollToAnchor(t.anchor)}
                  title={t.label}
                  style={{ paddingLeft: `${0.5 + t.depth * 0.75}rem` }}
                  className={`block w-full text-left leading-snug py-1 pr-2 rounded-md transition-colors cursor-pointer truncate ${t.depth === 0 ? 'text-[12px] font-medium' : 'text-[11px]'} ${
                    activeToc === t.anchor
                      ? 'text-gold-700 dark:text-gold-400 bg-gold-50 dark:bg-gold-900/20'
                      : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800/50'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </div>
        </aside>

        <div ref={bodyRef} className={`flex-1 min-w-0 transition-[margin] ${selected ? 'lg:mr-[26rem]' : ''}`}>
          <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl shadow-sm p-5 sm:p-8">
            {prefaceHtml && (
              <div className="prose prose-stone dark:prose-invert prose-sm max-w-none mb-6 text-stone-600 dark:text-stone-400" dangerouslySetInnerHTML={{ __html: prefaceHtml }} />
            )}
            <ProvisionList provisions={doc.provisions} selectedId={selected?.id ?? null} reviewed={reviewed} onSelect={(p) => select(p)} showChanges={doc.kind === 'code'} />
          </div>
        </div>
      </div>

      {selected && (
        <ProvisionPanel
          key={selected.id}
          doc={doc}
          provision={selected}
          mayReview={mayReview}
          onClose={() => select(null)}
          onReviewed={() => setReviewed((s) => new Set(s).add(selected.id))}
        />
      )}
    </div>
  );
}

function ProvisionList({ provisions, selectedId, reviewed, onSelect, showChanges }: {
  provisions: StatuteProvision[];
  selectedId: number | null;
  reviewed: Set<number>;
  onSelect: (p: StatuteProvision) => void;
  showChanges: boolean;
}) {
  return (
    <div className="font-serif text-[15px] leading-relaxed text-stone-800 dark:text-stone-200">
      {provisions.map((p, i) => {
        const prev = provisions[i - 1];
        // Division headings that open here: the path from the first level that differs from the provision before.
        let firstDepth = 0;
        while (firstDepth < p.path.length && prev?.path[firstDepth]?.anchor === p.path[firstDepth].anchor) firstDepth++;
        const opened = p.path.slice(firstDepth);
        const repealed = p.status === 'repealed';
        const active = selectedId === p.id;
        return (
          <Fragment key={p.id}>
            {opened.map((d, k) => {
              const depth = firstDepth + k;
              return (
                <div
                  key={d.anchor}
                  id={d.anchor}
                  data-division=""
                  className={`scroll-mt-24 font-sans text-center ${depth === 0 ? 'mt-10 mb-3 text-sm font-semibold uppercase tracking-wider text-stone-700 dark:text-stone-200' : 'mt-6 mb-3 text-[13px] font-medium text-stone-600 dark:text-stone-300'}`}
                >
                  {d.label}
                </div>
              );
            })}
            <section
              id={p.anchor}
              onClick={() => onSelect(p)}
              className={`group relative scroll-mt-24 -mx-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                active ? 'bg-gold-50 dark:bg-gold-900/20 ring-1 ring-gold-300 dark:ring-gold-700' : 'hover:bg-stone-50 dark:hover:bg-white/[0.03]'
              }`}
            >
              <div className={repealed ? 'text-stone-400 dark:text-stone-500' : ''}>
                {p.text.split('\n').map((para, k) => (
                  <p key={k} className={`${k > 0 ? 'mt-2' : ''} ${/^\(([a-z]|\d+|[ivx]+)\)\s/.test(para) ? 'pl-6' : ''} ${repealed ? 'line-through' : ''}`}>
                    {k === 0 && (
                      <>
                        <span className="font-semibold not-italic">{p.label}</span>{' '}
                        {p.heading && <span className="italic">{p.heading}.</span>}{' '}
                        {(p.heading || para) && <span aria-hidden="true">– </span>}
                      </>
                    )}
                    {para}
                  </p>
                ))}
                {repealed && !p.text && <p className="italic"><span className="font-semibold not-italic">{p.label}</span> Repealed.</p>}
              </div>
              <div className="flex items-center gap-1.5 mt-1 font-sans">
                {showChanges && p.change && p.change !== 'original' && <StatusPill size="sm" tone={CHANGE_TONE[p.change]} label={CHANGE_LABELS[p.change]} />}
                {showChanges && reviewed.has(p.id) && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400" title="Reviewed against the source">
                    <ShieldCheck className="w-3 h-3" /> Reviewed
                  </span>
                )}
                <span className="ml-auto text-[10px] text-stone-400 opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-0.5">
                  <History className="w-3 h-3" /> History
                </span>
              </div>
            </section>
          </Fragment>
        );
      })}
    </div>
  );
}

/** Jump to a provision by number ("237", "266-A") or by words in it. */
function FindInCode({ doc, onPick }: { doc: StatuteDoc; onPick: (p: StatuteProvision) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    // "237", "art. 266-A", "sec 23", or for the Rules "rule 41 sec 3" / "41-3".
    const rule = /^(?:rule\s*)?(\d+)\s*(?:,|-|\s)\s*(?:sec(?:tion)?\.?\s*)?(\d+)$/.exec(needle);
    const num = needle.replace(/^(art(icle)?|sec(tion)?)\.?\s*/, '');
    const anchor = doc.kind === 'rules'
      ? (rule ? ruleSectionAnchor(Number(rule[1]), Number(rule[2])) : null)
      : provisionAnchor(doc.unit, num);
    const exact = doc.provisions.filter((p) => p.anchor === anchor);
    const words = needle.split(/\s+/).filter(Boolean);
    const text = doc.provisions.filter((p) => p.anchor !== anchor && words.every((w) => `${p.heading ?? ''} ${p.text}`.toLowerCase().includes(w)));
    return [...exact, ...text].slice(0, 12);
  }, [q, doc]);

  return (
    <div className="relative max-w-xl">
      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) { onPick(hits[0]); setOpen(false); } }}
        placeholder={`Go to ${doc.unit === 'article' ? 'an article' : 'a section'} number, or find words in the text…`}
        className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] focus:outline-none focus:ring-2 focus:ring-gold-500/30"
      />
      {open && q.trim() && (
        <div className="absolute z-20 mt-1 w-full max-h-80 overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] shadow-lg">
          {hits.length === 0 ? (
            <p className="px-3 py-2 text-xs text-stone-400">Nothing matches.</p>
          ) : hits.map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onPick(p); setOpen(false); }}
              className="block w-full text-left px-3 py-2 hover:bg-stone-50 dark:hover:bg-white/5 cursor-pointer"
            >
              <span className="text-xs font-semibold text-stone-700 dark:text-stone-200">{p.label}</span>{' '}
              <span className="text-xs text-stone-500 dark:text-stone-400">{p.heading}</span>
              <span className="block text-[11px] text-stone-400 truncate">{p.path.at(-1)?.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProvisionPanel({ doc, provision, mayReview, onClose, onReviewed }: {
  doc: StatuteDoc;
  provision: StatuteProvision;
  mayReview: boolean;
  onClose: () => void;
  onReviewed: () => void;
}) {
  const isCode = doc.kind === 'code';
  const [detail, setDetail] = useState<ProvisionDetail | null>(null);
  const [loading, setLoading] = useState(isCode);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isCode) return;
    let live = true;
    fetch(`/api/codes/provisions/${provision.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Could not load the history'))))
      .then((d: ProvisionDetail) => { if (live) setDetail(d); })
      .catch((err) => { if (live) toast.error(err.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [isCode, provision.id]);

  const versions = useMemo(() => [...(detail?.versions ?? [])].sort((a, b) => b.seq - a.seq), [detail]);
  const latestSeq = versions[0]?.seq ?? 0;
  const currentReview = detail?.reviews.find((r) => r.versionSeq === latestSeq) ?? null;
  const link = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}#${provision.anchor}` : '';

  async function review() {
    setBusy(true);
    try {
      const res = await fetch(`/api/codes/provisions/${provision.id}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not record the review');
      setDetail((d) => (d ? { ...d, reviews: [data.review as ProvisionReview, ...d.reviews] } : d));
      onReviewed();
      toast.success('Marked reviewed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not record the review');
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside
      role="dialog"
      aria-label={`${provision.citation}: history`}
      className="fixed z-30 right-0 bottom-0 top-auto lg:top-16 w-full lg:w-[26rem] max-h-[70vh] lg:max-h-none border-l border-t lg:border-t-0 border-stone-200 dark:border-white/10 bg-white dark:bg-card shadow-2xl flex flex-col"
    >
      <div className="flex items-start gap-2 px-5 pt-4 pb-3 border-b border-[var(--border-color)]">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wide text-stone-400">{doc.title}</p>
          <h2 className="font-serif text-lg font-semibold text-stone-900 dark:text-stone-100 leading-snug">
            {provision.label} {provision.heading}
          </h2>
          <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">
            <CopyText text={provision.citation} className="!font-sans" />
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded-md text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-white/5 cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 text-sm">
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(link).then(() => toast.success('Link copied'))}>
            <Link2 className="w-3.5 h-3.5" /> Copy link
          </Button>
          {doc.sourceUrl && (
            <Button size="sm" variant="outline" href={doc.sourceUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-3.5 h-3.5" /> {doc.kind === 'rules' ? 'Official text' : 'Source'}
            </Button>
          )}
        </div>

        {!isCode ? (
          <p className="text-xs text-stone-500 dark:text-stone-400">
            As published in {doc.descriptor}{doc.effectiveOn ? `, effective ${fmtDate(doc.effectiveOn)}` : ''}. Changes to individual sections are not tracked for the Rules of Court.
          </p>
        ) : loading ? (
          <div className="flex items-center gap-2 text-xs text-stone-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading the history…</div>
        ) : detail ? (
          <>
            <ReviewBox review={currentReview} mayReview={mayReview} busy={busy} onReview={review} />
            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400 mb-2 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" /> History
              </h3>
              <ol className="relative border-l border-stone-200 dark:border-white/10 ml-1.5 space-y-4">
                {versions.map((v, i) => (
                  <VersionEntry key={v.seq} version={v} previous={versions[i + 1] ?? null} current={i === 0} doc={doc} />
                ))}
              </ol>
            </div>
          </>
        ) : null}
      </div>
    </aside>
  );
}

function ReviewBox({ review, mayReview, busy, onReview }: { review: ProvisionReview | null; mayReview: boolean; busy: boolean; onReview: () => void }) {
  if (review) {
    return (
      <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-emerald-200 dark:border-emerald-400/20 bg-emerald-50/60 dark:bg-emerald-400/5 text-xs text-emerald-800 dark:text-emerald-300">
        <ShieldCheck className="w-4 h-4 shrink-0 mt-px" />
        <span>Reviewed against the source by {review.reviewerName} on {fmtDate(review.reviewedAt)}.</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-400/20 bg-amber-50/60 dark:bg-amber-400/5 text-xs text-amber-800 dark:text-amber-300">
      <span className="flex-1">Not yet reviewed against the source.</span>
      {mayReview && (
        <Button size="sm" variant="success" onClick={onReview} disabled={busy}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Mark reviewed
        </Button>
      )}
    </div>
  );
}

function VersionEntry({ version: v, previous, current, doc }: { version: ProvisionVersion; previous: ProvisionVersion | null; current: boolean; doc: StatuteDoc }) {
  const [show, setShow] = useState<'none' | 'text' | 'diff'>('none');
  const canDiff = !!(v.text && previous?.text);
  return (
    <li className="pl-4 relative">
      <span className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--card-bg)] ${current ? 'bg-gold-500' : 'bg-stone-300 dark:bg-stone-600'}`} aria-hidden="true" />
      <div className="flex items-center gap-1.5 flex-wrap">
        <StatusPill size="sm" tone={CHANGE_TONE[v.change]} label={CHANGE_LABELS[v.change]} />
        {current && <span className="text-[10px] uppercase tracking-wide text-gold-600 dark:text-gold-400">In force</span>}
      </div>
      <p className="mt-1 text-stone-700 dark:text-stone-200">
        {v.change === 'original'
          ? <>Enacted by {doc.descriptor.split(' · ')[0]}{v.approvedOn ? `, approved ${fmtDate(v.approvedOn)}` : ''}</>
          : describeChange(v, fmtDate)}
      </p>
      {v.effectiveOn && <p className="text-xs text-stone-500 dark:text-stone-400">Effective {fmtDate(v.effectiveOn)}</p>}
      {v.change !== 'original' && v.number && previous?.number && v.number !== previous.number && (
        <p className="text-xs text-stone-500 dark:text-stone-400">Formerly {doc.unit === 'article' ? 'art.' : 'sec.'} {previous.number}</p>
      )}
      {v.instrumentUrl && (
        <a href={v.instrumentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-gold-600 dark:text-gold-400 hover:underline">
          {v.instrument ?? 'Source'} <ExternalLink className="w-3 h-3" />
        </a>
      )}
      {v.note && <p className="mt-1 text-xs text-stone-500 dark:text-stone-400 italic">{v.note}</p>}
      <div className="mt-1.5 flex items-center gap-3 text-xs">
        {v.text ? (
          <button type="button" onClick={() => setShow(show === 'text' ? 'none' : 'text')} className="inline-flex items-center gap-0.5 text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 cursor-pointer">
            <ChevronRight className={`w-3 h-3 transition-transform ${show === 'text' ? 'rotate-90' : ''}`} /> Text of this version
          </button>
        ) : v.change !== 'repealed' ? (
          <span className="text-stone-400">Text of this version not in the collection</span>
        ) : null}
        {canDiff && (
          <button type="button" onClick={() => setShow(show === 'diff' ? 'none' : 'diff')} className="inline-flex items-center gap-0.5 text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 cursor-pointer">
            <ChevronRight className={`w-3 h-3 transition-transform ${show === 'diff' ? 'rotate-90' : ''}`} /> What changed
          </button>
        )}
      </div>
      {show === 'text' && v.text && (
        <div className="mt-2 p-3 rounded-lg bg-stone-50 dark:bg-white/[0.03] font-serif text-[13px] leading-relaxed whitespace-pre-line">{v.text}</div>
      )}
      {show === 'diff' && v.text && previous?.text && (
        <div className="mt-2 p-3 rounded-lg bg-stone-50 dark:bg-white/[0.03] font-serif text-[13px] leading-relaxed whitespace-pre-line">
          {diffWords(previous.text, v.text).map((part, i) => (
            <span
              key={i}
              className={part.kind === 'added' ? 'bg-emerald-100 dark:bg-emerald-400/20 text-emerald-900 dark:text-emerald-200' : part.kind === 'removed' ? 'bg-rose-100 dark:bg-rose-400/20 text-rose-900 dark:text-rose-200 line-through' : ''}
            >
              {part.text}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}
