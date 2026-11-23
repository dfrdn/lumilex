'use client';

import { useState, useMemo, useCallback } from 'react';
import useSWR, { type KeyedMutator } from 'swr';
import {
  CalendarDays, Receipt, MessageSquare,
  CheckCircle2, XCircle, Clock, AlertCircle,
  PieChart, TrendingUp, Pencil, Trash2,
} from 'lucide-react';
import FileReimbursementModal, { type EditingReimbursement } from '@/components/FileReimbursementModal';
import FileLeaveModal, { type FiledLeave } from '@/components/FileLeaveModal';
import SubmitFeedbackModal, { type SubmittedFeedback } from '@/components/SubmitFeedbackModal';

// ── Types ────────────────────────────────────────────

type Leave = FiledLeave;
type Feedback = SubmittedFeedback;

/** Which "file a new request" buttons this view offers. */
export type SubmissionAction = 'leave' | 'reimbursement' | 'feedback';

interface Reimbursement {
  notion_id: string;
  expense: string;
  amount: number;
  expense_category: string;
  expense_date: string | null;
  matter_id: string | null;
  matter_name: string;
  client_id: string | null;
  client_name: string;
  reimbursed: boolean;
  receipt_urls: { name: string; url: string; path?: string }[];
  synced_at: string;
}

type Tab = 'leaves' | 'reimbursements' | 'feedbacks';

const TABS: { key: Tab; label: string; icon: typeof CalendarDays }[] = [
  { key: 'leaves', label: 'Leaves', icon: CalendarDays },
  { key: 'reimbursements', label: 'Reimbursements', icon: Receipt },
  { key: 'feedbacks', label: 'Feedbacks', icon: MessageSquare },
];

function StatusBadge({ status }: { status: string }) {
  const lower = status.toLowerCase();
  if (lower === 'approved' || lower === 'reimbursed') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-200/60 dark:ring-emerald-500/20">
        <CheckCircle2 className="w-3 h-3" />
        {status}
      </span>
    );
  }
  if (lower === 'rejected' || lower === 'denied') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 ring-1 ring-red-200/60 dark:ring-red-500/20">
        <XCircle className="w-3 h-3" />
        {status}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-1 ring-amber-200/60 dark:ring-amber-500/20">
      <Clock className="w-3 h-3" />
      {status}
    </span>
  );
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  });
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount);
}

// ── Leave Analytics ──────────────────────────────────

function LeaveAnalytics({ leaves }: { leaves: Leave[] }) {
  const stats = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const thisYear = leaves.filter((l) => {
      const d = l.period_start ? new Date(l.period_start).getFullYear() : 0;
      return d === currentYear;
    });

    const approved = thisYear.filter((l) => l.status.toLowerCase() === 'approved');
    const pending = thisYear.filter((l) => l.status.toLowerCase() === 'pending');
    const rejected = thisYear.filter((l) => l.status.toLowerCase() === 'rejected' || l.status.toLowerCase() === 'denied');

    // Count days for approved leaves
    const totalDays = approved.reduce((sum, l) => {
      if (!l.period_start) return sum;
      const start = new Date(l.period_start);
      const end = l.period_end ? new Date(l.period_end) : start;
      const diff = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
      return sum + diff;
    }, 0);

    // By type
    const byType: Record<string, number> = {};
    for (const l of approved) {
      byType[l.leave_type] = (byType[l.leave_type] || 0) + 1;
    }

    return { total: thisYear.length, approved: approved.length, pending: pending.length, rejected: rejected.length, totalDays, byType };
  }, [leaves]);

  const typeEntries = Object.entries(stats.byType).sort((a, b) => b[1] - a[1]);
  const typeColors: Record<string, string> = {
    'Vacation Leave': 'bg-blue-500',
    'Sick Leave': 'bg-red-400',
    'Emergency Leave': 'bg-amber-500',
    'Personal Leave': 'bg-violet-500',
  };

  return (
    <div className="mb-6 space-y-4">
      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-[#1C1C1E] rounded-xl p-4 ring-1 ring-stone-900/5 dark:ring-white/5">
          <div className="flex items-center gap-2 text-xs font-medium text-stone-400 dark:text-[var(--text-muted)] uppercase tracking-wider mb-2">
            <TrendingUp className="w-3.5 h-3.5" />
            Total ({new Date().getFullYear()})
          </div>
          <p className="text-2xl font-bold text-stone-900 dark:text-[#F5F0EB]">{stats.total}</p>
          <p className="text-xs text-stone-400 dark:text-[var(--text-muted)] mt-0.5">{stats.totalDays} day{stats.totalDays !== 1 ? 's' : ''} taken</p>
        </div>
        <div className="bg-white dark:bg-[#1C1C1E] rounded-xl p-4 ring-1 ring-stone-900/5 dark:ring-white/5">
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-2">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Approved
          </div>
          <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{stats.approved}</p>
        </div>
        <div className="bg-white dark:bg-[#1C1C1E] rounded-xl p-4 ring-1 ring-stone-900/5 dark:ring-white/5">
          <div className="flex items-center gap-2 text-xs font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-2">
            <Clock className="w-3.5 h-3.5" />
            Pending
          </div>
          <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{stats.pending}</p>
        </div>
        <div className="bg-white dark:bg-[#1C1C1E] rounded-xl p-4 ring-1 ring-stone-900/5 dark:ring-white/5">
          <div className="flex items-center gap-2 text-xs font-medium text-red-600 dark:text-red-400 uppercase tracking-wider mb-2">
            <XCircle className="w-3.5 h-3.5" />
            Rejected
          </div>
          <p className="text-2xl font-bold text-red-700 dark:text-red-400">{stats.rejected}</p>
        </div>
      </div>

      {/* By type breakdown */}
      {typeEntries.length > 0 && (
        <div className="bg-white dark:bg-[#1C1C1E] rounded-xl p-4 ring-1 ring-stone-900/5 dark:ring-white/5">
          <div className="flex items-center gap-2 text-xs font-medium text-stone-400 dark:text-[var(--text-muted)] uppercase tracking-wider mb-3">
            <PieChart className="w-3.5 h-3.5" />
            Approved by Type
          </div>
          <div className="space-y-2.5">
            {typeEntries.map(([type, count]) => {
              const pct = stats.approved > 0 ? (count / stats.approved) * 100 : 0;
              return (
                <div key={type}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-stone-700 dark:text-[#C5C0B8]">{type}</span>
                    <span className="text-stone-400 dark:text-[var(--text-muted)] font-mono text-xs">{count}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-stone-100 dark:bg-[#2A2A2D] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${typeColors[type] || 'bg-stone-400'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────

/** A setState-shaped writer for one list inside a cached SWR response. */
function useListSetter<K extends string, T>(mutate: KeyedMutator<{ [P in K]?: T[] }>, key: K) {
  return useCallback(
    (update: (prev: T[]) => T[]) =>
      mutate((d) => ({ ...d, [key]: update(d?.[key] ?? []) }) as { [P in K]?: T[] }, { revalidate: false }),
    [mutate, key],
  );
}

export default function MySubmissionsClient({ actions = [] }: { actions?: SubmissionAction[] }) {
  const [tab, setTab] = useState<Tab>('leaves');
  const { data: leaveData, error: leaveErr, mutate: mutateLeaves } = useSWR<{ leaves?: Leave[] }>('/api/leave');
  const { data: reimbData, error: reimbErr, mutate: mutateReimbursements } = useSWR<{ reimbursements?: Reimbursement[] }>('/api/reimbursement');
  const { data: feedbackData, error: feedbackErr, mutate: mutateFeedbacks } = useSWR<{ feedbacks?: Feedback[] }>('/api/feedback');
  const leaves = leaveData?.leaves ?? [];
  const reimbursements = reimbData?.reimbursements ?? [];
  const feedbacks = feedbackData?.feedbacks ?? [];
  const loading = (!leaveData && !leaveErr) || (!reimbData && !reimbErr) || (!feedbackData && !feedbackErr);
  const setLeaves = useListSetter(mutateLeaves, 'leaves');
  const setReimbursements = useListSetter(mutateReimbursements, 'reimbursements');
  const setFeedbacks = useListSetter(mutateFeedbacks, 'feedbacks');

  const [leaveOpen, setLeaveOpen] = useState(false);
  const [reimbOpen, setReimbOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const [editingReimb, setEditingReimb] = useState<Reimbursement | null>(null);
  const [deletingReimb, setDeletingReimb] = useState<Reimbursement | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleLeaveFiled = useCallback((created: Leave | null) => {
    if (!created) return;
    // The list is ordered newest period first — keep that invariant instead of
    // blindly prepending, since a filed leave can start in the past.
    setLeaves((prev) =>
      [created, ...prev].sort((a, b) => (b.period_start ?? '').localeCompare(a.period_start ?? '')),
    );
    setTab('leaves');
  }, [setLeaves]);

  const handleFeedbackSubmitted = useCallback((created: Feedback | null) => {
    if (!created) return;
    setFeedbacks((prev) => [created, ...prev]);
    setTab('feedbacks');
  }, [setFeedbacks]);

  const refetchReimbursements = useCallback(() => { void mutateReimbursements(); }, [mutateReimbursements]);

  async function handleConfirmDelete() {
    if (!deletingReimb) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const res = await fetch(
        `/api/reimbursement?notionId=${encodeURIComponent(deletingReimb.notion_id)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete');
      }
      setReimbursements((prev) => prev.filter((r) => r.notion_id !== deletingReimb.notion_id));
      setDeletingReimb(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setDeleteBusy(false);
    }
  }

  const editingPayload: EditingReimbursement | null = editingReimb
    ? {
        notion_id: editingReimb.notion_id,
        expense: editingReimb.expense,
        amount: editingReimb.amount,
        expense_category: editingReimb.expense_category,
        expense_date: editingReimb.expense_date,
        client_id: editingReimb.client_id,
        matter_id: editingReimb.matter_id,
        reimbursed: editingReimb.reimbursed,
        receipt_urls: editingReimb.receipt_urls ?? [],
      }
    : null;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-900 dark:text-[#F5F0EB]">My Requests</h1>
          <p className="text-sm text-stone-400 dark:text-[var(--text-muted)] mt-1">Track your filed leaves, reimbursements, and feedbacks</p>
        </div>
        {actions.length > 0 && (
          <div className="flex items-center gap-2.5 flex-wrap shrink-0">
            {actions.includes('leave') && (
              <button
                onClick={() => setLeaveOpen(true)}
                className="action-lift press inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-secondary)] hover:border-emerald-300 dark:hover:border-emerald-500/30 hover:text-emerald-700 dark:hover:text-emerald-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-500/5 cursor-pointer"
              >
                <CalendarDays className="w-3.5 h-3.5 text-emerald-500/60 dark:text-emerald-500/40" />
                File Leave
              </button>
            )}
            {actions.includes('reimbursement') && (
              <button
                onClick={() => setReimbOpen(true)}
                className="action-lift press inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-secondary)] hover:border-gold-300 dark:hover:border-gold-500/30 hover:text-gold-700 dark:hover:text-gold-400 hover:bg-gold-50/50 dark:hover:bg-gold-500/5 cursor-pointer"
              >
                <Receipt className="w-3.5 h-3.5 text-gold-500/60 dark:text-gold-500/40" />
                File Reimbursement
              </button>
            )}
            {actions.includes('feedback') && (
              <button
                onClick={() => setFeedbackOpen(true)}
                className="action-lift press inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-secondary)] hover:border-violet-300 dark:hover:border-violet-500/30 hover:text-violet-700 dark:hover:text-violet-400 hover:bg-violet-50/50 dark:hover:bg-violet-500/5 cursor-pointer"
              >
                <MessageSquare className="w-3.5 h-3.5 text-violet-500/60 dark:text-violet-500/40" />
                Submit Feedback
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-stone-100 dark:bg-[#1C1C1E] rounded-xl mb-6 ring-1 ring-stone-900/5 dark:ring-white/5">
        {TABS.map(({ key, label, icon: Icon }) => {
          const count = key === 'leaves' ? leaves.length : key === 'reimbursements' ? reimbursements.length : feedbacks.length;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer ${
                tab === key
                  ? 'bg-white dark:bg-[#2A2A2D] text-stone-900 dark:text-[#F5F0EB] shadow-sm'
                  : 'text-stone-500 dark:text-[var(--text-muted)] hover:text-stone-700 dark:hover:text-[#9B978F]'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{label}</span>
              {!loading && count > 0 && (
                <span className={`text-xs font-mono px-1.5 py-0.5 rounded-full ${
                  tab === key
                    ? 'bg-stone-100 dark:bg-[#1C1C1E] text-stone-600 dark:text-[#9B978F]'
                    : 'bg-stone-200/60 dark:bg-[#232326] text-stone-400 dark:text-[var(--text-muted)]'
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex gap-1.5">
            <div className="w-2 h-2 rounded-full bg-gold-400 animate-pulse" />
            <div className="w-2 h-2 rounded-full bg-gold-400 animate-pulse" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 rounded-full bg-gold-400 animate-pulse" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      )}

      {/* ── Leaves Tab ─────────────────────────────────── */}
      {!loading && tab === 'leaves' && (
        <>
          <LeaveAnalytics leaves={leaves} />

          {leaves.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              message="No leave requests filed yet"
              action={actions.includes('leave') ? { label: 'File Leave', onClick: () => setLeaveOpen(true) } : undefined}
            />
          ) : (
            <div className="space-y-3">
              {leaves.map((leave) => (
                <div
                  key={leave.notion_id}
                  className="bg-white dark:bg-[#1C1C1E] rounded-xl p-4 ring-1 ring-stone-900/5 dark:ring-white/5"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <p className="text-sm font-medium text-stone-900 dark:text-[#F5F0EB]">{leave.leave_type}</p>
                      <p className="text-xs text-stone-400 dark:text-[#5E5B55] mt-0.5">
                        {formatDate(leave.period_start)}
                        {leave.period_end && leave.period_end !== leave.period_start && ` — ${formatDate(leave.period_end)}`}
                      </p>
                    </div>
                    <StatusBadge status={leave.status} />
                  </div>
                  {leave.reason && (
                    <p className="text-sm text-stone-600 dark:text-[#9B978F] line-clamp-2">{leave.reason}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Reimbursements Tab ─────────────────────────── */}
      {!loading && tab === 'reimbursements' && (
        <>
          {/* Quick summary */}
          {reimbursements.length > 0 && (
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="bg-white dark:bg-[#1C1C1E] rounded-xl p-4 ring-1 ring-stone-900/5 dark:ring-white/5">
                <p className="text-xs font-medium text-stone-400 dark:text-[var(--text-muted)] uppercase tracking-wider mb-1">Total Filed</p>
                <p className="text-2xl font-bold text-stone-900 dark:text-[#F5F0EB]">
                  {formatCurrency(reimbursements.reduce((s, r) => s + r.amount, 0))}
                </p>
              </div>
              <div className="bg-white dark:bg-[#1C1C1E] rounded-xl p-4 ring-1 ring-stone-900/5 dark:ring-white/5">
                <p className="text-xs font-medium text-stone-400 dark:text-[var(--text-muted)] uppercase tracking-wider mb-1">Pending</p>
                <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">
                  {formatCurrency(reimbursements.filter((r) => !r.reimbursed).reduce((s, r) => s + r.amount, 0))}
                </p>
              </div>
            </div>
          )}

          {reimbursements.length === 0 ? (
            <EmptyState
              icon={Receipt}
              message="No reimbursements filed yet"
              action={actions.includes('reimbursement') ? { label: 'File Reimbursement', onClick: () => setReimbOpen(true) } : undefined}
            />
          ) : (
            <div className="space-y-3">
              {reimbursements.map((r) => (
                <div
                  key={r.notion_id}
                  className="bg-white dark:bg-[#1C1C1E] rounded-xl p-4 ring-1 ring-stone-900/5 dark:ring-white/5"
                >
                  <div className="flex items-start justify-between gap-3 mb-1.5">
                    <div>
                      <p className="text-sm font-medium text-stone-900 dark:text-[#F5F0EB]">{r.expense}</p>
                      <p className="text-xs text-stone-400 dark:text-[#5E5B55] mt-0.5">
                        {r.expense_category} · {formatDate(r.expense_date)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-stone-900 dark:text-[#F5F0EB] font-mono">{formatCurrency(r.amount)}</p>
                      <StatusBadge status={r.reimbursed ? 'Reimbursed' : 'Pending'} />
                    </div>
                  </div>
                  {(r.client_name || r.matter_name) && (
                    <p className="text-xs text-stone-400 dark:text-[var(--text-muted)]">
                      {r.client_name}{r.matter_name ? ` · ${r.matter_name}` : ''}
                    </p>
                  )}
                  {r.receipt_urls && r.receipt_urls.length > 0 && (
                    <div className="flex items-center gap-1.5 mt-2">
                      <span className="text-[10px] text-stone-400 dark:text-[var(--text-muted)] uppercase tracking-wider">Receipts:</span>
                      {r.receipt_urls.map((file, i) => (
                        <a
                          key={i}
                          href={file.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-gold-600 dark:text-gold-400 hover:underline truncate max-w-[120px]"
                        >
                          {file.name}
                        </a>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-end gap-1 mt-3 pt-2.5 border-t border-stone-100 dark:border-[rgba(255,255,255,0.06)]">
                    <button
                      type="button"
                      onClick={() => setEditingReimb(r)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-stone-500 dark:text-[#9B978F] hover:text-stone-800 dark:hover:text-[#F5F0EB] hover:bg-stone-100 dark:hover:bg-[#2A2A2D] rounded-md transition-colors cursor-pointer"
                      title={r.reimbursed ? 'Add receipts' : 'Edit reimbursement'}
                    >
                      <Pencil className="w-3 h-3" />
                      {r.reimbursed ? 'Add Receipts' : 'Edit'}
                    </button>
                    {!r.reimbursed && (
                      <button
                        type="button"
                        onClick={() => { setDeletingReimb(r); setDeleteError(null); }}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-stone-500 dark:text-[#9B978F] hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md transition-colors cursor-pointer"
                        title="Delete reimbursement"
                      >
                        <Trash2 className="w-3 h-3" />
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Feedbacks Tab ──────────────────────────────── */}
      {!loading && tab === 'feedbacks' && (
        <>
          {feedbacks.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              message="No feedbacks submitted yet"
              action={actions.includes('feedback') ? { label: 'Submit Feedback', onClick: () => setFeedbackOpen(true) } : undefined}
            />
          ) : (
            <div className="space-y-3">
              {feedbacks.map((f) => (
                <div
                  key={f.notion_id}
                  className="bg-white dark:bg-[#1C1C1E] rounded-xl p-4 ring-1 ring-stone-900/5 dark:ring-white/5"
                >
                  <div className="flex items-start justify-between gap-3 mb-1.5">
                    <div>
                      <p className="text-sm font-medium text-stone-900 dark:text-[#F5F0EB]">{f.subject}</p>
                      <p className="text-xs text-stone-400 dark:text-[#5E5B55] mt-0.5">
                        {f.type} · {formatDate(f.feedback_date)}
                      </p>
                    </div>
                    {f.response ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-200/60 dark:ring-emerald-500/20 shrink-0">
                        <CheckCircle2 className="w-3 h-3" />
                        Responded
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-stone-100 dark:bg-[#2A2A2D] text-stone-500 dark:text-[var(--text-muted)] ring-1 ring-stone-200/60 dark:ring-white/5 shrink-0">
                        <AlertCircle className="w-3 h-3" />
                        Awaiting
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-stone-600 dark:text-[#9B978F] line-clamp-2">{f.message}</p>
                  {f.response && (
                    <div className="mt-3 pt-3 border-t border-stone-100 dark:border-[rgba(255,255,255,0.06)]">
                      <p className="text-[10px] font-semibold text-stone-400 dark:text-[var(--text-muted)] uppercase tracking-wider mb-1">Response</p>
                      <p className="text-sm text-stone-700 dark:text-[#C5C0B8]">{f.response}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* File leave / submit feedback modals */}
      {actions.includes('leave') && (
        <FileLeaveModal open={leaveOpen} onClose={() => setLeaveOpen(false)} onSaved={handleLeaveFiled} />
      )}
      {actions.includes('reimbursement') && (
        <FileReimbursementModal
          open={reimbOpen}
          onClose={() => setReimbOpen(false)}
          onSaved={() => { refetchReimbursements(); setTab('reimbursements'); }}
        />
      )}
      {actions.includes('feedback') && (
        <SubmitFeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} onSaved={handleFeedbackSubmitted} />
      )}

      {/* Edit reimbursement modal */}
      <FileReimbursementModal
        open={!!editingReimb}
        onClose={() => setEditingReimb(null)}
        editing={editingPayload}
        onSaved={refetchReimbursements}
      />

      {/* Delete confirmation */}
      {deletingReimb && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
            onClick={deleteBusy ? undefined : () => setDeletingReimb(null)}
          />
          <div className="relative bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-2xl w-full max-w-sm ring-1 ring-stone-900/5 dark:ring-white/5 overflow-hidden">
            <div className="px-5 pt-5 pb-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center ring-1 ring-red-200/60 dark:ring-red-500/20">
                  <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
                </div>
                <h2 className="text-base font-semibold text-stone-900 dark:text-[#F5F0EB]">Delete reimbursement?</h2>
              </div>
              <p className="text-sm text-stone-600 dark:text-[#9B978F]">
                &quot;{deletingReimb.expense}&quot; ({formatCurrency(deletingReimb.amount)}) will be permanently removed along with any uploaded receipts.
              </p>
              {deleteError && (
                <p className="mt-3 text-xs text-red-600 dark:text-red-400">{deleteError}</p>
              )}
            </div>
            <div className="px-5 py-3 bg-stone-50/60 dark:bg-[#141414] border-t border-stone-100 dark:border-[rgba(255,255,255,0.06)] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeletingReimb(null)}
                disabled={deleteBusy}
                className="px-3 py-1.5 text-sm font-medium text-stone-500 dark:text-[#9B978F] hover:text-stone-800 dark:hover:text-[#F5F0EB] rounded-md transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleteBusy}
                className="px-3 py-1.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors cursor-pointer disabled:opacity-50"
              >
                {deleteBusy ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  message,
  action,
}: {
  icon: typeof CalendarDays;
  message: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-stone-400 dark:text-[var(--text-muted)]">
      <Icon className="w-10 h-10 mb-3 opacity-40" />
      <p className="text-sm">{message}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="action-lift press mt-4 inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-secondary)] hover:text-stone-800 dark:hover:text-[#F5F0EB] cursor-pointer"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
