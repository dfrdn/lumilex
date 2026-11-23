'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, Upload, Paperclip, Eye, Download, Sparkles, Loader2 } from 'lucide-react';
import DatePickerInput from '@/components/DatePickerInput';
import { useFileViewer } from '@/hooks/use-file-viewer';
import type { Corporation, CorporationFile, CorporationFileCategory } from '@/types/corporations';
import { uploadCorporationFile, type CorRegistrationOutcome } from '@/lib/corporations/upload-file';
import { isExtractable, type DocumentExtraction } from '@/lib/ai/corporation-doc-extract-shape';
import { useFeature } from '@/components/FeatureProvider';
import ExtractedFieldsModal from '@/components/detail/ExtractedFieldsModal';
import { useFileDrop } from '@/hooks/use-file-drop';

interface Props {
  corporation: Corporation;
  files: CorporationFile[];
  onFilesChange: React.Dispatch<React.SetStateAction<CorporationFile[]>>;
  /** Details confirmed from a document land on the company record. */
  onCorporationChange: (c: Corporation) => void;
}

interface RegistrationSection {
  key: string;
  title: string;
  fields: { label: string; col: keyof Corporation; mono?: boolean }[];
  /** Omitted for sections that track an account rather than a document. */
  fileCategory?: string;
  note?: string;
}

const SECTIONS: RegistrationSection[] = [
  {
    key: 'bir', title: 'BIR',
    fields: [
      { label: 'TIN', col: 'birTin', mono: true },
      { label: 'RDO Code', col: 'birRdoCode' },
      { label: 'COR Date', col: 'birCorDate' },
      { label: 'Books Registration', col: 'birBooksRegistrationDate' },
      { label: 'OR Authority', col: 'birOrAuthorityDate' },
    ],
    fileCategory: 'BIR COR',
  },
  {
    key: 'permit', title: 'Business Permit',
    fields: [
      { label: 'Permit No.', col: 'businessPermitNo', mono: true },
      { label: 'LGU', col: 'businessPermitLgu' },
      { label: 'Issued', col: 'businessPermitIssuedDate' },
      { label: 'Expires', col: 'businessPermitExpiryDate' },
    ],
    fileCategory: 'Business Permit',
  },
  {
    key: 'sss', title: 'SSS',
    fields: [
      { label: 'Employer No.', col: 'sssEmployerNo', mono: true },
      { label: 'Registration', col: 'sssRegistrationDate' },
    ],
    fileCategory: 'SSS R-1',
  },
  {
    key: 'philhealth', title: 'PhilHealth',
    fields: [
      { label: 'Employer No.', col: 'philhealthEmployerNo', mono: true },
      { label: 'Registration', col: 'philhealthRegistrationDate' },
    ],
    fileCategory: 'PhilHealth ER1',
  },
  {
    key: 'pagibig', title: 'Pag-IBIG',
    fields: [
      { label: 'Employer No.', col: 'pagibigEmployerNo', mono: true },
      { label: 'Registration', col: 'pagibigRegistrationDate' },
    ],
    fileCategory: 'Pag-IBIG EFR',
  },
  {
    key: 'eplatforms', title: 'E-Filing Platforms',
    note: 'Enrolment is what readiness means here — without an account the corporation cannot file. Record the account identifier only; keep passwords in the firm password manager.',
    fields: [
      { label: 'BIR ORUS account', col: 'birOrusUsername', mono: true },
      { label: 'ORUS enrolled', col: 'birOrusEnrolledDate' },
      { label: 'SEC eFAST account', col: 'secEfastUsername', mono: true },
      { label: 'eFAST enrolled', col: 'secEfastEnrolledDate' },
      { label: 'SEC HABOR account', col: 'secHaborUsername', mono: true },
      { label: 'HABOR enrolled', col: 'secHaborEnrolledDate' },
    ],
  },
];

const COL_TO_API: Record<string, string> = {
  birTin: 'birTin', birRdoCode: 'birRdoCode', birCorDate: 'birCorDate',
  birBooksRegistrationDate: 'birBooksRegistrationDate', birOrAuthorityDate: 'birOrAuthorityDate',
  businessPermitNo: 'businessPermitNo', businessPermitLgu: 'businessPermitLgu',
  businessPermitIssuedDate: 'businessPermitIssuedDate', businessPermitExpiryDate: 'businessPermitExpiryDate',
  sssEmployerNo: 'sssEmployerNo', sssRegistrationDate: 'sssRegistrationDate',
  philhealthEmployerNo: 'philhealthEmployerNo', philhealthRegistrationDate: 'philhealthRegistrationDate',
  pagibigEmployerNo: 'pagibigEmployerNo', pagibigRegistrationDate: 'pagibigRegistrationDate',
  birOrusUsername: 'birOrusUsername', birOrusEnrolledDate: 'birOrusEnrolledDate',
  secEfastUsername: 'secEfastUsername', secEfastEnrolledDate: 'secEfastEnrolledDate',
  secHaborUsername: 'secHaborUsername', secHaborEnrolledDate: 'secHaborEnrolledDate',
};

function isDateCol(col: keyof Corporation) {
  return col.toString().toLowerCase().includes('date');
}

export default function CorporationRegistrationsTab({ corporation, files, onFilesChange, onCorporationChange }: Props) {
  const [draft, setDraft] = useState(corporation);
  const lastSaved = useRef(corporation);
  const [savedField, setSavedField] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
  const [reading, setReading] = useState<number | null>(null);
  // Reading a document sends it to the model, which the firm has to have switched on.
  const canRead = useFeature('ai_analysis');
  const [review, setReview] = useState<{ extraction: DocumentExtraction; reason?: string } | null>(null);
  const fileViewer = useFileViewer();

  // Mirror server-side changes — a BIR COR extraction lands here as a new
  // corporation prop while this tab is mounted. Only fields the user hasn't
  // touched locally are re-seeded, so an in-progress edit isn't clobbered.
  useEffect(() => {
    setDraft((d) => {
      const next = { ...d };
      let changed = false;
      for (const key of Object.keys(corporation) as (keyof Corporation)[]) {
        if (d[key] !== lastSaved.current[key]) continue;
        if (corporation[key] === lastSaved.current[key]) continue;
        (next as Record<string, unknown>)[key as string] = corporation[key];
        changed = true;
      }
      return changed ? next : d;
    });
    lastSaved.current = corporation;
  }, [corporation]);

  async function saveField(col: keyof Corporation, value: unknown) {
    const apiKey = COL_TO_API[col as string];
    if (!apiKey) return;
    if ((lastSaved.current as unknown as Record<string, unknown>)[col as string] === (value || null)) return;
    setErrorField((prev) => (prev === col ? null : prev));
    const res = await fetch(`/api/corporation/${corporation.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [apiKey]: value || null }),
    }).catch(() => null);
    if (!res?.ok) {
      setDraft((d) => ({ ...d, [col]: (lastSaved.current as unknown as Record<string, unknown>)[col as string] ?? null }));
      setErrorField(col as string);
      return;
    }
    lastSaved.current = { ...lastSaved.current, [col]: (value || null) as never };
    setSavedField(col as string);
    setTimeout(() => setSavedField(null), 1000);
  }

  /** What was read from a document goes to the confirmation dialog; nothing is written until someone saves it. */
  function showRead(category: string, outcome: CorRegistrationOutcome) {
    if (outcome.result === 'needs_review' && outcome.extraction) {
      setReview({ extraction: outcome.extraction, reason: outcome.reason });
    } else if (outcome.reason) {
      setUploadErrors((prev) => ({ ...prev, [category]: outcome.reason! }));
    }
  }

  async function readFile(f: CorporationFile) {
    setReading(f.id);
    setUploadErrors((prev) => {
      const next = { ...prev };
      delete next[f.category];
      return next;
    });
    try {
      const res = await fetch(`/api/corporation/${corporation.id}/files/${f.id}/read`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.registration) throw new Error(data?.error ?? 'The document could not be read.');
      showRead(f.category, data.registration as CorRegistrationOutcome);
    } catch (e) {
      setUploadErrors((prev) => ({ ...prev, [f.category]: e instanceof Error ? e.message : 'The document could not be read.' }));
    } finally {
      setReading(null);
    }
  }

  async function uploadFile(category: string, file: File) {
    setUploadBusy(category);
    setUploadErrors((prev) => {
      const next = { ...prev };
      delete next[category];
      return next;
    });
    try {
      const data = await uploadCorporationFile(corporation.id, category as CorporationFileCategory, file);
      onFilesChange((prev) => [data.file, ...prev]);
      if (data.registration) showRead(category, data.registration);
    } catch (e) {
      setUploadErrors((prev) => ({
        ...prev,
        [category]: e instanceof Error ? e.message : 'Upload failed',
      }));
    } finally {
      setUploadBusy(null);
    }
  }

  async function uploadMany(category: string, list: File[]) {
    for (const f of list) await uploadFile(category, f);
  }

  const preview = (f: CorporationFile) => fileViewer.preview(f.name, f.storagePath);
  const download = (f: CorporationFile) => fileViewer.download(f.name, f.storagePath);

  return (
    <div className="space-y-4">
      {SECTIONS.map((sec) => {
        const sectionFiles = sec.fileCategory ? files.filter((f) => f.category === sec.fileCategory) : [];
        return (
          <section key={sec.key} className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-1">{sec.title}</h3>
            {sec.note && <p className="text-[11px] text-stone-500 dark:text-stone-400 mb-3">{sec.note}</p>}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {sec.fields.map((f) => {
                const value = (draft as unknown as Record<string, unknown>)[f.col as string] ?? '';
                return (
                  <label key={f.col as string} className="block" data-field={f.col as string}>
                    <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">
                      {f.label}
                      {savedField === f.col && (
                        <span className="ml-2 text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> saved
                        </span>
                      )}
                      {errorField === f.col && (
                        <span className="ml-2 text-rose-600 dark:text-rose-400 inline-flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" /> save failed
                        </span>
                      )}
                    </span>
                    {isDateCol(f.col) ? (
                      <DatePickerInput
                        value={value ? String(value).slice(0, 10) : null}
                        onChange={(v) => {
                          setDraft((d) => ({ ...d, [f.col]: v }));
                          saveField(f.col, v);
                        }}
                      />
                    ) : (
                      <input
                        type="text"
                        value={(value as string | null) ?? ''}
                        onChange={(e) => setDraft((d) => ({ ...d, [f.col]: e.target.value }))}
                        onBlur={(e) => saveField(f.col, e.target.value)}
                        className={`w-full px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg outline-none focus:border-navy-600 ${f.mono ? 'font-mono' : ''}`}
                      />
                    )}
                  </label>
                );
              })}
            </div>
            {sec.fileCategory && (
            <SectionDropZone
              category={sec.fileCategory}
              busy={uploadBusy === sec.fileCategory}
              onDropFiles={(list) => void uploadMany(sec.fileCategory!, list)}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-stone-600 dark:text-stone-300">
                  {sec.fileCategory} <span className="text-stone-400 dark:text-stone-500">({sectionFiles.length})</span>
                </span>
                <RegistrationUploadButton
                  category={sec.fileCategory!}
                  busy={uploadBusy === sec.fileCategory}
                  onPick={(f) => uploadFile(sec.fileCategory!, f)}
                />
              </div>
              {uploadErrors[sec.fileCategory] && (
                <p className="mb-2 text-xs text-rose-600 dark:text-rose-400 inline-flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {uploadErrors[sec.fileCategory]}
                </p>
              )}
              {sectionFiles.length > 0 && (
                <ul className="space-y-1">
                  {sectionFiles.map((f) => (
                    <li key={f.id} className="flex items-center gap-2 px-2 py-1 text-xs bg-stone-50 dark:bg-white/5 rounded">
                      <Paperclip className="w-3 h-3 text-stone-400 dark:text-stone-500 shrink-0" />
                      <button
                        type="button"
                        onClick={() => preview(f)}
                        className="flex-1 min-w-0 truncate text-left text-stone-700 dark:text-stone-200 hover:text-navy-700 dark:hover:text-navy-300 hover:underline"
                        title={f.name}
                      >
                        {f.name}
                      </button>
                      <span className="text-[10px] text-stone-400 dark:text-stone-500">
                        {new Date(f.uploadedAt).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' })}
                      </span>
                      {canRead && isExtractable(f.category) && (
                        <button
                          type="button"
                          onClick={() => void readFile(f)}
                          disabled={reading !== null}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-navy-700 dark:text-navy-300 hover:bg-navy-50 dark:hover:bg-navy-500/10 disabled:opacity-50"
                          title="Read this document and fill in the fields above"
                        >
                          {reading === f.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                          {reading === f.id ? 'Reading…' : 'Fill from document'}
                        </button>
                      )}
                      <button type="button" onClick={() => preview(f)} className="p-1 text-stone-400 dark:text-stone-500 hover:text-navy-700 dark:hover:text-navy-300" title="Preview">
                        <Eye className="w-3 h-3" />
                      </button>
                      <button type="button" onClick={() => download(f)} className="p-1 text-stone-400 dark:text-stone-500 hover:text-navy-700 dark:hover:text-navy-300" title="Download">
                        <Download className="w-3 h-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </SectionDropZone>
            )}
          </section>
        );
      })}

      {review && (
        <ExtractedFieldsModal
          open
          corporation={corporation}
          extraction={review.extraction}
          reason={review.reason}
          onClose={() => setReview(null)}
          onUpdated={onCorporationChange}
        />
      )}

      {fileViewer.viewer}
    </div>
  );
}

function RegistrationUploadButton({ category, busy, onPick }: { category: string; busy: boolean; onPick: (f: File) => void }) {
  const ref = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        disabled={busy}
        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-stone-300 dark:border-white/15 rounded hover:bg-stone-50 dark:hover:bg-white/5 disabled:opacity-50"
      >
        <Upload className="w-3 h-3" />
        {busy ? 'Uploading…' : 'Upload'}
      </button>
      <input
        ref={ref}
        type="file"
        className="hidden"
        accept="image/*,application/pdf"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = '';
        }}
      />
      <span className="sr-only">Upload {category}</span>
    </>
  );
}

/**
 * Wraps a section's file area so the whole block accepts a drop, not just the
 * Upload button. The highlight is per-section because each one files into its
 * own document category.
 */
function SectionDropZone({
  category,
  busy,
  onDropFiles,
  children,
}: {
  category: string;
  busy: boolean;
  onDropFiles: (files: File[]) => void;
  children: React.ReactNode;
}) {
  const { isOver, dropProps } = useFileDrop(onDropFiles, { disabled: busy });
  return (
    <div
      {...dropProps}
      className={`mt-4 border-t border-stone-100 dark:border-white/10 pt-3 rounded-b-lg transition-colors ${
        isOver ? 'bg-navy-50 dark:bg-navy-500/10 ring-1 ring-navy-300 dark:ring-navy-500/40 ring-dashed' : ''
      }`}
    >
      {isOver && <p className="mb-1 text-[11px] text-navy-700 dark:text-navy-300">Drop to file under {category}</p>}
      {children}
    </div>
  );
}
