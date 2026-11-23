'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkles, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import DatePickerInput from '@/components/DatePickerInput';
import { formatDate } from '@/lib/format-date';
import { EXTRACTABLE_CATEGORIES, type DocumentExtraction } from '@/lib/ai/corporation-doc-extract-shape';
import type { Corporation } from '@/types/corporations';

/** Human labels for the fields these documents carry. */
const FIELD_LABELS: Record<string, string> = {
  approvedName: 'SEC-approved name',
  secRegistrationNo: 'SEC registration no.',
  secRegistrationDate: 'SEC registration date',
  companyType: 'Company type',
  birTin: 'TIN',
  birRdoCode: 'RDO code',
  birCorDate: 'BIR COR date',
  businessPermitNo: 'Permit no.',
  businessPermitLgu: 'Issuing LGU',
  businessPermitIssuedDate: 'Issued',
  businessPermitExpiryDate: 'Expires',
  sssEmployerNo: 'SSS employer no.',
  sssRegistrationDate: 'SSS registration date',
  philhealthEmployerNo: 'PhilHealth employer no.',
  philhealthRegistrationDate: 'PhilHealth registration date',
  pagibigEmployerNo: 'Pag-IBIG employer no.',
  pagibigRegistrationDate: 'Pag-IBIG registration date',
};

const DATE_FIELDS = new Set([
  'secRegistrationDate',
  'birCorDate',
  'businessPermitIssuedDate',
  'businessPermitExpiryDate',
  'sssRegistrationDate',
  'philhealthRegistrationDate',
  'pagibigRegistrationDate',
]);

const INPUT = 'w-full px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg outline-none focus:border-navy-600';

interface Props {
  open: boolean;
  corporation: Corporation;
  extraction: DocumentExtraction;
  /** Server-side note when only part of the document could be read. */
  reason?: string;
  onClose: () => void;
  onUpdated: (c: Corporation) => void;
}

/**
 * Confirmation step for the post-incorporation registration documents.
 *
 * These never apply themselves: a misread TIN or permit number is quiet and
 * hard to notice later, and unlike the SEC COR there's no corporate name to
 * sanity-check the reading against. Every value stays editable — the model's
 * read is a starting point, not an answer.
 */
export default function ExtractedFieldsModal({
  open,
  corporation,
  extraction,
  reason,
  onClose,
  onUpdated,
}: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const spec = EXTRACTABLE_CATEGORIES[extraction.category];

  useEffect(() => {
    if (!open) return;
    const seeded: Record<string, string> = {};
    for (const field of spec.fields) {
      seeded[field] = extraction.fields[field] ?? '';
    }
    setValues(seeded);
    setError('');
  }, [open, extraction, spec]);

  if (!open) return null;

  const filled = Object.entries(values).filter(([, v]) => v.trim());

  /** What the company already has for a field, when saving would replace it with something else. */
  const replaced = (field: string): string | null => {
    const raw = (corporation as unknown as Record<string, unknown>)[field];
    if (raw == null || raw === '') return null;
    const current = DATE_FIELDS.has(field) ? String(raw).slice(0, 10) : String(raw).trim();
    const next = (values[field] ?? '').trim();
    if (!next || next === current) return null;
    return DATE_FIELDS.has(field) ? formatDate(current) : current;
  };
  const canSubmit = filled.length > 0 && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      // Only send what has a value — a blank left blank shouldn't null out
      // something already on the record.
      const patch = Object.fromEntries(filled.map(([k, v]) => [k, v.trim()]));
      const res = await fetch(`/api/corporation/${corporation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.corporation) {
        setError(data?.error ?? 'Could not save these details.');
        return;
      }
      onUpdated(data.corporation as Corporation);
      toast.success(`${spec.label} details saved.`);
      onClose();
    } catch {
      setError('Could not save these details.');
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto"
      onClick={() => !submitting && onClose()}
    >
      <div className="bg-white dark:bg-card rounded-xl shadow-2xl w-full max-w-lg my-8" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-stone-200 dark:border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-navy-700 dark:text-navy-300" />
            <h2 className="text-base font-semibold text-stone-800 dark:text-stone-100">Confirm details read from the document</h2>
          </div>
          <button onClick={onClose} disabled={submitting} className="p-1 rounded hover:bg-stone-100 dark:hover:bg-white/10">
            <X className="w-4 h-4 text-stone-500 dark:text-stone-400" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Read from the {spec.label}. Check each value against the document before saving — nothing has been
            written yet.
          </p>

          {(reason || extraction.notes) && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30">
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 dark:text-amber-300">{reason || extraction.notes}</p>
            </div>
          )}

          <div className="space-y-3">
            {spec.fields.map((field) => (
              <div key={field}>
                <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">
                  {FIELD_LABELS[field] ?? field}
                  {!extraction.fields[field] && (
                    <span className="ml-1.5 text-[10px] uppercase tracking-wider text-stone-400 dark:text-stone-500">not read</span>
                  )}
                </label>
                {DATE_FIELDS.has(field) ? (
                  <DatePickerInput
                    value={values[field] || ''}
                    onChange={(v) => setValues((prev) => ({ ...prev, [field]: v ?? '' }))}
                  />
                ) : (
                  <input
                    className={INPUT}
                    value={values[field] ?? ''}
                    onChange={(e) => setValues((prev) => ({ ...prev, [field]: e.target.value }))}
                    disabled={submitting}
                  />
                )}
                {replaced(field) && (
                  <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                    On record: <span className="font-medium">{replaced(field)}</span> — saving replaces it.
                  </p>
                )}
              </div>
            ))}
          </div>

          {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-stone-200 dark:border-white/10 flex items-center justify-between gap-3">
          <p className="text-[11px] text-stone-500 dark:text-stone-400">
            {filled.length} of {spec.fields.length} filled.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={submitting}
              className="px-3 py-1.5 text-sm text-stone-600 dark:text-stone-300 rounded-lg hover:bg-stone-100 dark:hover:bg-white/10"
            >
              Discard
            </button>
            <button
              onClick={submit}
              disabled={!canSubmit}
              className="px-3 py-1.5 text-sm font-medium text-white bg-navy-700 rounded-lg hover:bg-navy-800 disabled:bg-stone-300 dark:disabled:bg-stone-700"
            >
              {submitting ? 'Saving…' : 'Save details'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
