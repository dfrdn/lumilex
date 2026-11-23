'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Scale, ChevronRight, Calendar, AlertTriangle, BookOpen, Check, X, Loader2 } from 'lucide-react';
import DatePickerInput from '@/components/DatePickerInput';
import { parseRuleCitations, sectionHref } from '@/lib/rules/model';
import type { RuleSet } from '@/lib/legal/court-rules';
import { addDays } from '@/lib/dates';

interface ComputedPreview {
  id: string;
  label: string;
  computedDate: string;
  calendarType: string;
  entityType: 'deliverable' | 'hearing';
  hearingType?: string;
  isReglementary: boolean;
  legalBasis: string;
  notes?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  matterId: string;
  matterType: string;
  onSuccess: () => void;
}

function formatDate(d: string): string {
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila',
  });
}

export default function DeadlineCalculatorModal({ open, onClose, matterId, matterType, onSuccess }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedRuleSet, setSelectedRuleSet] = useState<RuleSet | null>(null);
  const [triggerDate, setTriggerDate] = useState('');
  const [preview, setPreview] = useState<ComputedPreview[]>([]);
  const [computing, setComputing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);

  const [allRuleSets, setAllRuleSets] = useState<RuleSet[]>([]);

  // Fetch rule sets from API
  useEffect(() => {
    if (!open) return;
    fetch(`/api/court-rules?matterType=${encodeURIComponent(matterType)}`)
      .then((r) => r.json())
      .then((d) => setAllRuleSets(d.data ?? []))
      .catch(() => {});
  }, [open, matterType]);

  const applicableRuleSets = allRuleSets;

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep(1);
      setSelectedRuleSet(null);
      setTriggerDate('');
      setPreview([]);
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

  const handleSelectRuleSet = (rs: RuleSet) => {
    setSelectedRuleSet(rs);
    setStep(2);
  };

  const handleComputePreview = async () => {
    if (!selectedRuleSet || !triggerDate) return;
    setComputing(true);
    setError('');

    try {
      // Use the client-side preview (call the calculation API or compute locally)
      // We'll compute client-side from the rule set data
      const deadlines: ComputedPreview[] = [];
      const computedDates = new Map<string, string>();

      for (const dl of selectedRuleSet.deadlines) {
        const baseDate = dl.dependsOn
          ? computedDates.get(dl.dependsOn) ?? triggerDate
          : triggerDate;

        // Simple calendar day calculation for preview
        // Business day calculation would need the API, but for preview we approximate
        const computedDate = addDays(
          baseDate,
          dl.calendarType === 'calendar'
            ? dl.daysFromTrigger
            // Approximate business days (multiply by 7/5)
            : Math.ceil(dl.daysFromTrigger * 7 / 5),
        );

        computedDates.set(dl.id, computedDate);
        deadlines.push({
          id: dl.id,
          label: dl.label,
          computedDate,
          calendarType: dl.calendarType,
          entityType: dl.entityType,
          hearingType: dl.hearingType,
          isReglementary: dl.isReglementary,
          legalBasis: dl.legalBasis,
          notes: dl.notes,
        });
      }

      setPreview(deadlines);
      setStep(3);
    } catch {
      setError('Failed to compute deadlines');
    }
    setComputing(false);
  };

  const handleConfirm = async () => {
    if (!selectedRuleSet || !triggerDate) return;
    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/deadlines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matterId,
          ruleSetId: selectedRuleSet.id,
          triggerDate,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to apply deadline chain');
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

  const modal = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div
        ref={backdropRef}
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px] animate-overlay"
        onClick={onClose}
      />
      <div className="relative w-full max-w-2xl mx-4 bg-[var(--card-bg)] rounded-2xl shadow-2xl border border-[var(--border-color)] animate-dialog max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border-color)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-navy-500 dark:text-navy-400" />
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Apply Court Rules</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
            <X className="w-4 h-4 text-[var(--text-muted)]" />
          </button>
        </div>

        {/* Steps indicator */}
        <div className="px-6 py-3 border-b border-[var(--border-color)] flex items-center gap-2 text-xs shrink-0">
          {[
            { n: 1, label: 'Select Rule Set' },
            { n: 2, label: 'Trigger Date' },
            { n: 3, label: 'Preview & Confirm' },
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
              <p className="text-lg font-semibold text-[var(--text-primary)]">Deadline Chain Applied</p>
              <p className="text-sm text-[var(--text-secondary)] mt-1">Deliverables and hearings have been created.</p>
            </div>
          )}

          {/* Step 1: Select Rule Set */}
          {step === 1 && !success && (
            <div className="space-y-2">
              {applicableRuleSets.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] text-center py-8">
                  No court rules available for this matter type ({matterType}).
                </p>
              ) : (
                applicableRuleSets.map((rs) => (
                  <button
                    key={rs.id}
                    onClick={() => handleSelectRuleSet(rs)}
                    className="w-full text-left px-4 py-3.5 rounded-xl border border-[var(--border-color)] hover:border-navy-300 dark:hover:border-navy-600 hover:bg-navy-50/30 dark:hover:bg-navy-500/5 transition-all group"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-[var(--text-primary)] group-hover:text-navy-600 dark:group-hover:text-navy-400 transition-colors">
                          {rs.name}
                        </p>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">
                          {rs.triggerEventLabel}
                        </p>
                        <p className="text-[10px] text-[var(--text-muted)] mt-1">
                          {rs.deadlines.length} deadline{rs.deadlines.length !== 1 ? 's' : ''}: {rs.deadlines.map((d) => d.label).join(', ')}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[var(--text-muted)] group-hover:text-navy-500 transition-colors shrink-0" />
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

          {/* Step 2: Trigger Date */}
          {step === 2 && !success && selectedRuleSet && (
            <div>
              <div className="mb-6 p-4 rounded-xl bg-navy-50/30 dark:bg-navy-500/5 border border-navy-200/50 dark:border-navy-500/15">
                <p className="text-sm font-medium text-navy-700 dark:text-navy-400">{selectedRuleSet.name}</p>
                <p className="text-xs text-navy-600/70 dark:text-navy-400/60 mt-0.5">{selectedRuleSet.triggerEventLabel}</p>
              </div>

              <label className="block text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">
                <Calendar className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
                Trigger Date
              </label>
              <DatePickerInput
                variant="token"
                value={triggerDate || null}
                onChange={(v) => setTriggerDate(v ?? '')}
                placeholder="Pick a date"
              />

              <div className="flex items-center gap-3 mt-6">
                <button
                  onClick={() => setStep(1)}
                  className="px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleComputePreview}
                  disabled={!triggerDate || computing}
                  className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-navy-600 hover:bg-navy-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-colors"
                >
                  {computing && <Loader2 className="w-4 h-4 animate-spin" />}
                  Compute Deadlines
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Preview & Confirm */}
          {step === 3 && !success && preview.length > 0 && (
            <div>
              <div className="mb-4 p-4 rounded-xl bg-navy-50/30 dark:bg-navy-500/5 border border-navy-200/50 dark:border-navy-500/15">
                <p className="text-sm font-medium text-navy-700 dark:text-navy-400">{selectedRuleSet?.name}</p>
                <p className="text-xs text-navy-600/70 dark:text-navy-400/60 mt-0.5">
                  Trigger: {formatDate(triggerDate)}
                </p>
              </div>

              <div className="space-y-2">
                {preview.map((dl) => (
                  <div
                    key={dl.id}
                    className="px-4 py-3 rounded-xl border border-[var(--border-color)] bg-white/50 dark:bg-white/[0.02]"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-[var(--text-primary)]">{dl.label}</span>
                      {dl.isReglementary && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          Reglementary
                        </span>
                      )}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        dl.entityType === 'hearing'
                          ? 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400'
                          : 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400'
                      }`}>
                        {dl.entityType === 'hearing' ? 'Hearing' : 'Filing'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-[var(--text-secondary)] font-mono font-medium">
                        {formatDate(dl.computedDate)}
                      </span>
                      {dl.calendarType === 'business' && (
                        <span className="text-[10px] text-amber-600 dark:text-amber-400">
                          (business days — final date computed server-side)
                        </span>
                      )}
                      {dl.legalBasis && (() => {
                        const cite = parseRuleCitations(dl.legalBasis)[0];
                        const cls = 'inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)]';
                        return cite ? (
                          <a href={sectionHref(cite.source, cite.rule, cite.section)} target="_blank" rel="noopener noreferrer" title="Read the rule in the Library" className={`${cls} hover:text-gold-600 dark:hover:text-gold-400 underline-offset-2 hover:underline`}>
                            <BookOpen className="w-3 h-3" />
                            {dl.legalBasis}
                          </a>
                        ) : (
                          <span className={cls}>
                            <BookOpen className="w-3 h-3" />
                            {dl.legalBasis}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                ))}
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
                  Apply Deadline Chain
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
