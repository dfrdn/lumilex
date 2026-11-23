'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  AlertTriangle, CheckCircle2, Download, FileText, FolderOpen, History, Landmark, Library, Loader2,
  PenTool, Reply, Save, Scale, Sparkles, X,
} from 'lucide-react';
import SearchableSelect from '@/components/SearchableSelect';
import SuperDocViewer, { type SuperDocViewerHandle } from '@/components/SuperDocViewer';
import DatePickerInput from '@/components/DatePickerInput';

type DraftFormat = 'pleading' | 'letter' | 'status_report';

export interface DraftingMatter {
  id: string;
  name: string;
  caseTitle: string | null;
  code: string | null;
  type: string | null;
}

export interface DraftingLawyer {
  id: string;
  name: string;
}

interface DraftingFile {
  id: string;
  name: string;
  date: string | null;
  isCourtRecord: boolean;
}

interface Generation {
  id: number;
  fileName: string;
  generatedBy: string | null;
  createdAt: string;
  savedToMatter: boolean;
}

interface GroundingPreview {
  hasBrief: boolean;
  briefPreview: string;
  ownWork: { title: string; origin: string; similarity: number }[];
  priorWork: { title: string; matterName: string; deliverableId: string | null; similarity: number }[];
  kbPages: { id: number; title: string; kind: string; status: string }[];
  authorities: { caseNumber: string; title: string; date?: string; url: string; similarity: number }[];
}

interface DraftResult {
  fileName: string;
  downloadUrl: string | null;
  deliverableId: string | null;
  generationId: number | null;
  truncated?: boolean;
  // Captured client-side at generation time so a revision can re-run the same
  // document type / format / model.
  documentType: string;
  format: DraftFormat;
  model: 'standard' | 'complex';
  grounding: {
    hasBrief: boolean;
    ownWork: { title: string; origin: string }[];
    priorWork: { title: string; matterName: string }[];
    kbPages: { id: number; title: string; kind: string }[];
    authorities: { caseNumber: string; title: string; url: string }[];
  };
}

const COMMON_DOCS = [
  'Motion for Reconsideration',
  'Position Paper',
  'Judicial Affidavit',
  'Answer with Counterclaim',
  'Comment/Opposition',
  'Demand Letter',
  'Petition for Review',
  'Manifestation',
  'Reply',
];

const REVISE_CHIPS = [
  'Tighten the language',
  'Strengthen the prayer / relief',
  'Make the tone more formal',
  'Expand the strongest argument',
];

interface Props {
  matters: DraftingMatter[];
  lawyers: DraftingLawyer[];
  currentUserId: string;
  signerName: string;
}

export default function DraftingStudioClient({ matters, lawyers, currentUserId, signerName }: Props) {
  const [matterId, setMatterId] = useState('');
  const [documentType, setDocumentType] = useState('');
  const [format, setFormat] = useState<DraftFormat>('pleading');
  // Status reports only — aggregate activity since this date (empty = auto).
  const [sinceDate, setSinceDate] = useState<string | null>(null);
  const [model, setModel] = useState<'standard' | 'complex'>('standard');
  const [respondingToFileId, setRespondingToFileId] = useState('');
  const [matterFiles, setMatterFiles] = useState<DraftingFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [deliverableType, setDeliverableType] = useState<'External' | 'Internal' | 'For Client'>('External');
  const [createDeliverable, setCreateDeliverable] = useState(true);
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);

  const [grounding, setGrounding] = useState<GroundingPreview | null>(null);
  const [groundingLoading, setGroundingLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<DraftResult | null>(null);
  const [recentDrafts, setRecentDrafts] = useState<Generation[]>([]);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [savingEdits, setSavingEdits] = useState(false);
  const [refineInstruction, setRefineInstruction] = useState('');
  const [refining, setRefining] = useState(false);
  const [revisions, setRevisions] = useState<string[]>([]);
  // Grounding sources the drafter curated out (own-work by title, prior work by
  // key, KB pages by id). Reset when the matter changes (the source set changes).
  const [excludedOwn, setExcludedOwn] = useState<Set<string>>(new Set());
  const [excludedPrior, setExcludedPrior] = useState<Set<string>>(new Set());
  const [excludedKb, setExcludedKb] = useState<Set<number>>(new Set());
  const [excludedAuth, setExcludedAuth] = useState<Set<string>>(new Set());
  const superdocRef = useRef<SuperDocViewerHandle>(null);

  // Status reports have a fixed document type + no "responding to". Pin the
  // document type so grounding preview + generate work; restore a blank field
  // when switching back to a free-form format.
  useEffect(() => {
    if (format === 'status_report') {
      setDocumentType('Status Report');
      setRespondingToFileId('');
    } else {
      setDocumentType((prev) => (prev === 'Status Report' ? '' : prev));
    }
  }, [format]);

  // Load the matter's readable files for the "Responding to" picker whenever
  // the matter changes. Resets the prior selection so a stale file from another
  // matter can't ride along.
  useEffect(() => {
    setRespondingToFileId('');
    setMatterFiles([]);
    setExcludedOwn(new Set());
    setExcludedPrior(new Set());
    setExcludedKb(new Set());
    setExcludedAuth(new Set());
    if (!matterId) return;
    const controller = new AbortController();
    setFilesLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/drafting/matter-files?matterId=${encodeURIComponent(matterId)}`, { signal: controller.signal });
        if (res.ok) {
          const data = await res.json();
          setMatterFiles(Array.isArray(data.files) ? data.files : []);
        }
      } catch { /* aborted or network error — ignore */ }
      finally {
        if (!controller.signal.aborted) setFilesLoading(false);
      }
    })();
    return () => controller.abort();
  }, [matterId]);

  // Recent drafts for the matter — lets a draft be re-downloaded after the page
  // refreshes (the on-screen link is one-time). Reloaded after each generation.
  const loadGenerations = useCallback(async (signal?: AbortSignal) => {
    if (!matterId) { setRecentDrafts([]); return; }
    try {
      const res = await fetch(`/api/drafting/generations?matterId=${encodeURIComponent(matterId)}`, signal ? { signal } : undefined);
      if (res.ok) {
        const data = await res.json();
        setRecentDrafts(Array.isArray(data.generations) ? data.generations : []);
      }
    } catch { /* aborted or network error — ignore */ }
  }, [matterId]);

  useEffect(() => {
    const controller = new AbortController();
    loadGenerations(controller.signal);
    return () => controller.abort();
  }, [loadGenerations]);

  // Preview grounding when matter + document type are both set (debounced).
  // Each input change aborts the previous request, so a slow earlier fetch
  // can't overwrite a newer one; nothing is cached, so a failed fetch never
  // blocks a retry.
  useEffect(() => {
    if (!matterId || documentType.trim().length < 3) {
      setGrounding(null);
      return;
    }
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      setGroundingLoading(true);
      try {
        const res = await fetch(
          `/api/drafting/grounding?matterId=${encodeURIComponent(matterId)}&documentType=${encodeURIComponent(documentType.trim())}&format=${format}`,
          { signal: controller.signal },
        );
        if (res.ok) setGrounding(await res.json());
      } catch { /* aborted or network error — ignore */ }
      finally {
        if (!controller.signal.aborted) setGroundingLoading(false);
      }
    }, 700);
    return () => { controller.abort(); clearTimeout(handle); };
  }, [matterId, documentType, format]);

  // Load the generated docx into the editable SuperDoc preview.
  useEffect(() => {
    setPreviewBlob(null);
    if (!result?.downloadUrl) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(result.downloadUrl!, { signal: controller.signal });
        if (res.ok) setPreviewBlob(await res.blob());
      } catch { /* aborted or network error — ignore */ }
    })();
    return () => controller.abort();
  }, [result]);

  async function downloadEdited() {
    const blob = (await superdocRef.current?.exportDocx()) ?? previewBlob;
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result?.fileName || 'draft.docx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function saveEdits() {
    if (!result?.generationId) { toast.error('Cannot save — this draft has no saved copy.'); return; }
    const blob = await superdocRef.current?.exportDocx();
    if (!blob) { toast.error('The editor is not ready yet.'); return; }
    setSavingEdits(true);
    try {
      const fd = new FormData();
      fd.append('file', blob, result.fileName || 'draft.docx');
      const res = await fetch(`/api/drafting/generations/${result.generationId}/save`, { method: 'POST', body: fd });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? 'Save failed'); }
      toast.success('Saved your changes to the matter');
      loadGenerations();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingEdits(false);
    }
  }

  async function generate() {
    if (!matterId || documentType.trim().length < 3) return;
    setGenerating(true);
    setResult(null);
    // One key per click; a network-level retry of this same request reuses it
    // (server dedupes), while a deliberate re-click gets a fresh key.
    const idempotencyKey = crypto.randomUUID();
    const excludeGrounding = excludedOwn.size || excludedPrior.size || excludedKb.size || excludedAuth.size
      ? {
          ownWorkTitles: [...excludedOwn],
          priorWorkKeys: [...excludedPrior],
          kbPageIds: [...excludedKb],
          authorityCaseNumbers: [...excludedAuth],
        }
      : undefined;
    try {
      const res = await fetch('/api/drafting/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matterId,
          documentType: documentType.trim(),
          format,
          model,
          sinceDate: format === 'status_report' && sinceDate ? sinceDate : undefined,
          instructions: instructions.trim() || undefined,
          respondingToFileId: respondingToFileId || undefined,
          deliverableType,
          createDeliverable,
          reviewerIds: createDeliverable && reviewerIds.length > 0 ? reviewerIds : undefined,
          signerName: signerName || undefined,
          idempotencyKey,
          excludeGrounding,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Drafting failed');
      setResult({ ...data, documentType: documentType.trim(), format, model });
      setRevisions([]);
      toast.success('Draft generated');
      // Surface it in "Recent drafts" so it stays re-downloadable after refresh.
      loadGenerations();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Drafting failed');
    } finally {
      setGenerating(false);
    }
  }

  // Iterative revision: export the current (possibly edited) DOCX, send it with
  // a natural-language instruction; the server re-drafts on top of it and
  // overwrites the same object, then we reload the preview from the fresh URL.
  async function refine(instruction: string) {
    const text = instruction.trim();
    if (text.length < 3 || !result?.generationId || refining) return;
    const blob = await superdocRef.current?.exportDocx();
    if (!blob) { toast.error('The editor is not ready yet.'); return; }
    setRefining(true);
    try {
      const fd = new FormData();
      fd.append('file', blob, result.fileName || 'draft.docx');
      fd.append('instruction', text);
      fd.append('format', result.format);
      fd.append('documentType', result.documentType);
      fd.append('model', result.model);
      const res = await fetch(`/api/drafting/generations/${result.generationId}/refine`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Revision failed');
      // New object → the preview effect reloads the revised DOCX from the URL.
      setResult((prev) => (prev ? { ...prev, downloadUrl: data.downloadUrl ?? prev.downloadUrl, truncated: data.truncated } : prev));
      setRevisions((prev) => [...prev, text]);
      setRefineInstruction('');
      toast.success('Draft revised');
      loadGenerations();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Revision failed');
    } finally {
      setRefining(false);
    }
  }

  const respondingToFile = respondingToFileId ? matterFiles.find((f) => f.id === respondingToFileId) ?? null : null;

  return (
    <>
    <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_320px]">
      {/* Left: form */}
      <div className="space-y-5">
        {/* Matter picker */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Matter</label>
          <SearchableSelect
            options={matters.map((m) => ({ id: m.id, label: m.name, sublabel: m.code, keywords: m.caseTitle }))}
            value={matterId || null}
            onChange={setMatterId}
            placeholder="Select a matter…"
            searchPlaceholder="Search matters…"
            limit={matters.length || 50}
          />
        </div>

        {/* Document type — free-form for pleadings/letters; fixed for status reports */}
        {format !== 'status_report' && (
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">What do you want to draft?</label>
            <input
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value)}
              placeholder="e.g. Motion for Reconsideration"
              maxLength={200}
              className="w-full px-3 py-2.5 rounded-xl border border-stone-200 dark:border-[rgba(255,255,255,0.1)] bg-card text-sm focus:outline-none focus:ring-2 focus:ring-gold-300"
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {COMMON_DOCS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDocumentType(d)}
                  className="text-[11px] px-2 py-1 rounded-full border border-stone-200 dark:border-[rgba(255,255,255,0.1)] text-stone-500 dark:text-stone-400 hover:border-gold-300 hover:text-gold-700 dark:hover:text-gold-300"
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Format — pleading (no letterhead) vs letter (firm letterhead) */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Format</label>
          <div className="flex items-center gap-1">
            {([['pleading', 'Pleading'], ['letter', 'Letter'], ['status_report', 'Status Report']] as const).map(([val, lbl]) => (
              <button
                key={val}
                type="button"
                onClick={() => setFormat(val)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                  format === val
                    ? 'border-gold-400 bg-gold-50 dark:bg-gold-400/10 text-gold-700 dark:text-gold-300'
                    : 'border-stone-200 dark:border-[rgba(255,255,255,0.1)] text-stone-500 dark:text-stone-400 hover:border-stone-300'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-1.5">
            {format === 'pleading'
              ? 'Court pleading — no letterhead, Book Antiqua, Efficient Use of Paper Rule, with numbered paragraphs and real footnotes.'
              : format === 'letter'
                ? 'Letter — firm letterhead, Adobe Garamond Pro.'
                : 'Client status report — aggregates activity on the matter since the last report and drafts the update letter on the firm letterhead.'}
          </p>
        </div>

        {/* Status report — optional "since" date (defaults to the last report) */}
        {format === 'status_report' && (
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Cover activity since <span className="text-stone-400 font-normal">(optional)</span>
            </label>
            <div className="max-w-xs">
              <DatePickerInput
                value={sinceDate}
                onChange={setSinceDate}
                placeholder="Since the last status report"
              />
            </div>
            <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-1.5">
              Leave blank to cover everything since the last report was sent (or the matter opened). The report folds in hearings, filings, and documents received in this window.
            </p>
          </div>
        )}

        {/* Model — standard vs top-tier for a hard brief */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Drafting model</label>
          <div className="flex items-center gap-1">
            {([['standard', 'Standard'], ['complex', 'Complex brief']] as const).map(([val, lbl]) => (
              <button
                key={val}
                type="button"
                onClick={() => setModel(val)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                  model === val
                    ? 'border-gold-400 bg-gold-50 dark:bg-gold-400/10 text-gold-700 dark:text-gold-300'
                    : 'border-stone-200 dark:border-[rgba(255,255,255,0.1)] text-stone-500 dark:text-stone-400 hover:border-stone-300 dark:hover:border-[rgba(255,255,255,0.25)]'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-1.5">
            {model === 'standard'
              ? 'Fast, high-quality drafting for everyday filings and letters.'
              : 'Slower, top-tier model — for complex briefs and dense argumentation.'}
          </p>
        </div>

        {/* Responding to — optional, for responsive pleadings */}
        {matterId && format !== 'status_report' && (
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Responding to <span className="text-stone-400 font-normal">(optional — for a responsive pleading)</span>
            </label>
            {filesLoading ? (
              <p className="text-xs text-stone-400 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading the matter&apos;s files…</p>
            ) : matterFiles.length === 0 ? (
              <p className="text-xs text-stone-400 dark:text-stone-500">No readable documents on this matter yet — upload and analyze the pleading you&apos;re responding to first.</p>
            ) : (
              <>
                <SearchableSelect
                  options={[
                    { id: '', label: '— None (not a response) —' },
                    ...matterFiles.map((f) => ({ id: f.id, label: f.name, sublabel: fmtFileDate(f.date) })),
                  ]}
                  value={respondingToFileId || null}
                  onChange={setRespondingToFileId}
                  placeholder="Select the document being responded to…"
                  searchPlaceholder="Search files…"
                  limit={matterFiles.length + 1}
                />
                <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-1.5">
                  The draft will read this filing and rebut it point by point.
                </p>
              </>
            )}
          </div>
        )}

        {/* Instructions */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
            Instructions <span className="text-stone-400 font-normal">(optional)</span>
          </label>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Anything specific — the relief sought, arguments to emphasize, tone…"
            maxLength={4000}
            className="w-full min-h-[90px] px-3 py-2.5 rounded-xl border border-stone-200 dark:border-[rgba(255,255,255,0.1)] bg-card text-sm resize-y focus:outline-none focus:ring-2 focus:ring-gold-300 dark:focus:ring-gold-500/40"
          />
        </div>

        {/* Deliverable options */}
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={createDeliverable} onChange={(e) => setCreateDeliverable(e.target.checked)} className="accent-gold-500" />
            Add to matter as a draft deliverable
          </label>
          {createDeliverable && format === 'status_report' && (
            <span className="text-[11px] px-2.5 py-1 rounded-full border border-gold-400 bg-gold-50 dark:bg-gold-400/10 text-gold-700 dark:text-gold-300">
              Status Report
            </span>
          )}
          {createDeliverable && format !== 'status_report' && (
            <div className="flex items-center gap-1">
              {(['External', 'Internal', 'For Client'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setDeliverableType(t)}
                  className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                    deliverableType === t
                      ? 'border-gold-400 bg-gold-50 dark:bg-gold-400/10 text-gold-700 dark:text-gold-300'
                      : 'border-stone-200 dark:border-[rgba(255,255,255,0.1)] text-stone-500 dark:text-stone-400 hover:border-stone-300 dark:hover:border-[rgba(255,255,255,0.25)]'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Reviewers — who the draft is routed to for review */}
        {createDeliverable && (
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Reviewers <span className="text-stone-400 font-normal">(optional — you can also assign later)</span>
            </label>
            {reviewerIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {reviewerIds.map((id) => {
                  const name = lawyers.find((l) => l.id === id)?.name ?? id;
                  return (
                    <span key={id} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-gold-50 dark:bg-gold-400/10 text-gold-700 dark:text-gold-300 border border-gold-200 dark:border-gold-400/20">
                      {name}
                      <button type="button" onClick={() => setReviewerIds((prev) => prev.filter((x) => x !== id))} className="hover:text-gold-900 dark:hover:text-gold-100">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <div className="max-w-sm">
              <SearchableSelect
                options={lawyers.filter((l) => l.id !== currentUserId && !reviewerIds.includes(l.id)).map((l) => ({ id: l.id, label: l.name }))}
                value={null}
                onChange={(id) => setReviewerIds((prev) => (prev.includes(id) ? prev : [...prev, id]))}
                placeholder="Add a reviewer…"
                searchPlaceholder="Search lawyers…"
              />
            </div>
          </div>
        )}

        <button
          onClick={generate}
          disabled={generating || !matterId || documentType.trim().length < 3}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-gold-500 hover:bg-gold-600 text-white disabled:opacity-50"
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <PenTool className="w-4 h-4" />}
          {generating ? 'Drafting…' : 'Generate draft'}
        </button>

        {/* Result */}
        {result && (
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-400/20 bg-emerald-50/40 dark:bg-emerald-400/5 p-5">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <p className="text-sm font-medium">Draft ready</p>
            </div>
            <p className="text-xs text-[var(--text-secondary)] mb-3">
              {result.fileName} — drafted in the firm&apos;s house style
              {result.grounding.hasBrief ? ', grounded in the matter brief' : ''}
              {result.grounding.ownWork.length > 0 ? `, ${result.grounding.ownWork.length} document(s) from this matter` : ''}
              {result.grounding.priorWork.length > 0 ? `, ${result.grounding.priorWork.length} exemplar(s) from other matters` : ''}
              {result.grounding.kbPages.length > 0 ? `, ${result.grounding.kbPages.length} knowledge page(s)` : ''}
              {(result.grounding.authorities?.length ?? 0) > 0 ? `, ${result.grounding.authorities.length} SC authorit${result.grounding.authorities.length === 1 ? 'y' : 'ies'} (verify before filing)` : ''}.
            </p>
            {result.truncated && (
              <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400 mb-3">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                This draft hit the length limit and may be cut off before the end (e.g. the prayer or signature block). Review the tail and regenerate if needed.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {result.downloadUrl && (
                <a
                  href={result.downloadUrl}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-navy-700 hover:bg-navy-800 dark:bg-gold-500 dark:hover:bg-gold-600 text-white"
                >
                  <Download className="w-4 h-4" /> Download .docx
                </a>
              )}
              {result.deliverableId && (
                <Link
                  href={`/dashboard/deliverables/${result.deliverableId}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-stone-200 dark:border-[rgba(255,255,255,0.1)] hover:bg-white/50 dark:hover:bg-white/5"
                >
                  <FileText className="w-4 h-4" /> Open deliverable
                </Link>
              )}
            </div>
            <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-3">
              An AI first draft — review and revise before filing.
            </p>
          </div>
        )}

        {/* Recent drafts — re-download past generations for this matter */}
        {matterId && recentDrafts.length > 0 && (
          <div className="rounded-xl border border-stone-200 dark:border-[rgba(255,255,255,0.1)] p-4">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400 mb-2">
              <History className="w-3.5 h-3.5" /> Recent drafts for this matter
            </h3>
            <ul className="divide-y divide-stone-100 dark:divide-[rgba(255,255,255,0.06)]">
              {recentDrafts.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm truncate">{g.fileName}</p>
                    <p className="text-[11px] text-stone-400">
                      {fmtDateTime(g.createdAt)}{g.generatedBy ? ` · ${g.generatedBy}` : ''}
                      {g.savedToMatter
                        ? <span className="ml-1 text-emerald-600 dark:text-emerald-400">· saved to matter</span>
                        : <span className="ml-1 text-amber-600 dark:text-amber-400">· download-only</span>}
                    </p>
                  </div>
                  <a
                    href={`/api/drafting/generations/${g.id}/download`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border border-stone-200 dark:border-[rgba(255,255,255,0.1)] hover:bg-white/50 dark:hover:bg-white/5 shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" /> Download
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Right: grounding panel */}
      <aside className="lg:border-l lg:border-stone-100 lg:dark:border-[rgba(255,255,255,0.06)] lg:pl-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400 flex items-center gap-1.5 mb-3">
          <Sparkles className="w-3.5 h-3.5" /> Grounded on
        </h2>

        {respondingToFile && (
          <div className="mb-4 rounded-lg border border-gold-200 dark:border-gold-400/20 bg-gold-50/40 dark:bg-gold-400/5 p-2.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-gold-700 dark:text-gold-300">
              <Reply className="w-3.5 h-3.5" /> Responding to
            </div>
            <p className="text-[11px] text-stone-600 dark:text-stone-300 mt-1 break-words">{respondingToFile.name}</p>
          </div>
        )}

        {!matterId || documentType.trim().length < 3 ? (
          <p className="text-xs text-stone-400 dark:text-stone-500">
            Pick a matter and a document type to see what the draft will draw on.
          </p>
        ) : groundingLoading ? (
          <p className="text-xs text-stone-400 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Gathering context…</p>
        ) : grounding ? (
          <div className="space-y-4">
            <p className="text-[11px] text-stone-400 dark:text-stone-500">Uncheck any source to leave it out of the draft.</p>
            <GroundItem
              icon={<Scale className="w-3.5 h-3.5" />}
              label="Matter brief"
              ok={grounding.hasBrief}
              empty="No brief yet for this matter"
            >
              {grounding.hasBrief && (
                <p className="text-[11px] text-stone-500 dark:text-stone-400 line-clamp-3">{grounding.briefPreview}…</p>
              )}
            </GroundItem>

            <GroundItem
              icon={<FolderOpen className="w-3.5 h-3.5" />}
              label={`This matter's record (${grounding.ownWork.length})`}
              ok={grounding.ownWork.length > 0}
              empty="No related documents found in this matter"
            >
              {grounding.ownWork.map((w, i) => {
                const key = w.title.toLowerCase();
                const excluded = excludedOwn.has(key);
                return (
                  <label key={i} className={`flex items-start gap-1.5 text-[11px] cursor-pointer ${excluded ? 'opacity-40 line-through' : 'text-stone-600 dark:text-stone-300'}`}>
                    <input type="checkbox" checked={!excluded} onChange={() => setExcludedOwn((p) => toggleInSet(p, key))} className="mt-0.5 accent-gold-500" />
                    <span className="truncate">{w.title}{w.origin ? <span className="text-stone-400"> ({w.origin})</span> : null}</span>
                  </label>
                );
              })}
            </GroundItem>

            <GroundItem
              icon={<Library className="w-3.5 h-3.5" />}
              label={`Firm knowledge (${grounding.kbPages.length})`}
              ok={grounding.kbPages.length > 0}
              empty="No matching knowledge pages"
            >
              {grounding.kbPages.map((p) => {
                const excluded = excludedKb.has(p.id);
                return (
                  <div key={p.id} className={`flex items-start gap-1.5 text-[11px] ${excluded ? 'opacity-40' : ''}`}>
                    <input type="checkbox" checked={!excluded} onChange={() => setExcludedKb((s) => toggleInSet(s, p.id))} className="mt-0.5 accent-gold-500 shrink-0" />
                    <Link href={`/dashboard/library/${p.id}`} className={`text-stone-600 dark:text-stone-300 hover:text-gold-600 dark:hover:text-gold-300 truncate ${excluded ? 'line-through' : ''}`}>
                      {p.title}
                    </Link>
                  </div>
                );
              })}
            </GroundItem>

            <GroundItem
              icon={<FileText className="w-3.5 h-3.5" />}
              label={`Exemplars from other matters (${grounding.priorWork.length})`}
              ok={grounding.priorWork.length > 0}
              empty="No similar filings in other matters"
            >
              {grounding.priorWork.map((w, i) => {
                const key = w.deliverableId ?? w.title;
                const excluded = excludedPrior.has(key);
                return (
                  <label key={i} className={`flex items-start gap-1.5 text-[11px] cursor-pointer ${excluded ? 'opacity-40 line-through' : 'text-stone-600 dark:text-stone-300'}`}>
                    <input type="checkbox" checked={!excluded} onChange={() => setExcludedPrior((p) => toggleInSet(p, key))} className="mt-0.5 accent-gold-500" />
                    <span className="truncate">{w.title} <span className="text-stone-400">{w.matterName}</span></span>
                  </label>
                );
              })}
            </GroundItem>

            {format !== 'status_report' && (
            <GroundItem
              icon={<Landmark className="w-3.5 h-3.5" />}
              label={`SC authorities — juris.ph (${grounding.authorities.length})`}
              ok={grounding.authorities.length > 0}
              empty="No on-point SC decisions found"
            >
              {grounding.authorities.map((a) => {
                const excluded = excludedAuth.has(a.caseNumber);
                return (
                  <div key={a.caseNumber} className={`flex items-start gap-1.5 text-[11px] ${excluded ? 'opacity-40' : ''}`}>
                    <input type="checkbox" checked={!excluded} onChange={() => setExcludedAuth((s) => toggleInSet(s, a.caseNumber))} className="mt-0.5 accent-gold-500 shrink-0" />
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`text-stone-600 dark:text-stone-300 hover:text-gold-600 dark:hover:text-gold-300 truncate ${excluded ? 'line-through' : ''}`}
                      title={a.title}
                    >
                      <span className="font-mono">{a.caseNumber}</span>
                      {a.date ? <span className="text-stone-400"> ({a.date})</span> : null}
                      {' '}{a.title}
                    </a>
                  </div>
                );
              })}
              {grounding.authorities.length > 0 && (
                <p className="text-[10px] text-stone-400 dark:text-stone-500 mt-1">
                  AI-matched from juris.ph — verify each cited case against the full decision before filing.
                </p>
              )}
            </GroundItem>
            )}
          </div>
        ) : null}
      </aside>
    </div>

    {/* Editable in-browser preview (SuperDoc) */}
    {result && (
      <div className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" /> Preview &amp; edit
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={downloadEdited}
              disabled={!previewBlob}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-stone-200 dark:border-[rgba(255,255,255,0.1)] hover:bg-white/50 dark:hover:bg-white/5 disabled:opacity-50"
            >
              <Download className="w-4 h-4" /> Download
            </button>
            <button
              onClick={saveEdits}
              disabled={!previewBlob || savingEdits || !result.generationId}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gold-500 hover:bg-gold-600 text-white disabled:opacity-50"
            >
              {savingEdits ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {savingEdits ? 'Saving…' : 'Save changes to matter'}
            </button>
          </div>
        </div>
        <p className="text-[11px] text-stone-500 dark:text-stone-400 mb-2">
          Edit inline, then Download your edits or Save them back to the matter. The footnotes, numbering, and page setup render here as they will in Word.
        </p>

        {/* Revise with AI — re-drafts on top of the current (edited) text.
            Not available for status reports (their layout is composed, not
            re-drafted through the pleading/letter path). */}
        {result.format !== 'status_report' && (
        <div className="mb-3 rounded-xl border border-stone-200 dark:border-[rgba(255,255,255,0.1)] p-3">
          <div className="flex items-center gap-1.5 text-xs font-medium mb-2">
            <Sparkles className="w-3.5 h-3.5 text-gold-600 dark:text-gold-300" /> Revise with AI
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {REVISE_CHIPS.map((c) => (
              <button
                key={c}
                type="button"
                disabled={refining || !previewBlob}
                onClick={() => refine(c)}
                className="text-[11px] px-2 py-1 rounded-full border border-stone-200 dark:border-[rgba(255,255,255,0.1)] text-stone-500 dark:text-stone-400 hover:border-gold-300 hover:text-gold-700 dark:hover:text-gold-300 disabled:opacity-50"
              >
                {c}
              </button>
            ))}
          </div>
          <div className="flex items-start gap-2">
            <textarea
              value={refineInstruction}
              onChange={(e) => setRefineInstruction(e.target.value)}
              placeholder="Describe a change — e.g. 'add an argument on lack of jurisdiction under Rule 65', 'cite the latest ruling on forum shopping'…"
              maxLength={4000}
              disabled={refining}
              className="flex-1 min-h-[46px] px-3 py-2 rounded-lg border border-stone-200 dark:border-[rgba(255,255,255,0.1)] bg-card text-sm resize-y focus:outline-none focus:ring-2 focus:ring-gold-300 disabled:opacity-50"
            />
            <button
              onClick={() => refine(refineInstruction)}
              disabled={refining || !previewBlob || refineInstruction.trim().length < 3}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-gold-500 hover:bg-gold-600 text-white disabled:opacity-50 shrink-0"
            >
              {refining ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {refining ? 'Revising…' : 'Revise'}
            </button>
          </div>
          <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-1.5">
            Applies your change on top of the current text (including your edits) and re-renders the whole draft.
          </p>
          {revisions.length > 0 && (
            <div className="mt-2 text-[11px] text-stone-500 dark:text-stone-400">
              <span className="font-medium">Revisions applied:</span>
              <ol className="list-decimal ml-4 mt-0.5 space-y-0.5">
                {revisions.map((r, i) => <li key={i}>{r}</li>)}
              </ol>
            </div>
          )}
        </div>
        )}

        {previewBlob ? (
          <SuperDocViewer
            ref={superdocRef}
            document={previewBlob}
            mode="editing"
            className="border border-stone-200 dark:border-[rgba(255,255,255,0.1)] rounded-xl overflow-hidden bg-white min-h-[600px]"
          />
        ) : (
          <p className="text-xs text-stone-400 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading preview…</p>
        )}
      </div>
    )}
    </>
  );
}

function fmtFileDate(d: string | null): string | null {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });
}

function fmtDateTime(d: string | null): string {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
}

function toggleInSet<T>(set: Set<T>, key: T): Set<T> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function GroundItem({
  icon, label, ok, empty, children,
}: {
  icon: React.ReactNode; label: string; ok: boolean; empty: string; children?: React.ReactNode;
}) {
  return (
    <div>
      <div className={`flex items-center gap-1.5 text-xs font-medium ${ok ? 'text-foreground' : 'text-stone-400 dark:text-stone-500'}`}>
        {icon} {label}
      </div>
      <div className="mt-1 pl-5 space-y-0.5">
        {ok ? children : <p className="text-[11px] text-stone-400 dark:text-stone-500">{empty}</p>}
      </div>
    </div>
  );
}
