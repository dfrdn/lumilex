'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Upload, FileText, Loader2, Search, ChevronDown, X, Check, Copy,
  AlertTriangle, Swords, Sparkles, MessageSquare, Clock, BookOpen,
  ExternalLink, Crosshair, ScrollText, Scale, CircleAlert, WifiOff,
  CornerDownRight, ListChecks, CircleDashed,
} from 'lucide-react';
import { useFileDrop } from '@/hooks/use-file-drop';
import { isResponsivePleading } from '@/lib/legal/pleading-subtypes';
import type {
  RedTeamFinding, FindingCategory, Severity, AdverseAuthority, CitationCheck, CoverageRow,
} from '@/lib/ai/red-team';

export interface RedTeamMatter {
  id: string;
  name: string;
  code: string | null;
  /** The verbose cause of action. Searchable, never displayed — see page.tsx. */
  caseTitle?: string | null;
}

interface MatterDeliverable {
  id: string;
  name: string;
  subtype: string | null;
}

type RedTeamMode = 'self' | 'opposing';

interface RunRow {
  id: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  mode: RedTeamMode;
  deliverable_id: string | null;
  file_name: string;
  document_type: string | null;
  overall_risk: 'severe' | 'high' | 'moderate' | 'low' | null;
  weakest_link: string | null;
  opposing_theory: string | null;
  findings: RedTeamFinding[] | null;
  severity_breakdown: Record<Severity, number> | null;
  finding_count: number | null;
  adverse_authorities: AdverseAuthority[] | null;
  citation_checks: CitationCheck[] | null;
  concessions: string[] | null;
  adverse_search_available: boolean | null;
  cite_check_available: boolean | null;
  target_file_name: string | null;
  target_document_type: string | null;
  response_coverage: CoverageRow[] | null;
  error_message: string | null;
}

interface HistoryRow {
  id: number;
  file_name: string;
  mode: RedTeamMode;
  status: string;
  document_type: string | null;
  overall_risk: string | null;
  finding_count: number | null;
  created_at: string;
}

interface NoteRow {
  id: number;
  findingIndex: number | null;
  findingHeading: string | null;
  verdict: 'agree' | 'wrong' | 'context' | null;
  body: string;
  createdAt: string;
  authorId: string;
  authorName: string;
  authorInitials: string;
}

const CATEGORY_LABELS: Record<FindingCategory, string> = {
  procedural: 'Procedural defect',
  jurisdiction: 'Jurisdiction / venue',
  prescription: 'Prescription / laches',
  evidentiary_gap: 'Evidentiary gap',
  authority_misuse: 'Authority misused',
  contrary_authority: 'Contrary authority',
  missing_element: 'Missing element',
  internal_inconsistency: 'Internal inconsistency',
  record_contradiction: 'Contradicts the record',
  admission_against_interest: 'Admission against interest',
  overclaim: 'Overclaim',
  remedy_mismatch: 'Wrong remedy',
  pleading_defect: 'Pleading defect',
  vagueness: 'Vagueness',
  unanswered_allegation: 'Not specifically denied',
  waived_defense: 'Defense waived',
  unrebutted_argument: 'Argument left unrebutted',
};

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

function severityTone(s: string): string {
  if (s === 'critical') return 'bg-red-100 text-red-800 ring-red-300 dark:bg-red-500/15 dark:text-red-200 dark:ring-red-500/40';
  if (s === 'high') return 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30';
  if (s === 'medium') return 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30';
  return 'bg-stone-100 text-stone-600 ring-stone-200 dark:bg-stone-500/10 dark:text-stone-400 dark:ring-stone-500/30';
}

function riskTone(r: string | null): string {
  if (r === 'severe') return 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200';
  if (r === 'high') return 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300';
  if (r === 'moderate') return 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300';
  return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300';
}

function cardTone(s: string): string {
  if (s === 'critical') return 'border-red-300/70 bg-red-50/40 dark:border-red-500/30 dark:bg-red-500/[0.06]';
  if (s === 'high') return 'border-red-200/70 bg-red-50/25 dark:border-red-500/20 dark:bg-red-500/[0.04]';
  if (s === 'medium') return 'border-amber-200/70 bg-amber-50/25 dark:border-amber-500/20 dark:bg-amber-500/[0.04]';
  return 'border-stone-200/70 bg-white dark:border-stone-700/60 dark:bg-stone-900/40';
}

// Gaps first — the reason the pleading being answered was attached at all.
const COVERAGE_ORDER: CoverageRow['status'][] = ['missing', 'partial', 'unclear', 'addressed'];

const COVERAGE_LABEL: Record<CoverageRow['status'], string> = {
  missing: 'Not answered',
  partial: 'Partly answered',
  unclear: 'Not checked',
  addressed: 'Answered',
};

function coverageTone(s: CoverageRow['status']): string {
  if (s === 'missing') return 'text-red-600 dark:text-red-400';
  if (s === 'partial') return 'text-amber-600 dark:text-amber-400';
  if (s === 'unclear') return 'text-stone-400 dark:text-stone-500';
  return 'text-emerald-600 dark:text-emerald-400';
}

function CoverageIcon({ status }: { status: CoverageRow['status'] }) {
  const cls = `w-4 h-4 shrink-0 mt-0.5 ${coverageTone(status)}`;
  if (status === 'addressed') return <Check className={cls} />;
  if (status === 'unclear') return <CircleDashed className={cls} />;
  return <AlertTriangle className={cls} />;
}

function shortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return ''; }
}

// ── Generic searchable combobox ─────────────────────────────────────
function Combobox({ items, value, onChange, placeholder, searchPlaceholder = 'Search…', emptyText = 'No results' }: {
  // `keywords` is matched but not shown: a matter's cause of action runs to a
  // full line and would crowd out the case name it is filed under, but a lawyer
  // who remembers only "annulment of title" still has to be able to find it.
  items: { id: string; name: string; code?: string | null; keywords?: string | null }[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder: string;
  searchPlaceholder?: string;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function h(e: MouseEvent) { if (!ref.current?.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', h, true);
    return () => document.removeEventListener('mousedown', h, true);
  }, [open]);

  const selected = items.find((m) => m.id === value);
  const filtered = (q
    ? items.filter((m) => `${m.name} ${m.code ?? ''} ${m.keywords ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    : items
  ).slice(0, 50);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg border border-stone-200 bg-stone-50/80 hover:border-stone-300 transition dark:bg-stone-800 dark:border-stone-700 dark:hover:border-stone-600"
      >
        <span className={`truncate ${selected ? 'text-stone-800 dark:text-stone-100' : 'text-stone-400 dark:text-stone-500'}`}>
          {selected ? `${selected.name}${selected.code ? ` (${selected.code})` : ''}` : placeholder}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {selected && (
            <span role="button" onClick={(e) => { e.stopPropagation(); onChange(null); setOpen(false); }} className="p-0.5 rounded hover:bg-stone-200 text-stone-400 dark:hover:bg-stone-700"><X className="w-3 h-3" /></span>
          )}
          <ChevronDown className={`w-3.5 h-3.5 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>
      {open && (
        <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg overflow-hidden dark:bg-stone-900 dark:border-stone-700">
          <div className="p-2 border-b border-stone-100 dark:border-stone-800">
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-stone-50 rounded-md dark:bg-stone-800">
              <Search className="w-3.5 h-3.5 text-stone-400 shrink-0" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} className="flex-1 text-sm bg-transparent outline-none text-stone-800 dark:text-stone-100 placeholder:text-stone-400" />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto py-0.5">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-sm text-stone-400 text-center">{emptyText}</p>
            ) : filtered.map((m) => (
              <button key={m.id} type="button" onClick={() => { onChange(m.id); setOpen(false); setQ(''); }} className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors ${m.id === value ? 'text-gold-700 bg-gold-50/80 dark:bg-gold-500/10 dark:text-gold-300' : 'text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800'}`}>
                <span className="truncate">{m.name}{m.code ? <span className="text-xs ml-1.5 text-stone-400">{m.code}</span> : null}</span>
                {m.id === value && <Check className="w-3.5 h-3.5 text-gold-600 dark:text-gold-400 shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── File drop zone ──────────────────────────────────────────────────
function PleadingDrop({ file, onFile, title, hint, compact }: {
  file: File | null;
  onFile: (f: File) => void;
  title: string;
  hint: string;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { isOver, dropProps } = useFileDrop((files) => { if (files[0]) onFile(files[0]); });

  return (
    <div
      {...dropProps}
      onClick={() => inputRef.current?.click()}
      className={`flex flex-1 min-w-0 items-center gap-3 rounded-xl border-2 border-dashed cursor-pointer transition ${compact ? 'px-3 py-3' : 'px-4 py-5'} ${isOver ? 'border-gold-400 bg-gold-50/50 dark:bg-gold-500/5' : 'border-stone-200 hover:border-stone-300 dark:border-stone-700 dark:hover:border-stone-600'}`}
    >
      <div className={`rounded-lg bg-stone-100 dark:bg-stone-800 flex items-center justify-center shrink-0 ${compact ? 'w-8 h-8' : 'w-10 h-10'}`}>
        {file ? <FileText className="w-5 h-5 text-gold-600 dark:text-gold-400" /> : <Upload className="w-5 h-5 text-stone-400" />}
      </div>
      <div className="min-w-0">
        {file ? (
          <>
            <p className="text-sm font-medium text-stone-800 dark:text-stone-100 truncate">{file.name}</p>
            <p className="text-xs text-stone-400">Click to choose a different file</p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-stone-700 dark:text-stone-200">{title}</p>
            <p className="text-xs text-stone-400">{hint}</p>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.doc,.docx"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
      />
    </div>
  );
}

// ── Finding card ────────────────────────────────────────────────────
function FindingCard({ finding, index, mode, notes, onAddNote }: {
  finding: RedTeamFinding;
  index: number;
  mode: RedTeamMode;
  notes: NoteRow[];
  onAddNote: (index: number, heading: string, body: string, verdict: 'agree' | 'wrong' | 'context') => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [verdict, setVerdict] = useState<'agree' | 'wrong' | 'context'>('context');
  const [saving, setSaving] = useState(false);

  const action = mode === 'self' ? finding.fix?.trim() : finding.argument_line?.trim();
  const actionLabel = mode === 'self' ? 'How to close it' : 'Argument line for our response';

  const submitNote = async () => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      await onAddNote(index, finding.heading, text.trim(), verdict);
      setText('');
      setVerdict('context');
      setAdding(false);
    } catch { /* parent toasts */ } finally {
      setSaving(false);
    }
  };

  const rejected = notes.some((n) => n.verdict === 'wrong');

  return (
    <div className={`rounded-xl border p-4 ${rejected ? 'border-stone-200/70 bg-stone-50/60 opacity-60 dark:border-stone-700/60 dark:bg-stone-900/30' : cardTone(finding.severity)}`}>
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${severityTone(finding.severity)}`}>
          {finding.severity}
        </span>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
          {CATEGORY_LABELS[finding.category] ?? finding.category}
        </span>
        {finding.location && (
          <span className="text-[11px] text-stone-400 dark:text-stone-500">{finding.location}</span>
        )}
        <span className="ml-auto text-[10px] uppercase tracking-wide text-stone-400" title="How sure the model is that this attack lands — independent of how much it would cost.">
          {finding.confidence} confidence
        </span>
      </div>

      <h4 className="text-sm font-semibold text-stone-900 dark:text-stone-100">{finding.heading}</h4>

      {finding.our_text && (
        <blockquote className="mt-2 border-l-2 border-stone-300 dark:border-stone-600 pl-3 text-xs text-stone-500 dark:text-stone-400 italic">
          {finding.our_text}
        </blockquote>
      )}
      {finding.is_omission && !finding.our_text && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-stone-400">
          <CircleAlert className="w-3 h-3" /> Nothing in the document to quote — this is what&apos;s missing.
        </p>
      )}

      <div className="mt-3">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
          {mode === 'self' ? 'How they use it' : 'The weakness'}
        </span>
        <p className="mt-0.5 text-sm text-stone-700 dark:text-stone-200 whitespace-pre-wrap">{finding.attack}</p>
      </div>

      {finding.authority && (
        <p className="mt-2 inline-flex items-start gap-1.5 text-xs text-stone-500 dark:text-stone-400">
          <Scale className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {finding.authority}
        </p>
      )}

      {action && (
        <div className="mt-3 rounded-lg border border-stone-200/80 bg-stone-50/70 px-3 py-2.5 dark:border-stone-700/60 dark:bg-stone-800/40">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">{actionLabel}</span>
            <button
              type="button"
              onClick={() => { navigator.clipboard.writeText(action); toast.success('Copied'); }}
              className="inline-flex items-center gap-1 text-[11px] text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
            >
              <Copy className="w-3 h-3" /> Copy
            </button>
          </div>
          <p className="text-sm text-stone-700 dark:text-stone-200 whitespace-pre-wrap">{action}</p>
        </div>
      )}

      {/* Reviewer notes for the AI */}
      <div className="mt-3 border-t border-stone-100 dark:border-stone-800 pt-2.5">
        {notes.map((n) => (
          <div key={n.id} className="flex items-start gap-1.5 mb-1.5">
            <MessageSquare className={`w-3 h-3 mt-0.5 shrink-0 ${n.verdict === 'wrong' ? 'text-red-500' : n.verdict === 'agree' ? 'text-emerald-500' : 'text-gold-500'}`} />
            <p className="text-xs text-stone-600 dark:text-stone-300">
              <span className="font-semibold">{n.authorInitials}:</span>{' '}
              {n.verdict === 'wrong' && <span className="text-red-600 dark:text-red-400 font-medium">Rejected — </span>}
              {n.verdict === 'agree' && <span className="text-emerald-600 dark:text-emerald-400 font-medium">Confirmed — </span>}
              {n.body}
            </p>
          </div>
        ))}
        {adding ? (
          <div className="mt-1 space-y-1.5">
            <div className="inline-flex rounded-lg border border-stone-200 dark:border-stone-700 p-0.5 bg-stone-50 dark:bg-stone-800">
              {([['agree', 'Real'], ['wrong', 'Wrong'], ['context', 'Context']] as const).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setVerdict(val)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition ${verdict === val ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-900 dark:text-stone-100' : 'text-stone-500 hover:text-stone-700 dark:text-stone-400'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitNote(); }}
              rows={2}
              autoFocus
              placeholder="Why is this right or wrong? — e.g. “Barangay conciliation doesn’t apply; the parties reside in different cities.”"
              className="w-full text-xs px-2.5 py-2 rounded-lg border border-stone-200 bg-white outline-none focus:ring-2 focus:ring-gold-400/20 focus:border-gold-400 resize-y dark:bg-stone-800 dark:border-stone-700 dark:text-stone-100"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setAdding(false); setText(''); }} className="text-xs text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300">Cancel</button>
              <button type="button" onClick={submitNote} disabled={saving || !text.trim()} className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-gold-600 hover:bg-gold-700 px-2.5 py-1 rounded-md transition disabled:opacity-40">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Save note
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-xs text-stone-400 hover:text-gold-600 transition">
            <MessageSquare className="w-3 h-3" /> {notes.length ? 'Add another note' : 'Is this right?'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────
export default function RedTeamClient({ matters }: { matters: RedTeamMatter[] }) {
  const [mode, setMode] = useState<RedTeamMode>('self');
  const [matterId, setMatterId] = useState<string | null>(null);
  const [matterDeliverables, setMatterDeliverables] = useState<MatterDeliverable[]>([]);
  const [selectedDeliverableId, setSelectedDeliverableId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [respondingOpen, setRespondingOpen] = useState(false);
  const [targetDeliverableId, setTargetDeliverableId] = useState<string | null>(null);
  const [targetFile, setTargetFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [run, setRun] = useState<RunRow | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const autoRan = useRef(false);
  // Holds the disposer for the in-flight poll loop. Without it, opening a
  // second run while the first is still processing leaves both loops calling
  // setRun and the results panel flip-flops between them.
  const stopPollRef = useRef<(() => void) | null>(null);

  const status = run?.status;
  const busy = submitting || status === 'pending' || status === 'processing';

  const poll = useCallback((id: number) => {
    stopPollRef.current?.();
    let stop = false;
    stopPollRef.current = () => { stop = true; };
    const tick = async () => {
      if (stop) return;
      try {
        const res = await fetch(`/api/red-team?id=${id}`);
        const data = await res.json();
        if (stop) return;
        if (data.run) {
          setRun(data.run as RunRow);
          if (data.run.status === 'completed' || data.run.status === 'failed') return;
        }
      } catch { /* keep polling */ }
      if (!stop) setTimeout(tick, 2500);
    };
    tick();
  }, []);

  useEffect(() => () => stopPollRef.current?.(), []);

  const loadHistory = useCallback(async (mId: string | null) => {
    try {
      const res = await fetch(mId ? `/api/red-team?matterId=${mId}` : '/api/red-team');
      const data = await res.json();
      setHistory(data.runs ?? []);
    } catch { /* ignore */ }
  }, []);

  const loadNotes = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/red-team/comments?redTeamId=${id}`);
      const data = await res.json();
      setNotes(data.comments ?? []);
    } catch { /* ignore */ }
  }, []);

  const start = useCallback(async (body: FormData | Record<string, unknown>) => {
    setSubmitting(true);
    setError('');
    setRun(null);
    setNotes([]);
    try {
      const res = await fetch('/api/red-team', {
        method: 'POST',
        ...(body instanceof FormData
          ? { body }
          : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start the review');
      setRun({ id: data.id, status: 'pending' } as RunRow);
      poll(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }, [poll]);

  const openRun = useCallback((id: number) => {
    setRun({ id, status: 'processing' } as RunRow);
    setNotes([]);
    poll(id);
  }, [poll]);

  // On arrival: open an existing run (?runId=) or auto-run from a deliverable
  // hook (?deliverableId=&mode=).
  useEffect(() => {
    if (autoRan.current) return;
    const params = new URLSearchParams(window.location.search);
    const existingId = params.get('runId');
    if (existingId && !Number.isNaN(Number(existingId))) {
      autoRan.current = true;
      openRun(Number(existingId));
      return;
    }
    const deliverableId = params.get('deliverableId');
    if (!deliverableId) return;
    autoRan.current = true;
    const m = params.get('mode') === 'opposing' ? 'opposing' : 'self';
    setMode(m);
    start({ deliverableId, mode: m });
  }, [start, openRun]);

  // Matter change → load its pleadings + history; reset the pickers.
  useEffect(() => {
    setSelectedDeliverableId(null);
    setTargetDeliverableId(null);
    loadHistory(matterId);
    if (!matterId) { setMatterDeliverables([]); return; }
    let cancelled = false;
    fetch(`/api/red-team/deliverables?matterId=${matterId}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setMatterDeliverables(d.deliverables ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [matterId, loadHistory]);

  // When a run finishes, pull its notes and refresh history.
  useEffect(() => {
    if (run?.status === 'completed' && run.id) {
      loadNotes(run.id);
      loadHistory(matterId);
    }
  }, [run?.status, run?.id, loadNotes, loadHistory, matterId]);

  const addNote = useCallback(async (
    index: number,
    heading: string,
    body: string,
    verdict: 'agree' | 'wrong' | 'context',
  ) => {
    if (!run) return;
    const res = await fetch('/api/red-team/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redTeamId: run.id, findingIndex: index, findingHeading: heading, body, verdict }),
    });
    const data = await res.json();
    if (res.ok && data.comment) {
      setNotes((p) => [...p, data.comment as NoteRow]);
      // Exact suppression is keyed on the deliverable. An uploaded file has no
      // stable identity across runs, so promising the finding won't return
      // would be a promise the engine cannot keep — the note still feeds the
      // cross-pleading guidance either way.
      toast.success(
        verdict === 'wrong'
          ? (run.deliverable_id
              ? 'Noted — this finding won’t come back on the next run of this deliverable'
              : 'Noted — it will steer similar findings, but an uploaded file can’t be matched to a re-run. Run from the deliverable to suppress it exactly.')
          : 'Note saved — it will guide future runs on this and similar pleadings',
      );
    } else {
      toast.error(data.error || 'Could not save the note');
      throw new Error(data.error || 'failed');
    }
  }, [run]);

  // A pleading the draft answers only ever helps when it is actually attached,
  // so the field opens itself for the subtypes that are responsive by nature.
  useEffect(() => {
    const d = matterDeliverables.find((x) => x.id === selectedDeliverableId);
    if (d && isResponsivePleading(d.subtype, d.name)) setRespondingOpen(true);
  }, [selectedDeliverableId, matterDeliverables]);

  const handleSubmit = () => {
    if (!selectedDeliverableId && !file) {
      setError('Pick a pleading from the matter, or upload a file.');
      return;
    }
    // A JSON body cannot carry the uploaded pleading being answered, so any run
    // with an uploaded file on either side goes as multipart.
    if (file || targetFile) {
      const fd = new FormData();
      if (file) fd.append('file', file);
      else fd.append('deliverableId', selectedDeliverableId!);
      fd.append('mode', mode);
      if (matterId) fd.append('matterId', matterId);
      if (targetFile) fd.append('targetFile', targetFile);
      else if (targetDeliverableId) fd.append('targetDeliverableId', targetDeliverableId);
      start(fd);
      return;
    }
    start({
      deliverableId: selectedDeliverableId,
      mode,
      matterId,
      ...(targetDeliverableId ? { targetDeliverableId } : {}),
    });
  };

  const canSubmit = !busy && (!!selectedDeliverableId || !!file);
  const targetName = targetFile?.name
    ?? matterDeliverables.find((d) => d.id === targetDeliverableId)?.name
    ?? null;

  // The model orders findings, but sort defensively so severity always reads
  // top-down regardless of what came back.
  const sortedFindings = useMemo(() => {
    const list = (run?.findings ?? []).map((f, i) => ({ f, i }));
    return list.sort((a, b) => SEVERITY_ORDER.indexOf(a.f.severity) - SEVERITY_ORDER.indexOf(b.f.severity));
  }, [run?.findings]);

  const problemCites = (run?.citation_checks ?? []).filter((c) => c.verdict !== 'supports');
  const okCites = (run?.citation_checks ?? []).filter((c) => c.verdict === 'supports');

  // The two juris.ph legs fail independently, and a partial outage is the
  // dangerous case: a healthy cite-check next to a dead adverse search looks
  // exactly like "nothing was found against us". Say which half is missing.
  const searchDown = run?.adverse_search_available === false;
  const citesDown = run?.cite_check_available === false;
  const jurisWarning = searchDown && citesDown
    ? 'juris.ph could not be reached for this run: no contrary authority was searched for and no citation was verified.'
    : searchDown
      ? 'juris.ph did not answer the contrary-authority search, so nothing was searched for against this pleading. The cite-check below did run.'
      : citesDown
        ? 'juris.ph did not answer the cite-check, so none of the authorities this pleading cites were verified. The contrary-authority search did run.'
        : '';

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-16">
      {/* Input card */}
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] p-5 space-y-4">
        <div>
          <label className="block text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5">Whose pleading is this?</label>
          <div className="inline-flex rounded-lg border border-stone-200 dark:border-stone-700 p-0.5 bg-stone-50 dark:bg-stone-800">
            {([['self', 'Ours'], ['opposing', 'Theirs']] as const).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setMode(val)}
                className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition ${mode === val ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-900 dark:text-stone-100' : 'text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-stone-400">
            {mode === 'self'
              ? 'Attacks our own draft the way opposing counsel would, and tells us how to close each hole before filing.'
              : 'Takes apart the adverse party’s filing and drafts the argument lines for our response.'}
          </p>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5">Matter</label>
          <Combobox
            items={matters.map((m) => ({ id: m.id, name: m.name, code: m.code, keywords: m.caseTitle }))}
            value={matterId}
            onChange={setMatterId}
            placeholder="Link a matter (optional)"
            searchPlaceholder="Search by case name, code or cause of action…"
            emptyText="No matters found"
          />
          <p className="mt-1.5 text-xs text-stone-400">
            Linking a matter is what lets the review catch contradictions with documents already in the case record.
          </p>
        </div>

        {matterId && (
          <div>
            <label className="block text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5">Pleading in this matter</label>
            <Combobox
              items={matterDeliverables}
              value={selectedDeliverableId}
              onChange={(id) => { setSelectedDeliverableId(id); if (id) setFile(null); }}
              placeholder={matterDeliverables.length ? 'Choose a pleading (optional)' : 'No pleadings in this matter'}
              searchPlaceholder="Search pleadings…"
              emptyText="No pleadings in this matter"
            />
          </div>
        )}

        <div>
          <label className="block text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5">
            {selectedDeliverableId ? 'Or upload a different file' : 'Pleading'}
          </label>
          <PleadingDrop
            file={file}
            onFile={(f) => { setFile(f); setSelectedDeliverableId(null); setError(''); }}
            title="Drop a PDF or Word file, or click to browse"
            hint="Complaints, answers, motions, petitions, position papers, memoranda."
          />
        </div>

        {/* The pleading this one answers */}
        <div className="rounded-xl border border-stone-200/80 dark:border-stone-700/60 overflow-hidden">
          <button
            type="button"
            onClick={() => setRespondingOpen((o) => !o)}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-left bg-stone-50/70 dark:bg-stone-800/40 hover:bg-stone-100/70 dark:hover:bg-stone-800/70 transition"
          >
            <CornerDownRight className="w-3.5 h-3.5 text-stone-400 shrink-0" />
            <span className="text-sm font-medium text-stone-700 dark:text-stone-200">
              Is this a response to another pleading?
            </span>
            {targetName && !respondingOpen && (
              <span className="text-xs text-gold-700 dark:text-gold-400 truncate">{targetName}</span>
            )}
            <span className="ml-auto text-[11px] text-stone-400 shrink-0">Optional</span>
            <ChevronDown className={`w-3.5 h-3.5 text-stone-400 transition-transform shrink-0 ${respondingOpen ? 'rotate-180' : ''}`} />
          </button>

          {respondingOpen && (
            <div className="p-4 space-y-3 border-t border-stone-200/80 dark:border-stone-700/60">
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Attach the complaint, motion or petition this one answers, and the review also checks it point by
                point: every material allegation left without a specific denial is deemed admitted under Rule 8,
                Sec. 11, and every ground left unrebutted stands.
              </p>

              {matterId && matterDeliverables.length > 0 && (
                <Combobox
                  items={matterDeliverables.filter((d) => d.id !== selectedDeliverableId)}
                  value={targetDeliverableId}
                  onChange={(id) => { setTargetDeliverableId(id); if (id) setTargetFile(null); }}
                  placeholder="Choose a pleading in this matter"
                  searchPlaceholder="Search pleadings…"
                  emptyText="No other pleadings in this matter"
                />
              )}

              <div className="flex items-center gap-2">
                <PleadingDrop
                  file={targetFile}
                  onFile={(f) => { setTargetFile(f); setTargetDeliverableId(null); setError(''); }}
                  title={targetDeliverableId ? 'Or upload a different file' : 'Drop the pleading being answered'}
                  hint="Usually the other side's filing — PDF or Word."
                  compact
                />
                {(targetFile || targetDeliverableId) && (
                  <button
                    type="button"
                    onClick={() => { setTargetFile(null); setTargetDeliverableId(null); }}
                    className="shrink-0 p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:text-stone-500 dark:hover:text-stone-200 dark:hover:bg-stone-800 transition"
                    title="Remove"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-lg border border-red-200/60 dark:bg-red-500/10 dark:text-red-300 dark:border-red-400/30">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-gold-600 hover:bg-gold-700 rounded-lg shadow-sm transition disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Swords className="w-4 h-4" />}
            {busy ? 'Attacking…' : mode === 'self' ? 'Red team this draft' : 'Build our attack'}
          </button>
        </div>
      </div>

      {/* Recent runs */}
      {history.length > 0 && (
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--border-color)] flex items-center gap-2">
            <Clock className="w-4 h-4 text-stone-400" />
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              {matterId ? 'Reviews in this matter' : 'Recent reviews'}
            </h2>
          </div>
          <div className="divide-y divide-[var(--border-color)]">
            {history.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => openRun(h.id)}
                className={`w-full flex items-center gap-3 px-5 py-3 text-left transition hover:bg-stone-50 dark:hover:bg-stone-800/40 ${run?.id === h.id ? 'bg-gold-50/40 dark:bg-gold-500/5' : ''}`}
              >
                <FileText className="w-4 h-4 text-stone-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-stone-800 dark:text-stone-100 truncate">{h.file_name}</p>
                  <p className="text-xs text-stone-400">
                    {h.mode === 'self' ? 'Our draft' : 'Their filing'}
                    {h.document_type ? ` · ${h.document_type}` : ''} · {shortDate(h.created_at)}
                  </p>
                </div>
                {h.status === 'completed' ? (
                  <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${riskTone(h.overall_risk)}`}>
                    {h.overall_risk ?? 'reviewed'} · {h.finding_count ?? 0}
                  </span>
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400 capitalize">{h.status}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* In-progress */}
      {busy && !run?.findings && (
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-8 text-center">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-gold-500" />
          <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">
            Mapping the argument, searching juris.ph for authority against it, and checking every case it cites…
          </p>
          <p className="mt-1 text-xs text-stone-400">This takes a couple of minutes.</p>
        </div>
      )}

      {/* Failed */}
      {status === 'failed' && (
        <div className="bg-[var(--card-bg)] rounded-xl border border-red-200 dark:border-red-500/30 p-5">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-300 font-medium"><AlertTriangle className="w-4 h-4" /> Review failed</div>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{run?.error_message || 'The pleading could not be analyzed. Check the file and try again.'}</p>
        </div>
      )}

      {/* Results */}
      {status === 'completed' && run && (
        <div className="space-y-4">
          {/* Risk header + weakest link */}
          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] p-5">
            <div className="flex items-center gap-2 mb-3">
              <Swords className="w-5 h-5 text-gold-600 dark:text-gold-400" />
              <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
                {run.mode === 'self' ? 'Red team assessment' : 'Attack plan'}
              </h2>
              {run.document_type && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                  {run.document_type}
                </span>
              )}
            </div>

            {run.target_file_name && (
              <p className="-mt-1 mb-3 flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
                <CornerDownRight className="w-3.5 h-3.5 shrink-0 text-stone-400" />
                Read against <span className="font-medium text-stone-700 dark:text-stone-200">{run.target_file_name}</span>
                {run.target_document_type ? ` (${run.target_document_type})` : ''}
              </p>
            )}

            <div className="flex flex-wrap gap-2 mb-4">
              <span className={`inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg font-medium capitalize ${riskTone(run.overall_risk)}`}>
                <Crosshair className="w-3.5 h-3.5" /> {run.overall_risk ?? 'reviewed'} risk
              </span>
              {run.severity_breakdown && SEVERITY_ORDER.map((s) => (
                run.severity_breakdown![s] > 0 ? (
                  <span key={s} className={`inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg ring-1 ring-inset ${severityTone(s)}`}>
                    {run.severity_breakdown![s]} {s}
                  </span>
                ) : null
              ))}
            </div>

            {jurisWarning && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200/60 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                <WifiOff className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{jurisWarning} Treat what&apos;s missing as unknown, not as clearance, and run this again later.</span>
              </div>
            )}

            {run.weakest_link && (
              <div className="rounded-lg border border-red-200/70 bg-red-50/50 px-4 py-3 dark:border-red-500/25 dark:bg-red-500/[0.06]">
                <div className="flex items-center gap-1.5 mb-1">
                  <Crosshair className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">
                    {run.mode === 'self' ? 'Fix this first' : 'Lead with this'}
                  </span>
                </div>
                <p className="text-sm text-stone-800 dark:text-stone-100 whitespace-pre-wrap">{run.weakest_link}</p>
              </div>
            )}
          </div>

          {/* Point-by-point coverage of the pleading being answered */}
          {(run.response_coverage?.length ?? 0) > 0 && (
            <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] p-5">
              <div className="flex items-center gap-2 mb-1">
                <ListChecks className="w-4 h-4 text-gold-600 dark:text-gold-400" />
                <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                  {run.mode === 'self' ? 'What we answered' : 'What they answered'}
                </h3>
              </div>
              <p className="text-xs text-stone-400 dark:text-stone-500 mb-3">
                {run.mode === 'self'
                  ? 'Every point in the pleading we are answering, and whether this draft meets it. A material allegation left without a specific denial is deemed admitted (Rule 8, Sec. 11).'
                  : 'Every point of ours, and whether their filing meets it. What they left standing is what we press in reply.'}
              </p>
              <div className="space-y-2.5">
                {[...run.response_coverage!]
                  .sort((a, b) => COVERAGE_ORDER.indexOf(a.status) - COVERAGE_ORDER.indexOf(b.status))
                  .map((c, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <CoverageIcon status={c.status} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          {c.ref && (
                            <span className="font-mono text-[12px] text-stone-500 dark:text-stone-400">{c.ref}</span>
                          )}
                          <span className={`text-[10px] uppercase tracking-wide font-semibold ${coverageTone(c.status)}`}>
                            {COVERAGE_LABEL[c.status]}
                          </span>
                        </div>
                        <p className="text-sm text-stone-700 dark:text-stone-200">{c.point}</p>
                        {c.note && (
                          <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">{c.note}</p>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Cite-check */}
          {(run.citation_checks?.length ?? 0) > 0 && (
            <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] p-5">
              <div className="flex items-center gap-2 mb-3">
                <BookOpen className="w-4 h-4 text-gold-600 dark:text-gold-400" />
                <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Cite-check</h3>
                <span className="text-xs text-stone-400 dark:text-stone-500">does each case say what we said it says?</span>
              </div>
              <div className="space-y-3">
                {[...problemCites, ...okCites].map((c, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    {c.verdict === 'supports' ? (
                      <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    ) : c.verdict === 'mismatch' ? (
                      <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        {c.url ? (
                          <a href={c.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-[13px] text-navy-700 dark:text-navy-300 hover:underline">
                            {c.ref}
                            <ExternalLink className="w-3 h-3 opacity-60 shrink-0" />
                          </a>
                        ) : (
                          <span className="font-mono text-[13px] text-stone-700 dark:text-stone-200">{c.ref}</span>
                        )}
                        {c.title && (
                          <span className="text-stone-500 dark:text-stone-400 text-xs">{c.title}{c.date ? ` (${c.date})` : ''}</span>
                        )}
                        <span className={`text-[10px] uppercase tracking-wide font-semibold ${
                          c.verdict === 'supports' ? 'text-emerald-600 dark:text-emerald-400'
                            : c.verdict === 'mismatch' ? 'text-red-600 dark:text-red-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}>
                          {c.verdict === 'unverified' ? 'not in juris.ph' : c.verdict}
                        </span>
                      </div>
                      {c.offered_for && (
                        <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">Cited for: {c.offered_for}</p>
                      )}
                      {c.note && (
                        <p className="mt-1 text-xs text-stone-600 dark:text-stone-300">{c.note}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-stone-400 dark:text-stone-500">
                juris.ph indexes Supreme Court decisions and Republic Acts only, and its digests are
                AI-generated — CA and lower-court rulings can&apos;t be checked here, and a &ldquo;supports&rdquo; verdict
                is not a substitute for reading the decision.
              </p>
            </div>
          )}

          {/* Findings */}
          <p className="flex items-start gap-2 text-xs text-stone-400 dark:text-stone-500 px-1">
            <MessageSquare className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            Disagree with a finding? Mark it wrong — on a deliverable it won&apos;t come back on the next run, and
            either way the reason you give is surfaced on similar findings in other matters.
          </p>

          <div className="space-y-3">
            {sortedFindings.map(({ f, i }) => (
              <FindingCard
                key={i}
                finding={f}
                index={i}
                mode={run.mode}
                notes={notes.filter((n) => n.findingIndex === i)}
                onAddNote={addNote}
              />
            ))}
            {sortedFindings.length === 0 && (
              <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-6 text-center text-sm text-stone-500 dark:text-stone-400">
                No attacks worth raising were found. That is a thin result, not a clean bill of health — read the
                assessment below and satisfy yourself the pleading was actually understood.
              </div>
            )}
          </div>

          {/* Adverse authorities */}
          {(run.adverse_authorities?.length ?? 0) > 0 && (
            <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] p-5">
              <div className="flex items-center gap-2 mb-1">
                <Scale className="w-4 h-4 text-gold-600 dark:text-gold-400" />
                <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Authority searched against us</h3>
              </div>
              <p className="text-xs text-stone-400 dark:text-stone-500 mb-3">
                Decisions found by searching juris.ph for rulings that would defeat this pleading&apos;s own
                propositions. These are leads, not holdings — read each before relying on it or distinguishing it.
              </p>
              <div className="space-y-3">
                {run.adverse_authorities!.map((a, i) => (
                  <div key={i} className="text-sm">
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-[13px] text-navy-700 dark:text-navy-300 hover:underline">
                      {a.caseNumber}
                      <ExternalLink className="w-3 h-3 opacity-60 shrink-0" />
                    </a>
                    <span className="text-stone-600 dark:text-stone-300 text-xs ml-2">{a.title}{a.date ? ` (${a.date})` : ''}</span>
                    <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">
                      Searched against: {a.againstProposition}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Concessions */}
          {(run.concessions?.length ?? 0) > 0 && (
            <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] p-5">
              <div className="flex items-center gap-2 mb-3">
                <CircleAlert className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Given away for free</h3>
              </div>
              <ul className="space-y-1.5">
                {run.concessions!.map((c, i) => (
                  <li key={i} className="text-sm text-stone-700 dark:text-stone-200 flex items-start gap-2">
                    <span className="text-stone-300 dark:text-stone-600 mt-0.5">•</span>{c}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Opposing theory */}
          {run.opposing_theory && (
            <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] p-5">
              <div className="flex items-center gap-2 mb-3">
                <ScrollText className="w-4 h-4 text-gold-600 dark:text-gold-400" />
                <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                  {run.mode === 'self' ? 'The brief against us' : 'Their theory of the case'}
                </h3>
              </div>
              <p className="text-sm text-stone-700 dark:text-stone-200 whitespace-pre-wrap leading-relaxed">
                {run.opposing_theory}
              </p>
            </div>
          )}

          <p className="flex items-start gap-2 text-xs text-stone-400 dark:text-stone-500 px-1">
            <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            AI-assisted decision support, not legal advice. Every case named here — ours and theirs — must be read
            in full before it is relied on, distinguished, or cited in a filing.
          </p>
        </div>
      )}
    </div>
  );
}
