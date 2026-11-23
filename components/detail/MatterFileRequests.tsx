'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Inbox,
  Plus,
  Clock,
  Check,
  X,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import DatePickerInput from '@/components/DatePickerInput';

interface FileRequest {
  id: string;
  matter_id: string;
  requested_by: string;
  description: string;
  due_at: string | null;
  created_at: string;
  fulfilled_at: string | null;
  fulfilled_by_client_user_id: string | null;
  canceled_at: string | null;
}

interface Props {
  matterId: string;
}

function formatDueDate(iso: string | null): { label: string; overdue: boolean } | null {
  if (!iso) return null;
  const due = new Date(iso);
  const overdue = due.getTime() < Date.now();
  const label = due.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Manila',
  });
  return { label, overdue };
}

function relativeDate(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Manila',
  });
}

export default function MatterFileRequests({ matterId }: Props) {
  const { data, mutate, isLoading } = useSWR<{ requests: FileRequest[] }>(
    `/api/matters/${encodeURIComponent(matterId)}/file-requests`,
  );
  const requests = data?.requests ?? [];
  const open = requests.filter((r) => !r.fulfilled_at && !r.canceled_at);
  const fulfilled = requests.filter((r) => r.fulfilled_at && !r.canceled_at);

  const [showCreate, setShowCreate] = useState(false);

  async function cancelRequest(id: string) {
    const next = {
      requests: requests.map((r) => (r.id === id ? { ...r, canceled_at: new Date().toISOString() } : r)),
    };
    try {
      await mutate(
        async () => {
          const res = await fetch(
            `/api/matters/${encodeURIComponent(matterId)}/file-requests/${id}`,
            { method: 'PATCH' },
          );
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to cancel');
          }
          return next;
        },
        { optimisticData: next, rollbackOnError: true, revalidate: true },
      );
      toast.success('Request canceled.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Cancel failed');
    }
  }

  return (
    <>
    <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden animate-fade-up mb-6">
      <div className="px-6 py-4 border-b border-[var(--border-color)] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Inbox className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
            Client file requests
          </h2>
          {open.length > 0 && (
            <span className="text-[10px] font-semibold text-gold-700 dark:text-gold-400 bg-gold-100 dark:bg-gold-400/10 rounded-full px-2 py-0.5">
              {open.length} open
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-white bg-navy-600 hover:bg-navy-700 rounded-lg px-3 py-1.5 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Request files
        </button>
      </div>

      <div className="p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-6 text-[var(--text-muted)]">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : requests.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)] text-center">
            No file requests yet. Click <span className="font-medium">Request files</span> to ask
            the client for specific documents.
          </p>
        ) : (
          <div className="space-y-4">
            {open.length > 0 && (
              <ul className="space-y-2">
                {open.map((r) => {
                  const due = formatDueDate(r.due_at);
                  return (
                    <li
                      key={r.id}
                      className="border border-gold-200 dark:border-gold-400/30 bg-gold-50/40 dark:bg-gold-400/5 rounded-xl px-4 py-3"
                    >
                      <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap">
                        {r.description}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-secondary)] mt-2">
                        <span>Sent {relativeDate(r.created_at)}</span>
                        {due && (
                          <>
                            <span className="text-[var(--text-muted)]">·</span>
                            <span
                              className={`inline-flex items-center gap-1 ${
                                due.overdue
                                  ? 'text-red-700 dark:text-red-400 font-medium'
                                  : ''
                              }`}
                            >
                              <Clock className="w-3 h-3" />
                              {due.overdue ? 'Overdue · ' : 'Due '}
                              {due.label}
                            </span>
                          </>
                        )}
                        <span className="text-[var(--text-muted)]">·</span>
                        <button
                          type="button"
                          onClick={() => cancelRequest(r.id)}
                          className="text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {fulfilled.length > 0 && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)] mb-2">
                  Fulfilled ({fulfilled.length})
                </p>
                <ul className="space-y-1.5">
                  {fulfilled.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-start gap-3 px-3 py-2 rounded-lg bg-subtle/40"
                    >
                      <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-[var(--text-primary)] line-clamp-2">
                          {r.description}
                        </p>
                        <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                          Fulfilled {relativeDate(r.fulfilled_at)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
    {showCreate && (
      <CreateRequestModal
        matterId={matterId}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          setShowCreate(false);
          mutate();
        }}
      />
    )}
    </>
  );
}

const EXAMPLES = [
  'Certified true copies of the IDs of the petitioner and respondent',
  'Latest bank statements for the period in question',
  'Marriage certificate (PSA copy)',
  'Latest General Information Sheet (GIS) and Articles of Incorporation',
];

function CreateRequestModal({
  matterId,
  onClose,
  onCreated,
}: {
  matterId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!description.trim()) return;
    setSubmitting(true);
    try {
      const dueAt = dueDate ? new Date(`${dueDate}T17:00:00+08:00`).toISOString() : null;
      const res = await fetch(
        `/api/matters/${encodeURIComponent(matterId)}/file-requests`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: description.trim(), dueAt }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create request');
      }
      toast.success('Request sent. Email is on its way to the client.');
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create request');
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
      <div className="w-full max-w-lg bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl shadow-[var(--shadow-elevated)]">
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-[var(--border-color)]">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              Request files from client
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              They'll get an email and see this in their portal.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-subtle transition-colors disabled:opacity-50"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              What do you need?
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="Be specific — e.g. 'Certified true copies of the IDs of both parties'"
              className="w-full text-sm text-[var(--text-primary)] bg-card border border-[var(--border-color)] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gold-500/30 focus:border-gold-500/50 transition-colors resize-none"
              disabled={submitting}
              maxLength={1000}
            />
            <div className="flex items-center justify-between mt-1">
              <p className="text-[10px] text-[var(--text-muted)]">
                {description.length}/1000
              </p>
              {description.length === 0 && (
                <details className="text-[10px]">
                  <summary className="text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-secondary)]">
                    Examples
                  </summary>
                  <ul className="mt-1 space-y-1">
                    {EXAMPLES.map((ex) => (
                      <li key={ex}>
                        <button
                          type="button"
                          onClick={() => setDescription(ex)}
                          className="text-left text-[var(--text-secondary)] hover:text-gold-700 dark:hover:text-gold-400 transition-colors"
                        >
                          {ex}
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Due date (optional)
            </label>
            <DatePickerInput
              variant="token"
              value={dueDate || null}
              onChange={(v) => setDueDate(v ?? '')}
              placeholder="Select due date"
            />
          </div>

          <div className="flex items-start gap-2 text-[11px] text-[var(--text-muted)] bg-subtle/40 rounded-lg px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              An email goes to every active client user on this matter.
            </span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border-color)]">
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
            onClick={handleSubmit}
            disabled={submitting || !description.trim()}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-navy-600 hover:bg-navy-700 disabled:bg-navy-600/50 disabled:cursor-not-allowed px-4 py-1.5 rounded-lg transition-colors"
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {submitting ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </div>
    </div>
  );
}
