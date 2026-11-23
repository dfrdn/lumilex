'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, MessageSquare, ChevronDown, Check, CheckCircle2 } from 'lucide-react';
import { useEnumValues } from '@/hooks/use-enum-options';

export interface SubmittedFeedback {
  notion_id: string;
  subject: string;
  type: string;
  feedback_date: string | null;
  message: string;
  response: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: (created: SubmittedFeedback | null) => void;
}

export default function SubmitFeedbackModal({ open, onClose, onSaved }: Props) {
  const [subject, setSubject] = useState('');
  const [type, setType] = useState('');
  const feedbackTypes = useEnumValues('feedbacks', 'type');
  const [message, setMessage] = useState('');
  const [typeOpen, setTypeOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setSubject('');
      setType('');
      setMessage('');
      setSuccess(false);
      setError('');
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

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, type, message }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit feedback');
      }
      onSaved?.(data.feedback ?? null);
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
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px] animate-overlay"
        onClick={submitting ? undefined : onClose}
      />

      {/* Modal */}
      <div className="relative bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-2xl shadow-stone-900/10 dark:shadow-black/30 w-full max-w-md animate-dialog ring-1 ring-stone-900/5 dark:ring-white/5 overflow-hidden">
        {/* Header */}
        <div className="relative px-5 pt-5 pb-4">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-400 via-violet-500 to-purple-400" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-50 to-violet-100 dark:from-violet-500/10 dark:to-violet-500/20 flex items-center justify-center ring-1 ring-violet-200/60 dark:ring-violet-500/20">
                <MessageSquare className="w-4.5 h-4.5 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-stone-900 dark:text-[#F5F0EB] leading-tight">Submit Feedback</h2>
                <p className="text-xs text-stone-400 dark:text-[var(--text-muted)] mt-0.5">Share your thoughts with the team</p>
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

        {/* Success state */}
        {success ? (
          <div className="px-6 py-14 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-50 dark:bg-emerald-500/10 ring-4 ring-emerald-100/60 dark:ring-emerald-500/5 flex items-center justify-center mx-auto mb-4 animate-scale-in">
              <CheckCircle2 className="w-7 h-7 text-emerald-500 dark:text-emerald-400" />
            </div>
            <p className="text-lg font-semibold text-stone-900 dark:text-[#F5F0EB]">Feedback Submitted</p>
            <p className="text-sm text-stone-400 dark:text-[var(--text-muted)] mt-1">Thank you for your feedback.</p>
          </div>
        ) : (
          <>
            {/* Form body */}
            <div className="px-5 pb-5 space-y-4 max-h-[62vh] overflow-y-auto">
              {/* Subject */}
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 dark:text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                  Subject
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  autoFocus
                  className="w-full px-3 py-2 text-sm text-stone-800 dark:text-[#F5F0EB] bg-stone-50/80 dark:bg-[#2A2A2D] border border-stone-200 dark:border-[rgba(255,255,255,0.06)] rounded-lg placeholder:text-stone-400 dark:placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-violet-400/20 focus:border-violet-400 dark:focus:border-violet-500/40 transition-all duration-150"
                  placeholder="Brief summary of your feedback"
                />
              </div>

              {/* Type */}
              <div className="relative">
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 dark:text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                  Type
                </label>
                <button
                  type="button"
                  onClick={() => setTypeOpen((o) => !o)}
                  className={`w-full flex items-center justify-between gap-1 px-3 py-2 text-sm rounded-lg transition-all duration-150 cursor-pointer border ${
                    typeOpen
                      ? 'border-violet-400 ring-2 ring-violet-400/20 bg-white dark:bg-[#2A2A2D] dark:border-violet-500/40'
                      : 'border-stone-200 dark:border-[rgba(255,255,255,0.06)] bg-stone-50/80 dark:bg-[#2A2A2D] hover:border-stone-300 dark:hover:border-[rgba(255,255,255,0.1)]'
                  }`}
                >
                  <span className={`truncate ${type ? 'text-stone-800 dark:text-[#F5F0EB]' : 'text-stone-400 dark:text-[var(--text-muted)]'}`}>
                    {type || 'Select type'}
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 text-stone-400 shrink-0 transition-transform duration-150 dark:text-stone-500 ${typeOpen ? 'rotate-180' : ''}`} />
                </button>

                {typeOpen && (
                  <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white dark:bg-[#2A2A2D] border border-stone-200 dark:border-[rgba(255,255,255,0.06)] rounded-lg shadow-lg shadow-stone-900/5 dark:shadow-black/20 py-0.5 max-h-52 overflow-y-auto animate-fade-down">
                    {feedbackTypes.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => { setType(opt); setTypeOpen(false); }}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors duration-75 cursor-pointer ${
                          type === opt
                            ? 'text-violet-700 dark:text-violet-400 bg-violet-50/80 dark:bg-violet-500/10 font-medium'
                            : 'text-stone-700 dark:text-[#F5F0EB] hover:bg-stone-50 dark:hover:bg-[#232326]'
                        }`}
                      >
                        {opt}
                        {type === opt && <Check className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400 shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Message */}
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 dark:text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                  Message
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 text-sm text-stone-800 dark:text-[#F5F0EB] bg-stone-50/80 dark:bg-[#2A2A2D] border border-stone-200 dark:border-[rgba(255,255,255,0.06)] rounded-lg placeholder:text-stone-400 dark:placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-violet-400/20 focus:border-violet-400 dark:focus:border-violet-500/40 transition-all duration-150 resize-none"
                  placeholder="Describe your feedback in detail..."
                />
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
                disabled={submitting || !subject || !type || !message}
                className="px-5 py-2 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-lg shadow-sm shadow-violet-600/20 transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 disabled:opacity-40 disabled:shadow-none"
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
                  'Submit Feedback'
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
