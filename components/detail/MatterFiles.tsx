'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Paperclip, ChevronDown, ChevronRight, ChevronLeft, Search, ArrowUpDown, Eye, Download, FileCheck } from 'lucide-react';
import { useDetailPane } from '@/components/DetailPaneContext';
import type { NotionFileDetail, FileAttachment } from '@/types/notion';
import type { MatterFiledCopy } from '@/lib/queries/detail';
import FilePreviewModal from '@/components/FilePreviewModal';
import { downloadFile } from '@/lib/download-file';

function formatDate(d: string | null): string {
  if (!d) return '\u2014';
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila',
  });
}

interface Props {
  files: NotionFileDetail[];
  /**
   * Show a source-matter chip on each file row. Defaults to auto-detect
   * (true when rows span >1 matter). Group pages pass `true` explicitly so
   * attribution is always shown even when a group happens to have all
   * files under a single member matter.
   */
  showSourceMatter?: boolean;
  /**
   * "Filed version" deliverable_files rows for this matter's deliverables.
   * Rendered as a Filed Copies sub-list inside the same Files card so the
   * authoritative stamped/received copies are co-located with regular files.
   */
  filedCopies?: MatterFiledCopy[];
}

type SortKey =
  | 'date_received_desc'
  | 'date_received_asc'
  | 'document_date_desc'
  | 'created_time_desc'
  | 'name_asc'
  | 'matter_asc';

const PAGE_SIZE = 25;

const SORT_LABELS: Record<SortKey, string> = {
  date_received_desc: 'Date received (newest first)',
  date_received_asc: 'Date received (oldest first)',
  document_date_desc: 'Document date (newest first)',
  created_time_desc: 'Date added (newest first)',
  name_asc: 'Name (A–Z)',
  matter_asc: 'Matter (A–Z)',
};

export default function MatterFiles({ files, showSourceMatter: showSourceMatterProp, filedCopies = [] }: Props) {
  const { openPane } = useDetailPane();
  const [expanded, setExpanded] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('document_date_desc');
  const [previewFiles, setPreviewFiles] = useState<FileAttachment[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [page, setPage] = useState(1);

  const filteredFiledCopies = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return filedCopies;
    return filedCopies.filter((c) =>
      (c.fileName || '').toLowerCase().includes(q) ||
      (c.deliverableName || '').toLowerCase().includes(q),
    );
  }, [filedCopies, search]);

  const showSourceMatter = useMemo(() => {
    if (showSourceMatterProp !== undefined) return showSourceMatterProp;
    const set = new Set(files.map((f) => f.matterId).filter((v): v is string => !!v));
    return set.size > 1;
  }, [files, showSourceMatterProp]);

  const handleHash = useCallback(() => {
    if (window.location.hash === '#section-files') {
      setExpanded(true);
      requestAnimationFrame(() => {
        document.getElementById('section-files')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        history.replaceState(null, '', window.location.pathname + window.location.search);
      });
    }
  }, []);

  useEffect(() => {
    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, [handleHash]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = q
      ? files.filter((f) =>
          (f.name || '').toLowerCase().includes(q) ||
          (f.origin || '').toLowerCase().includes(q) ||
          (f.actionTaken || '').toLowerCase().includes(q),
        )
      : files.slice();

    // Sort — nulls always sort to the bottom so "missing date" rows don't
    // dominate the top of a desc sort.
    const nullLast = (a: string | null, b: string | null, dir: 1 | -1) => {
      if (!a && !b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      return a < b ? -dir : a > b ? dir : 0;
    };
    matched.sort((a, b) => {
      switch (sortBy) {
        case 'date_received_desc': return nullLast(a.dateReceived ?? null, b.dateReceived ?? null, -1);
        case 'date_received_asc': return nullLast(a.dateReceived ?? null, b.dateReceived ?? null, 1);
        case 'document_date_desc': return nullLast(a.documentDate ?? null, b.documentDate ?? null, -1);
        case 'created_time_desc': return nullLast(a.createdTime ?? null, b.createdTime ?? null, -1);
        case 'name_asc': return (a.name || '').localeCompare(b.name || '');
        case 'matter_asc': {
          const cmp = (a.matter || '').localeCompare(b.matter || '');
          if (cmp !== 0) return cmp;
          return nullLast(a.dateReceived ?? null, b.dateReceived ?? null, -1);
        }
      }
    });
    return matched;
  }, [files, search, sortBy]);

  // Reset to the first page whenever the result set changes (search / sort).
  useEffect(() => {
    setPage(1);
  }, [search, sortBy]);

  // Filed copies occupy the first slots of the sequence, then regular files.
  // The pager windows across the whole thing so filed copies don't repeat on
  // every page.
  const combinedCount = filteredFiledCopies.length + filtered.length;
  const totalPages = Math.max(1, Math.ceil(combinedCount / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageEnd = pageStart + PAGE_SIZE;
  const pagedFiledCopies = filteredFiledCopies.slice(pageStart, pageEnd);
  const pagedFiles = filtered.slice(
    Math.max(0, pageStart - filteredFiledCopies.length),
    Math.max(0, pageEnd - filteredFiledCopies.length),
  );

  return (
    <>
    <div id="section-files" className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden transition-all duration-200 hover:shadow-[var(--shadow-card-hover)] hover:border-[var(--border-hover)] animate-fade-up mt-6">
      {/* Header — clickable toggle */}
      <div
        className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)] cursor-pointer select-none hover:bg-card-hover transition-colors duration-150"
        onClick={() => setExpanded((o) => !o)}
      >
        <div className="flex items-center gap-2.5">
          <Paperclip className="w-4 h-4 text-[var(--text-muted)]" />
          <h2 className="text-[15px] font-semibold text-foreground">Files</h2>
          <span className="font-mono text-[11px] font-medium text-gold-400 bg-gold-50 dark:bg-[rgba(185, 143, 69,0.12)] rounded-full px-2.5 py-0.5 tabular-nums tracking-wide">
            {files.length + filedCopies.length}
          </span>
        </div>
        <ChevronDown className={`w-4 h-4 text-[var(--text-muted)] transition-transform duration-250 ease-out ${expanded ? 'rotate-0' : '-rotate-90'}`} />
      </div>

      {/* Collapsible body */}
      <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          {/* Search + sort */}
          <div className="px-5 py-2.5 border-b border-[var(--border-color)] flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 px-3 py-1.5 bg-[var(--subtle-bg)] rounded-lg">
              <Search className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search files..."
                className="flex-1 text-sm bg-transparent outline-none placeholder:text-[var(--text-muted)] text-[var(--text-primary)]"
              />
              {search && filtered.length !== files.length && (
                <span className="text-[11px] text-[var(--text-muted)] shrink-0">
                  {filtered.length} of {files.length}
                </span>
              )}
            </div>
            <div className="relative shrink-0">
              <ArrowUpDown className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)] pointer-events-none" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
                className="appearance-none pl-8 pr-7 py-1.5 text-xs rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-gold-500/30 focus:border-gold-500 cursor-pointer"
                aria-label="Sort files"
              >
                {(Object.keys(SORT_LABELS) as SortKey[])
                  .filter((k) => k !== 'matter_asc' || showSourceMatter)
                  .map((k) => (
                    <option key={k} value={k}>{SORT_LABELS[k]}</option>
                  ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--text-muted)] pointer-events-none" />
            </div>
          </div>

          {/* Filed Copies — authoritative stamped/sent-out versions, surfaced
              at the top so they're easy to grab without drilling into each
              deliverable. */}
          {pagedFiledCopies.length > 0 && (
            <div className="border-b border-[var(--border-color)] bg-emerald-50/30 dark:bg-emerald-500/[0.04]">
              <div className="px-5 pt-3 pb-2 flex items-center gap-2">
                <FileCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-700 dark:text-emerald-300">
                  Filed Copies
                </h3>
                <span className="font-mono text-[10px] text-emerald-700/70 dark:text-emerald-300/70 tabular-nums">
                  {filteredFiledCopies.length}
                </span>
              </div>
              <div className="divide-y divide-emerald-100/60 dark:divide-emerald-500/10">
                {pagedFiledCopies.map((c) => {
                  const att: FileAttachment = { name: c.fileName, url: c.fileUrl };
                  return (
                    <Link
                      key={c.id}
                      href={`/dashboard/deliverables/${c.deliverableId}`}
                      className="flex items-center justify-between gap-4 px-5 py-2.5 hover:bg-emerald-50/60 dark:hover:bg-emerald-500/10 transition-all duration-150 group"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground group-hover:text-emerald-700 dark:group-hover:text-emerald-300 truncate transition-colors duration-150">
                          {c.fileName || '(Untitled)'}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-100/60 dark:bg-emerald-500/15 ring-1 ring-inset ring-emerald-200/60 dark:ring-emerald-500/20 rounded px-1.5 py-0.5">
                            Filed Copy
                          </span>
                          {c.deliverableName && (
                            <span className="text-[11px] text-[var(--text-muted)] truncate">
                              {c.deliverableName}
                            </span>
                          )}
                          <span className="text-[11px] text-[var(--text-muted)] shrink-0">
                            v{c.version} · {formatDate(c.createdAt.slice(0, 10))}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setPreviewFiles([att]);
                            setPreviewIndex(0);
                          }}
                          className="inline-flex items-center justify-center w-6 h-6 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 ring-1 ring-emerald-200/60 dark:ring-emerald-500/20 rounded-md transition-colors cursor-pointer"
                          title="Preview"
                        >
                          <Eye className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void downloadFile(att);
                          }}
                          className="inline-flex items-center justify-center w-6 h-6 text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--card-bg)] hover:bg-[var(--card-bg-hover)] border border-[var(--border-color)] rounded-md transition-all cursor-pointer"
                          title="Download"
                        >
                          <Download className="w-3 h-3" />
                        </button>
                        <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* File list */}
          {combinedCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Paperclip className="w-8 h-8 text-[var(--text-muted)] mb-2 opacity-30" />
              <p className="text-sm text-[var(--text-muted)]">
                {search ? 'No files match your search' : 'No files'}
              </p>
            </div>
          ) : pagedFiles.length > 0 ? (
            <div className="divide-y divide-[var(--border-color)]">
              {pagedFiles.map((f) => (
                <Link
                  key={f.id}
                  href={`/dashboard/files/${f.id}`}
                  onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); openPane('files', f.id); }}
                  className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-gold-50/40 dark:hover:bg-[rgba(185, 143, 69,0.06)] transition-all duration-150 group"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground group-hover:text-gold-600 dark:group-hover:text-gold-400 truncate transition-colors duration-150">
                      {f.name || '(Untitled)'}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {showSourceMatter && f.matter && (
                        <span
                          className="text-[10px] font-medium text-navy-700 bg-navy-50 ring-1 ring-inset ring-navy-200/60 rounded px-1.5 py-0.5 dark:text-navy-400 dark:bg-navy-500/10 dark:ring-navy-500/20"
                          title={`From matter: ${f.matter}`}
                        >
                          {f.matter}
                        </span>
                      )}
                      {f.origin && (
                        <span className="text-[10px] font-medium text-[var(--text-muted)] bg-[var(--subtle-bg)] rounded px-1.5 py-0.5">
                          {f.origin}
                        </span>
                      )}
                      {f.dateReceived && (
                        <span className="text-[11px] text-[var(--text-muted)]">
                          Received {formatDate(f.dateReceived)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {f.fileUrls && f.fileUrls.length > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setPreviewFiles(f.fileUrls);
                            setPreviewIndex(0);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-gold-700 dark:text-gold-400 bg-gold-50 dark:bg-gold-400/10 rounded-md ring-1 ring-gold-200/60 dark:ring-gold-400/20 hover:bg-gold-100 dark:hover:bg-gold-400/20 transition-colors cursor-pointer"
                          title={f.fileUrls.length > 1 ? `Preview ${f.fileUrls.length} files` : 'Preview'}
                        >
                          <Eye className="w-3 h-3" />
                          {f.fileUrls.length > 1 && (
                            <span className="tabular-nums">{f.fileUrls.length}</span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            for (const att of f.fileUrls) {
                              void downloadFile(att);
                            }
                          }}
                          className="inline-flex items-center justify-center w-6 h-6 text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--card-bg)] hover:bg-[var(--card-bg-hover)] border border-[var(--border-color)] rounded-md transition-all cursor-pointer"
                          title={f.fileUrls.length > 1 ? `Download ${f.fileUrls.length} files` : 'Download'}
                        >
                          <Download className="w-3 h-3" />
                        </button>
                      </>
                    )}
                    <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Link>
              ))}
            </div>
          ) : null}

          {/* Pagination — only when the filtered list spills past one page. */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border-color)]">
              <span className="text-[11px] text-[var(--text-muted)] tabular-nums">
                {pageStart + 1}–{Math.min(pageEnd, combinedCount)} of {combinedCount}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="inline-flex items-center gap-1 pl-1.5 pr-2.5 py-1 text-[11px] font-medium rounded-md border border-[var(--border-color)] text-[var(--text-primary)] bg-[var(--card-bg)] hover:bg-[var(--card-bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Prev
                </button>
                <span className="text-[11px] text-[var(--text-muted)] tabular-nums px-1">
                  Page {safePage} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 text-[11px] font-medium rounded-md border border-[var(--border-color)] text-[var(--text-primary)] bg-[var(--card-bg)] hover:bg-[var(--card-bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  Next
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

    <FilePreviewModal
      open={previewFiles.length > 0}
      onClose={() => setPreviewFiles([])}
      files={previewFiles}
      initialIndex={previewIndex}
    />
    </>
  );
}
