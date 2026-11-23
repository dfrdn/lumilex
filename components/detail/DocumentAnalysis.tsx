'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Sparkles, Users, CalendarDays, AlertTriangle, Scale,
  BookOpen, MapPin, FileText, ChevronDown, RotateCcw, Loader2, ExternalLink,
} from 'lucide-react';
import type { FileAttachment } from '@/types/notion';
import type { FileAnalysis, AnalysisEntities } from '@/types/ai';
import type { ResolvedCitation } from '@/lib/juris';

// ── Helpers ──────────────────────────────────────────────────────

const SUPPORTED_EXTENSIONS = new Set(['pdf', 'doc', 'docx']);

function getExtension(url: string): string {
  return url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
}

function isSupportedFile(file: FileAttachment): boolean {
  return SUPPORTED_EXTENSIONS.has(getExtension(file.url));
}

// ── Props ────────────────────────────────────────────────────────

interface Props {
  fileId: string;
  fileUrls: FileAttachment[];
  matterName: string;
}

// ── Entity Section ───────────────────────────────────────────────

function EntitySection({
  icon: Icon,
  label,
  count,
  children,
  defaultOpen = true,
}: {
  icon: React.ElementType;
  label: string;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0) return null;

  return (
    <div className="border-t border-[var(--border-color)] pt-4 mt-4 first:border-0 first:pt-0 first:mt-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full group cursor-pointer"
      >
        <Icon className="w-3.5 h-3.5 text-[var(--text-muted)]" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
          {label}
        </span>
        <span className="text-[10px] font-semibold text-[var(--text-muted)] bg-[var(--subtle-bg)] rounded-full px-1.5 py-px tabular-nums">
          {count}
        </span>
        <ChevronDown
          className={`w-3 h-3 text-[var(--text-muted)] ml-auto transition-transform duration-200 ${open ? 'rotate-0' : '-rotate-90'}`}
        />
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────

export default function DocumentAnalysis({ fileId, fileUrls, matterName }: Props) {
  const [analysis, setAnalysis] = useState<FileAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const sseRef = useRef<EventSource | null>(null);

  // Filter to supported files
  const supportedFiles = fileUrls.filter(isSupportedFile);
  const selectedFile = supportedFiles[selectedIndex];

  // Stop SSE subscription
  const stopListening = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
  }, []);

  // Subscribe to real-time file analysis updates via SSE
  const startListening = useCallback(() => {
    stopListening();
    const es = new EventSource(`/api/realtime/file-analyses?ids=${encodeURIComponent(fileId)}`);
    sseRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'update' && data.fileId === fileId) {
          setAnalysis((prev) => prev ? { ...prev, ...data.analysis } : data.analysis);
          if (data.analysis.status === 'completed' || data.analysis.status === 'failed') {
            stopListening();
            setLoading(false);
            if (data.analysis.status === 'failed') {
              setError(data.analysis.errorMessage || 'Analysis failed');
            }
          }
        }
      } catch { /* ignore */ }
    };

    es.onerror = () => {
      // SSE disconnected — close and let the component re-fetch on next interaction
      es.close();
      sseRef.current = null;
    };
  }, [fileId, stopListening]);

  // Check for cached analysis on mount / file change
  useEffect(() => {
    if (!selectedFile) return;
    setError(null);
    setLoading(true);

    fetch(
      `/api/file-analysis?fileId=${encodeURIComponent(fileId)}&attachmentName=${encodeURIComponent(selectedFile.name)}`,
    )
      .then((res) => res.json())
      .then((data) => {
        if (data.analysis) {
          setAnalysis(data.analysis);
          if (data.analysis.status === 'processing' || data.analysis.status === 'pending') {
            startListening();
          } else {
            setLoading(false);
            if (data.analysis.status === 'failed') {
              setError(data.analysis.errorMessage || 'Analysis failed');
            }
          }
        } else {
          setAnalysis(null);
          setLoading(false);
        }
      })
      .catch(() => {
        setAnalysis(null);
        setLoading(false);
      });

    return stopListening;
  }, [fileId, selectedFile, startListening, stopListening]);

  // Trigger analysis
  const handleAnalyze = useCallback(async () => {
    if (!selectedFile) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/file-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId, attachmentIndex: selectedIndex }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to start analysis');
        setLoading(false);
        return;
      }

      setAnalysis(data.analysis);

      if (data.analysis.status === 'completed') {
        setLoading(false);
      } else {
        startListening();
      }
    } catch {
      setError('Failed to start analysis. Please try again.');
      setLoading(false);
    }
  }, [fileId, selectedFile, selectedIndex, startListening]);

  // Retry after failure
  const handleRetry = useCallback(async () => {
    if (!selectedFile) return;
    // Delete the failed analysis so the unique index allows a new one
    setAnalysis(null);
    setError(null);
    handleAnalyze();
  }, [selectedFile, handleAnalyze]);

  // No supported files
  if (supportedFiles.length === 0) return null;

  const isCompleted = analysis?.status === 'completed';
  const isProcessing = loading && !isCompleted;

  return (
    <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden animate-fade-up">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[var(--border-color)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-gold-500 dark:text-gold-400" />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
            AI Analysis
          </h2>
        </div>
        {isCompleted && (
          <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 rounded-full px-2 py-0.5">
            Analyzed
          </span>
        )}
      </div>

      <div className="p-6">
        {/* File selector (when multiple supported files) */}
        {supportedFiles.length > 1 && (
          <div className="mb-4">
            <label className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider block mb-2">
              {isCompleted ? 'Viewing attachment' : 'Select attachment to analyze'}
            </label>
            <select
              value={selectedIndex}
              onChange={(e) => {
                setSelectedIndex(Number(e.target.value));
                setAnalysis(null);
                setError(null);
              }}
              className="w-full text-sm bg-[var(--subtle-bg)] border border-[var(--border-color)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-gold-400/40"
            >
              {supportedFiles.map((f, i) => (
                <option key={i} value={i}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* ── Idle State ────────────────────────────────────── */}
        {!analysis && !isProcessing && !error && (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-xl bg-gold-50 dark:bg-gold-500/10 flex items-center justify-center mx-auto mb-3">
              <Sparkles className="w-6 h-6 text-gold-500 dark:text-gold-400" />
            </div>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              Use AI to summarize this document and extract key entities.
            </p>
            <button
              type="button"
              onClick={handleAnalyze}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-gold-600 hover:bg-gold-700 rounded-xl shadow-sm transition-all duration-150 cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              Analyze Document
            </button>
          </div>
        )}

        {/* ── Short Summary (shown prominently when auto-analysis completed) ── */}
        {isCompleted && analysis.shortSummary && (
          <div className="mb-4 p-3 rounded-lg bg-gold-50/60 dark:bg-gold-500/5 border border-gold-200/40 dark:border-gold-500/10">
            <p className="text-sm font-medium text-[var(--text-primary)] leading-relaxed">
              {analysis.shortSummary}
            </p>
          </div>
        )}

        {/* ── Loading State ─────────────────────────────────── */}
        {isProcessing && (
          <div className="py-6">
            <div className="flex items-center justify-center gap-3 mb-5">
              <Loader2 className="w-5 h-5 text-gold-500 animate-spin dark:text-gold-400" />
              <p className="text-sm font-medium text-[var(--text-secondary)]">
                Analyzing document...
              </p>
            </div>
            {/* Shimmer skeleton */}
            <div className="space-y-3 animate-pulse">
              <div className="h-3 bg-[var(--subtle-bg)] rounded-full w-full" />
              <div className="h-3 bg-[var(--subtle-bg)] rounded-full w-5/6" />
              <div className="h-3 bg-[var(--subtle-bg)] rounded-full w-4/6" />
              <div className="h-8" />
              <div className="h-3 bg-[var(--subtle-bg)] rounded-full w-3/4" />
              <div className="h-3 bg-[var(--subtle-bg)] rounded-full w-full" />
              <div className="h-3 bg-[var(--subtle-bg)] rounded-full w-2/3" />
            </div>
          </div>
        )}

        {/* ── Error State ───────────────────────────────────── */}
        {error && !isProcessing && (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center mx-auto mb-3">
              <AlertTriangle className="w-6 h-6 text-red-500 dark:text-red-400" />
            </div>
            <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>
            <button
              type="button"
              onClick={handleRetry}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-foreground bg-[var(--subtle-bg)] hover:bg-card-hover border border-[var(--border-color)] rounded-xl transition-all duration-150 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              Retry
            </button>
          </div>
        )}

        {/* ── Completed State ───────────────────────────────── */}
        {isCompleted && analysis.summary && (
          <div>
            {/* Summary */}
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-3">
                <BookOpen className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  Summary
                </span>
              </div>
              <div className="text-sm text-[var(--text-secondary)] leading-relaxed space-y-3">
                {analysis.summary.split('\n\n').map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            </div>

            {/* Entities */}
            {analysis.entities && (
              <EntitiesDisplay entities={analysis.entities} />
            )}

            {/* Footer metadata */}
            <div className="mt-5 pt-4 border-t border-[var(--border-color)] flex items-center justify-between text-[10px] text-[var(--text-muted)]">
              <span>
                Model: {analysis.modelUsed} · {new Date(analysis.completedAt!).toLocaleDateString('en-PH', {
                  month: 'short', day: 'numeric', year: 'numeric',
                })}
              </span>
              <button
                type="button"
                onClick={handleRetry}
                className="inline-flex items-center gap-1 text-[var(--text-muted)] hover:text-foreground transition-colors cursor-pointer"
                title="Re-analyze"
              >
                <RotateCcw className="w-3 h-3" />
                Re-analyze
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Entities Display ─────────────────────────────────────────────

function EntitiesDisplay({ entities }: { entities: AnalysisEntities }) {
  const parties = entities.parties ?? [];
  const dates = entities.dates ?? [];
  const deadlines = entities.deadlines ?? [];
  const obligations = entities.obligations ?? [];
  const caseReferences = entities.caseReferences ?? [];
  const resolved = entities.resolvedCitations ?? [];
  const citationBadges = buildCitationBadges(caseReferences, resolved);

  return (
    <div>
      {/* Document Type & Jurisdiction */}
      {(entities.documentType || entities.jurisdiction) && (
        <div className="flex flex-wrap gap-2 mb-4 pb-4 border-b border-[var(--border-color)]">
          {entities.documentType && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-full bg-navy-50 text-navy-700 dark:bg-navy-500/10 dark:text-navy-300 ring-1 ring-inset ring-navy-200/60 dark:ring-navy-500/20">
              <FileText className="w-3 h-3" />
              {entities.documentType}
            </span>
          )}
          {entities.jurisdiction && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-full bg-stone-50 text-stone-600 dark:bg-stone-500/10 dark:text-stone-400 ring-1 ring-inset ring-stone-200/60 dark:ring-stone-500/20">
              <MapPin className="w-3 h-3" />
              {entities.jurisdiction}
            </span>
          )}
        </div>
      )}

      {/* Parties */}
      <EntitySection icon={Users} label="Parties" count={parties.length}>
        <div className="space-y-2">
          {parties.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] bg-[var(--subtle-bg)] rounded-md px-1.5 py-0.5 w-24 text-center shrink-0 truncate">
                {p.role}
              </span>
              <span className="text-sm text-[var(--text-primary)]">{p.name}</span>
            </div>
          ))}
        </div>
      </EntitySection>

      {/* Key Dates */}
      <EntitySection icon={CalendarDays} label="Key Dates" count={dates.length}>
        <div className="space-y-2">
          {dates.map((d, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="text-xs font-mono text-gold-600 dark:text-gold-400 whitespace-nowrap shrink-0 pt-0.5">
                {d.date}
              </span>
              <span className="text-sm text-[var(--text-secondary)]">{d.description}</span>
            </div>
          ))}
        </div>
      </EntitySection>

      {/* Deadlines */}
      <EntitySection icon={AlertTriangle} label="Deadlines" count={deadlines.length} defaultOpen>
        <div className="space-y-2">
          {deadlines.map((d, i) => (
            <div key={i} className="flex items-start gap-3 p-2.5 rounded-lg bg-red-50/50 dark:bg-red-500/5 border border-red-200/40 dark:border-red-500/10">
              <span className="text-xs font-mono text-red-600 dark:text-red-400 whitespace-nowrap shrink-0 pt-0.5">
                {d.date}
              </span>
              <span className="text-sm text-[var(--text-primary)]">{d.description}</span>
            </div>
          ))}
        </div>
      </EntitySection>

      {/* Obligations */}
      <EntitySection icon={Scale} label="Obligations" count={obligations.length}>
        <div className="space-y-2">
          {obligations.map((o, i) => (
            <div key={i} className="text-sm">
              <span className="font-medium text-[var(--text-primary)]">{o.party}:</span>{' '}
              <span className="text-[var(--text-secondary)]">{o.description}</span>
            </div>
          ))}
        </div>
      </EntitySection>

      {/* Case References — verified against juris.ph where possible */}
      <EntitySection icon={BookOpen} label="Case References" count={citationBadges.length}>
        <div className="flex flex-wrap gap-2">
          {citationBadges.map((badge, i) => (
            <CitationBadge key={i} badge={badge} />
          ))}
        </div>
        {resolved.length > 0 && (
          <p className="mt-2 text-[10px] text-[var(--text-muted)]">
            Linked citations verified via juris.ph · summaries are AI-generated — verify before
            citing in a filing.
          </p>
        )}
      </EntitySection>
    </div>
  );
}

// ── Citation badges ──────────────────────────────────────────────

interface CitationBadgeData {
  text: string;
  citation?: ResolvedCitation;
}

function normalizeCitation(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Pair each raw case-reference string with the juris.ph verification that
 * matches it (by normalized containment), then append verified citations
 * (e.g. RA numbers from the document body) not covered by any raw reference.
 */
function buildCitationBadges(
  caseReferences: string[],
  resolved: ResolvedCitation[],
): CitationBadgeData[] {
  const used = new Set<string>();
  const badges: CitationBadgeData[] = caseReferences.map((text) => {
    const n = normalizeCitation(text);
    const citation = resolved.find((c) => n.includes(normalizeCitation(c.ref)));
    if (citation) used.add(citation.ref);
    return { text, citation };
  });
  for (const citation of resolved) {
    if (!used.has(citation.ref)) badges.push({ text: citation.ref, citation });
  }
  return badges;
}

function CitationBadge({ badge }: { badge: CitationBadgeData }) {
  const { text, citation } = badge;
  const base = 'inline-flex items-center gap-1 px-2.5 py-1 text-xs font-mono rounded-lg border';

  if (citation?.status === 'found' && citation.url) {
    return (
      <a
        href={citation.url}
        target="_blank"
        rel="noopener noreferrer"
        title={citation.title ? `${citation.title}${citation.date ? ` (${citation.date})` : ''}` : undefined}
        className={`${base} text-navy-700 dark:text-navy-300 bg-navy-50 dark:bg-navy-500/10 border-navy-200/60 dark:border-navy-500/20 hover:bg-navy-100 dark:hover:bg-navy-500/20 transition-colors`}
      >
        {text}
        <ExternalLink className="w-3 h-3 shrink-0" />
      </a>
    );
  }
  if (citation?.status === 'not_found') {
    return (
      <span
        title="Not found in the juris.ph index — double-check this citation"
        className={`${base} text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border-amber-200/60 dark:border-amber-500/20`}
      >
        <AlertTriangle className="w-3 h-3 shrink-0" />
        {text}
      </span>
    );
  }
  return (
    <span className={`${base} text-[var(--text-secondary)] bg-[var(--subtle-bg)] border-[var(--border-color)]`}>
      {text}
    </span>
  );
}
