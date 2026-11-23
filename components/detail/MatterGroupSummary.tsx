'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Sparkles, RefreshCw, AlertCircle, Clock, ChevronDown,
  Users, Gavel, Calendar, AlertTriangle, Target, GitBranch,
} from 'lucide-react';

interface KeyDate {
  date: string;
  label: string;
  status?: 'upcoming' | 'past' | 'contingent';
  source_matter_id?: string | null;
}

interface OpenIssue {
  issue: string;
  source_matter_ids?: string[];
  flagged_at?: string | null;
}

interface PartyEntry {
  name: string;
  role: string;
  side?: 'us' | 'opposing' | 'other';
  notes?: string;
  source_matter_ids?: string[];
}

interface RulingEntry {
  date: string;
  ruling: string;
  effect: string;
  source_matter_id?: string | null;
}

interface GroupBriefData {
  rootMatterId: string;
  memberMatterIds: string[];
  summary: string;
  posture: string | null;
  progressionNotes: string | null;
  parties: PartyEntry[] | null;
  keyDates: KeyDate[];
  keyRulings: RulingEntry[] | null;
  openIssues: OpenIssue[];
  modelUsed: string | null;
  generatedAt: string | null;
  stale: boolean;
}

function formatRelativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function sideBadgeClasses(side?: string): string {
  if (side === 'us') return 'bg-emerald-50 text-emerald-700 border-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20';
  if (side === 'opposing') return 'bg-rose-50 text-rose-700 border-rose-200/60 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20';
  return 'bg-stone-100 text-stone-600 border-stone-200/60 dark:bg-stone-500/10 dark:text-stone-400 dark:border-stone-500/20';
}

function BriefSection({
  icon: Icon,
  label,
  count,
  children,
  defaultOpen = false,
}: {
  icon: React.ElementType;
  label: string;
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0) return null;
  return (
    <div className="border-t border-[var(--border-color)] pt-3 mt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full group cursor-pointer"
      >
        <Icon className="w-3.5 h-3.5 text-[var(--text-muted)]" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</span>
        {typeof count === 'number' && (
          <span className="text-[10px] font-semibold text-[var(--text-muted)] bg-[var(--subtle-bg)] rounded-full px-1.5 py-px tabular-nums">{count}</span>
        )}
        <ChevronDown className={`w-3 h-3 text-[var(--text-muted)] ml-auto transition-transform duration-200 ${open ? 'rotate-0' : '-rotate-90'}`} />
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

export default function MatterGroupSummary({ rootId }: { rootId: string }) {
  const [data, setData] = useState<GroupBriefData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBrief = useCallback(async () => {
    try {
      const res = await fetch(`/api/matter-group-summary?rootId=${rootId}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const json = await res.json();
      setData(json.summary === null ? null : json);
    } catch {
      setError('Failed to load group brief');
    } finally {
      setLoading(false);
    }
  }, [rootId]);

  useEffect(() => { fetchBrief(); }, [fetchBrief]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/matter-group-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? 'Failed to generate');
      }
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate group brief');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-[var(--border-color)] flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-violet-500" />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Group Brief</h2>
        </div>
        <div className="p-6 animate-pulse space-y-2">
          <div className="h-3 bg-stone-200 dark:bg-stone-700 rounded w-3/4" />
          <div className="h-3 bg-stone-200 dark:bg-stone-700 rounded w-1/2" />
        </div>
      </div>
    );
  }

  if (!data || !data.summary) {
    return (
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-[var(--border-color)] flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-violet-500" />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Group Brief</h2>
        </div>
        <div className="p-6 flex flex-col items-center gap-3">
          <p className="text-sm text-[var(--text-muted)] text-center">No group brief generated yet.</p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 border border-violet-200/60 transition-all duration-150 disabled:opacity-50 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/20 dark:hover:bg-violet-500/20"
          >
            {generating ? (<><RefreshCw className="w-3.5 h-3.5 animate-spin" />Generating…</>) : (<><Sparkles className="w-3.5 h-3.5" />Generate Group Brief</>)}
          </button>
          {error && (
            <p className="text-xs text-red-500 flex items-center gap-1 dark:text-red-400">
              <AlertCircle className="w-3 h-3" /> {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  const parties = data.parties ?? [];
  const rulings = data.keyRulings ?? [];
  const keyDates = data.keyDates ?? [];
  const openIssues = data.openIssues ?? [];

  return (
    <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-[var(--border-color)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-violet-500" />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Group Brief</h2>
          <span className="text-[10px] font-medium text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-500/10 rounded-full px-2 py-0.5">
            {data.memberMatterIds.length} matters
          </span>
          {data.generatedAt && (
            <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-1 ml-2">
              <Clock className="w-2.5 h-2.5" />
              {formatRelativeDate(data.generatedAt)}
              {data.stale && ' · stale'}
            </span>
          )}
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md text-[var(--text-muted)] hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-500/10 dark:hover:text-violet-400 transition-all duration-150 disabled:opacity-50"
          title="Regenerate group brief"
        >
          <RefreshCw className={`w-3 h-3 ${generating ? 'animate-spin' : ''}`} />
          {generating ? 'Generating…' : 'Refresh'}
        </button>
      </div>

      <div className="p-6">
        <p className="text-sm text-[var(--text-primary)] leading-relaxed">{data.summary}</p>

        {data.posture && (
          <div className="mt-4 flex items-start gap-2 px-3 py-2.5 bg-violet-50/60 dark:bg-violet-500/5 rounded-lg border border-violet-200/40 dark:border-violet-500/10">
            <Target className="w-3.5 h-3.5 text-violet-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400 mb-0.5">Posture</p>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{data.posture}</p>
            </div>
          </div>
        )}

        {data.progressionNotes && (
          <div className="mt-3 flex items-start gap-2 px-3 py-2.5 bg-sky-50/60 dark:bg-sky-500/5 rounded-lg border border-sky-200/40 dark:border-sky-500/10">
            <GitBranch className="w-3.5 h-3.5 text-sky-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-sky-600 dark:text-sky-400 mb-0.5">Progression</p>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{data.progressionNotes}</p>
            </div>
          </div>
        )}

        <BriefSection icon={Users} label="Parties" count={parties.length}>
          <ul className="space-y-1.5">
            {parties.map((p, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <span className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider rounded-full px-1.5 py-0.5 border shrink-0 ${sideBadgeClasses(p.side)}`}>
                  {p.side === 'us' ? 'Us' : p.side === 'opposing' ? 'Opp' : 'Other'}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="text-[var(--text-primary)] font-medium">{p.name}</span>
                  {p.role && <span className="text-[var(--text-muted)]"> — {p.role}</span>}
                  {p.notes && <p className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-snug">{p.notes}</p>}
                  {p.source_matter_ids && p.source_matter_ids.length > 1 && (
                    <p className="text-[10px] text-[var(--text-muted)]">in {p.source_matter_ids.length} matters</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </BriefSection>

        <BriefSection icon={Gavel} label="Key Rulings" count={rulings.length}>
          <ul className="space-y-2.5">
            {rulings.map((r, i) => (
              <li key={i} className="text-xs">
                <div className="flex items-baseline gap-2 mb-0.5">
                  <span className="font-mono text-[10px] text-[var(--text-muted)] tabular-nums">{r.date}</span>
                  <span className="text-[var(--text-primary)] font-medium">{r.ruling}</span>
                </div>
                {r.effect && <p className="text-[var(--text-secondary)] leading-snug ml-[4.5rem]">{r.effect}</p>}
              </li>
            ))}
          </ul>
        </BriefSection>

        <BriefSection icon={Calendar} label="Key Dates" count={keyDates.length}>
          <ul className="space-y-1.5">
            {keyDates.map((d, i) => (
              <li key={i} className="flex items-baseline gap-2 text-xs">
                <span className={`font-mono text-[10px] tabular-nums shrink-0 ${d.status === 'upcoming' ? 'text-sky-600 dark:text-sky-400' : d.status === 'past' ? 'text-stone-400 dark:text-stone-500' : 'text-[var(--text-muted)]'}`}>{d.date}</span>
                <span className="text-[var(--text-secondary)] leading-snug">{d.label}</span>
              </li>
            ))}
          </ul>
        </BriefSection>

        <BriefSection icon={AlertTriangle} label="Open Issues" count={openIssues.length} defaultOpen={openIssues.length > 0 && openIssues.length <= 3}>
          <ul className="space-y-2">
            {openIssues.map((issue, i) => (
              <li key={i} className="text-xs text-[var(--text-secondary)] leading-snug">
                <span className="text-rose-500 mr-1.5">•</span>
                {issue.issue}
              </li>
            ))}
          </ul>
        </BriefSection>

        {error && (
          <p className="mt-3 text-xs text-red-500 flex items-center gap-1 dark:text-red-400">
            <AlertCircle className="w-3 h-3" /> {error}
          </p>
        )}
      </div>
    </div>
  );
}
