'use client';

import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Shield, ChevronRight, Calendar, Check, X, Loader2 } from 'lucide-react';
import DatePickerInput from '@/components/DatePickerInput';
import {
  PRESCRIPTIVE_PERIODS,
  PRESCRIPTIVE_CATEGORIES,
  type PrescriptivePeriod,
} from '@/lib/legal/prescriptive-periods';
import { addDays, addYears } from '@/lib/dates';

interface Props {
  open: boolean;
  onClose: () => void;
  matterId: string;
  onSuccess: () => void;
}

function formatDate(d: string): string {
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Manila',
  });
}

export default function SOLSetupModal({ open, onClose, matterId, onSuccess }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedPeriod, setSelectedPeriod] = useState<PrescriptivePeriod | null>(null);
  const [accrualDate, setAccrualDate] = useState('');
  const [tollingDays, setTollingDays] = useState(0);
  const [tollingNotes, setTollingNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const periodsForCategory = useMemo(() => {
    if (!selectedCategory) return [];
    return PRESCRIPTIVE_PERIODS.filter((p) => p.category === selectedCategory);
  }, [selectedCategory]);

  // Compute preview expiry
  const previewExpiry = useMemo(() => {
    if (!selectedPeriod || !accrualDate) return null;
    const expiry = addYears(accrualDate, selectedPeriod.years);
    return tollingDays > 0 ? addDays(expiry, tollingDays) : expiry;
  }, [selectedPeriod, accrualDate, tollingDays]);

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep(1);
      setSelectedCategory('');
      setSelectedPeriod(null);
      setAccrualDate('');
      setTollingDays(0);
      setTollingNotes('');
      setError('');
      setSuccess(false);
    }
  }, [open]);

  // Keyboard
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleSelectPeriod = (p: PrescriptivePeriod) => {
    setSelectedPeriod(p);
    setStep(2);
  };

  const handleConfirm = async () => {
    if (!selectedPeriod || !accrualDate) return;
    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/sol', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matterId,
          periodId: selectedPeriod.id,
          accrualDate,
          tollingDays: tollingDays || 0,
          tollingNotes: tollingNotes || '',
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create SOL record');
      }

      setSuccess(true);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setSubmitting(false);
  };

  if (!open) return null;

  const CATEGORY_COLORS: Record<string, string> = {
    Civil: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20',
    Criminal: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20',
    Labor: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20',
    Tax: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20',
  };

  const modal = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px] animate-overlay"
        onClick={onClose}
      />
      <div className="relative w-full max-w-xl mx-4 bg-[var(--card-bg)] rounded-2xl shadow-2xl border border-[var(--border-color)] animate-dialog max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border-color)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-navy-500 dark:text-navy-400" />
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Set Prescriptive Period</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
            <X className="w-4 h-4 text-[var(--text-muted)]" />
          </button>
        </div>

        {/* Steps */}
        <div className="px-6 py-3 border-b border-[var(--border-color)] flex items-center gap-2 text-xs shrink-0">
          {[
            { n: 1, label: 'Cause of Action' },
            { n: 2, label: 'Accrual Date' },
            { n: 3, label: 'Confirm' },
          ].map(({ n, label }, i) => (
            <div key={n} className="flex items-center gap-2">
              {i > 0 && <ChevronRight className="w-3 h-3 text-[var(--text-muted)]" />}
              <span className={`flex items-center gap-1.5 ${
                step === n
                  ? 'text-navy-600 dark:text-navy-400 font-semibold'
                  : step > n
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-[var(--text-muted)]'
              }`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  step === n
                    ? 'bg-navy-100 text-navy-700 dark:bg-navy-500/20 dark:text-navy-400'
                    : step > n
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
                    : 'bg-stone-100 text-stone-500 dark:bg-stone-500/20 dark:text-stone-400'
                }`}>
                  {step > n ? <Check className="w-3 h-3" /> : n}
                </span>
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          {success && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center mb-4">
                <Check className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
              </div>
              <p className="text-lg font-semibold text-[var(--text-primary)]">Prescriptive Period Set</p>
              <p className="text-sm text-[var(--text-secondary)] mt-1">SOL tracker is now active for this matter.</p>
            </div>
          )}

          {/* Step 1: Select Category + Cause of Action */}
          {step === 1 && !success && (
            <div>
              {/* Category selector */}
              <div className="flex flex-wrap gap-2 mb-4">
                {PRESCRIPTIVE_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3.5 py-2 text-xs font-semibold rounded-lg border transition-all ${
                      selectedCategory === cat
                        ? CATEGORY_COLORS[cat]
                        : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-navy-300 dark:hover:border-navy-600'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Periods list */}
              {periodsForCategory.length > 0 && (
                <div className="space-y-2">
                  {periodsForCategory.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => handleSelectPeriod(p)}
                      className="w-full text-left px-4 py-3 rounded-xl border border-[var(--border-color)] hover:border-navy-300 dark:hover:border-navy-600 hover:bg-navy-50/30 dark:hover:bg-navy-500/5 transition-all group"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-[var(--text-primary)] group-hover:text-navy-600 dark:group-hover:text-navy-400 transition-colors">
                            {p.causeOfAction}
                          </p>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="text-xs text-[var(--text-muted)]">{p.legalBasis}</span>
                            <span className="text-xs font-semibold text-navy-600 dark:text-navy-400">
                              {p.years} year{p.years !== 1 ? 's' : ''}
                            </span>
                          </div>
                          {p.notes && (
                            <p className="text-[10px] text-[var(--text-muted)] mt-1">{p.notes}</p>
                          )}
                        </div>
                        <ChevronRight className="w-4 h-4 text-[var(--text-muted)] group-hover:text-navy-500 transition-colors shrink-0" />
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {!selectedCategory && (
                <p className="text-sm text-[var(--text-muted)] text-center py-6">
                  Select a category to view available prescriptive periods.
                </p>
              )}
            </div>
          )}

          {/* Step 2: Accrual Date + Tolling */}
          {step === 2 && !success && selectedPeriod && (
            <div>
              <div className="mb-6 p-4 rounded-xl bg-navy-50/30 dark:bg-navy-500/5 border border-navy-200/50 dark:border-navy-500/15">
                <p className="text-sm font-medium text-navy-700 dark:text-navy-400">{selectedPeriod.causeOfAction}</p>
                <p className="text-xs text-navy-600/70 dark:text-navy-400/60 mt-0.5">
                  {selectedPeriod.legalBasis} &middot; {selectedPeriod.years} year{selectedPeriod.years !== 1 ? 's' : ''}
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">
                    <Calendar className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
                    Date of Accrual
                  </label>
                  <DatePickerInput
                    variant="token"
                    value={accrualDate || null}
                    onChange={(v) => setAccrualDate(v ?? '')}
                    placeholder="Pick a date"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">
                      Tolling Days (Optional)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={tollingDays || ''}
                      onChange={(e) => setTollingDays(Number(e.target.value) || 0)}
                      placeholder="0"
                      className="w-full px-4 py-3 text-sm rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] focus:outline-none focus:border-navy-400 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">
                      Tolling Notes
                    </label>
                    <input
                      type="text"
                      value={tollingNotes}
                      onChange={(e) => setTollingNotes(e.target.value)}
                      placeholder="e.g. Demand letter sent"
                      className="w-full px-4 py-3 text-sm rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] focus:outline-none focus:border-navy-400 transition-colors"
                    />
                  </div>
                </div>

                {accrualDate && previewExpiry && (
                  <div className="p-4 rounded-xl bg-amber-50/50 dark:bg-amber-500/5 border border-amber-200/50 dark:border-amber-500/10">
                    <p className="text-xs text-[var(--text-muted)]">Preview Expiry Date</p>
                    <p className="text-base font-semibold text-[var(--text-primary)] mt-0.5">{formatDate(previewExpiry)}</p>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 mt-6">
                <button
                  onClick={() => setStep(1)}
                  className="px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={() => accrualDate && setStep(3)}
                  disabled={!accrualDate}
                  className="px-5 py-2.5 text-sm font-medium text-white bg-navy-600 hover:bg-navy-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors"
                >
                  Review
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Confirm */}
          {step === 3 && !success && selectedPeriod && previewExpiry && (
            <div>
              <div className="space-y-3">
                <div className="p-4 rounded-xl border border-[var(--border-color)]">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-0.5">Category</p>
                      <p className="font-medium text-[var(--text-primary)]">{selectedPeriod.category}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-0.5">Cause of Action</p>
                      <p className="font-medium text-[var(--text-primary)]">{selectedPeriod.causeOfAction}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-0.5">Legal Basis</p>
                      <p className="text-[var(--text-secondary)]">{selectedPeriod.legalBasis}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-0.5">Period</p>
                      <p className="font-medium text-[var(--text-primary)]">{selectedPeriod.years} year{selectedPeriod.years !== 1 ? 's' : ''}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-0.5">Accrual Date</p>
                      <p className="font-medium text-[var(--text-primary)]">{formatDate(accrualDate)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-0.5">Expiry Date</p>
                      <p className="font-bold text-red-600 dark:text-red-400">{formatDate(previewExpiry)}</p>
                    </div>
                    {tollingDays > 0 && (
                      <>
                        <div>
                          <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-0.5">Tolling Days</p>
                          <p className="text-[var(--text-primary)]">{tollingDays}</p>
                        </div>
                        {tollingNotes && (
                          <div>
                            <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-0.5">Tolling Notes</p>
                            <p className="text-[var(--text-secondary)]">{tollingNotes}</p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 mt-6">
                <button
                  onClick={() => setStep(2)}
                  className="px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={submitting}
                  className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-navy-600 hover:bg-navy-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors"
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Set Prescriptive Period
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
