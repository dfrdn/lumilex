'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Stamp, ChevronDown, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import DatePickerInput from '@/components/DatePickerInput';
import CellDropdown from '@/components/admin/CellDropdown';
import { missingRegistrationFacts } from '@/lib/corporation-lifecycle';
import type { Corporation, CompanyType } from '@/types/corporations';

const COMPANY_TYPE_OPTIONS: { id: CompanyType; label: string }[] = [
  { id: 'Stock', label: 'Stock' },
  { id: 'Non-Stock', label: 'Non-Stock' },
  { id: 'OPC', label: 'One-Person Corporation (OPC)' },
  { id: 'Partnership', label: 'Partnership' },
];

const INPUT =
  'w-full px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg outline-none focus:border-navy-600';
const LABEL = 'block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1';

/** Values read off a COR, offered for confirmation instead of retyping. */
export interface RegistrationPrefill {
  approvedName: string;
  secRegistrationNo: string;
  secRegistrationDate: string;
}

interface Props {
  open: boolean;
  corporation: Corporation;
  /** When present, seeds the form from an extracted certificate rather than the record. */
  prefill?: RegistrationPrefill;
  onClose: () => void;
  onUpdated: (c: Corporation) => void;
}

/**
 * Records a SEC registration on a corporation that never went through the
 * step-by-step flow — the lawyer has the COR in hand and needs the registry to
 * catch up in one move.
 *
 * This is not a status edit. It writes the registration facts, which is what
 * fires the approval chain (client rename, matter close, Post-Incorporation /
 * Housekeeping matters, year-1 compliance deliverables) and lets the lifecycle
 * trigger derive the status.
 */
export default function MarkRegisteredModal({ open, corporation, prefill, onClose, onUpdated }: Props) {
  const [approvedName, setApprovedName] = useState('');
  const [secRegistrationNo, setSecRegistrationNo] = useState('');
  const [secRegistrationDate, setSecRegistrationDate] = useState('');
  const [companyType, setCompanyType] = useState<CompanyType | ''>('');
  const [typeOpen, setTypeOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const typeRef = useRef<HTMLButtonElement>(null);

  // Re-seed each time the modal opens: the proposed name is the lawyer's
  // starting point, but SEC frequently approves a variant, so it stays editable.
  useEffect(() => {
    if (!open) return;
    setApprovedName(prefill?.approvedName || corporation.approvedName || corporation.proposedNames[0] || '');
    setSecRegistrationNo(prefill?.secRegistrationNo || corporation.secRegistrationNo || '');
    setSecRegistrationDate(prefill?.secRegistrationDate || corporation.secRegistrationDate || '');
    setCompanyType((corporation.companyType as CompanyType | null) ?? '');
    setError('');
  }, [open, corporation, prefill]);

  if (!open) return null;

  const missing = missingRegistrationFacts({ approvedName, secRegistrationNo, secRegistrationDate });
  const canSubmit = missing.length === 0 && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`/api/corporation/${corporation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvedName: approvedName.trim(),
          secRegistrationNo: secRegistrationNo.trim(),
          secRegistrationDate,
          ...(companyType ? { companyType } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.corporation) {
        setError(data?.error ?? 'Could not record the registration.');
        return;
      }
      onUpdated(data.corporation as Corporation);
      toast.success(`Registration recorded — ${approvedName.trim()} is now ${data.corporation.status}.`);
      onClose();
    } catch {
      setError('Could not record the registration.');
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
            <Stamp className="w-5 h-5 text-stone-700 dark:text-stone-200" />
            <h2 className="text-base font-semibold text-stone-800 dark:text-stone-100">Record SEC Registration</h2>
          </div>
          <button onClick={onClose} disabled={submitting} className="p-1 rounded hover:bg-stone-100 dark:hover:bg-white/10">
            <X className="w-4 h-4 text-stone-500 dark:text-stone-400" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-xs text-stone-500 dark:text-stone-400 leading-relaxed">
            Use this when the corporation is already registered but the intermediate steps were never
            recorded. Saving closes the Incorporation matter, renames the client to the approved name,
            opens the Post-Incorporation and Housekeeping matters where scope applies, and schedules the
            year-1 GIS, AFS, BIR and business-permit deadlines.
          </p>

          <div>
            <label className={LABEL}>SEC-approved name *</label>
            <input
              className={INPUT}
              value={approvedName}
              onChange={(e) => setApprovedName(e.target.value)}
              disabled={submitting}
              placeholder="As printed on the Certificate of Incorporation"
            />
            {corporation.proposedNames[0] && approvedName.trim() !== corporation.proposedNames[0] && (
              <p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">
                Proposed was &ldquo;{corporation.proposedNames[0]}&rdquo;.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>SEC registration no. *</label>
              <input
                className={`${INPUT} font-mono`}
                value={secRegistrationNo}
                onChange={(e) => setSecRegistrationNo(e.target.value)}
                disabled={submitting}
                placeholder="2025030194341-24"
              />
            </div>
            <div>
              <label className={LABEL}>SEC registration date *</label>
              <DatePickerInput
                value={secRegistrationDate}
                onChange={(v) => setSecRegistrationDate(v ?? '')}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Company type</label>
              <button
                ref={typeRef}
                type="button"
                onClick={() => setTypeOpen((o) => !o)}
                disabled={submitting}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg bg-white dark:bg-card text-left outline-none hover:border-stone-400 dark:hover:border-stone-600"
              >
                <span className={companyType ? 'text-stone-800 dark:text-stone-100' : 'text-stone-400 dark:text-stone-500'}>
                  {companyType || 'Select…'}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
              </button>
              {typeOpen && (
                <CellDropdown
                  mode="single"
                  value={companyType}
                  options={COMPANY_TYPE_OPTIONS}
                  onSelect={(v) => {
                    setCompanyType((v as CompanyType) ?? '');
                    setTypeOpen(false);
                  }}
                  onClose={() => setTypeOpen(false)}
                  anchorRef={typeRef}
                />
              )}
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30">
              <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <p className="text-xs text-rose-700 dark:text-rose-300">{error}</p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-stone-200 dark:border-white/10 flex items-center justify-between gap-3">
          <p className="text-[11px] text-stone-500 dark:text-stone-400">
            {missing.length ? `Still needed: ${missing.join(', ')}.` : 'Ready to record.'}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={submitting}
              className="px-3 py-1.5 text-sm text-stone-600 dark:text-stone-300 rounded-lg hover:bg-stone-100 dark:hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!canSubmit}
              className="px-3 py-1.5 text-sm font-medium text-white bg-navy-700 rounded-lg hover:bg-navy-800 disabled:bg-stone-300 dark:disabled:bg-stone-700"
            >
              {submitting ? 'Recording…' : 'Record registration'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
