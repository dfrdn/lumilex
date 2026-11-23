'use client';

import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import useSWR from 'swr';
import {
  Loader2,
  FileCheck,
  FileText,
  FileDown,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronRight,
  RefreshCw,
  Cloud,
  ExternalLink,
  Upload,
  X,
  Paperclip,
  Plus,
  Trash2,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import SuperDocViewer, { type SuperDocViewerHandle } from '@/components/SuperDocViewer';
import { uploadToSignedUrl } from '@/lib/upload';
import { annexLetter } from '@/lib/annexes';

// ── Types ─────────────────────────────────────────────────────────

interface Deliverable {
  notion_id: string;
  name: string;
  type: string | null;
  matter_name: string;
  client_name: string;
  drafter_ids: string[];
  reviewer_ids: string[];
  external_due_date: string | null;
  latest_file: string | null;
  latest_version: number | null;
}

interface Correction {
  original: string;
  corrected: string;
  reason: string;
}

type ModalStep = 'idle' | 'proofreading' | 'review' | 'finalizing' | 'done' | 'error';

// ── Annexes ───────────────────────────────────────────────────────

interface MatterFile {
  fileId: string;
  recordName: string;
  sourceName: string;
  path: string;
}

interface AnnexDraft {
  id: string;
  source: 'matter' | 'upload';
  label: string; // editable, without the "Annex X -" prefix or extension
  ext: string;
  sourcePath?: string; // source === 'matter'
  file?: File; // source === 'upload'
}

let annexIdCounter = 0;
function nextAnnexId(): string {
  annexIdCounter += 1;
  return `annex-${annexIdCounter}`;
}

function fileBaseAndExt(filename: string): { base: string; ext: string } {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return { base: filename, ext: '' };
  return { base: filename.slice(0, dot), ext: filename.slice(dot + 1) };
}

// Strip a leading "[Matter] " prefix so the default annex label reads cleanly.
function cleanAnnexLabel(base: string): string {
  return base.replace(/^\[[^\]]*\]\s*/, '').trim() || base.trim();
}

// ── Component ─────────────────────────────────────────────────────

export default function FinalizeDeliverables() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // SWR for deliverables list
  const { data: delData, isLoading: loading, mutate: mutateDeliverables } = useSWR<{ data: Deliverable[] }>(
    '/api/admin/deliverables?filter.status=Pre-finalized&includeStatusReports=1&pageSize=100',
  );
  const deliverables = delData?.data ?? [];

  // SWR for people (name resolution) — cached globally
  const { data: membersRaw } = useSWR<{ id: string; name: string }[]>('/api/members');
  const [people, setPeople] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!membersRaw) return;
    const arr = Array.isArray(membersRaw) ? membersRaw : [];
    const map: Record<string, string> = {};
    for (const m of arr) {
      if (m.id && m.name) map[m.id] = m.name;
    }
    setPeople(map);
  }, [membersRaw]);

  // Modal state
  const [selected, setSelected] = useState<Deliverable | null>(null);
  const [modalStep, setModalStep] = useState<ModalStep>('idle');
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [summary, setSummary] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [result, setResult] = useState<{
    cleanDocxUrl: string | null;
    signedPdfUrl: string | null;
    version: number;
    warnings: string[];
  } | null>(null);
  const [spStatus, setSpStatus] = useState<{
    checking: boolean;
    synced: boolean;
    docxUrl?: string;
    pdfUrl?: string;
  }>({ checking: false, synced: false });

  // SuperDoc state
  const [docxBlob, setDocxBlob] = useState<Blob | null>(null);
  const [docxReady, setDocxReady] = useState(false);
  const superdocRef = useRef<SuperDocViewerHandle>(null);

  // Manual finalize state
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTarget, setManualTarget] = useState<Deliverable | null>(null);
  const [manualDocx, setManualDocx] = useState<File | null>(null);
  const [manualPdf, setManualPdf] = useState<File | null>(null);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  // Annex state (shared by both the automated and manual flows — only one
  // finalize modal is open at a time).
  const [annexes, setAnnexes] = useState<AnnexDraft[]>([]);
  const [matterFiles, setMatterFiles] = useState<MatterFile[]>([]);
  const [matterFilesLoading, setMatterFilesLoading] = useState(false);

  async function loadMatterFiles(deliverableId: string) {
    setMatterFilesLoading(true);
    setMatterFiles([]);
    try {
      const res = await fetch(
        `/api/admin/finalize?action=matter-files&deliverableId=${encodeURIComponent(deliverableId)}`,
      );
      const json = await res.json();
      if (res.ok) setMatterFiles(json.files ?? []);
    } catch {
      // Best-effort — the upload path still works without the matter list.
    } finally {
      setMatterFilesLoading(false);
    }
  }

  // Upload any pending annex files via signed URLs, then return the normalized
  // annex payload (matter paths + uploaded temp paths) for the finalize call.
  async function prepareAnnexes(deliverableId: string) {
    const uploadDrafts = annexes.filter((a) => a.source === 'upload' && a.file);
    const uploadMap = new Map<string, string>();

    if (uploadDrafts.length > 0) {
      const prepRes = await fetch('/api/admin/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliverableId,
          step: 'annex-prepare',
          annexUploads: uploadDrafts.map((d) => ({ name: d.file!.name })),
        }),
      });
      const prep = await prepRes.json();
      if (!prepRes.ok) throw new Error(prep.error ?? 'Failed to prepare annex upload');
      const uploads = (prep.uploads ?? []) as { name: string; path: string; signedUrl: string }[];

      await Promise.all(
        uploadDrafts.map(async (d, idx) => {
          const u = uploads[idx];
          if (!u) throw new Error(`Annex upload preparation incomplete for ${d.file!.name}`);
          await uploadToSignedUrl(u.signedUrl, d.file!, {
            name: d.file!.name,
            size: d.file!.size,
            type: d.file!.type,
          });
          uploadMap.set(d.id, u.path);
        }),
      );
    }

    return annexes
      .map((a) => ({
        source: a.source,
        label: a.label,
        ext: a.ext,
        sourcePath: a.source === 'matter' ? a.sourcePath : undefined,
        uploadPath: a.source === 'upload' ? uploadMap.get(a.id) : undefined,
      }))
      .filter((a) => (a.source === 'matter' ? a.sourcePath : a.uploadPath));
  }

  // ── Finalization Flow ──────────────────────────────────────────

  async function startFinalize(d: Deliverable) {
    setSelected(d);
    setModalStep('proofreading');
    setCorrections([]);
    setSummary('');
    setErrorMessage('');
    setResult(null);
    setSpStatus({ checking: false, synced: false });
    setDocxBlob(null);
    setDocxReady(false);
    setAnnexes([]);
    loadMatterFiles(d.notion_id);

    try {
      const res = await fetch('/api/admin/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliverableId: d.notion_id, step: 'preview' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Preview failed');

      setCorrections(json.corrections ?? []);
      setSummary(json.summary ?? '');

      // Fetch cleaned DOCX blob for SuperDoc
      if (json.cleanedDocxUrl) {
        try {
          const docxRes = await fetch(json.cleanedDocxUrl);
          if (docxRes.ok) {
            const blob = await docxRes.blob();
            setDocxBlob(blob);
          }
        } catch {
          // SuperDoc preview is best-effort; finalize still works without it
        }
      }

      setModalStep('review');
    } catch (err: any) {
      setErrorMessage(err.message ?? 'Something went wrong');
      setModalStep('error');
    }
  }

  async function confirmFinalize() {
    if (!selected) return;
    setModalStep('finalizing');

    try {
      // Export the edited DOCX from SuperDoc and upload it via a signed URL.
      // Avoids pushing a multi-MB base64 body through the 4.5 MB serverless cap;
      // any failure here is non-fatal — the server re-cleans the original.
      let editedDocxPath: string | undefined;
      if (superdocRef.current) {
        try {
          const blob = await superdocRef.current.exportDocx();
          if (blob) {
            const prepRes = await fetch('/api/admin/finalize', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                deliverableId: selected.notion_id,
                step: 'edited-prepare',
              }),
            });
            const prep = await prepRes.json();
            if (prepRes.ok && prep.signedUrl) {
              const put = await fetch(prep.signedUrl, {
                method: 'PUT',
                headers: {
                  'Content-Type':
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                },
                body: blob,
              });
              if (put.ok) editedDocxPath = prep.path;
            }
          }
        } catch {
          // If export/upload fails, proceed without edited version.
        }
      }

      // Upload any pending annexes, then finalize with the annex payload.
      const annexPayload = await prepareAnnexes(selected.notion_id);

      const res = await fetch('/api/admin/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliverableId: selected.notion_id,
          step: 'confirm',
          ...(editedDocxPath ? { editedDocxPath } : {}),
          ...(annexPayload.length ? { annexes: annexPayload } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Finalization failed');

      setResult({
        cleanDocxUrl: json.cleanDocxUrl,
        signedPdfUrl: json.signedPdfUrl,
        version: json.version,
        warnings: json.warnings ?? [],
      });
      setModalStep('done');

      // Re-fetch list (removes the finalized deliverable)
      mutateDeliverables();

      // Check SharePoint sync status after a short delay (fire-and-forget on server)
      setSpStatus({ checking: true, synced: false });
      setTimeout(async () => {
        try {
          const spRes = await fetch(
            `/api/admin/sharepoint-sync?deliverableId=${selected.notion_id}`,
          );
          const spJson = await spRes.json();
          if (spJson.configured && spJson.synced) {
            const docxFile = spJson.files?.find((f: { fileName: string; sharePointUrl: string }) => f.fileName.endsWith('.docx'));
            const pdfFile = spJson.files?.find((f: { fileName: string; sharePointUrl: string }) => f.fileName.endsWith('.pdf'));
            setSpStatus({
              checking: false,
              synced: true,
              docxUrl: docxFile?.sharePointUrl,
              pdfUrl: pdfFile?.sharePointUrl,
            });
          } else if (!spJson.configured) {
            setSpStatus({ checking: false, synced: false });
          } else {
            setSpStatus({ checking: true, synced: false });
            // Retry once more after another delay
            setTimeout(async () => {
              try {
                const retry = await fetch(
                  `/api/admin/sharepoint-sync?deliverableId=${selected.notion_id}`,
                );
                const retryJson = await retry.json();
                if (retryJson.synced) {
                  const d2 = retryJson.files?.find((f: { fileName: string; sharePointUrl: string }) => f.fileName.endsWith('.docx'));
                  const p2 = retryJson.files?.find((f: { fileName: string; sharePointUrl: string }) => f.fileName.endsWith('.pdf'));
                  setSpStatus({ checking: false, synced: true, docxUrl: d2?.sharePointUrl, pdfUrl: p2?.sharePointUrl });
                } else {
                  setSpStatus({ checking: false, synced: false });
                }
              } catch {
                setSpStatus({ checking: false, synced: false });
              }
            }, 5000);
          }
        } catch {
          setSpStatus({ checking: false, synced: false });
        }
      }, 3000);
    } catch (err: any) {
      setErrorMessage(err.message ?? 'Something went wrong');
      setModalStep('error');
    }
  }

  function closeModal() {
    setSelected(null);
    setModalStep('idle');
    setDocxBlob(null);
    setDocxReady(false);
    setAnnexes([]);
  }

  // ── Manual finalize ───────────────────────────────────────────
  function openManual(d: Deliverable) {
    setManualTarget(d);
    setManualDocx(null);
    setManualPdf(null);
    setManualError(null);
    setAnnexes([]);
    loadMatterFiles(d.notion_id);
    setManualOpen(true);
  }

  function closeManual() {
    if (manualSubmitting) return;
    setManualOpen(false);
    setManualTarget(null);
    setManualDocx(null);
    setManualPdf(null);
    setManualError(null);
    setAnnexes([]);
  }

  async function submitManual() {
    if (!manualTarget) return;
    if (!manualDocx && !manualPdf) {
      setManualError('Please select at least one file (DOCX or PDF).');
      return;
    }
    setManualSubmitting(true);
    setManualError(null);

    try {
      const selected: { kind: 'docx' | 'pdf'; file: File }[] = [];
      if (manualDocx) selected.push({ kind: 'docx', file: manualDocx });
      if (manualPdf) selected.push({ kind: 'pdf', file: manualPdf });

      // Phase 1: mint signed upload URLs. Files go straight to Supabase Storage,
      // so we never push multi-MB base64 through the 4.5 MB serverless body cap.
      const prepRes = await fetch('/api/admin/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliverableId: manualTarget.notion_id,
          step: 'manual-prepare',
          manualFiles: selected.map((s) => ({ kind: s.kind, name: s.file.name })),
        }),
      });
      const prep = await prepRes.json();
      if (!prepRes.ok) throw new Error(prep.error ?? 'Failed to prepare upload');

      const uploads = prep.uploads as {
        kind: string;
        name: string;
        path: string;
        signedUrl: string;
      }[];

      // Phase 2: PUT each file directly to storage.
      await Promise.all(
        uploads.map(async (u) => {
          const match = selected.find((s) => s.kind === u.kind);
          if (!match) return;
          const put = await fetch(u.signedUrl, {
            method: 'PUT',
            headers: { 'Content-Type': match.file.type || 'application/octet-stream' },
            body: match.file,
          });
          if (!put.ok) throw new Error(`Upload failed for ${match.file.name} (${put.status})`);
        }),
      );

      // Phase 2b: upload any pending annexes via signed URLs.
      const annexPayload = await prepareAnnexes(manualTarget.notion_id);

      // Phase 3: record the finalized files + flip status to Outbox.
      const res = await fetch('/api/admin/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliverableId: manualTarget.notion_id,
          step: 'manual',
          manualVersion: prep.version,
          manualFiles: uploads.map((u) => ({
            kind: u.kind,
            name: u.name,
            path: u.path,
            size: selected.find((s) => s.kind === u.kind)?.file.size,
          })),
          ...(annexPayload.length ? { annexes: annexPayload } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Manual finalization failed');

      // Surface any annexes that couldn't be attached (e.g. a missing source
      // object) — the finalize itself still succeeded.
      const warnings = (json.warnings ?? []) as string[];
      if (warnings.length > 0) {
        toast.warning(warnings.join(' · '));
      } else if (json.annexCount > 0) {
        toast.success(
          `Finalized with ${json.annexCount} annex${json.annexCount === 1 ? '' : 'es'} attached.`,
        );
      }

      // Success — close manual modal, re-fetch list
      setManualOpen(false);
      setManualTarget(null);
      setManualDocx(null);
      setManualPdf(null);
      mutateDeliverables();
    } catch (err: unknown) {
      setManualError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setManualSubmitting(false);
    }
  }

  function resolveName(id: string | null): string {
    if (!id) return '\u2014';
    return people[id] ?? id.substring(0, 8);
  }

  // Per-deliverable download popover state
  interface VersionFile {
    fileUrl: string;
    fileName: string;
    fileSize: number | null;
  }
  const [downloadOpenFor, setDownloadOpenFor] = useState<string | null>(null);
  const [downloadLoadingId, setDownloadLoadingId] = useState<string | null>(null);
  const [versionFiles, setVersionFiles] = useState<VersionFile[]>([]);
  const [versionNumber, setVersionNumber] = useState<number | null>(null);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  const [popoverAnchor, setPopoverAnchor] = useState<{ top: number; right: number } | null>(null);

  async function openDownloadMenu(d: Deliverable, anchorEl?: HTMLElement) {
    // Toggle off if clicked twice
    if (downloadOpenFor === d.notion_id) {
      setDownloadOpenFor(null);
      setPopoverAnchor(null);
      return;
    }
    // Anchor the popover below the clicked button, using fixed positioning
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      setPopoverAnchor({
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
      });
    }
    setDownloadOpenFor(d.notion_id);
    setDownloadLoadingId(d.notion_id);
    setVersionFiles([]);
    setVersionNumber(null);
    setVersionError(null);

    try {
      const res = await fetch(
        `/api/admin/finalize?action=latest-version-files&deliverableId=${d.notion_id}`,
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to fetch files');
      setVersionFiles(json.files ?? []);
      setVersionNumber(json.version ?? null);
      if (!json.files || json.files.length === 0) {
        setVersionError('No files available for this deliverable.');
      }
    } catch (err: unknown) {
      setVersionError(err instanceof Error ? err.message : 'Failed to load files');
    } finally {
      setDownloadLoadingId(null);
    }
  }

  async function downloadVersionFile(file: VersionFile) {
    setDownloadingPath(file.fileUrl);
    try {
      const signRes = await fetch('/api/file-sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: [file.fileUrl] }),
      });
      const signJson = await signRes.json();
      const url = signJson.urls?.[file.fileUrl];
      if (!url) throw new Error('Failed to generate download URL');
      window.open(url, '_blank');
    } catch {
      // Silent fail
    } finally {
      setDownloadingPath(null);
    }
  }

  // Close popover on outside click / Escape / scroll / resize
  useEffect(() => {
    if (!downloadOpenFor) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setDownloadOpenFor(null);
        setPopoverAnchor(null);
      }
    }
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-download-popover]')) {
        setDownloadOpenFor(null);
        setPopoverAnchor(null);
      }
    }
    function handleReposition() {
      setDownloadOpenFor(null);
      setPopoverAnchor(null);
    }
    window.addEventListener('keydown', handleKey);
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('scroll', handleReposition, true);
    window.addEventListener('resize', handleReposition);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('scroll', handleReposition, true);
      window.removeEventListener('resize', handleReposition);
    };
  }, [downloadOpenFor]);

  // ── Render ─────────────────────────────────────────────────────

  if (!mounted || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  if (deliverables.length === 0) {
    return (
      <div className="text-center py-20">
        <FileCheck className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-3 opacity-40" />
        <p className="text-sm text-[var(--text-muted)]">
          No pre-finalized deliverables
        </p>
        <button
          onClick={() => { mutateDeliverables(); }}
          className="mt-3 inline-flex items-center gap-1.5 text-xs text-gold-600 hover:text-gold-700 cursor-pointer dark:text-gold-400 dark:hover:text-gold-300"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>
    );
  }

  // Modal width: wide for review (SuperDoc + corrections), narrow for other steps
  const isWideModal = modalStep === 'review';

  return (
    <div>
      {/* Count */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-[var(--text-secondary)]">
          <span className="font-semibold text-foreground tabular-nums">
            {deliverables.length}
          </span>{' '}
          Pre-finalized Deliverables
        </p>
        <button
          onClick={() => { mutateDeliverables(); }}
          className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-foreground cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-[var(--border-color)] bg-card shadow-[var(--shadow-card)]">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="sticky top-0 bg-background z-10 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border-color)]">
                Deliverable
              </th>
              <th className="sticky top-0 bg-background z-10 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border-color)]">
                Matter / Client
              </th>
              <th className="sticky top-0 bg-background z-10 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border-color)]">
                Drafter
              </th>
              <th className="sticky top-0 bg-background z-10 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border-color)]">
                Deadline
              </th>
              <th className="sticky top-0 bg-background z-10 px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border-color)] w-32">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {deliverables.map((d) => (
              <tr
                key={d.notion_id}
                className="group hover:bg-[var(--subtle-bg)] transition-colors duration-100"
              >
                <td className="px-3 py-2.5 border-b border-[var(--border-color)]">
                  <div className="flex items-center gap-2 max-w-xs">
                    <p className="text-sm font-medium text-foreground truncate">
                      {d.name}
                    </p>
                    {d.type === 'Status Report' && (
                      <span className="shrink-0 rounded-full bg-pink-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pink-700 dark:bg-pink-500/15 dark:text-pink-300">
                        Status Report
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5 border-b border-[var(--border-color)]">
                  <p className="text-sm text-foreground truncate max-w-xs">
                    {d.matter_name}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">{d.client_name}</p>
                </td>
                <td className="px-3 py-2.5 border-b border-[var(--border-color)]">
                  <p className="text-sm text-foreground">
                    {d.drafter_ids?.map(resolveName).join(', ') || '\u2014'}
                  </p>
                </td>
                <td className="px-3 py-2.5 border-b border-[var(--border-color)]">
                  <p className="text-sm text-foreground">
                    {d.external_due_date
                      ? new Date(d.external_due_date + 'T00:00:00').toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : '\u2014'}
                  </p>
                </td>
                <td className="px-3 py-2.5 border-b border-[var(--border-color)] text-right">
                  <div className="inline-flex items-center gap-1.5">
                    <button
                      data-download-popover
                      onClick={(e) => openDownloadMenu(d, e.currentTarget)}
                      disabled={downloadLoadingId === d.notion_id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-foreground hover:border-gold-300 hover:bg-gold-50/50 dark:hover:bg-gold-500/5 transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Download files from latest version"
                    >
                      {downloadLoadingId === d.notion_id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <FileDown className="w-3.5 h-3.5" />
                      )}
                      Download
                      <ChevronRight
                        className={`w-3 h-3 transition-transform duration-150 ${
                          downloadOpenFor === d.notion_id ? 'rotate-90' : ''
                        }`}
                      />
                    </button>
                    <button
                      onClick={() => openManual(d)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-foreground hover:border-gold-300 hover:bg-gold-50/50 dark:hover:bg-gold-500/5 transition-colors duration-150 cursor-pointer"
                      title="Upload pre-finalized files and mark as Outbox"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Manual
                    </button>
                    <button
                      onClick={() => startFinalize(d)}
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-lg bg-gold-500 hover:bg-gold-600 text-white transition-colors duration-150 cursor-pointer shadow-sm"
                    >
                      <FileCheck className="w-3.5 h-3.5" />
                      Finalize
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Modal ────────────────────────────────────────────────── */}
      {selected && modalStep !== 'idle' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm"
            onClick={modalStep === 'done' || modalStep === 'error' ? closeModal : undefined}
          />

          <div className={`relative bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl shadow-xl mx-4 p-6 transition-all duration-200 ${
            isWideModal
              ? 'w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col'
              : 'w-full max-w-lg max-h-[80vh] overflow-y-auto'
          }`}>
            {/* ── Proofreading ──────────────────────────── */}
            {modalStep === 'proofreading' && (
              <div className="text-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-gold-500 mx-auto mb-4 dark:text-gold-400" />
                <h2 className="font-serif text-lg font-semibold text-foreground mb-1">
                  Proofreading
                </h2>
                <p className="text-sm text-[var(--text-muted)]">
                  Cleaning document and checking for errors...
                </p>
              </div>
            )}

            {/* ── Review: SuperDoc + Corrections Side-by-Side ──── */}
            {modalStep === 'review' && (
              <>
                {/* Header */}
                <div className="flex items-center justify-between mb-4 shrink-0">
                  <div>
                    <h2 className="font-serif text-lg font-semibold text-foreground">
                      Review &amp; Finalize
                    </h2>
                    <p className="text-sm text-[var(--text-muted)]">
                      {selected.name}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={closeModal}
                      className="px-4 py-2 text-sm font-medium rounded-xl border border-[var(--border-color)] text-[var(--text-secondary)] bg-background hover:bg-[var(--subtle-bg)] transition-colors duration-150 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={confirmFinalize}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-gold-500 hover:bg-gold-600 text-white transition-colors duration-150 cursor-pointer shadow-sm"
                    >
                      <FileCheck className="w-3.5 h-3.5" />
                      Confirm Finalize
                    </button>
                  </div>
                </div>

                {/* Side-by-side: Document Editor + Corrections Panel */}
                <div className="flex gap-4 flex-1 min-h-0 overflow-hidden">
                  {/* Left: SuperDoc Editor */}
                  <div className="flex-[3] min-w-0 border border-[var(--border-color)] rounded-xl overflow-hidden bg-white dark:bg-stone-900">
                    {docxBlob ? (
                      <div className="h-[calc(90vh-10rem)] overflow-auto">
                        <SuperDocViewer
                          ref={superdocRef}
                          document={docxBlob}
                          mode="editing"
                          onReady={() => setDocxReady(true)}
                          className="h-full"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-64 text-[var(--text-muted)]">
                        <div className="text-center">
                          <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
                          <p className="text-sm">Document preview not available</p>
                          <p className="text-xs mt-1">Finalization will still work normally</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right: Corrections Panel */}
                  <div className="flex-[1] min-w-[280px] max-w-[360px] flex flex-col overflow-hidden">
                    {/* Summary */}
                    <div className="flex items-start gap-2 mb-3 p-3 rounded-lg bg-[var(--subtle-bg)] border border-[var(--border-color)] shrink-0">
                      {corrections.length === 0 ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0 dark:text-emerald-400" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                      )}
                      <p className="text-sm text-foreground">{summary}</p>
                    </div>

                    {/* Corrections list */}
                    {corrections.length > 0 ? (
                      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">
                          AI Corrections ({corrections.length})
                        </p>
                        {corrections.map((c, i) => (
                          <div
                            key={i}
                            className="p-3 rounded-lg border border-[var(--border-color)] bg-background"
                          >
                            <div className="flex items-center gap-2 text-sm">
                              <span className="text-red-500 line-through dark:text-red-400">{c.original}</span>
                              <ChevronRight className="w-3 h-3 text-[var(--text-muted)] shrink-0" />
                              <span className="text-emerald-600 font-medium dark:text-emerald-400">{c.corrected}</span>
                            </div>
                            <p className="text-xs text-[var(--text-muted)] mt-1">{c.reason}</p>
                          </div>
                        ))}
                        <p className="text-xs text-[var(--text-muted)] mt-2 pb-2">
                          Review corrections above and edit the document directly if needed. The AI will not auto-modify the document.
                        </p>
                      </div>
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-center p-4">
                        <div>
                          <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 dark:text-emerald-400" />
                          <p className="text-sm text-foreground font-medium">No corrections needed</p>
                          <p className="text-xs text-[var(--text-muted)] mt-1">
                            Document looks clean. You can still make edits before finalizing.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Annexes */}
                    <div className="shrink-0 mt-3 pt-3 border-t border-[var(--border-color)] overflow-y-auto max-h-[38vh]">
                      <AnnexSection
                        annexes={annexes}
                        setAnnexes={setAnnexes}
                        matterFiles={matterFiles}
                        matterFilesLoading={matterFilesLoading}
                      />
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ── Finalizing ───────────────────────────── */}
            {modalStep === 'finalizing' && (
              <div className="text-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-gold-500 mx-auto mb-4 dark:text-gold-400" />
                <h2 className="font-serif text-lg font-semibold text-foreground mb-1">
                  Finalizing
                </h2>
                <p className="text-sm text-[var(--text-muted)]">
                  Inserting signatures, generating PDF, syncing to SharePoint...
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-2">
                  This may take up to a minute.
                </p>
              </div>
            )}

            {/* ── Done ─────────────────────────────────── */}
            {modalStep === 'done' && result && (
              <div>
                <div className="text-center mb-6">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3 dark:text-emerald-400" />
                  <h2 className="font-serif text-lg font-semibold text-foreground mb-1">
                    Finalized
                  </h2>
                  <p className="text-sm text-[var(--text-muted)]">
                    Version {result.version} generated successfully
                  </p>
                </div>

                {/* Warnings */}
                {result.warnings.length > 0 && (
                  <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                    {result.warnings.map((w, i) => (
                      <p key={i} className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                        {w}
                      </p>
                    ))}
                  </div>
                )}

                {/* Download links */}
                <div className="space-y-2 mb-6">
                  {result.cleanDocxUrl && (
                    <a
                      href={result.cleanDocxUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--subtle-bg)] transition-colors duration-150"
                    >
                      <FileText className="w-5 h-5 text-blue-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">Clean DOCX</p>
                        <p className="text-xs text-[var(--text-muted)]">No tracked changes, no signatures</p>
                      </div>
                      <FileDown className="w-4 h-4 text-[var(--text-muted)]" />
                    </a>
                  )}
                  {result.signedPdfUrl && (
                    <a
                      href={result.signedPdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 rounded-lg border border-[var(--border-color)] hover:bg-[var(--subtle-bg)] transition-colors duration-150"
                    >
                      <FileText className="w-5 h-5 text-red-500 shrink-0 dark:text-red-400" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">Signed PDF</p>
                        <p className="text-xs text-[var(--text-muted)]">With e-signatures</p>
                      </div>
                      <FileDown className="w-4 h-4 text-[var(--text-muted)]" />
                    </a>
                  )}
                </div>

                {/* SharePoint status */}
                {spStatus.checking && (
                  <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-[var(--subtle-bg)] border border-[var(--border-color)]">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-500 shrink-0" />
                    <p className="text-xs text-[var(--text-muted)]">
                      Syncing to SharePoint...
                    </p>
                  </div>
                )}
                {spStatus.synced && (
                  <div className="mb-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                    <div className="flex items-center gap-2 mb-2">
                      <Cloud className="w-4 h-4 text-blue-500 shrink-0" />
                      <p className="text-xs font-medium text-blue-700 dark:text-blue-400">
                        Synced to SharePoint
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {spStatus.docxUrl && (
                        <a
                          href={spStatus.docxUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Open DOCX in SharePoint
                        </a>
                      )}
                      {spStatus.pdfUrl && (
                        <a
                          href={spStatus.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Open PDF in SharePoint
                        </a>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-4 py-2 text-sm font-medium rounded-xl bg-gold-500 hover:bg-gold-600 text-white transition-colors duration-150 cursor-pointer shadow-sm"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}

            {/* ── Error ────────────────────────────────── */}
            {modalStep === 'error' && (
              <div>
                <div className="text-center mb-4">
                  <XCircle className="w-10 h-10 text-red-500 mx-auto mb-3 dark:text-red-400" />
                  <h2 className="font-serif text-lg font-semibold text-foreground mb-1">
                    Error
                  </h2>
                  <p className="text-sm text-red-500 dark:text-red-400">{errorMessage}</p>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-4 py-2 text-sm font-medium rounded-xl border border-[var(--border-color)] text-[var(--text-secondary)] bg-background hover:bg-[var(--subtle-bg)] transition-colors duration-150 cursor-pointer"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => startFinalize(selected)}
                    className="px-4 py-2 text-sm font-medium rounded-xl bg-gold-500 hover:bg-gold-600 text-white transition-colors duration-150 cursor-pointer shadow-sm"
                  >
                    Retry
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Download dropdown (portal so it can overflow the table) ── */}
      {typeof document !== 'undefined' && downloadOpenFor && popoverAnchor &&
        createPortal(
          <div
            data-download-popover
            className="fixed w-72 max-h-80 overflow-y-auto bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl shadow-[var(--shadow-elevated)] animate-fade-in"
            style={{
              top: popoverAnchor.top,
              right: popoverAnchor.right,
              zIndex: 60,
            }}
          >
            <div className="px-3 py-2 border-b border-[var(--border-color)] flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Latest Version
                {versionNumber !== null && (
                  <span className="ml-1 text-foreground">v{versionNumber}</span>
                )}
              </span>
              <span className="text-[10px] text-[var(--text-muted)]">
                {versionFiles.length} file{versionFiles.length === 1 ? '' : 's'}
              </span>
            </div>

            {downloadLoadingId === downloadOpenFor ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-4 h-4 animate-spin text-[var(--text-muted)]" />
              </div>
            ) : versionError ? (
              <div className="px-3 py-4 text-xs text-[var(--text-muted)] text-center">
                {versionError}
              </div>
            ) : (
              <ul className="py-1">
                {versionFiles.map((f) => {
                  const ext = f.fileName.split('.').pop()?.toLowerCase() ?? '';
                  const isDocx = ext === 'docx' || ext === 'doc';
                  const isPdf = ext === 'pdf';
                  const isLoading = downloadingPath === f.fileUrl;
                  return (
                    <li key={f.fileUrl}>
                      <button
                        type="button"
                        onClick={() => downloadVersionFile(f)}
                        disabled={isLoading}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--subtle-bg)] transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <FileText
                          className={`w-4 h-4 shrink-0 ${
                            isDocx
                              ? 'text-blue-500'
                              : isPdf
                                ? 'text-red-500 dark:text-red-400'
                                : 'text-[var(--text-muted)]'
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">
                            {f.fileName}
                          </p>
                          {f.fileSize !== null && (
                            <p className="text-[10px] text-[var(--text-muted)]">
                              {(f.fileSize / 1024).toFixed(1)} KB
                            </p>
                          )}
                        </div>
                        {isLoading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-muted)] shrink-0" />
                        ) : (
                          <FileDown className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>,
          document.body,
        )}

      {/* ── Manual Finalize Modal ────────────────────────────────── */}
      {manualOpen && manualTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm"
            onClick={closeManual}
          />
          <div className="relative bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl shadow-xl mx-4 p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto animate-fade-in">
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <div className="min-w-0 pr-4">
                <h2 className="font-serif text-lg font-semibold text-foreground">
                  Finalize Manually
                </h2>
                <p className="text-sm text-[var(--text-muted)] truncate">
                  {manualTarget.name}
                </p>
              </div>
              <button
                type="button"
                onClick={closeManual}
                disabled={manualSubmitting}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Info banner */}
            <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/15 border border-amber-200/60 dark:border-amber-800/40">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                <div className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                  Upload already-finalized files prepared outside the system. This
                  skips AI proofread, cleanup, e-signature insertion, and PDF
                  conversion. The deliverable will be moved directly to Outbox.
                </div>
              </div>
            </div>

            {/* File inputs */}
            <div className="space-y-3 mb-4">
              <ManualFileInput
                label="Final DOCX"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                file={manualDocx}
                onFile={setManualDocx}
                disabled={manualSubmitting}
                hint="Clean document with no tracked changes"
              />
              <ManualFileInput
                label="Signed PDF"
                accept=".pdf,application/pdf"
                file={manualPdf}
                onFile={setManualPdf}
                disabled={manualSubmitting}
                hint="PDF with e-signatures already inserted"
              />
              <p className="text-[11px] text-[var(--text-muted)]">
                At least one file is required. Both are recommended for completeness.
              </p>
            </div>

            {/* Annexes */}
            <div className="mb-4 pt-4 border-t border-[var(--border-color)]">
              <AnnexSection
                annexes={annexes}
                setAnnexes={setAnnexes}
                matterFiles={matterFiles}
                matterFilesLoading={matterFilesLoading}
                disabled={manualSubmitting}
              />
            </div>

            {/* Error */}
            {manualError && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5">
                  <XCircle className="w-3.5 h-3.5 shrink-0" />
                  {manualError}
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeManual}
                disabled={manualSubmitting}
                className="px-4 py-2 text-sm font-medium rounded-xl border border-[var(--border-color)] text-[var(--text-secondary)] bg-background hover:bg-[var(--subtle-bg)] transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitManual}
                disabled={manualSubmitting || (!manualDocx && !manualPdf)}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-gold-500 hover:bg-gold-600 text-white transition-colors duration-150 cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {manualSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <FileCheck className="w-3.5 h-3.5" />
                    Finalize &amp; Move to Outbox
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Manual file input sub-component ───────────────────────────────
function ManualFileInput({
  label,
  accept,
  file,
  onFile,
  disabled,
  hint,
}: {
  label: string;
  accept: string;
  file: File | null;
  onFile: (f: File | null) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
        {label}
      </label>
      {file ? (
        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-[var(--border-color)] bg-[var(--subtle-bg)]">
          <FileText className="w-4 h-4 text-gold-500 shrink-0 dark:text-gold-400" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
            <p className="text-[11px] text-[var(--text-muted)]">
              {(file.size / 1024).toFixed(1)} KB
            </p>
          </div>
          <button
            type="button"
            onClick={() => onFile(null)}
            disabled={disabled}
            className="p-1 rounded-md text-[var(--text-muted)] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed dark:hover:text-red-400"
            title="Remove file"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-[var(--border-color)] text-[var(--text-muted)] hover:text-foreground hover:border-gold-300 hover:bg-gold-50/30 dark:hover:bg-gold-500/5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Upload className="w-4 h-4" />
          <span className="text-sm">
            Choose {label} {hint && <span className="text-[11px] opacity-70">· {hint}</span>}
          </span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}

// ── Annex section ─────────────────────────────────────────────────
// Attach supplementary files to the finalized deliverable, either picked from
// the matter's existing files or uploaded. Each becomes "Annex A - <label>",
// lettered by display order. Shared by the automated + manual finalize modals.
function AnnexSection({
  annexes,
  setAnnexes,
  matterFiles,
  matterFilesLoading,
  disabled,
}: {
  annexes: AnnexDraft[];
  setAnnexes: Dispatch<SetStateAction<AnnexDraft[]>>;
  matterFiles: MatterFile[];
  matterFilesLoading: boolean;
  disabled?: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const uploadRef = useRef<HTMLInputElement>(null);

  const usedPaths = new Set(
    annexes.filter((a) => a.source === 'matter' && a.sourcePath).map((a) => a.sourcePath),
  );

  function addMatterFile(mf: MatterFile) {
    const { base, ext } = fileBaseAndExt(mf.sourceName);
    setAnnexes((prev) => [
      ...prev,
      { id: nextAnnexId(), source: 'matter', label: cleanAnnexLabel(base), ext, sourcePath: mf.path },
    ]);
  }

  function addUploads(files: FileList | null) {
    if (!files) return;
    const next: AnnexDraft[] = Array.from(files).map((file) => {
      const { base, ext } = fileBaseAndExt(file.name);
      return { id: nextAnnexId(), source: 'upload' as const, label: cleanAnnexLabel(base), ext, file };
    });
    if (next.length > 0) setAnnexes((prev) => [...prev, ...next]);
  }

  function removeAnnex(id: string) {
    setAnnexes((prev) => prev.filter((a) => a.id !== id));
  }

  function updateLabel(id: string, label: string) {
    setAnnexes((prev) => prev.map((a) => (a.id === id ? { ...a, label } : a)));
  }

  const q = filter.trim().toLowerCase();
  const filtered = q
    ? matterFiles.filter((m) => `${m.recordName} ${m.sourceName}`.toLowerCase().includes(q))
    : matterFiles;

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Paperclip className="w-3.5 h-3.5 text-[var(--text-muted)]" />
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Annexes
        </span>
        <span className="text-[11px] text-[var(--text-muted)] normal-case font-normal">
          (optional)
        </span>
      </div>

      {/* Current annexes */}
      {annexes.length > 0 && (
        <ul className="space-y-1.5 mb-2">
          {annexes.map((a, i) => (
            <li
              key={a.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--subtle-bg)]"
            >
              <span className="shrink-0 rounded-md bg-gold-100 px-1.5 py-0.5 text-[10px] font-semibold text-gold-700 dark:bg-gold-500/15 dark:text-gold-300">
                Annex {annexLetter(i)}
              </span>
              {a.source === 'matter' ? (
                <FileText className="w-3.5 h-3.5 shrink-0 text-blue-500" />
              ) : (
                <Upload className="w-3.5 h-3.5 shrink-0 text-emerald-500 dark:text-emerald-400" />
              )}
              <input
                value={a.label}
                onChange={(e) => updateLabel(a.id, e.target.value)}
                disabled={disabled}
                className="flex-1 min-w-0 bg-transparent text-sm text-foreground outline-none border-b border-transparent focus:border-gold-300 disabled:opacity-50"
                placeholder="Annex label"
              />
              {a.ext && (
                <span className="shrink-0 text-[11px] text-[var(--text-muted)]">.{a.ext}</span>
              )}
              <button
                type="button"
                onClick={() => removeAnnex(a.id)}
                disabled={disabled}
                className="shrink-0 p-1 rounded-md text-[var(--text-muted)] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 dark:hover:text-red-400 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                title="Remove annex"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add controls */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setPickerOpen((o) => !o)}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-foreground hover:border-gold-300 hover:bg-gold-50/40 dark:hover:bg-gold-500/5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" />
          Add from matter files
        </button>
        <button
          type="button"
          onClick={() => uploadRef.current?.click()}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-dashed border-[var(--border-color)] text-[var(--text-secondary)] hover:text-foreground hover:border-gold-300 hover:bg-gold-50/40 dark:hover:bg-gold-500/5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Upload className="w-3.5 h-3.5" />
          Upload
        </button>
        <input
          ref={uploadRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            addUploads(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {/* Matter file picker */}
      {pickerOpen && (
        <div className="mt-2 rounded-lg border border-[var(--border-color)] bg-background overflow-hidden">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-[var(--border-color)]">
            <Search className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search matter files…"
              className="flex-1 min-w-0 bg-transparent text-sm text-foreground outline-none placeholder:text-[var(--text-muted)]"
            />
          </div>
          <ul className="max-h-44 overflow-y-auto py-1">
            {matterFilesLoading ? (
              <li className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin text-[var(--text-muted)]" />
              </li>
            ) : filtered.length === 0 ? (
              <li className="px-3 py-3 text-xs text-[var(--text-muted)] text-center">
                {matterFiles.length === 0 ? 'No files on this matter' : 'No matches'}
              </li>
            ) : (
              filtered.map((m) => {
                const already = usedPaths.has(m.path);
                return (
                  <li key={m.fileId}>
                    <button
                      type="button"
                      onClick={() => addMatterFile(m)}
                      disabled={already}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--subtle-bg)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <FileText className="w-3.5 h-3.5 shrink-0 text-blue-500" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{m.recordName}</p>
                        <p className="text-[10px] text-[var(--text-muted)] truncate">{m.sourceName}</p>
                      </div>
                      {already ? (
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500 dark:text-emerald-400" />
                      ) : (
                        <Plus className="w-3.5 h-3.5 shrink-0 text-[var(--text-muted)]" />
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
