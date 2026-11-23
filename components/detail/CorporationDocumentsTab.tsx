'use client';

import { useState, useRef } from 'react';
import { Upload, Trash2, Eye, Download, Paperclip, AlertCircle, CheckCircle2, Sparkles, X, Search, Users } from 'lucide-react';
import { useFileViewer } from '@/hooks/use-file-viewer';
import MarkRegisteredModal, { type RegistrationPrefill } from '@/components/detail/MarkRegisteredModal';
import ExtractedFieldsModal from '@/components/detail/ExtractedFieldsModal';
import { uploadCorporationFile } from '@/lib/corporations/upload-file';
import { useFileDrop } from '@/hooks/use-file-drop';
import { EXTRACTABLE_CATEGORIES, type DocumentExtraction } from '@/lib/ai/corporation-doc-extract-shape';
import type {
  Corporation,
  CorporationFile,
  CorporationFileCategory,
  CorporationPerson,
} from '@/types/corporations';
import { confirmAction } from '@/components/ui/confirm';

interface Props {
  corporation: Corporation;
  files: CorporationFile[];
  onFilesChange: React.Dispatch<React.SetStateAction<CorporationFile[]>>;
  onCorporationChange: (c: Corporation) => void;
  people: CorporationPerson[];
}

/** What the server made of a freshly uploaded registration document. */
interface CorRegistration {
  result: 'applied' | 'needs_review' | 'unreadable';
  reason?: string;
  extraction?: DocumentExtraction;
  corporation?: Corporation;
}

// Display groups. Each group renders a section with its own upload control.
const GROUPS: { title: string; categories: CorporationFileCategory[] }[] = [
  {
    title: 'SEC Filing Package',
    categories: ['AOI', 'By-Laws', 'Treasurer Affidavit', 'Name Verification Slip', 'Inward Remittance Cert', 'SEC Filing Receipt', 'SEC COR'],
  },
  {
    title: 'BIR',
    categories: ['BIR COR', 'BIR Books', 'Authority to Print'],
  },
  {
    title: 'Business Permits & LGU',
    categories: ['Business Permit', 'Barangay Clearance', 'Sanitary Permit', 'Fire Safety Inspection'],
  },
  {
    title: 'Employer Registrations',
    categories: ['SSS R-1', 'PhilHealth ER1', 'Pag-IBIG EFR'],
  },
  {
    title: 'Capital & Shares',
    categories: ['Stock Certificate', 'Deed of Assignment'],
  },
  {
    title: 'Reportorial',
    categories: ['GIS', 'AFS'],
  },
  {
    title: 'Governance',
    categories: ['Beneficial Ownership Declaration'],
  },
  {
    title: 'Misc.',
    categories: ['Other'],
  },
];

export default function CorporationDocumentsTab({ corporation, files, onFilesChange, onCorporationChange, people }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileViewer = useFileViewer();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'category' | 'all'>('category');
  const [corRegistration, setCorRegistration] = useState<CorRegistration | null>(null);
  const [reviewPrefill, setReviewPrefill] = useState<RegistrationPrefill | null>(null);
  const [fieldReview, setFieldReview] = useState<{ extraction: DocumentExtraction; reason?: string } | null>(null);

  // Split corp-level vs person-attached files.
  const corpFiles = files.filter((f) => f.personId == null);
  const personFiles = files.filter((f) => f.personId != null);

  const filesByCategory = new Map<string, CorporationFile[]>();
  for (const f of corpFiles) {
    const list = filesByCategory.get(f.category) ?? [];
    list.push(f);
    filesByCategory.set(f.category, list);
  }

  const peopleById = new Map(people.map((p) => [p.id, p]));
  const personFilesByPersonId = new Map<number, CorporationFile[]>();
  for (const f of personFiles) {
    if (f.personId == null) continue;
    const list = personFilesByPersonId.get(f.personId) ?? [];
    list.push(f);
    personFilesByPersonId.set(f.personId, list);
  }

  // Every file, newest first — the company's own and each person's — for the
  // "All files" view and for search.
  const ownerOf = (f: CorporationFile) => {
    if (f.personId == null) return null;
    const p = peopleById.get(f.personId);
    return p ? (p.isJuridical ? p.entityName ?? '' : `${p.firstName} ${p.lastName}`.trim()) || null : null;
  };
  const q = query.trim().toLowerCase();
  const flat = [...files]
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
    .map((file) => ({ file, owner: ownerOf(file) }))
    .filter(({ file, owner }) => !q || `${file.name} ${file.category} ${owner ?? ''} ${file.filingYear ?? ''}`.toLowerCase().includes(q));

  function clearError(key: string) {
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function upload(category: CorporationFileCategory, file: File, personId?: number) {
    setBusy(personId ? `person-${personId}` : category);
    clearError(category);
    try {
      const data = await uploadCorporationFile(corporation.id, category, file, personId);
      onFilesChange((prev) => [data.file, ...prev]);

      const registration = data.registration as CorRegistration | undefined;
      if (registration) {
        setCorRegistration(registration);
        if (registration.result === 'applied' && registration.corporation) {
          onCorporationChange(registration.corporation);
        }
      }
    } catch (e) {
      setErrors((prev) => ({
        ...prev,
        [category]: e instanceof Error ? e.message : 'Upload failed',
      }));
    } finally {
      setBusy(null);
    }
  }

  async function uploadMany(category: CorporationFileCategory, list: File[]) {
    for (const f of list) await upload(category, f);
  }

  async function remove(fileId: number) {
    if (!(await confirmAction({ title: 'Delete this file?', message: 'It is removed from the company’s documents.', confirmLabel: 'Delete', danger: true }))) return;
    setBusy(`del-${fileId}`);
    clearError(`del-${fileId}`);
    const removed = files.find((f) => f.id === fileId);
    onFilesChange((prev) => prev.filter((f) => f.id !== fileId));
    const res = await fetch(`/api/corporation/${corporation.id}/files/${fileId}`, { method: 'DELETE' }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      if (removed) onFilesChange((prev) => (prev.some((f) => f.id === fileId) ? prev : [removed, ...prev]));
      const data = await res?.json().catch(() => ({}));
      setErrors((prev) => ({ ...prev, [`del-${fileId}`]: data?.error || 'Delete failed' }));
    }
  }

  async function toggleShare(f: CorporationFile) {
    const next = !f.clientVisible;
    const flip = (v: boolean) => onFilesChange((prev) => prev.map((x) => (x.id === f.id ? { ...x, clientVisible: v } : x)));
    flip(next);
    const res = await fetch(`/api/corporation/${corporation.id}/files/${f.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientVisible: next }),
    }).catch(() => null);
    if (!res?.ok) {
      flip(!next);
      const data = await res?.json().catch(() => ({}));
      setErrors((prev) => ({ ...prev, [`del-${f.id}`]: data?.error || 'Could not change sharing' }));
    }
  }

  const preview = (f: CorporationFile) => fileViewer.preview(f.name, f.storagePath);
  const download = (f: CorporationFile) => fileViewer.download(f.name, f.storagePath);

  return (
    <div className="space-y-4">
      {corRegistration && (
        <CorRegistrationBanner
          registration={corRegistration}
          onDismiss={() => setCorRegistration(null)}
          onReview={() => {
            const ex = corRegistration.extraction;
            if (!ex) return;
            // A SEC COR review goes through the registration dialog, since
            // confirming it fires the whole approval chain. The other
            // documents just write their own fields.
            if (ex.category === 'SEC COR') {
              setReviewPrefill({
                approvedName: ex.fields.approvedName ?? '',
                secRegistrationNo: ex.fields.secRegistrationNo ?? '',
                secRegistrationDate: ex.fields.secRegistrationDate ?? '',
              });
            } else {
              setFieldReview({ extraction: ex, reason: corRegistration.reason });
            }
            setCorRegistration(null);
          }}
        />
      )}

      <MarkRegisteredModal
        open={reviewPrefill !== null}
        corporation={corporation}
        prefill={reviewPrefill ?? undefined}
        onClose={() => setReviewPrefill(null)}
        onUpdated={onCorporationChange}
      />

      {fieldReview && (
        <ExtractedFieldsModal
          open
          corporation={corporation}
          extraction={fieldReview.extraction}
          reason={fieldReview.reason}
          onClose={() => setFieldReview(null)}
          onUpdated={onCorporationChange}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files, categories or people…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-stone-200 dark:border-white/10 bg-white dark:bg-card text-stone-800 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-navy-200 dark:focus:ring-navy-500/30"
          />
        </label>
        <div className="inline-flex p-1 rounded-xl bg-stone-100 dark:bg-white/[0.06] gap-1">
          {(['category', 'all'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                view === v && !query
                  ? 'bg-white dark:bg-card text-stone-900 dark:text-stone-50 shadow-sm'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'
              }`}
            >
              {v === 'category' ? 'By category' : `All files · ${files.length}`}
            </button>
          ))}
        </div>
      </div>

      {(view === 'all' || query.trim()) && (
        <section className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-2xl p-5">
          {flat.length === 0 ? (
            <p className="text-sm text-stone-500 dark:text-stone-400">{query.trim() ? `No files match “${query.trim()}”.` : 'No files yet.'}</p>
          ) : (
            <ul className="space-y-1.5">
              {flat.map(({ file: f, owner }) => (
                <li key={f.id}>
                  <div className="flex items-center gap-2 mb-0.5 text-[10px] text-stone-500 dark:text-stone-400">
                    <span className="px-1.5 py-px rounded bg-navy-50 text-navy-700 dark:bg-navy-500/15 dark:text-navy-200">{f.category}</span>
                    {owner && <span>{owner}</span>}
                    {f.filingYear && <span>· {f.filingYear}</span>}
                  </div>
                  <ul>
                    <FileRow
                      file={f}
                      onPreview={() => preview(f)}
                      onDownload={() => download(f)}
                      onRemove={() => remove(f.id)}
                      onToggleShare={() => toggleShare(f)}
                      removing={busy === `del-${f.id}`}
                      error={errors[`del-${f.id}`]}
                    />
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {view === 'category' && !query.trim() && GROUPS.map((g) => (
        <section key={g.title} className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-3">{g.title}</h3>
          <ul className="divide-y divide-stone-100 dark:divide-white/10">
            {g.categories.map((cat) => (
              <CategoryRow
                key={cat}
                category={cat}
                rows={filesByCategory.get(cat) ?? []}
                busy={busy === cat}
                error={errors[cat]}
                onDropFiles={(list) => void uploadMany(cat, list)}
                onPick={(file) => void upload(cat, file)}
                onPreview={preview}
                onDownload={download}
                onRemove={remove}
                onToggleShare={toggleShare}
                removingId={busy}
                rowErrors={errors}
              />
            ))}
          </ul>
        </section>
      ))}

      {/* Person-attached files (e.g. IDs of incorporators) */}
      {view === 'category' && !query.trim() && personFilesByPersonId.size > 0 && (
        <section className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-3">Person-Attached Files</h3>
          <ul className="divide-y divide-stone-100 dark:divide-white/10">
            {Array.from(personFilesByPersonId.entries()).map(([pid, rows]) => {
              const p = peopleById.get(pid);
              return (
                <li key={pid} className="py-3">
                  <div className="text-sm font-medium text-stone-700 dark:text-stone-200">
                    {p ? `${p.firstName} ${p.lastName}`.trim() : `Person #${pid}`}
                    {p && <span className="ml-2 text-xs text-stone-400 dark:text-stone-500">— {p.role}</span>}
                  </div>
                  <ul className="mt-1.5 space-y-1">
                    {rows.map((f) => (
                      <FileRow
                        key={f.id}
                        file={f}
                        onPreview={() => preview(f)}
                        onDownload={() => download(f)}
                        onRemove={() => remove(f.id)}
                        removing={busy === `del-${f.id}`}
                        error={errors[`del-${f.id}`]}
                      />
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">Person-attached files are uploaded from the Intake or People tab (e.g. ID copies on each incorporator).</p>
        </section>
      )}

      {fileViewer.viewer}
    </div>
  );
}

function FileRow({ file, onPreview, onDownload, onRemove, onToggleShare, removing, error }: {
  file: CorporationFile;
  onPreview: () => void;
  onDownload: () => void;
  onRemove: () => void;
  /** Company files only — a person's ID stays with the firm. */
  onToggleShare?: () => void;
  removing: boolean;
  error?: string;
}) {
  return (
    <li className="rise-in group/file flex items-center gap-2 px-2 py-1 text-xs rounded bg-stone-50 dark:bg-white/5 hover:bg-stone-100/80 dark:hover:bg-white/[0.07] transition-colors">
      <Paperclip className="w-3 h-3 text-stone-400 dark:text-stone-500 shrink-0" />
      <span className="flex-1 truncate text-stone-700 dark:text-stone-200" title={file.name}>{file.name}</span>
      {error && (
        <span className="text-rose-600 dark:text-rose-400 text-[10px] inline-flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {error}
        </span>
      )}
      {onToggleShare && file.personId == null && (
        <button
          type="button"
          onClick={onToggleShare}
          className={`press inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium transition-all ${
            file.clientVisible
              ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/25'
              : 'text-stone-400 opacity-0 group-hover/file:opacity-100 focus:opacity-100 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300'
          }`}
          title={file.clientVisible ? 'Shared with the client in the portal — click to stop sharing' : 'Share with the client in the portal'}
        >
          <Users key={String(file.clientVisible)} className={`w-3 h-3 ${file.clientVisible ? 'pop' : ''}`} />
          {file.clientVisible ? 'Client' : 'Share'}
        </button>
      )}
      <span className="text-stone-400 dark:text-stone-500 text-[10px]">{new Date(file.uploadedAt).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' })}</span>
      <button onClick={onPreview} className="p-1 text-stone-400 dark:text-stone-500 hover:text-navy-700 dark:hover:text-navy-300" title="Preview">
        <Eye className="w-3 h-3" />
      </button>
      <button onClick={onDownload} className="p-1 text-stone-400 dark:text-stone-500 hover:text-navy-700 dark:hover:text-navy-300" title="Download">
        <Download className="w-3 h-3" />
      </button>
      <button onClick={onRemove} disabled={removing} className="p-1 text-stone-400 dark:text-stone-500 hover:text-rose-600 dark:hover:text-rose-400 disabled:opacity-50" title="Delete">
        <Trash2 className="w-3 h-3" />
      </button>
    </li>
  );
}

function UploadButton({ label, onPick, busy }: { label: string; onPick: (f: File) => void; busy: boolean }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-stone-300 dark:border-white/15 rounded hover:bg-stone-50 dark:hover:bg-white/5 disabled:opacity-50 shrink-0"
      >
        <Upload className="w-3 h-3" />
        {busy ? 'Uploading…' : label}
      </button>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = '';
        }}
      />
    </>
  );
}

/**
 * Outcome of reading a freshly uploaded registration document. The applied
 * case (SEC COR only) is a notification — the work is already done. The other
 * two hand the lawyer the extracted values rather than making them retype the
 * document.
 */
function CorRegistrationBanner({
  registration,
  onDismiss,
  onReview,
}: {
  registration: CorRegistration;
  onDismiss: () => void;
  onReview: () => void;
}) {
  const applied = registration.result === 'applied';
  const tone = applied ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30' : 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30';
  const ex = registration.extraction;
  const label = ex ? EXTRACTABLE_CATEGORIES[ex.category].label : 'document';
  const readValues = ex ? Object.values(ex.fields).filter(Boolean) : [];

  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${tone}`}>
      {applied ? (
        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
      ) : (
        <Sparkles className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
      )}
      <div className="flex-1 min-w-0">
        {applied ? (
          <>
            <p className="text-sm font-medium text-emerald-900 dark:text-emerald-300">Registration recorded from the certificate.</p>
            <p className="mt-0.5 text-xs text-emerald-800 dark:text-emerald-300">
              {readValues.join(' · ')}. The incorporation matter is closed and the year-1 compliance
              deadlines are scheduled.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-amber-900 dark:text-amber-300">
              {registration.result === 'unreadable'
                ? `Could not read this ${label}.`
                : `${label} read — needs your confirmation.`}
            </p>
            {registration.reason && <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">{registration.reason}</p>}
            {readValues.length > 0 && (
              <>
                <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">{readValues.join(' · ')}</p>
                <button
                  onClick={onReview}
                  className="mt-2 px-2.5 py-1 text-xs font-medium text-white bg-navy-700 rounded-lg hover:bg-navy-800"
                >
                  Review and save
                </button>
              </>
            )}
          </>
        )}
      </div>
      <button onClick={onDismiss} className="p-1 rounded hover:bg-black/5 shrink-0">
        <X className="w-3.5 h-3.5 text-stone-500 dark:text-stone-400" />
      </button>
    </div>
  );
}

/**
 * One document category: its files, an upload button, and the whole row as a
 * drop target. Extracted from the list so it can own the drop state — the
 * highlight has to be per-row, not per-tab, or dragging a COR onto the page
 * gives no indication of which of the 24 slots it will land in.
 */
function CategoryRow({
  category,
  rows,
  busy,
  error,
  onDropFiles,
  onPick,
  onPreview,
  onDownload,
  onRemove,
  onToggleShare,
  removingId,
  rowErrors,
}: {
  category: CorporationFileCategory;
  rows: CorporationFile[];
  busy: boolean;
  error?: string;
  onDropFiles: (files: File[]) => void;
  onPick: (file: File) => void;
  onPreview: (f: CorporationFile) => void;
  onDownload: (f: CorporationFile) => void;
  onRemove: (id: number) => void;
  onToggleShare: (f: CorporationFile) => void;
  removingId: string | null;
  rowErrors: Record<string, string>;
}) {
  const { isOver, dropProps } = useFileDrop(onDropFiles, { disabled: busy });

  return (
    <li
      {...dropProps}
      className={`py-2.5 px-2 -mx-2 flex items-start gap-3 rounded-lg transition-colors ${
        isOver ? 'bg-navy-50 dark:bg-navy-500/10 ring-1 ring-navy-300 dark:ring-navy-500/40 ring-dashed' : ''
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-stone-800 dark:text-stone-100">{category}</span>
          <span className="text-xs text-stone-400 dark:text-stone-500">({rows.length})</span>
          {isOver && <span className="text-[11px] text-navy-700 dark:text-navy-300">Drop to upload</span>}
        </div>
        {error && (
          <p className="mt-1 text-xs text-rose-600 dark:text-rose-400 inline-flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> {error}
          </p>
        )}
        {rows.length > 0 && (
          <ul className="mt-1.5 space-y-1">
            {rows.map((f) => (
              <FileRow
                key={f.id}
                file={f}
                onPreview={() => onPreview(f)}
                onDownload={() => onDownload(f)}
                onRemove={() => onRemove(f.id)}
                onToggleShare={() => onToggleShare(f)}
                removing={removingId === `del-${f.id}`}
                error={rowErrors[`del-${f.id}`]}
              />
            ))}
          </ul>
        )}
      </div>
      <UploadButton label={rows.length ? 'Add another' : 'Upload'} onPick={onPick} busy={busy} />
    </li>
  );
}
