'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import {
  ArrowLeft, Check, CircleCheck, Clock, FileText, Link2, List as ListIcon, Loader2, Pencil, Pin, Quote, Save,
  Sparkles, Trash2, User, X, ArrowRight,
} from 'lucide-react';
import ChatMarkdown from '@/components/ChatMarkdown';
import type { RulesPageMeta } from '@/lib/library/load';
import {
  canDeleteKind, canEditKind, canPublishKind, isHandbookKind, kindLabel, publishBlockedReason, sectionOf,
  stripCitationTags, STATUS_LABELS,
  type LibraryCitation, type LibraryContributor, type LibraryPageFull,
} from '@/lib/library/model';
import { confirmAction } from '@/components/ui/confirm';

const ResourceEditor = dynamic(() => import('./ResourceEditor'), { ssr: false });

interface Props {
  page: LibraryPageFull;
  citations: LibraryCitation[];
  contributors: LibraryContributor[];
  /** Set for a Rules of Court page: its book, neighbours, and section anchors. */
  rules?: RulesPageMeta | null;
  /** A section number to open the page at (?section=N). */
  initialSection?: number | null;
  role: string;
  currentUserId: string;
}

export default function LibraryPageDetail({ page: initial, citations, contributors, rules = null, initialSection = null, role }: Props) {
  const router = useRouter();
  const [page, setPage] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftTitle, setDraftTitle] = useState(initial.title);
  const [draftSummary, setDraftSummary] = useState(initial.summary ?? '');
  const [draftContent, setDraftContent] = useState(initial.content_md ?? '');

  const handbook = isHandbookKind(page.kind);
  const isRules = !!rules;
  // Rules pages read like handbook pages: one article, no citation rail.
  const plain = handbook || isRules;
  const html = page.content_format === 'html';
  const initialAnchor = isRules && initialSection != null ? rules.sections.find((x) => x.section === initialSection)?.anchor ?? null : null;
  const mayEdit = canEditKind(role, page.kind);
  const mayPublish = canPublishKind(role, page.kind);
  const mayDelete = canDeleteKind(role, page.kind);
  const blocked = publishBlockedReason(page, citations.length);

  async function patch(body: Record<string, unknown>, successMsg: string): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/library/pages/${page.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Update failed');
      setPage((p) => ({ ...p, ...data.page }));
      toast.success(successMsg);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
      return false;
    } finally {
      setBusy(false);
    }
  }

  function startEdit() {
    setDraftTitle(page.title);
    setDraftSummary(page.summary ?? '');
    setDraftContent(page.content_md ?? '');
    setEditing(true);
  }

  async function saveEdit() {
    if (!draftTitle.trim()) return;
    const ok = await patch({ title: draftTitle.trim(), summary: draftSummary.trim(), content: draftContent }, 'Saved');
    if (ok) setEditing(false);
  }

  async function remove() {
    if (!(await confirmAction({ title: 'Delete this page?', message: 'The last version is kept in history, but the page disappears for everyone.', confirmLabel: 'Delete', danger: true }))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/library/pages/${page.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Delete failed');
      toast.success('Page deleted');
      router.push('/dashboard/library');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
      setBusy(false);
    }
  }

  const created = fmtDate(page.created_at, true);
  const updated = page.updated_at !== page.created_at ? fmtDate(page.updated_at) : null;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Back + actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link href={isRules ? '/dashboard/library?section=rules' : '/dashboard/library'} className="inline-flex items-center gap-1.5 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300 transition-colors">
          <ArrowLeft className="w-4 h-4" /> {isRules ? 'Rules of Court' : 'Library'}
        </Link>
        {rules && <RuleNav rules={rules} />}
        {(mayEdit || mayPublish || mayDelete) && !editing && (
          <div className="flex items-center gap-2 flex-wrap">
            {mayEdit && (
              <button type="button" onClick={startEdit} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border-color)] text-stone-600 dark:text-stone-400 hover:border-gold-300 dark:hover:border-gold-700 hover:text-gold-600 dark:hover:text-gold-400 transition-colors cursor-pointer disabled:opacity-50">
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            )}
            {mayEdit && (
              <button type="button" onClick={() => patch({ pinned: !page.pinned }, page.pinned ? 'Unpinned' : 'Pinned to the top')} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border-color)] text-stone-600 dark:text-stone-400 hover:border-gold-300 dark:hover:border-gold-700 transition-colors cursor-pointer disabled:opacity-50">
                <Pin className="w-3.5 h-3.5" /> {page.pinned ? 'Unpin' : 'Pin'}
              </button>
            )}
            {mayPublish && page.status !== 'published' && (
              <button
                type="button"
                onClick={() => patch({ status: 'published' }, 'Published to the firm')}
                disabled={busy || !!blocked}
                title={blocked ?? 'Publish'}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CircleCheck className="w-3.5 h-3.5" />} Publish
              </button>
            )}
            {mayPublish && page.status === 'published' && (
              <button type="button" onClick={() => patch({ status: 'draft' }, 'Moved back to draft')} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border-color)] text-stone-600 dark:text-stone-400 hover:border-stone-300 dark:hover:border-stone-600 transition-colors cursor-pointer disabled:opacity-50">
                <X className="w-3.5 h-3.5" /> Unpublish
              </button>
            )}
            {mayDelete && (
              <button type="button" onClick={remove} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 dark:border-red-800/40 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors cursor-pointer disabled:opacity-50">
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            )}
          </div>
        )}
      </div>

      {blocked && mayPublish && page.status !== 'published' && (
        <div className="px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-400/20 bg-amber-50/60 dark:bg-amber-400/5 text-xs text-amber-800 dark:text-amber-300">
          {blocked}
        </div>
      )}

      {editing ? (
        <div className="space-y-5 max-w-4xl">
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-[var(--border-color)] hover:bg-stone-50 dark:hover:bg-white/5 cursor-pointer">
              Cancel
            </button>
            <button type="button" onClick={saveEdit} disabled={busy || !draftTitle.trim()} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-gold-500 hover:bg-gold-600 text-white cursor-pointer disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
            </button>
          </div>
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            className="w-full text-2xl font-serif font-bold text-stone-900 dark:text-stone-100 bg-transparent border-0 outline-none"
          />
          <textarea
            value={draftSummary}
            onChange={(e) => setDraftSummary(e.target.value)}
            rows={2}
            placeholder="Summary shown on the card…"
            className="w-full text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gold-500/30 resize-none"
          />
          {html ? (
            <ResourceEditor content={draftContent} onChange={setDraftContent} />
          ) : (
            <>
              <textarea
                value={draftContent}
                onChange={(e) => setDraftContent(e.target.value)}
                className="w-full min-h-[440px] p-4 rounded-xl border border-stone-200 dark:border-[rgba(255,255,255,0.1)] bg-card font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-gold-300 dark:focus:ring-gold-500/40"
              />
              {!handbook && (
                <p className="text-[11px] text-stone-400 dark:text-stone-500">
                  Markdown. Saving marks this page curated by the firm, so the next rebuild from matters leaves it alone.
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`px-2.5 py-0.5 text-[10px] font-semibold rounded-full uppercase tracking-wide ${
                sectionOf(page.kind) === 'handbook'
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-300'
                  : sectionOf(page.kind) === 'rules'
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300'
                    : 'bg-violet-50 text-violet-700 dark:bg-violet-400/10 dark:text-violet-300'
              }`}>
                {isRules ? rules.sourceLabel : kindLabel(page.kind)}
              </span>
              {!isRules && <StatusBadge status={page.status} />}
              {page.pinned && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-gold-600 dark:text-gold-400 uppercase tracking-wide">
                  <Pin className="w-3 h-3" /> Pinned
                </span>
              )}
              {!handbook && <span className="text-[11px] text-stone-400 dark:text-stone-500">v{page.version}</span>}
            </div>
            <h1 className="font-serif text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-100">{page.title}</h1>
            {isRules ? (
              <p className="text-sm text-stone-500 dark:text-stone-400">
                {rules.part ? <>{rules.part.split(' — ').map((x) => x.charAt(0) + x.slice(1).toLowerCase()).join(' · ')} · </> : null}
                {rules.sections.length} section{rules.sections.length === 1 ? '' : 's'} · {rules.issuance}, effective {fmtDate(rules.effective)} ·{' '}
                <a href={rules.officialUrl} target="_blank" rel="noopener noreferrer" className="text-gold-600 dark:text-gold-400 hover:underline">Official text</a>
              </p>
            ) : page.summary && <p className="text-sm text-stone-500 dark:text-stone-400">{page.summary}</p>}
            {!isRules && <div className="flex items-center gap-4 text-xs text-stone-400 dark:text-stone-500 flex-wrap">
              <span className="flex items-center gap-1.5">
                {page.generated_by === 'manual' ? <User className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
                {page.generated_by === 'manual' ? (page.author_name || 'The firm') : `Drafted by ${page.model_used ?? 'AI'}`}
              </span>
              <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> {created}</span>
              {updated && <span className="text-stone-300 dark:text-stone-600">Updated {updated}</span>}
            </div>}
          </div>

          <div className={`grid gap-6 ${plain ? 'xl:grid-cols-[1fr_224px]' : 'lg:grid-cols-[1fr_300px]'}`}>
            <div className="min-w-0">
              {html ? (
                <HtmlArticle html={page.content_md ?? ''} initialAnchor={initialAnchor} />
              ) : (
                <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl shadow-sm p-6 sm:p-8">
                  <article className="prose-kb text-sm leading-relaxed">
                    <ChatMarkdown content={stripCitationTags(page.content_md ?? '')} />
                  </article>
                </div>
              )}
            </div>

            {!plain && (
              <aside className="space-y-5">
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400 flex items-center gap-1.5 mb-2">
                    <Quote className="w-3.5 h-3.5" /> Citations ({citations.length})
                  </h2>
                  <div className="space-y-2">
                    {citations.map((c) => (
                      <div key={c.id} className="p-2.5 rounded-lg border border-stone-100 dark:border-[rgba(255,255,255,0.06)] bg-card">
                        {c.matter_id ? (
                          <Link href={`/dashboard/matters/${c.matter_id}`} className="text-xs font-medium hover:text-gold-600 dark:hover:text-gold-300">{c.matter_name}</Link>
                        ) : (
                          <span className="text-xs font-medium">{c.source_type}</span>
                        )}
                        {c.excerpt && <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-1 line-clamp-3">“{c.excerpt}”</p>}
                      </div>
                    ))}
                    {citations.length === 0 && <p className="text-xs text-stone-400 dark:text-stone-500">No citations.</p>}
                  </div>
                </div>
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400 flex items-center gap-1.5 mb-2">
                    <Link2 className="w-3.5 h-3.5" /> Distilled from ({contributors.length})
                  </h2>
                  <div className="space-y-1">
                    {contributors.map((m) => (
                      <Link key={m.matter_id} href={`/dashboard/matters/${m.matter_id}`} className="flex items-center gap-1.5 text-xs text-stone-600 dark:text-stone-300 hover:text-gold-600 dark:hover:text-gold-300 py-0.5">
                        <FileText className="w-3 h-3 shrink-0 text-stone-400" />
                        <span className="truncate">{m.matter_name}</span>
                      </Link>
                    ))}
                    {contributors.length === 0 && <p className="text-xs text-stone-400 dark:text-stone-500">No source matters recorded.</p>}
                  </div>
                </div>
                <p className="text-[11px] text-stone-400 dark:text-stone-500 flex items-center gap-1.5 pt-3 border-t border-stone-100 dark:border-[rgba(255,255,255,0.06)]">
                  <Sparkles className="w-3 h-3" />
                  {page.generated_by === 'manual' ? 'Curated by the firm' : `Drafted by ${page.model_used ?? 'AI'}`}
                  {page.last_generated_at && ` · last generated ${fmtDate(page.last_generated_at)}`}
                </p>
              </aside>
            )}
          </div>
          {rules && (
            <div className="flex justify-end pt-2">
              <RuleNav rules={rules} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Previous / next rule in the same book. */
function RuleNav({ rules }: { rules: RulesPageMeta }) {
  const cls = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border-color)] text-stone-600 dark:text-stone-400 hover:border-gold-300 dark:hover:border-gold-700 hover:text-gold-600 dark:hover:text-gold-400 transition-colors max-w-[16rem]';
  return (
    <div className="flex items-center gap-2">
      {rules.prev && (
        <Link href={`/dashboard/library/${rules.prev.id}`} className={cls} title={rules.prev.title}>
          <ArrowLeft className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{rules.prev.title}</span>
        </Link>
      )}
      {rules.next && (
        <Link href={`/dashboard/library/${rules.next.id}`} className={cls} title={rules.next.title}>
          <span className="truncate">{rules.next.title}</span> <ArrowRight className="w-3.5 h-3.5 shrink-0" />
        </Link>
      )}
    </div>
  );
}

function fmtDate(iso: string, long = false): string {
  return new Date(iso).toLocaleDateString('en-PH', long
    ? { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }
    : { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });
}

function StatusBadge({ status }: { status: LibraryPageFull['status'] }) {
  const tone: Record<LibraryPageFull['status'], string> = {
    draft: 'bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300',
    review: 'bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-300',
    published: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300',
    stale: 'bg-stone-100 text-stone-500 dark:bg-white/5 dark:text-stone-400',
    archived: 'bg-stone-100 text-stone-400 dark:bg-white/5 dark:text-stone-500',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${tone[status]}`}>
      {status === 'published' && <Check className="w-3 h-3" />}
      {status === 'draft' ? 'Draft — needs review' : STATUS_LABELS[status]}
    </span>
  );
}

// ── Rich-text article with a table of contents (handbook pages) ──

interface TocHeading { id: string; text: string; level: number }

function parseHeadings(html: string): { headings: TocHeading[]; processedHtml: string } {
  const headings: TocHeading[] = [];
  const slugCounts: Record<string, number> = {};
  const processedHtml = html.replace(/<(h[1-3])([^>]*)>([\s\S]*?)<\/\1>/gi, (match, tag, attrs, inner) => {
    const text = inner.replace(/<[^>]*>/g, '').trim();
    let slug = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').substring(0, 60);
    if (slugCounts[slug] !== undefined) {
      slugCounts[slug]++;
      slug = `${slug}-${slugCounts[slug]}`;
    } else {
      slugCounts[slug] = 0;
    }
    headings.push({ id: slug, text, level: parseInt(tag[1]) });
    return `<${tag}${attrs} id="${slug}">${inner}</${tag}>`;
  });
  return { headings, processedHtml };
}

function HtmlArticle({ html, initialAnchor = null }: { html: string; initialAnchor?: string | null }) {
  const [activeId, setActiveId] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);
  const { headings, processedHtml } = useMemo(() => parseHeadings(html), [html]);
  const hasToc = headings.length > 2;

  // Opened at a section (?section=N): scroll to it once the article is in the DOM.
  useEffect(() => {
    if (!initialAnchor) return;
    let tries = 0;
    const tick = () => {
      const el = document.getElementById(initialAnchor);
      if (el) {
        el.scrollIntoView({ block: 'start', behavior: 'smooth' });
        el.classList.add('scroll-mt-24');
        return;
      }
      if (tries++ < 20) timer = setTimeout(tick, 100);
    };
    let timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, [initialAnchor]);

  useEffect(() => {
    if (!headings.length) return;
    const container = contentRef.current;
    if (!container) return;
    const onScroll = () => {
      const elements = container.querySelectorAll('h1[id], h2[id], h3[id]');
      let current = '';
      for (const el of elements) {
        if (el.getBoundingClientRect().top <= 120) current = el.id;
        else break;
      }
      if (current) setActiveId(current);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [headings, processedHtml]);

  const scrollToHeading = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90, behavior: 'smooth' });
  }, []);

  return (
    <div className={`flex gap-8 ${hasToc ? 'items-start' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl shadow-sm p-6 sm:p-8">
          <div
            ref={contentRef}
            className="prose prose-stone dark:prose-invert max-w-none overflow-x-auto prose-headings:font-serif prose-headings:tracking-tight prose-a:text-gold-600 dark:prose-a:text-gold-400 prose-a:no-underline hover:prose-a:underline prose-strong:text-stone-800 dark:prose-strong:text-stone-200 prose-blockquote:border-gold-300 dark:prose-blockquote:border-gold-700"
            dangerouslySetInnerHTML={{ __html: processedHtml }}
          />
        </div>
      </div>
      {hasToc && (
        <aside className="hidden xl:block w-56 shrink-0 sticky top-24">
          <div className="border border-[var(--border-color)] rounded-xl bg-[var(--card-bg)] p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-[var(--border-color)]">
              <ListIcon className="w-3.5 h-3.5 text-gold-500 dark:text-gold-400" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">On this page</span>
            </div>
            <nav className="space-y-0.5 max-h-[calc(100vh-200px)] overflow-y-auto">
              {headings.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => scrollToHeading(h.id)}
                  className={`block w-full text-left text-[12px] leading-snug py-1 rounded-md transition-colors cursor-pointer truncate ${
                    h.level === 1 ? 'pl-2 font-semibold' : h.level === 2 ? 'pl-4' : 'pl-6 text-[11px]'
                  } ${activeId === h.id
                    ? 'text-gold-700 dark:text-gold-400 bg-gold-50 dark:bg-gold-900/20'
                    : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800/50'}`}
                  title={h.text}
                >
                  {h.text}
                </button>
              ))}
            </nav>
          </div>
        </aside>
      )}
    </div>
  );
}
