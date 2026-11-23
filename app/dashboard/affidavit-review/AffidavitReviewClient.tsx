'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Upload, FileText, Loader2, Search, ChevronDown, X, Check, Copy,
  ShieldAlert, ShieldCheck, AlertTriangle, ScanSearch, Sparkles, MessageSquare, Clock,
  BookOpen, ExternalLink,
} from 'lucide-react';
import type { AffidavitFinding, ObjectionType } from '@/lib/ai/affidavit-review';
import type { ResolvedCitation } from '@/lib/juris';
import { uploadToSignedUrl } from '@/lib/upload';

export interface ReviewMatter {
  id: string;
  name: string;
  code: string | null;
}

type ReviewMode = 'self' | 'opposing';

interface ReviewRow {
  id: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  mode: ReviewMode;
  file_name: string;
  affiant_name: string | null;
  summary: string | null;
  question_count: number | null;
  objectionable_count: number | null;
  severity_breakdown: { high: number; medium: number; low: number } | null;
  findings: AffidavitFinding[] | null;
  citations: ResolvedCitation[] | null;
  error_message: string | null;
}

interface HistoryRow {
  id: number;
  file_name: string;
  mode: ReviewMode;
  status: string;
  question_count: number | null;
  objectionable_count: number | null;
  created_at: string;
}

interface NoteRow {
  id: number;
  qNo: number | null;
  body: string;
  createdAt: string;
  authorId: string;
  authorName: string;
  authorInitials: string;
}

const OBJECTION_LABELS: Record<ObjectionType, string> = {
  leading: 'Leading',
  misleading: 'Misleading',
  compound: 'Compound',
  argumentative: 'Argumentative',
  narrative: 'Calls for narrative',
  asked_answered: 'Asked & answered',
  assumes_facts: 'Assumes facts',
  speculation: 'Speculation',
  opinion: 'Lay opinion',
  hearsay: 'Hearsay',
  relevance: 'Irrelevant',
  original_document: 'Original document rule',
  parol_evidence: 'Parol evidence',
  privilege: 'Privileged',
  incompetent: 'Incompetent',
  foundation: 'Lacks foundation',
  vague: 'Vague / ambiguous',
  ja_rule_defect: 'JA Rule defect',
};

function severityTone(s: string): string {
  if (s === 'high') return 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30';
  if (s === 'medium') return 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30';
  return 'bg-stone-100 text-stone-600 ring-stone-200 dark:bg-stone-500/10 dark:text-stone-400 dark:ring-stone-500/30';
}

function shortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return ''; }
}

// ── Generic searchable combobox ─────────────────────────────────────
function Combobox({ items, value, onChange, placeholder, searchPlaceholder = 'Search…', emptyText = 'No results' }: {
  items: { id: string; name: string; code?: string | null }[];
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
    ? items.filter((m) => `${m.name} ${m.code ?? ''}`.toLowerCase().includes(q.toLowerCase()))
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

// ── Finding card (with per-question AI notes) ───────────────────────
function FindingCard({ finding, notes, onAddNote }: {
  finding: AffidavitFinding;
  notes: NoteRow[];
  onAddNote: (qNo: number, question: string, body: string) => Promise<void>;
}) {
  const objectionable = finding.verdict === 'objectionable';
  const action = finding.suggested_rephrase?.trim() || finding.objection_language?.trim() || '';
  const actionIsRephrase = !!finding.suggested_rephrase?.trim();

  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const submitNote = async () => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      await onAddNote(finding.q_no, finding.question, text.trim());
      setText('');
      setAdding(false);
    } catch { /* parent toasts */ } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`rounded-xl border p-4 ${objectionable ? 'border-red-200/70 bg-red-50/30 dark:border-red-500/20 dark:bg-red-500/[0.04]' : 'border-stone-200/70 bg-white dark:border-stone-700/60 dark:bg-stone-900/40'}`}>
      <div className="flex items-start gap-3">
        <span className={`shrink-0 inline-flex items-center justify-center min-w-7 h-7 px-1.5 rounded-lg text-xs font-bold tabular-nums ${objectionable ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'}`}>
          Q{finding.q_no}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-stone-800 dark:text-stone-100">{finding.question}</p>
          {finding.answer_excerpt && (
            <p className="mt-1 text-xs text-stone-400 dark:text-stone-500 line-clamp-2">A: {finding.answer_excerpt}</p>
          )}

          {objectionable ? (
            <div className="mt-3 space-y-2.5">
              {(finding.objections ?? []).map((o, i) => (
                <div key={i} className="text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-semibold ring-1 ring-inset ${severityTone(o.severity)}`}>
                      {OBJECTION_LABELS[o.type] ?? o.type}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-stone-400">{o.severity}</span>
                    <span className="text-stone-500 dark:text-stone-400">· {o.rule}</span>
                  </div>
                  <p className="mt-1 text-stone-600 dark:text-stone-300">{o.rationale}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              <ShieldCheck className="w-3.5 h-3.5" /> No objection
            </div>
          )}

          {objectionable && action && (
            <div className="mt-3 rounded-lg border border-stone-200/80 bg-stone-50/70 px-3 py-2.5 dark:border-stone-700/60 dark:bg-stone-800/40">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                  {actionIsRephrase ? 'Suggested rephrase' : 'Objection language'}
                </span>
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

          {/* Reviewer notes for the AI (applied to future reviews) */}
          <div className="mt-3 border-t border-stone-100 dark:border-stone-800 pt-2.5">
            {notes.map((n) => (
              <div key={n.id} className="flex items-start gap-1.5 mb-1.5">
                <MessageSquare className="w-3 h-3 text-gold-500 mt-0.5 shrink-0" />
                <p className="text-xs text-stone-600 dark:text-stone-300">
                  <span className="font-semibold">{n.authorInitials}:</span> {n.body}
                </p>
              </div>
            ))}
            {adding ? (
              <div className="mt-1 space-y-1.5">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitNote(); }}
                  rows={2}
                  autoFocus
                  placeholder="Tell the AI how to handle this question next time — e.g. “This is a preliminary matter; don’t flag as leading.”"
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
                <MessageSquare className="w-3 h-3" /> {notes.length ? 'Add another note for the AI' : 'Note for the AI'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────
export default function AffidavitReviewClient({ matters }: { matters: ReviewMatter[] }) {
  const [mode, setMode] = useState<ReviewMode>('self');
  const [matterId, setMatterId] = useState<string | null>(null);
  const [matterDeliverables, setMatterDeliverables] = useState<{ id: string; name: string }[]>([]);
  const [selectedDeliverableId, setSelectedDeliverableId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [review, setReview] = useState<ReviewRow | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoRan = useRef(false);

  const status = review?.status;
  const busy = submitting || status === 'pending' || status === 'processing';

  const poll = useCallback((id: number) => {
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const res = await fetch(`/api/affidavit-review?id=${id}`);
        const data = await res.json();
        if (data.review) {
          setReview(data.review as ReviewRow);
          if (data.review.status === 'completed' || data.review.status === 'failed') return;
        }
      } catch { /* keep polling */ }
      if (!stop) setTimeout(tick, 2500);
    };
    tick();
    return () => { stop = true; };
  }, []);

  const loadHistory = useCallback(async (mId: string | null) => {
    try {
      const res = await fetch(mId ? `/api/affidavit-review?matterId=${mId}` : '/api/affidavit-review');
      const data = await res.json();
      setHistory(data.reviews ?? []);
    } catch { /* ignore */ }
  }, []);

  const loadNotes = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/affidavit-review/comments?reviewId=${id}`);
      const data = await res.json();
      setNotes(data.comments ?? []);
    } catch { /* ignore */ }
  }, []);

  const start = useCallback(async (body: Record<string, unknown>) => {
    setSubmitting(true);
    setError('');
    setReview(null);
    setNotes([]);
    try {
      const res = await fetch('/api/affidavit-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start review');
      setReview({ id: data.id, status: 'pending' } as ReviewRow);
      poll(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }, [poll]);

  const openReview = useCallback((id: number) => {
    setReview({ id, status: 'processing' } as ReviewRow);
    setNotes([]);
    poll(id);
  }, [poll]);

  // On arrival: load an existing review (?reviewId=) or auto-run from a
  // deliverable hook (?deliverableId=&mode=).
  useEffect(() => {
    if (autoRan.current) return;
    const params = new URLSearchParams(window.location.search);
    const existingId = params.get('reviewId');
    if (existingId && !Number.isNaN(Number(existingId))) {
      autoRan.current = true;
      openReview(Number(existingId));
      return;
    }
    const deliverableId = params.get('deliverableId');
    if (!deliverableId) return;
    autoRan.current = true;
    const m = params.get('mode') === 'opposing' ? 'opposing' : 'self';
    setMode(m);
    start({ deliverableId, mode: m });
  }, [start, openReview]);

  // Matter change → load its JA deliverables + history; reset the picker.
  useEffect(() => {
    setSelectedDeliverableId(null);
    loadHistory(matterId);
    if (!matterId) { setMatterDeliverables([]); return; }
    let cancelled = false;
    fetch(`/api/affidavit-review/deliverables?matterId=${matterId}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setMatterDeliverables(d.deliverables ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [matterId, loadHistory]);

  // When a review finishes, pull its notes and refresh history.
  useEffect(() => {
    if (review?.status === 'completed' && review.id) {
      loadNotes(review.id);
      loadHistory(matterId);
    }
  }, [review?.status, review?.id, loadNotes, loadHistory, matterId]);

  const addNote = useCallback(async (qNo: number, question: string, body: string) => {
    if (!review) return;
    const res = await fetch('/api/affidavit-review/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewId: review.id, qNo, question, body }),
    });
    const data = await res.json();
    if (res.ok && data.comment) {
      setNotes((p) => [...p, data.comment as NoteRow]);
      toast.success('Note saved — it will guide future reviews of this and similar affidavits');
    } else {
      toast.error(data.error || 'Could not save note');
      throw new Error(data.error || 'failed');
    }
  }, [review]);

  const handleSubmit = async () => {
    if (selectedDeliverableId) {
      start({ deliverableId: selectedDeliverableId, mode, matterId });
      return;
    }
    if (!file) { setError('Pick a judicial affidavit from the matter, or upload a file.'); return; }

    // The affidavit goes browser-to-storage first; the review then runs against
    // the stored object. Sending the bytes to the route would cap the upload at
    // Vercel's 4.5MB request-body limit.
    setSubmitting(true);
    setError('');
    try {
      const prepRes = await fetch('/api/affidavit-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prepareUpload: true, name: file.name }),
      });
      const prep = await prepRes.json().catch(() => ({}));
      if (!prepRes.ok || !prep?.signedUrl) throw new Error(prep?.error || 'Could not start the upload.');

      await uploadToSignedUrl(prep.signedUrl, file, {
        name: file.name,
        size: file.size,
        type: file.type,
      });

      start({ storagePath: prep.storagePath, name: file.name, mode, matterId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setSubmitting(false);
    }
  };

  const onFiles = (files: FileList | null) => {
    const f = files?.[0];
    if (f) { setFile(f); setSelectedDeliverableId(null); setError(''); }
  };

  const canSubmit = !busy && (!!selectedDeliverableId || !!file);

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-16">
      {/* Input card */}
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] p-5 space-y-4">
        {/* Mode toggle */}
        <div>
          <label className="block text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5">Review mode</label>
          <div className="inline-flex rounded-lg border border-stone-200 dark:border-stone-700 p-0.5 bg-stone-50 dark:bg-stone-800">
            {([['self', 'Self-review'], ['opposing', 'Opposing JA']] as const).map(([val, label]) => (
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
              ? 'Reviews our own witness’s affidavit and suggests compliant rephrasings of objectionable questions.'
              : 'Reviews the adverse party’s affidavit and drafts objection / motion-to-strike language.'}
          </p>
        </div>

        {/* Matter (optional) */}
        <div>
          <label className="block text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5">Matter</label>
          <Combobox items={matters} value={matterId} onChange={setMatterId} placeholder="Link a matter (optional)" searchPlaceholder="Search matters…" emptyText="No matters found" />
        </div>

        {/* JA deliverable picker (when a matter is selected) */}
        {matterId && (
          <div>
            <label className="block text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5">Judicial affidavit in this matter</label>
            <Combobox
              items={matterDeliverables}
              value={selectedDeliverableId}
              onChange={(id) => { setSelectedDeliverableId(id); if (id) setFile(null); }}
              placeholder={matterDeliverables.length ? 'Choose a judicial affidavit (optional)' : 'No judicial affidavits in this matter'}
              searchPlaceholder="Search affidavits…"
              emptyText="No judicial affidavits in this matter"
            />
          </div>
        )}

        {/* Dropzone */}
        <div>
          <label className="block text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5">
            {selectedDeliverableId ? 'Or upload a different file' : 'Judicial affidavit'}
          </label>
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); onFiles(e.dataTransfer.files); }}
            className={`flex items-center gap-3 px-4 py-5 rounded-xl border-2 border-dashed cursor-pointer transition ${dragging ? 'border-gold-400 bg-gold-50/50 dark:bg-gold-500/5' : 'border-stone-200 hover:border-stone-300 dark:border-stone-700 dark:hover:border-stone-600'}`}
          >
            <div className="w-10 h-10 rounded-lg bg-stone-100 dark:bg-stone-800 flex items-center justify-center shrink-0">
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
                  <p className="text-sm font-medium text-stone-700 dark:text-stone-200">Drop a PDF or Word file, or click to browse</p>
                  <p className="text-xs text-stone-400">The affidavit must be in numbered question-and-answer form.</p>
                </>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => onFiles(e.target.files)} />
          </div>
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
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanSearch className="w-4 h-4" />}
            {busy ? 'Reviewing…' : 'Review for objections'}
          </button>
        </div>
      </div>

      {/* Recent reviews */}
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
                onClick={() => openReview(h.id)}
                className={`w-full flex items-center gap-3 px-5 py-3 text-left transition hover:bg-stone-50 dark:hover:bg-stone-800/40 ${review?.id === h.id ? 'bg-gold-50/40 dark:bg-gold-500/5' : ''}`}
              >
                <FileText className="w-4 h-4 text-stone-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-stone-800 dark:text-stone-100 truncate">{h.file_name}</p>
                  <p className="text-xs text-stone-400">{h.mode === 'self' ? 'Self-review' : 'Opposing JA'} · {shortDate(h.created_at)}</p>
                </div>
                {h.status === 'completed' ? (
                  <span className={`text-xs px-2 py-0.5 rounded-full ${(h.objectionable_count ?? 0) > 0 ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'}`}>
                    {h.objectionable_count ?? 0}/{h.question_count ?? 0} flagged
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
      {busy && !review?.findings && (
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-8 text-center">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-gold-500" />
          <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">Reading the affidavit and checking every question against the Rules on Evidence…</p>
        </div>
      )}

      {/* Failed */}
      {status === 'failed' && (
        <div className="bg-[var(--card-bg)] rounded-xl border border-red-200 dark:border-red-500/30 p-5">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-300 font-medium"><AlertTriangle className="w-4 h-4" /> Review failed</div>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{review?.error_message || 'The affidavit could not be analyzed. Check the file and try again.'}</p>
        </div>
      )}

      {/* Results */}
      {status === 'completed' && review && (
        <div className="space-y-4">
          {/* Summary header */}
          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] p-5">
            <div className="flex items-center gap-2 mb-3">
              <ShieldAlert className="w-5 h-5 text-gold-600 dark:text-gold-400" />
              <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">Objection review</h2>
              <span className="text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                {review.mode === 'self' ? 'Self-review' : 'Opposing JA'}
              </span>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              <span className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-stone-50 dark:bg-stone-800 text-stone-600 dark:text-stone-300">
                <FileText className="w-3.5 h-3.5" /> {review.question_count ?? 0} questions
              </span>
              <span className={`inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg ${(review.objectionable_count ?? 0) > 0 ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'}`}>
                <ShieldAlert className="w-3.5 h-3.5" /> {review.objectionable_count ?? 0} objectionable
              </span>
              {review.severity_breakdown && (['high', 'medium', 'low'] as const).map((s) => (
                review.severity_breakdown![s] > 0 ? (
                  <span key={s} className={`inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg ring-1 ring-inset ${severityTone(s)}`}>
                    {review.severity_breakdown![s]} {s}
                  </span>
                ) : null
              ))}
            </div>
            {review.affiant_name && (
              <p className="text-sm text-stone-500 dark:text-stone-400 mb-1"><span className="font-medium text-stone-600 dark:text-stone-300">Affiant:</span> {review.affiant_name}</p>
            )}
            {review.summary && (
              <p className="text-sm text-stone-700 dark:text-stone-200 whitespace-pre-wrap">{review.summary}</p>
            )}
          </div>

          {/* Citation check */}
          {(review.citations?.length ?? 0) > 0 && (
            <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] p-5">
              <div className="flex items-center gap-2 mb-3">
                <BookOpen className="w-4 h-4 text-gold-600 dark:text-gold-400" />
                <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Citation check</h3>
                <span className="text-xs text-stone-400 dark:text-stone-500">verified against juris.ph</span>
              </div>
              <div className="space-y-2">
                {review.citations!.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    {c.status === 'found' ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          {c.url ? (
                            <a
                              href={c.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 font-mono text-[13px] text-navy-700 dark:text-navy-300 hover:underline"
                            >
                              {c.ref}
                              <ExternalLink className="w-3 h-3 opacity-60 shrink-0" />
                            </a>
                          ) : (
                            <span className="font-mono text-[13px] text-stone-700 dark:text-stone-200">{c.ref}</span>
                          )}
                          {c.title && (
                            <span className="text-stone-500 dark:text-stone-400 text-xs ml-2">
                              {c.title}{c.date ? ` (${c.date})` : ''}
                            </span>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-mono text-[13px] text-stone-700 dark:text-stone-200">{c.ref}</span>
                          <span className="text-amber-700 dark:text-amber-400 text-xs ml-2">
                            not found in the juris.ph index — double-check this citation
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-stone-400 dark:text-stone-500">
                Coverage: SC decisions and Republic Acts only — CA/lower-court cases and administrative
                issuances can&apos;t be verified here and are not listed.
              </p>
            </div>
          )}

          <p className="flex items-start gap-2 text-xs text-stone-400 dark:text-stone-500 px-1">
            <MessageSquare className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            Disagree with a call, or the AI missed something? Add a note to that question — your notes train the AI: applied to future reviews of this affidavit, and surfaced on similar questions in other affidavits.
          </p>

          {/* Findings */}
          <div className="space-y-3">
            {(review.findings ?? []).map((f, i) => (
              <FindingCard
                key={`${f.q_no}-${i}`}
                finding={f}
                notes={notes.filter((n) => n.qNo === f.q_no)}
                onAddNote={addNote}
              />
            ))}
          </div>

          {/* Disclaimer */}
          <p className="flex items-start gap-2 text-xs text-stone-400 dark:text-stone-500 px-1">
            <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            AI-assisted decision support, not legal advice. Verify every rule citation and exercise your own professional judgment before relying on or filing these objections.
          </p>
        </div>
      )}
    </div>
  );
}
