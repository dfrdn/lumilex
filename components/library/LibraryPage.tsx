'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  BookOpen, Plus, Search, Pin, EyeOff, Clock, User, Loader2, ExternalLink, Sparkles, ArrowLeft, Eye, Tag, ChevronDown, Scale,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import CellDropdown, { type DropdownOption } from '@/components/admin/CellDropdown';
import { useLibraryPages } from '@/hooks/use-library';
import {
  HANDBOOK_KINDS, SECTION_KINDS, SECTION_LABELS, canAuthorHandbook, isReviewer, kindLabel, needsReview, sectionOf,
  type HandbookKind, type LibraryPageSummary, type LibrarySection,
} from '@/lib/library/model';

const ResourceEditor = dynamic(() => import('./ResourceEditor'), { ssr: false });

const SECTION_TONE: Record<LibrarySection, string> = {
  handbook: 'bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-300',
  distilled: 'bg-violet-50 text-violet-700 dark:bg-violet-400/10 dark:text-violet-300',
  rules: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300',
};

// Codes first, then the books of the Rules in the order the Court numbers them.
const LAW_ORDER = ['legal-code-labor', 'legal-code-rcc', 'rules-of-court-civil', 'rules-of-court-criminal', 'rules-of-court-evidence'];

function lawRank(slug: string): number {
  const i = LAW_ORDER.indexOf(slug);
  return i === -1 ? LAW_ORDER.length : i;
}

type StatusFilter = 'all' | 'published' | 'review';

interface Props {
  role: string;
  /**
   * Whether this firm's Library shows the pages distilled from its matters.
   * They are AI output, so they follow the `ai_search` switch; the handbook
   * and the Rules of Court do not.
   */
  showDistilled: boolean;
}

export default function LibraryPage({ role, showDistilled }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data, isLoading, mutate } = useLibraryPages();
  const pages = useMemo(() => data?.pages ?? [], [data]);

  const canAuthor = canAuthorHandbook(role);
  const reviewer = isReviewer(role);

  const [section, setSection] = useState<'all' | LibrarySection>(searchParams.get('section') === 'rules' ? 'rules' : 'all');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState<StatusFilter>(searchParams.get('status') === 'review' ? 'review' : 'all');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [building, setBuilding] = useState(false);

  // Distil new and updated pages from the matter archive. They land as drafts
  // in "Needs review"; a page a person curated is never overwritten.
  async function buildFromMatters() {
    setBuilding(true);
    try {
      const res = await fetch('/api/kb/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 25, minContributors: 2 }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not build from matters');
      const stats = body.stats;
      toast.success(`Read ${stats.mattersProcessed} matters · ${stats.pagesWritten} pages drafted or updated`);
      mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not build from matters');
    } finally {
      setBuilding(false);
    }
  }

  const reviewCount = useMemo(() => pages.filter((p) => needsReview(p.status)).length, [pages]);

  const kindsPresent = useMemo(() => {
    const present = new Set(pages.map((p) => p.kind));
    const order = section === 'all' ? [...SECTION_KINDS.handbook, ...SECTION_KINDS.distilled] : SECTION_KINDS[section];
    return order.filter((k) => present.has(k));
  }, [pages, section]);

  const rulesCount = useMemo(() => pages.filter((p) => sectionOf(p.kind) === 'rules').length, [pages]);
  const lawSummary = useMemo(() => {
    const law = pages.filter((p) => sectionOf(p.kind) === 'rules');
    const codes = law.filter((p) => p.kind === 'legal_code').length;
    const books = law.length - codes;
    return [codes && `${codes} code${codes === 1 ? '' : 's'}`, books && `${books} book${books === 1 ? '' : 's'} of the Rules`].filter(Boolean).join(' and ');
  }, [pages]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = pages.filter((p) => {
      const pageSection = sectionOf(p.kind);
      // The law has its own tab; "All" is the firm's own writing.
      if (section === 'all' && pageSection === 'rules' && !needle) return false;
      if (section !== 'all' && pageSection !== section) return false;
      if (kind && p.kind !== kind) return false;
      if (status === 'published' && p.status !== 'published') return false;
      if (status === 'review' && !needsReview(p.status)) return false;
      if (needle && !`${p.title} ${p.summary}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    if (section !== 'rules') return list;
    return [...list].sort((a, b) => lawRank(a.slug) - lawRank(b.slug) || a.title.localeCompare(b.title));
  }, [pages, section, kind, status, q]);

  const sectionTabs: ReadonlyArray<readonly ['all' | LibrarySection, string]> = [
    ['all', 'All'],
    ['handbook', SECTION_LABELS.handbook],
    ...(showDistilled ? [['distilled', SECTION_LABELS.distilled] as const] : []),
    ...(rulesCount > 0 ? [['rules', SECTION_LABELS.rules] as const] : []),
  ];

  if (creating) {
    return (
      <PageForm
        onBack={() => setCreating(false)}
        onSaved={(id) => { mutate(); setCreating(false); router.push(`/dashboard/library/${id}`); }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gold-50 dark:bg-gold-900/20 flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-gold-600 dark:text-gold-400" />
          </div>
          <div>
            <h1 className="font-serif text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">Library</h1>
            <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">
              {data
                ? `${pages.length - rulesCount} page${pages.length - rulesCount === 1 ? '' : 's'} · ${[
                  'the firm handbook',
                  showDistilled ? 'what the system distilled from our matters' : null,
                  rulesCount > 0 ? 'the codes and Rules of Court' : null,
                ].filter(Boolean).join(', ').replace(/, ([^,]*)$/, ' and $1')}`
                : ' '}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
        {reviewer && showDistilled && (
          <button
            type="button"
            onClick={buildFromMatters}
            disabled={building}
            title="Distil doctrine, clauses and profiles from closed matters into draft pages"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-[var(--border-color)] text-stone-600 dark:text-stone-300 hover:border-gold-300 dark:hover:border-gold-700 transition-colors cursor-pointer disabled:opacity-50"
          >
            {building ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Build from matters
          </button>
        )}
        {canAuthor && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-gold-500 text-white hover:bg-gold-600 transition-colors cursor-pointer shadow-sm"
          >
            <Plus className="w-4 h-4" />
            New page
          </button>
        )}
        </div>
      </div>

      {/* Section tabs + search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1 p-1 rounded-xl border border-stone-200 dark:border-[rgba(255,255,255,0.08)] bg-card" role="tablist">
          {sectionTabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={section === id}
              onClick={() => { setSection(id); setKind(''); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                section === id
                  ? 'bg-gold-50 text-gold-700 dark:bg-gold-400/15 dark:text-gold-300 ring-1 ring-inset ring-gold-300/60 dark:ring-gold-400/30'
                  : 'text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 dark:text-stone-500" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the library…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-stone-800 dark:text-stone-200 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-gold-500/30 focus:border-gold-400 dark:placeholder:text-stone-500"
          />
        </div>
        {(reviewer || canAuthor) && (
          <div className="inline-flex items-center gap-1 ml-auto">
            <Pill active={status === 'all'} onClick={() => setStatus('all')}>All</Pill>
            <Pill active={status === 'published'} onClick={() => setStatus('published')}>Published</Pill>
            <Pill active={status === 'review'} onClick={() => setStatus('review')}>
              Needs review{reviewCount > 0 && <span className="ml-1 inline-flex items-center justify-center min-w-[1.1rem] h-4 px-1 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300">{reviewCount}</span>}
            </Pill>
          </div>
        )}
      </div>

      {/* Kind chips */}
      {section !== 'rules' && kindsPresent.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill active={kind === ''} onClick={() => setKind('')}>All kinds</Pill>
          {kindsPresent.map((k) => (
            <Pill key={k} active={kind === k} onClick={() => setKind(kind === k ? '' : k)}>{kindLabel(k)}</Pill>
          ))}
        </div>
      )}

      {section === 'all' && rulesCount > 0 && !q.trim() && (
        <button
          type="button"
          onClick={() => { setSection('rules'); setKind(''); }}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-emerald-200 dark:border-emerald-400/20 bg-emerald-50/50 dark:bg-emerald-400/5 hover:bg-emerald-50 dark:hover:bg-emerald-400/10 text-left transition-colors cursor-pointer"
        >
          <Scale className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="text-sm text-stone-700 dark:text-stone-200">
            <span className="font-semibold">{SECTION_LABELS.rules}</span>
            <span className="text-stone-500 dark:text-stone-400"> · {lawSummary}, each read whole with every provision linkable</span>
          </span>
          <span className="ml-auto text-xs text-emerald-700 dark:text-emerald-300 shrink-0">Browse</span>
        </button>
      )}

      {/* Cards */}
      {isLoading || !data ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 text-gold-500 animate-spin dark:text-gold-400" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 rounded-xl border border-dashed border-stone-200 dark:border-[rgba(255,255,255,0.08)]">
          <BookOpen className="w-10 h-10 mx-auto text-stone-300 dark:text-stone-600 mb-3" />
          <p className="text-sm font-medium text-stone-600 dark:text-stone-300">
            {pages.length === 0 ? 'Nothing in the library yet.' : status === 'review' ? 'Nothing waiting for review.' : 'No pages match.'}
          </p>
          <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
            {pages.length === 0
              ? canAuthor ? 'Write the first guide or policy.' : 'Guides and policies will appear here once written.'
              : 'Try another section, kind, or search.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => <PageCard key={p.id} page={p} />)}
        </div>
      )}
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs border transition-colors cursor-pointer ${
        active
          ? 'border-gold-400 bg-gold-50 dark:bg-gold-400/10 text-gold-700 dark:text-gold-300'
          : 'border-stone-200 dark:border-[rgba(255,255,255,0.1)] text-stone-500 dark:text-stone-400 hover:border-stone-300 dark:hover:border-stone-600'
      }`}
    >
      {children}
    </button>
  );
}

function PageCard({ page }: { page: LibraryPageSummary }) {
  const section = sectionOf(page.kind);
  const date = new Date(page.updated_at).toLocaleDateString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila',
  });
  const body = (
    <>
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full uppercase tracking-wide ${SECTION_TONE[section]}`}>
          {kindLabel(page.kind)}
        </span>
        {page.status !== 'published' && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300 uppercase">
            <EyeOff className="w-3 h-3" /> {page.status === 'review' ? 'In review' : page.status === 'draft' ? 'Draft' : page.status}
          </span>
        )}
        {page.pinned && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-gold-600 dark:text-gold-400 uppercase tracking-wide">
            <Pin className="w-3 h-3" /> Pinned
          </span>
        )}
      </div>
      <h3 className="font-serif text-base font-bold text-stone-900 dark:text-stone-100 leading-snug mb-2 group-hover:text-gold-700 dark:group-hover:text-gold-400 transition-colors line-clamp-2">
        {page.title}
        {page.external_url && <ExternalLink className="inline-block w-3.5 h-3.5 ml-1.5 -mt-0.5 text-stone-400 dark:text-stone-500 align-middle" />}
      </h3>
      {page.summary && (
        <p className="text-xs text-stone-500 dark:text-stone-400 leading-relaxed line-clamp-3 mb-3">{page.summary}</p>
      )}
      <div className="flex items-center gap-3 text-[11px] text-stone-400 dark:text-stone-500 mt-auto pt-2 border-t border-stone-100 dark:border-stone-800">
        <span className="flex items-center gap-1 truncate">
          {page.generated_by === 'manual' ? <User className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
          {page.generated_by === 'manual'
            ? page.author_name || 'The firm'
            : `Drafted by AI${page.contributorCount > 0 ? ` · ${page.contributorCount} matter${page.contributorCount === 1 ? '' : 's'}` : ''}`}
        </span>
        <span className="flex items-center gap-1 shrink-0"><Clock className="w-3 h-3" />{date}</span>
      </div>
    </>
  );
  const className = 'group flex flex-col bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-5 hover:border-gold-300 dark:hover:border-gold-700 transition-all duration-150 cursor-pointer';
  return page.external_url ? (
    <a href={page.external_url} target="_blank" rel="noopener noreferrer" className={className}>{body}</a>
  ) : (
    <Link href={`/dashboard/library/${page.id}`} className={className}>{body}</Link>
  );
}

// ── New handbook page ──

const KIND_OPTIONS: DropdownOption[] = HANDBOOK_KINDS.map((k) => ({ id: k, label: kindLabel(k) }));

function PageForm({ onBack, onSaved }: { onBack: () => void; onSaved: (id: number) => void }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [summary, setSummary] = useState('');
  const [kind, setKind] = useState<HandbookKind>('guide');
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [kindOpen, setKindOpen] = useState(false);
  const kindRef = useRef<HTMLButtonElement>(null);

  async function save(status: 'draft' | 'published') {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/library/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), content, summary: summary.trim(), kind, status, pinned }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not save the page');
      toast.success(status === 'published' ? 'Published to the firm' : 'Saved as a draft');
      onSaved(body.page.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the page');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300 transition-colors cursor-pointer">
          <ArrowLeft className="w-4 h-4" /> Library
        </button>
        <div className="flex items-center gap-2">
          <button type="button" disabled={saving || !title.trim()} onClick={() => save('draft')} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-[var(--border-color)] text-stone-600 dark:text-stone-400 hover:border-gold-300 dark:hover:border-gold-700 transition-colors cursor-pointer disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <EyeOff className="w-4 h-4" />} Save draft
          </button>
          <button type="button" disabled={saving || !title.trim()} onClick={() => save('published')} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-gold-500 text-white hover:bg-gold-600 transition-colors cursor-pointer disabled:opacity-50 shadow-sm">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />} Publish
          </button>
        </div>
      </div>

      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Page title…"
        className="w-full text-2xl font-serif font-bold text-stone-900 dark:text-stone-100 bg-transparent border-0 outline-none placeholder:text-stone-300 dark:placeholder:text-stone-600"
      />

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4 text-stone-400 dark:text-stone-500" />
          <button
            type="button"
            ref={kindRef}
            onClick={() => setKindOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 text-sm rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] text-stone-700 dark:text-stone-300 px-2.5 py-1 cursor-pointer hover:border-stone-300 dark:hover:border-stone-600"
          >
            {kindLabel(kind)} <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
          </button>
          {kindOpen && (
            <CellDropdown
              mode="single"
              value={kind}
              options={KIND_OPTIONS}
              onSelect={(id) => { if (id) setKind(id as HandbookKind); setKindOpen(false); }}
              onClose={() => setKindOpen(false)}
              anchorRef={kindRef}
            />
          )}
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-stone-600 dark:text-stone-400 cursor-pointer">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="rounded border-stone-300 dark:border-stone-600 text-gold-500 focus:ring-gold-500/30" />
          <Pin className="w-3.5 h-3.5" /> Pin to top
        </label>
      </div>

      <div>
        <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1">Summary (shown on the card)</label>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="One or two sentences on what this page is for…"
          rows={2}
          className="w-full text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-stone-700 dark:text-stone-300 px-3 py-2 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-gold-500/30 resize-none dark:placeholder:text-stone-500"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1">Content</label>
        <ResourceEditor content={content} onChange={setContent} />
      </div>
    </div>
  );
}
