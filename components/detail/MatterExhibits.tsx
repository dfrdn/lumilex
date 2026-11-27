'use client';

import { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import useSWR from 'swr';
import {
  ScrollText,
  Plus,
  Pencil,
  Trash2,
  FileText,
  Loader2,
  FileDown,
  ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import DatePickerInput from '@/components/DatePickerInput';
import FilePreviewModal from '@/components/FilePreviewModal';
import type { FileAttachment } from '@/types/notion';
import { confirmAction } from '@/components/ui/confirm';

type OfferedBy =
  | 'plaintiff'
  | 'defendant'
  | 'prosecution'
  | 'accused'
  | 'petitioner'
  | 'respondent'
  | 'complainant'
  | 'other';

type Status = 'marked' | 'offered' | 'admitted' | 'denied' | 'withdrawn';

interface FileUrlEntry {
  name?: string;
  url?: string;
  path?: string;
}

interface ExhibitRow {
  id: string;
  matter_id: string;
  label: string;
  offered_by: OfferedBy;
  party_label: string;
  parent_exhibit_id: string | null;
  title: string;
  description: string;
  document_date: string | null;
  purpose: string;
  file_id: string | null;
  status: Status;
  marked_at: string | null;
  offered_at: string | null;
  ruling_date: string | null;
  ruling_note: string;
  sort_order: number;
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  file?: {
    notion_id: string;
    name: string;
    file_urls: FileUrlEntry[];
  } | null;
}

interface MatterFileLite {
  id: string;
  name: string;
}

interface Props {
  matterId: string;
  matterFiles: MatterFileLite[];
  canEdit: boolean;
  isClientPortal?: boolean;
}

const OFFERED_BY_OPTIONS: { value: OfferedBy; label: string }[] = [
  { value: 'plaintiff', label: 'Plaintiff' },
  { value: 'defendant', label: 'Defendant' },
  { value: 'prosecution', label: 'Prosecution' },
  { value: 'accused', label: 'Accused' },
  { value: 'petitioner', label: 'Petitioner' },
  { value: 'respondent', label: 'Respondent' },
  { value: 'complainant', label: 'Complainant' },
  { value: 'other', label: 'Other' },
];

const STATUS_OPTIONS: { value: Status; label: string; tone: string }[] = [
  { value: 'marked', label: 'Marked', tone: 'bg-stone-100 text-stone-700 ring-stone-200 dark:bg-stone-500/10 dark:text-stone-300 dark:ring-stone-500/20' },
  { value: 'offered', label: 'Offered', tone: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/20' },
  { value: 'admitted', label: 'Admitted', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20' },
  { value: 'denied', label: 'Denied', tone: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-500/20' },
  { value: 'withdrawn', label: 'Withdrawn', tone: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20' },
];

function statusOption(s: Status) {
  return STATUS_OPTIONS.find((o) => o.value === s) ?? STATUS_OPTIONS[0];
}

function offeredByLabel(value: OfferedBy, partyLabel: string): string {
  if (value === 'other' && partyLabel.trim()) return partyLabel.trim();
  return OFFERED_BY_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

// Sort exhibit labels in court-natural order: A, B, ..., Z, AA, ...
// or 1, 2, 3, with sub-markings like A-1 immediately after A.
function compareLabels(a: string, b: string): number {
  const parse = (s: string) => {
    const [main, sub] = s.split(/-/, 2);
    return { main, sub: sub ?? '' };
  };
  const pa = parse(a);
  const pb = parse(b);
  const numA = /^\d+$/.test(pa.main);
  const numB = /^\d+$/.test(pb.main);
  let cmp = 0;
  if (numA && numB) cmp = parseInt(pa.main, 10) - parseInt(pb.main, 10);
  else if (numA) cmp = 1;
  else if (numB) cmp = -1;
  else cmp = pa.main.localeCompare(pb.main, undefined, { sensitivity: 'base' });
  if (cmp !== 0) return cmp;
  return pa.sub.localeCompare(pb.sub, undefined, { sensitivity: 'base', numeric: true });
}

function formatDocDate(d: string | null): string {
  if (!d) return '';
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

// ── Component ────────────────────────────────────────────────────

export default function MatterExhibits({
  matterId,
  matterFiles,
  canEdit,
  isClientPortal = false,
}: Props) {
  const apiBase = isClientPortal
    ? `/api/portal/matters/${encodeURIComponent(matterId)}/exhibits`
    : `/api/matters/${encodeURIComponent(matterId)}/exhibits`;
  const { data, mutate, isLoading } = useSWR<{ exhibits: ExhibitRow[] }>(apiBase);
  const exhibits = useMemo(() => data?.exhibits ?? [], [data]);

  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<ExhibitRow | null>(null);
  const [foeBusy, setFoeBusy] = useState<OfferedBy | null>(null);
  const [previewFiles, setPreviewFiles] = useState<FileAttachment[] | null>(null);
  const [expanded, setExpanded] = useState(true);

  const grouped = useMemo(() => {
    const byParty = new Map<string, ExhibitRow[]>();
    for (const e of exhibits) {
      const key = `${e.offered_by}::${e.party_label}`;
      const arr = byParty.get(key) ?? [];
      arr.push(e);
      byParty.set(key, arr);
    }
    for (const arr of byParty.values()) {
      arr.sort((a, b) => {
        if (a.parent_exhibit_id === b.parent_exhibit_id) return compareLabels(a.label, b.label);
        if (!a.parent_exhibit_id) return -1;
        if (!b.parent_exhibit_id) return 1;
        return 0;
      });
    }
    return Array.from(byParty.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [exhibits]);

  async function deleteExhibit(id: string, label: string) {
    if (!(await confirmAction({ title: `Delete Exhibit "${label}"?`, confirmLabel: 'Delete', danger: true }))) return;
    const remaining = { exhibits: exhibits.filter((e) => e.id !== id && e.parent_exhibit_id !== id) };
    try {
      await mutate(
        async () => {
          const res = await fetch(`${apiBase}/${id}`, { method: 'DELETE' });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Delete failed');
          }
          return remaining;
        },
        { optimisticData: remaining, rollbackOnError: true, revalidate: true },
      );
      toast.success(`Deleted Exhibit "${label}".`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function updateStatus(ex: ExhibitRow, status: Status) {
    const next = { exhibits: exhibits.map((e) => (e.id === ex.id ? { ...e, status } : e)) };
    try {
      await mutate(
        async () => {
          const res = await fetch(`${apiBase}/${ex.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Update failed');
          }
          return next;
        },
        { optimisticData: next, rollbackOnError: true, revalidate: false },
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    }
  }

  async function generateFOE(offeredBy: OfferedBy, partyLabel: string) {
    setFoeBusy(offeredBy);
    try {
      const res = await fetch(
        `/api/matters/${encodeURIComponent(matterId)}/exhibits/formal-offer`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offeredBy, partyLabel }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'FOE generation failed');
      }
      const json: { downloadUrl?: string } = await res.json();
      toast.success(`Formal Offer draft ready for ${offeredByLabel(offeredBy, partyLabel)}.`);
      if (json.downloadUrl) window.open(json.downloadUrl, '_blank');
      mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'FOE generation failed');
    } finally {
      setFoeBusy(null);
    }
  }

  return (
    <>
      <div
        id="section-exhibits"
        className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden transition-all duration-200 hover:shadow-[var(--shadow-card-hover)] hover:border-[var(--border-hover)] animate-fade-up mt-6"
      >
        {/* Header — clickable toggle */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)] cursor-pointer select-none hover:bg-card-hover transition-colors duration-150"
          onClick={() => setExpanded((o) => !o)}
        >
          <div className="flex items-center gap-2.5">
            <ScrollText className="w-4 h-4 text-[var(--text-muted)]" />
            <h2 className="text-[15px] font-semibold text-foreground">Exhibits</h2>
            <span className="font-mono text-[11px] font-medium text-gold-400 bg-gold-50 dark:bg-[rgba(185, 143, 69,0.12)] rounded-full px-2.5 py-0.5 tabular-nums tracking-wide">
              {exhibits.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowCreate(true);
                }}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-white bg-navy-600 hover:bg-navy-700 rounded-lg px-3 py-1.5 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add exhibit
              </button>
            )}
            <ChevronDown className={`w-4 h-4 text-[var(--text-muted)] transition-transform duration-250 ease-out ${expanded ? 'rotate-0' : '-rotate-90'}`} />
          </div>
        </div>

        {/* Collapsible body */}
        <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
          <div className="overflow-hidden">
            <div className="p-6">
              {isLoading ? (
                <div className="flex items-center justify-center py-6 text-[var(--text-muted)]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
              ) : grouped.length === 0 ? (
                <p className="text-sm text-[var(--text-secondary)] text-center">
                  No exhibits yet.{' '}
                  {canEdit && (
                    <>
                      Click <span className="font-medium">Add exhibit</span> to mark the
                      first piece of documentary evidence.
                    </>
                  )}
                </p>
              ) : (
                <div className="space-y-6">
                  {grouped.map(([key, rows]) => {
                    const [offeredBy, partyLabel] = key.split('::') as [OfferedBy, string];
                    const partyDisplay = offeredByLabel(offeredBy, partyLabel);
                    return (
                      <div key={key}>
                        <div className="flex items-center justify-between mb-2.5">
                          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                            {partyDisplay}&apos;s Exhibits
                            <span className="ml-2 text-[var(--text-muted)] font-normal normal-case tracking-normal">
                              {rows.length}
                            </span>
                          </h3>
                          {canEdit && !isClientPortal && (
                            <button
                              type="button"
                              onClick={() => generateFOE(offeredBy, partyLabel)}
                              disabled={foeBusy === offeredBy}
                              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-navy-700 dark:text-navy-300 hover:bg-navy-50 dark:hover:bg-navy-500/10 rounded-md px-2 py-1 transition-colors disabled:opacity-60"
                            >
                              {foeBusy === offeredBy ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <FileDown className="w-3 h-3" />
                              )}
                              {foeBusy === offeredBy ? 'Generating…' : 'Generate Formal Offer'}
                            </button>
                          )}
                        </div>
                        <ul className="divide-y divide-[var(--border-color)] border border-[var(--border-color)] rounded-lg overflow-hidden">
                          {rows.map((row) => (
                            <ExhibitRowItem
                              key={row.id}
                              row={row}
                              canEdit={canEdit}
                              onEdit={() => setEditing(row)}
                              onDelete={() => deleteExhibit(row.id, row.label)}
                              onStatusChange={(s) => updateStatus(row, s)}
                              onPreviewFile={(files) => setPreviewFiles(files)}
                            />
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showCreate && (
        <ExhibitModal
          matterId={matterId}
          matterFiles={matterFiles}
          existing={null}
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            mutate();
          }}
          apiBase={apiBase}
        />
      )}
      {editing && (
        <ExhibitModal
          matterId={matterId}
          matterFiles={matterFiles}
          existing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            mutate();
          }}
          apiBase={apiBase}
        />
      )}
      <FilePreviewModal
        open={!!previewFiles}
        onClose={() => setPreviewFiles(null)}
        files={previewFiles ?? []}
      />
    </>
  );
}

// ── Row ──────────────────────────────────────────────────────────

function ExhibitRowItem({
  row,
  canEdit,
  onEdit,
  onDelete,
  onStatusChange,
  onPreviewFile,
}: {
  row: ExhibitRow;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onStatusChange: (status: Status) => void;
  onPreviewFile: (files: FileAttachment[]) => void;
}) {
  const [statusOpen, setStatusOpen] = useState(false);
  const statusBtnRef = useRef<HTMLButtonElement>(null);
  const status = statusOption(row.status);
  const fileAttachments: FileAttachment[] = (row.file?.file_urls ?? [])
    .filter((u) => u.path || u.url)
    .map((u) => ({
      name: u.name || row.file?.name || 'file',
      url: u.url ?? '',
      path: u.path,
    }));

  return (
    <li className="px-4 py-3 hover:bg-subtle/40 transition-colors">
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5">
          <span className="inline-flex items-center justify-center min-w-[3rem] px-2 py-1 rounded-md bg-navy-50 dark:bg-navy-500/10 text-navy-700 dark:text-navy-300 text-[11px] font-bold font-mono">
            Exh.&nbsp;{`"${row.label}"`}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                {row.title || <span className="italic text-[var(--text-muted)]">Untitled</span>}
              </p>
              {(row.description || row.purpose) && (
                <p className="text-xs text-[var(--text-secondary)] mt-0.5 line-clamp-2">
                  {row.purpose ? <><span className="italic">Offered:</span> {row.purpose}</> : row.description}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-[var(--text-muted)]">
                {row.document_date && <span>Doc dated {formatDocDate(row.document_date)}</span>}
                {row.file && fileAttachments.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onPreviewFile(fileAttachments)}
                    className="inline-flex items-center gap-1 text-navy-600 dark:text-navy-400 hover:underline cursor-pointer"
                  >
                    <FileText className="w-3 h-3" />
                    {row.file.name}
                  </button>
                )}
                {row.ruling_date && row.ruling_note && (
                  <span title={row.ruling_note}>Ruling {formatDocDate(row.ruling_date)}</span>
                )}
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-1.5">
              <button
                ref={statusBtnRef}
                type="button"
                onClick={() => canEdit && setStatusOpen((v) => !v)}
                disabled={!canEdit}
                className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider rounded-full px-2.5 py-1 ring-1 ring-inset ${status.tone} ${canEdit ? 'cursor-pointer' : 'cursor-default'}`}
              >
                {status.label}
                {canEdit && <ChevronDown className="w-2.5 h-2.5 opacity-60" />}
              </button>
              <PortalMenu
                anchorRef={statusBtnRef}
                open={statusOpen && canEdit}
                onClose={() => setStatusOpen(false)}
                align="right"
              >
                {STATUS_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => {
                      setStatusOpen(false);
                      if (o.value !== row.status) onStatusChange(o.value);
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-subtle/60 flex items-center justify-between"
                  >
                    <span className="text-[var(--text-primary)]">{o.label}</span>
                    {o.value === row.status && (
                      <span className="w-1.5 h-1.5 rounded-full bg-navy-600 dark:bg-navy-400" />
                    )}
                  </button>
                ))}
              </PortalMenu>
              {canEdit && (
                <>
                  <button
                    type="button"
                    onClick={onEdit}
                    className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-subtle transition-colors"
                    aria-label="Edit"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={onDelete}
                    className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-red-600 dark:hover:text-red-400 hover:bg-subtle transition-colors"
                    aria-label="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

// ── Modal ────────────────────────────────────────────────────────

function ExhibitModal({
  matterFiles,
  existing,
  onClose,
  onSaved,
  apiBase,
}: {
  matterId: string;
  matterFiles: MatterFileLite[];
  existing: ExhibitRow | null;
  onClose: () => void;
  onSaved: () => void;
  apiBase: string;
}) {
  const [label, setLabel] = useState(existing?.label ?? '');
  const [offeredBy, setOfferedBy] = useState<OfferedBy>(existing?.offered_by ?? 'plaintiff');
  const [partyLabel, setPartyLabel] = useState(existing?.party_label ?? '');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [documentDate, setDocumentDate] = useState<string>(existing?.document_date ?? '');
  const [purpose, setPurpose] = useState(existing?.purpose ?? '');
  const [fileId, setFileId] = useState<string>(existing?.file_id ?? '');
  const [status, setStatus] = useState<Status>(existing?.status ?? 'marked');
  const [rulingDate, setRulingDate] = useState<string>(existing?.ruling_date ?? '');
  const [rulingNote, setRulingNote] = useState(existing?.ruling_note ?? '');
  const [submitting, setSubmitting] = useState(false);

  async function handleSave() {
    if (!label.trim()) {
      toast.error('Label is required (e.g., "A", "1", "A-1").');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        label: label.trim(),
        offeredBy,
        partyLabel: offeredBy === 'other' ? partyLabel.trim() : '',
        title: title.trim(),
        description: description.trim(),
        documentDate: documentDate || null,
        purpose: purpose.trim(),
        fileId: fileId || null,
        status,
        rulingDate: rulingDate || null,
        rulingNote: rulingNote.trim(),
      };
      const url = existing ? `${apiBase}/${existing.id}` : apiBase;
      const method = existing ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Save failed');
      }
      toast.success(existing ? `Updated Exhibit "${label}".` : `Added Exhibit "${label}".`);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="w-full max-w-2xl bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl shadow-[var(--shadow-elevated)] max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)] sticky top-0 bg-[var(--card-bg)]">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {existing ? `Edit Exhibit "${existing.label}"` : 'Add exhibit'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-subtle transition-colors disabled:opacity-50"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Offered by">
              <CustomDropdown
                value={offeredBy}
                options={OFFERED_BY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                onChange={(v) => setOfferedBy(v as OfferedBy)}
                disabled={submitting}
              />
            </Field>
            <Field label='Label (e.g. "A", "A-1", "1")'>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="A"
                disabled={submitting}
                className="w-full text-sm text-[var(--text-primary)] bg-card border border-[var(--border-color)] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gold-500/30 focus:border-gold-500/50 transition-colors font-mono"
                maxLength={32}
              />
            </Field>
          </div>

          {offeredBy === 'other' && (
            <Field label="Party name">
              <input
                type="text"
                value={partyLabel}
                onChange={(e) => setPartyLabel(e.target.value)}
                placeholder='e.g. "Intervenor"'
                disabled={submitting}
                className="w-full text-sm text-[var(--text-primary)] bg-card border border-[var(--border-color)] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gold-500/30 focus:border-gold-500/50 transition-colors"
                maxLength={120}
              />
            </Field>
          )}

          <Field label="Title">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder='e.g. "Affidavit of Juan Dela Cruz dated 5 May 2026"'
              disabled={submitting}
              className="w-full text-sm text-[var(--text-primary)] bg-card border border-[var(--border-color)] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gold-500/30 focus:border-gold-500/50 transition-colors"
              maxLength={500}
            />
          </Field>

          <Field label="Description (optional)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Nature of the document, source, distinguishing details"
              disabled={submitting}
              className="w-full text-sm text-[var(--text-primary)] bg-card border border-[var(--border-color)] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gold-500/30 focus:border-gold-500/50 transition-colors resize-none"
              maxLength={4000}
            />
          </Field>

          <Field label='Purpose (e.g. "To prove that…")'>
            <textarea
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              rows={3}
              placeholder="Offered to prove…"
              disabled={submitting}
              className="w-full text-sm text-[var(--text-primary)] bg-card border border-[var(--border-color)] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gold-500/30 focus:border-gold-500/50 transition-colors resize-none"
              maxLength={4000}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Document date">
              <DatePickerInput
                variant="token"
                value={documentDate || null}
                onChange={(v) => setDocumentDate(v ?? '')}
                placeholder="Date on document"
              />
            </Field>
            <Field label="Status">
              <CustomDropdown
                value={status}
                options={STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
                onChange={(v) => setStatus(v as Status)}
                disabled={submitting}
              />
            </Field>
          </div>

          <Field label="Linked file">
            <FilePicker
              matterFiles={matterFiles}
              value={fileId}
              onChange={setFileId}
              disabled={submitting}
            />
          </Field>

          {(status === 'admitted' || status === 'denied') && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Ruling date">
                <DatePickerInput
                  variant="token"
                  value={rulingDate || null}
                  onChange={(v) => setRulingDate(v ?? '')}
                  placeholder="Date court ruled"
                />
              </Field>
              <Field label="Ruling note">
                <input
                  type="text"
                  value={rulingNote}
                  onChange={(e) => setRulingNote(e.target.value)}
                  placeholder="Order details / objection sustained"
                  disabled={submitting}
                  className="w-full text-sm text-[var(--text-primary)] bg-card border border-[var(--border-color)] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gold-500/30 focus:border-gold-500/50 transition-colors"
                  maxLength={2000}
                />
              </Field>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border-color)] sticky bottom-0 bg-[var(--card-bg)]">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={submitting || !label.trim()}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-navy-600 hover:bg-navy-700 disabled:bg-navy-600/50 disabled:cursor-not-allowed px-4 py-1.5 rounded-lg transition-colors"
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {submitting ? 'Saving…' : existing ? 'Save changes' : 'Add exhibit'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Local helpers ────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Menu rendered through a portal at <body> so it escapes parent containers'
 * overflow / scroll / transform contexts. Positioned with `position: fixed`
 * relative to the anchor element's bounding rect.
 */
function PortalMenu({
  anchorRef,
  open,
  onClose,
  children,
  align = 'stretch',
  maxHeight = 256,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  align?: 'stretch' | 'right';
  maxHeight?: number;
}) {
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const minWidth = align === 'right' ? 144 : rect.width;
      const width = Math.max(minWidth, rect.width);
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow >= maxHeight + 12 || spaceBelow >= rect.top
        ? rect.bottom + 4
        : Math.max(8, rect.top - maxHeight - 4);
      const left = align === 'right' ? rect.right - width : rect.left;
      setPos({ top, left, width });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, anchorRef, align, maxHeight]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !pos || typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <div
        style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, maxHeight }}
        className="z-[70] overflow-y-auto bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg shadow-[var(--shadow-elevated)] py-1"
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

function FilePicker({
  matterFiles,
  value,
  onChange,
  disabled,
}: {
  matterFiles: MatterFileLite[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const selected = matterFiles.find((f) => f.id === value);
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className="w-full flex items-center justify-between text-left text-sm text-[var(--text-primary)] bg-card border border-[var(--border-color)] rounded-lg px-3 py-2 hover:bg-subtle/40 transition-colors"
      >
        <span className={selected ? '' : 'text-[var(--text-muted)]'}>
          {selected?.name ?? '— No file attached —'}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)]" />
      </button>
      <PortalMenu anchorRef={buttonRef} open={open} onClose={() => setOpen(false)}>
        <button
          type="button"
          onClick={() => {
            onChange('');
            setOpen(false);
          }}
          className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-muted)] italic hover:bg-subtle/60"
        >
          No file attached
        </button>
        {matterFiles.length === 0 ? (
          <p className="px-3 py-3 text-xs text-[var(--text-muted)] italic">
            No files on this matter yet. Upload from the Files section above.
          </p>
        ) : (
          matterFiles.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                onChange(f.id);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-subtle/60 flex items-center justify-between"
            >
              <span className="truncate text-[var(--text-primary)]">{f.name}</span>
              {f.id === value && (
                <span className="w-1.5 h-1.5 rounded-full bg-navy-600 dark:bg-navy-400 ml-2" />
              )}
            </button>
          ))
        )}
      </PortalMenu>
    </>
  );
}

function CustomDropdown({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className="w-full flex items-center justify-between text-left text-sm text-[var(--text-primary)] bg-card border border-[var(--border-color)] rounded-lg px-3 py-2 hover:bg-subtle/40 transition-colors disabled:opacity-60"
      >
        <span>{current?.label ?? value}</span>
        <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)]" />
      </button>
      <PortalMenu anchorRef={buttonRef} open={open} onClose={() => setOpen(false)}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => {
              onChange(o.value);
              setOpen(false);
            }}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-subtle/60 flex items-center justify-between"
          >
            <span className="text-[var(--text-primary)]">{o.label}</span>
            {o.value === value && (
              <span className="w-1.5 h-1.5 rounded-full bg-navy-600 dark:bg-navy-400" />
            )}
          </button>
        ))}
      </PortalMenu>
    </>
  );
}
