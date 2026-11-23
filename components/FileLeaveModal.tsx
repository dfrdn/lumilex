'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Calendar, ChevronDown, Check, CheckCircle2 } from 'lucide-react';
import DatePickerInput from '@/components/DatePickerInput';
import { useEnumValues } from '@/hooks/use-enum-options';

export interface FiledLeave {
  notion_id: string;
  reason: string;
  name: string;
  leave_type: string;
  period_start: string | null;
  period_end: string | null;
  status: string;
  approved: boolean;
  synced_at: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: (created: FiledLeave | null) => void;
}

export default function FileLeaveModal({ open, onClose, onSaved }: Props) {
  const [reason, setReason] = useState('');
  const [leaveType, setLeaveType] = useState('');
  const leaveTypes = useEnumValues('leaves', 'leave_type');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [typeOpen, setTypeOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setReason('');
      setLeaveType('');
      setPeriodStart('');
      setPeriodEnd('');
      setSuccess(false);
      setError('');
      setErrors({});
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose, submitting]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!leaveType) e.leaveType = 'Leave type is required';
    if (!periodStart) e.periodStart = 'Start date is required';
    if (periodEnd && periodEnd < periodStart) e.periodEnd = 'End date cannot be before start date';
    if (!reason.trim()) e.reason = 'Reason is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason,
          leaveType,
          periodStart,
          periodEnd: periodEnd || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to file leave');
      }
      onSaved?.(data.leave ?? null);
      setSuccess(true);
      setTimeout(() => onClose(), 1200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px] animate-overlay"
        onClick={submitting ? undefined : onClose}
      />

      <div className="relative bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-2xl shadow-stone-900/10 dark:shadow-black/30 w-full max-w-md animate-dialog ring-1 ring-stone-900/5 dark:ring-white/5 overflow-hidden">
        {/* Header */}
        <div className="relative px-5 pt-5 pb-4">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-400 via-emerald-500 to-teal-400" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-500/10 dark:to-emerald-500/20 flex items-center justify-center ring-1 ring-emerald-200/60 dark:ring-emerald-500/20">
                <Calendar className="w-4.5 h-4.5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-stone-900 dark:text-[#F5F0EB] leading-tight">File Leave</h2>
                <p className="text-xs text-stone-400 dark:text-[#5E5B55] mt-0.5">Submit a leave application</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="p-1.5 -mr-1 rounded-lg text-stone-400 hover:text-stone-600 dark:hover:text-[#F5F0EB] hover:bg-stone-100 dark:hover:bg-[#2A2A2D] transition-colors duration-150 cursor-pointer disabled:opacity-50 dark:text-stone-500"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        {success ? (
          <div className="px-6 py-14 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-50 dark:bg-emerald-500/10 ring-4 ring-emerald-100/60 dark:ring-emerald-500/5 flex items-center justify-center mx-auto mb-4 animate-scale-in">
              <CheckCircle2 className="w-7 h-7 text-emerald-500 dark:text-emerald-400" />
            </div>
            <p className="text-lg font-semibold text-stone-900 dark:text-[#F5F0EB]">Leave Filed</p>
            <p className="text-sm text-stone-400 dark:text-[#5E5B55] mt-1">Your leave application has been submitted.</p>
          </div>
        ) : (
          <>
            <div className="px-5 pb-5 space-y-4 max-h-[62vh] overflow-y-auto">
              {/* Leave Type */}
              <div className="relative">
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 dark:text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                  Leave Type
                </label>
                <button
                  type="button"
                  onClick={() => setTypeOpen((o) => !o)}
                  autoFocus
                  className={`w-full flex items-center justify-between gap-1 px-3 py-2 text-sm rounded-lg transition-all duration-150 cursor-pointer border ${
                    errors.leaveType
                      ? 'border-red-400 ring-1 ring-red-400/20 bg-red-50/20 dark:bg-red-950/10'
                      : typeOpen
                        ? 'border-emerald-400 ring-2 ring-emerald-400/20 bg-white dark:bg-[#2A2A2D] dark:border-emerald-500/40'
                        : 'border-stone-200 dark:border-[rgba(255,255,255,0.06)] bg-stone-50/80 dark:bg-[#2A2A2D] hover:border-stone-300 dark:hover:border-stone-600'
                  }`}
                >
                  <span className={`truncate ${leaveType ? 'text-stone-800 dark:text-[#F5F0EB]' : 'text-stone-400 dark:text-[var(--text-muted)]'}`}>
                    {leaveType || 'Select leave type'}
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 text-stone-400 shrink-0 transition-transform duration-150 dark:text-stone-500 ${typeOpen ? 'rotate-180' : ''}`} />
                </button>
                {typeOpen && (
                  <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white dark:bg-[#2A2A2D] border border-stone-200 dark:border-[rgba(255,255,255,0.06)] rounded-lg shadow-lg py-0.5 max-h-52 overflow-y-auto animate-fade-down">
                    {leaveTypes.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => { setLeaveType(opt); setTypeOpen(false); setErrors((p) => ({ ...p, leaveType: '' })); }}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors duration-75 cursor-pointer ${
                          leaveType === opt
                            ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50/80 dark:bg-emerald-500/10 font-medium'
                            : 'text-stone-700 dark:text-[#F5F0EB] hover:bg-stone-50 dark:hover:bg-[#232326]'
                        }`}
                      >
                        {opt}
                        {leaveType === opt && <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {errors.leaveType && <p className="text-xs text-red-500 -mt-2 dark:text-red-400">{errors.leaveType}</p>}

              {/* Period */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 dark:text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                    Start Date
                  </label>
                  <DatePickerInput
                    value={periodStart || null}
                    onChange={(v) => { setPeriodStart(v ?? ''); setErrors((p) => ({ ...p, periodStart: '' })); }}
                    placeholder="Pick a date"
                    hasError={!!errors.periodStart}
                  />
                  {errors.periodStart && <p className="text-xs text-red-500 mt-1 dark:text-red-400">{errors.periodStart}</p>}
                </div>
                <div>
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 dark:text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                    End Date
                  </label>
                  <DatePickerInput
                    value={periodEnd || null}
                    onChange={(v) => { setPeriodEnd(v ?? ''); setErrors((p) => ({ ...p, periodEnd: '' })); }}
                    placeholder="Pick a date"
                    hasError={!!errors.periodEnd}
                  />
                  {errors.periodEnd && <p className="text-xs text-red-500 mt-1 dark:text-red-400">{errors.periodEnd}</p>}
                </div>
              </div>

              {/* Reason */}
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 dark:text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                  Reason
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => { setReason(e.target.value); if (errors.reason) setErrors((p) => ({ ...p, reason: '' })); }}
                  rows={3}
                  className={`w-full px-3 py-2 text-sm text-stone-800 dark:text-[#F5F0EB] bg-stone-50/80 dark:bg-[#2A2A2D] border rounded-lg placeholder:text-stone-400 dark:placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 transition-all duration-150 resize-none ${
                    errors.reason
                      ? 'border-red-400 focus:ring-red-400/20'
                      : 'border-stone-200 dark:border-[rgba(255,255,255,0.06)] focus:ring-emerald-400/20 focus:border-emerald-400 dark:focus:border-emerald-500/40'
                  }`}
                  placeholder="Reason for your leave..."
                />
                {errors.reason && <p className="text-xs text-red-500 mt-1 dark:text-red-400">{errors.reason}</p>}
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-start gap-2 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 text-sm px-3 py-2.5 rounded-lg border border-red-200/60 dark:border-red-500/20">
                  <X className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3.5 border-t border-stone-100 dark:border-[rgba(255,255,255,0.06)] bg-stone-50/60 dark:bg-[#141414] rounded-b-2xl flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 text-sm font-medium text-stone-500 dark:text-[var(--text-secondary)] hover:text-stone-700 dark:hover:text-[#F5F0EB] hover:bg-stone-100 dark:hover:bg-[#2A2A2D] rounded-lg transition-colors duration-150 cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="px-5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm shadow-emerald-600/20 transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 disabled:opacity-40 disabled:shadow-none"
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Submitting...
                  </span>
                ) : (
                  'File Leave'
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
