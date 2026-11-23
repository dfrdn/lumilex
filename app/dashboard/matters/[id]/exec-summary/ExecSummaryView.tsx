'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Sparkles, RefreshCw, Download, ChevronLeft, AlertCircle,
  Users, Gavel, Calendar, BookOpen, AlertTriangle, Target, Clock,
} from 'lucide-react';

interface MatterRow {
  notion_id: string;
  name: string;
  matter_code: string | null;
  case_title: string | null;
  case_number: string | null;
  court: string | null;
  client_name: string | null;
  is_case: boolean;
  status: string | null;
}

interface SummaryRow {
  overview: string | null;
  current_posture: string | null;
  parties: Array<{ name: string; role: string; side?: string; notes?: string }> | null;
  timeline: Array<{ date: string; label: string; significance: string; source_ref?: string | null }> | null;
  key_rulings: Array<{ date: string; ruling: string; effect: string; source_ref?: string | null }> | null;
  open_items: Array<{ item: string; owner?: string; due_date?: string | null; notes?: string }> | null;
  reading_list: Array<{ file_id: string; name: string; why: string; rank: number }> | null;
  generated_at: string | null;
  updated_at: string | null;
}

function formatRelative(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function sideBadge(side?: string): string {
  if (side === 'us') return 'bg-emerald-50 text-emerald-700 border-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20';
  if (side === 'opposing') return 'bg-rose-50 text-rose-700 border-rose-200/60 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20';
  return 'bg-stone-100 text-stone-600 border-stone-200/60 dark:bg-stone-500/10 dark:text-stone-400 dark:border-stone-500/20';
}

export default function ExecSummaryView({ matter, summary }: { matter: MatterRow; summary: SummaryRow | null }) {
  const [current, setCurrent] = useState<SummaryRow | null>(summary);
  const [generating, setGenerating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRegenerate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/matter-exec-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matterId: matter.notion_id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Generation failed');
      }
      const data = await res.json();
      setCurrent({
        overview: data.overview,
        current_posture: data.currentPosture,
        parties: data.parties,
        timeline: data.timeline,
        key_rulings: data.keyRulings,
        open_items: data.openItems,
        reading_list: data.readingList,
        generated_at: data.generatedAt,
        updated_at: data.generatedAt,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }, [matter.notion_id]);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/api/matter-exec-summary/docx?matterId=${encodeURIComponent(matter.notion_id)}`);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safe = matter.name.replace(/[^a-zA-Z0-9-_]+/g, '_');
      a.download = `Executive_Summary_${safe}.docx`;
      a.click();
      // Safari fetches the blob asynchronously after click(); revoking immediately
      // triggers "WebKitBlobResource error 1". Delay so the download can start.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }, [matter.notion_id, matter.name]);

  const hasSummary = current && current.overview;

  return (
    <div className="max-w-3xl mx-auto py-8 px-6">
      {/* Header / breadcrumb */}
      <div className="flex items-center justify-between mb-6 animate-fade-up">
        <Link
          href={`/dashboard/matters/${matter.notion_id}`}
          className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-3 h-3" />
          Back to matter
        </Link>
        <div className="flex items-center gap-2">
          {hasSummary && (
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-[var(--text-secondary)] hover:text-foreground hover:bg-[var(--subtle-bg)] border border-[var(--border-color)] transition-colors disabled:opacity-50"
            >
              <Download className="w-3 h-3" />
              {downloading ? 'Preparing…' : 'Download DOCX'}
            </button>
          )}
          <button
            onClick={handleRegenerate}
            disabled={generating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 border border-violet-200/60 transition-colors disabled:opacity-50 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/20 dark:hover:bg-violet-500/20"
          >
            <RefreshCw className={`w-3 h-3 ${generating ? 'animate-spin' : ''}`} />
            {generating ? 'Generating…' : hasSummary ? 'Regenerate' : 'Generate'}
          </button>
        </div>
      </div>

      {/* Title block */}
      <div className="mb-8 animate-fade-up">
        <div className="flex items-center gap-2 mb-1.5">
          <Sparkles className="w-4 h-4 text-violet-500" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Executive Summary</span>
          {current?.updated_at && (
            <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-1 ml-1">
              <Clock className="w-2.5 h-2.5" />
              {formatRelative(current.updated_at)}
            </span>
          )}
        </div>
        <h1 className="text-2xl font-bold text-foreground">{matter.name}</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-[var(--text-muted)]">
          {matter.matter_code && <span className="font-mono">{matter.matter_code}</span>}
          {matter.client_name && <span>· {matter.client_name}</span>}
          {matter.case_number && <span>· {matter.case_number}</span>}
          {matter.court && <span>· {matter.court}</span>}
          {matter.status && <span>· {matter.status}</span>}
        </div>
      </div>

      {error && (
        <div className="mb-6 flex items-start gap-2 px-3 py-2.5 bg-red-50/60 dark:bg-red-500/5 rounded-lg border border-red-200/40 dark:border-red-500/10 animate-fade-up">
          <AlertCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0 dark:text-red-400" />
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {!hasSummary && !generating && (
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] p-10 text-center animate-fade-up">
          <Sparkles className="w-10 h-10 text-violet-500 mx-auto mb-3 opacity-40" />
          <p className="text-sm text-[var(--text-muted)] mb-5">
            No executive summary has been generated for this matter yet.
          </p>
          <button
            onClick={handleRegenerate}
            disabled={generating}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            Generate Executive Summary
          </button>
        </div>
      )}

      {generating && !hasSummary && (
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] p-10 text-center animate-fade-up">
          <RefreshCw className="w-8 h-8 text-violet-500 mx-auto mb-3 animate-spin" />
          <p className="text-sm text-[var(--text-muted)]">
            Generating executive summary… this typically takes 30-60 seconds.
          </p>
        </div>
      )}

      {hasSummary && (
        <div className="space-y-6 animate-fade-up">
          {/* Overview */}
          {current.overview && (
            <Section icon={Sparkles} label="Overview" accent="violet">
              <div className="prose-sm text-[var(--text-primary)] leading-relaxed whitespace-pre-line">
                {current.overview}
              </div>
            </Section>
          )}

          {/* Current posture */}
          {current.current_posture && (
            <Section icon={Target} label="Current Posture" accent="amber">
              <p className="text-sm text-[var(--text-primary)] leading-relaxed">{current.current_posture}</p>
            </Section>
          )}

          {/* Reading list */}
          {(current.reading_list?.length ?? 0) > 0 && (
            <Section icon={BookOpen} label="What to Read First" count={current.reading_list!.length}>
              <ol className="space-y-3">
                {[...current.reading_list!].sort((a, b) => a.rank - b.rank).map((r) => (
                  <li key={r.file_id} className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-violet-50 dark:bg-violet-500/10 flex items-center justify-center text-[11px] font-semibold text-violet-600 dark:text-violet-400 tabular-nums">
                      {r.rank}
                    </span>
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/dashboard/files/${r.file_id}`}
                        className="text-sm font-medium text-foreground hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
                      >
                        {r.name}
                      </Link>
                      <p className="text-xs text-[var(--text-secondary)] mt-0.5 leading-snug">{r.why}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {/* Parties */}
          {(current.parties?.length ?? 0) > 0 && (
            <Section icon={Users} label="Parties" count={current.parties!.length}>
              <ul className="space-y-1.5">
                {current.parties!.map((p, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className={`shrink-0 inline-flex items-center text-[10px] font-semibold uppercase tracking-wider rounded-full px-1.5 py-0.5 border ${sideBadge(p.side)}`}>
                      {p.side === 'us' ? 'Us' : p.side === 'opposing' ? 'Opp' : 'Other'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-foreground">{p.name}</span>
                      {p.role && <span className="text-[var(--text-muted)]"> — {p.role}</span>}
                      {p.notes && <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-snug">{p.notes}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Timeline */}
          {(current.timeline?.length ?? 0) > 0 && (
            <Section icon={Calendar} label="Timeline" count={current.timeline!.length}>
              <ul className="space-y-3">
                {current.timeline!.map((t, i) => (
                  <li key={i} className="text-sm">
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="font-mono text-[11px] text-[var(--text-muted)] tabular-nums shrink-0">{t.date}</span>
                      <span className="font-medium text-foreground">{t.label}</span>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] ml-[4rem] leading-snug">{t.significance}</p>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Key rulings */}
          {(current.key_rulings?.length ?? 0) > 0 && (
            <Section icon={Gavel} label="Key Rulings" count={current.key_rulings!.length}>
              <ul className="space-y-3">
                {current.key_rulings!.map((r, i) => (
                  <li key={i} className="text-sm">
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="font-mono text-[11px] text-[var(--text-muted)] tabular-nums shrink-0">{r.date}</span>
                      <span className="font-medium text-foreground">{r.ruling}</span>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] ml-[4rem] leading-snug">{r.effect}</p>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Open items */}
          {(current.open_items?.length ?? 0) > 0 && (
            <Section icon={AlertTriangle} label="Open Items" count={current.open_items!.length}>
              <ul className="space-y-2">
                {current.open_items!.map((item, i) => (
                  <li key={i} className="text-sm text-[var(--text-secondary)] leading-snug">
                    <span className="text-rose-500 mr-1.5">•</span>
                    <span className="text-foreground">{item.item}</span>
                    {(item.owner || item.due_date) && (
                      <span className="text-xs text-[var(--text-muted)] ml-1">
                        {item.owner && ` — ${item.owner}`}
                        {item.due_date && ` · due ${item.due_date}`}
                      </span>
                    )}
                    {item.notes && <p className="text-xs text-[var(--text-muted)] ml-4 mt-0.5">{item.notes}</p>}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  icon: Icon,
  label,
  count,
  accent = 'default',
  children,
}: {
  icon: React.ElementType;
  label: string;
  count?: number;
  accent?: 'default' | 'violet' | 'amber';
  children: React.ReactNode;
}) {
  const accentClasses =
    accent === 'violet' ? 'text-violet-500' :
    accent === 'amber' ? 'text-amber-500' :
    'text-[var(--text-muted)]';

  return (
    <section className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden">
      <header className="flex items-center gap-2 px-6 py-3 border-b border-[var(--border-color)]">
        <Icon className={`w-3.5 h-3.5 ${accentClasses}`} />
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</h2>
        {typeof count === 'number' && (
          <span className="text-[10px] font-semibold text-[var(--text-muted)] bg-[var(--subtle-bg)] rounded-full px-1.5 py-px tabular-nums">
            {count}
          </span>
        )}
      </header>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}
