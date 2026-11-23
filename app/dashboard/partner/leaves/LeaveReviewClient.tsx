'use client';

import { useState, useEffect, useMemo } from 'react';
import { CheckCircle, XCircle, Clock, Calendar, AlertCircle } from 'lucide-react';
import SharedAvatar from '@/components/Avatar';

interface Leave {
  notion_id: string;
  reason: string;
  name: string;
  leave_type: string;
  period_start: string | null;
  period_end: string | null;
  status: string;
  approved: boolean;
  decided_by: string | null;
  decided_by_name: string;
  decided_at: string | null;
  avatar_url: string | null;
  decided_by_avatar_url: string | null;
}

function parseUTCDate(yyyymmdd: string): Date {
  return new Date(yyyymmdd + 'T00:00:00Z');
}

// [Monday 00:00, Sunday 23:59:59.999] of the ISO week containing `d`, in UTC.
function isoWeekRange(d: Date): [Date, Date] {
  const day = d.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diffToMonday);
  monday.setUTCHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);
  return [monday, sunday];
}

function affectedWeekWindow(start: string, end: string | null): [Date, Date] {
  const startDate = parseUTCDate(start);
  const endDate = end ? parseUTCDate(end) : startDate;
  const [winStart] = isoWeekRange(startDate);
  const [, winEnd] = isoWeekRange(endDate);
  return [winStart, winEnd];
}

function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

function findWeeklyOverlaps(target: Leave, all: Leave[]): Leave[] {
  if (!target.period_start) return [];
  const [winStart, winEnd] = affectedWeekWindow(target.period_start, target.period_end);
  return all
    .filter((other) => {
      if (other.notion_id === target.notion_id) return false;
      if (other.status.toLowerCase() === 'rejected') return false;
      if (!other.period_start) return false;
      const oStart = parseUTCDate(other.period_start);
      const oEnd = parseUTCDate(other.period_end ?? other.period_start);
      return rangesOverlap(winStart, winEnd, oStart, oEnd);
    })
    .sort((a, b) => (a.period_start ?? '').localeCompare(b.period_start ?? ''));
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  return parseUTCDate(d).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

function formatDateShort(d: string | null): string {
  if (!d) return '';
  return parseUTCDate(d).toLocaleDateString('en-PH', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

function formatRangeShort(start: string | null, end: string | null): string {
  if (!start) return '—';
  if (!end || end === start) return formatDateShort(start);
  return `${formatDateShort(start)} – ${formatDateShort(end)}`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
    timeZone: 'Asia/Manila',
  });
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === 'approved') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20">
      <CheckCircle className="w-3 h-3" /> Approved
    </span>
  );
  if (s === 'rejected') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-full bg-red-50 text-red-700 ring-1 ring-inset ring-red-200/60 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20">
      <XCircle className="w-3 h-3" /> Rejected
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-full bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200/60 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20">
      <Clock className="w-3 h-3" /> Pending
    </span>
  );
}

function dayInLeave(day: Date, leave: Leave): boolean {
  if (!leave.period_start) return false;
  const start = parseUTCDate(leave.period_start);
  const end = parseUTCDate(leave.period_end ?? leave.period_start);
  return day >= start && day <= end;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_PALETTE = [
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
];

function avatarClass(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function Avatar({ name, avatarUrl, size = 'md' }: { name: string; avatarUrl?: string | null; size?: 'sm' | 'md' }) {
  const px = size === 'sm' ? 28 : 40;
  const fontPx = size === 'sm' ? 'text-[10px]' : 'text-xs';
  return (
    <SharedAvatar
      avatarUrl={avatarUrl}
      initials={initials(name || '?')}
      name={name}
      size={px}
      fallbackClassName={`${avatarClass(name || '?')} ${fontPx} font-semibold select-none`}
    />
  );
}

function formatDateWithWeekday(d: string | null): string {
  if (!d) return '—';
  return parseUTCDate(d).toLocaleDateString('en-PH', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

function OverlapStrip({ target, all }: { target: Leave; all: Leave[] }) {
  const overlaps = useMemo(() => findWeeklyOverlaps(target, all), [target, all]);

  if (!target.period_start) return null;

  if (overlaps.length === 0) {
    return (
      <div className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
        <CheckCircle className="w-3 h-3" />
        No other leaves overlap this week
      </div>
    );
  }

  // Build the day columns: Monday of the first affected week → Sunday of the last
  const [winStart, winEnd] = affectedWeekWindow(target.period_start, target.period_end);
  const days: Date[] = [];
  const cursor = new Date(winStart);
  while (cursor <= winEnd) {
    days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const dayLabel = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const dayIdx = (d: Date) => (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6

  // Daily headcount of leaves out (target + overlaps), to highlight conflict days
  const dailyCount = days.map(
    (d) => (dayInLeave(d, target) ? 1 : 0) + overlaps.filter((o) => dayInLeave(d, o)).length,
  );
  const maxOut = Math.max(...dailyCount, 1);

  const rows: Array<{ leave: Leave; label: string; kind: 'self' | 'pending' | 'approved' }> = [
    { leave: target, label: target.name || 'This request', kind: 'self' },
    ...overlaps.map((o) => ({
      leave: o,
      label: o.name || 'Unknown',
      kind: (o.status.toLowerCase() === 'pending' || o.status === '' ? 'pending' : 'approved') as
        | 'pending'
        | 'approved',
    })),
  ];

  const barClass = (kind: 'self' | 'pending' | 'approved', filled: boolean): string => {
    if (!filled) return '';
    if (kind === 'self') return 'bg-amber-400 dark:bg-amber-500/70';
    if (kind === 'pending') return 'bg-amber-200 dark:bg-amber-500/30 ring-1 ring-inset ring-amber-400/50';
    return 'bg-emerald-400 dark:bg-emerald-500/60';
  };

  const conflictTint = (count: number): string => {
    if (count <= 1) return 'bg-transparent';
    // Two or more out → tint the column header to flag the conflict
    if (count === 2) return 'bg-amber-100/70 dark:bg-amber-500/15';
    return 'bg-red-100/70 dark:bg-red-500/15';
  };

  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-2">
        <AlertCircle className="w-3 h-3" />
        {overlaps.length} other {overlaps.length === 1 ? 'leave' : 'leaves'} this week
      </div>
      <div className="overflow-x-auto">
        <div className="inline-block">
          <div className="flex">
            {/* Name column */}
            <div className="flex flex-col gap-1.5 pr-3 pt-[30px] shrink-0">
              {rows.map((row) => (
                <div
                  key={row.leave.notion_id}
                  className={`h-5 flex items-center justify-end text-[11px] whitespace-nowrap ${
                    row.kind === 'self'
                      ? 'font-semibold text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)]'
                  }`}
                >
                  {row.label}
                </div>
              ))}
            </div>
            {/* Day grid */}
            <div className="flex gap-px">
              {days.map((d, i) => {
                const isWeekend = dayIdx(d) >= 5;
                const count = dailyCount[i];
                return (
                  <div key={d.toISOString()} className="flex flex-col gap-1.5" style={{ width: 30 }}>
                    <div
                      className={`h-[26px] flex flex-col items-center justify-center rounded-md text-[10px] leading-tight ${
                        conflictTint(count)
                      } ${isWeekend ? 'text-[var(--text-muted)]/50' : 'text-[var(--text-muted)]'}`}
                      title={count > 1 ? `${count} people out on ${d.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}` : undefined}
                    >
                      <div className="font-medium uppercase tracking-wider">{dayLabel[dayIdx(d)]}</div>
                      <div className="tabular-nums font-semibold text-[var(--text-secondary)]">{d.getUTCDate()}</div>
                    </div>
                    {rows.map((row) => {
                      const filled = dayInLeave(d, row.leave);
                      return (
                        <div
                          key={row.leave.notion_id}
                          className={`h-5 rounded-md ${barClass(row.kind, filled)} ${
                            !filled ? (isWeekend ? 'bg-[var(--subtle-bg)]/40' : 'bg-[var(--subtle-bg)]/70') : ''
                          }`}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
          {/* Legend */}
          <div className="flex items-center gap-3 mt-3 text-[10px] text-[var(--text-muted)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-400 dark:bg-amber-500/70" />
              This request
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-400 dark:bg-emerald-500/60" />
              Approved
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-200 dark:bg-amber-500/30 ring-1 ring-inset ring-amber-400/50" />
              Pending
            </span>
            {maxOut >= 2 && (
              <span className="inline-flex items-center gap-1.5">
                <span className={`inline-block w-2.5 h-2.5 rounded-sm ${maxOut >= 3 ? 'bg-red-100 dark:bg-red-500/15' : 'bg-amber-100 dark:bg-amber-500/15'}`} />
                {maxOut}+ out
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function HistoricTable({
  leaves,
  showStatusColumn,
  actionLoading,
  onAction,
}: {
  leaves: Leave[];
  showStatusColumn: boolean;
  actionLoading: string | null;
  onAction: (id: string, action: 'approve' | 'reject') => void;
}) {
  const rows = useMemo(
    () =>
      [...leaves].sort((a, b) =>
        (b.period_start ?? '').localeCompare(a.period_start ?? ''),
      ),
    [leaves],
  );

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-card)]">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-[var(--subtle-bg)] text-left">
            <tr className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              <th className="px-4 py-2.5">Applicant</th>
              <th className="px-4 py-2.5">Type</th>
              <th className="px-4 py-2.5">Dates</th>
              <th className="px-4 py-2.5 hidden md:table-cell">Reason</th>
              {showStatusColumn && <th className="px-4 py-2.5">Status</th>}
              <th className="px-4 py-2.5">Decided by</th>
              <th className="px-4 py-2.5 w-px text-right" />
            </tr>
          </thead>
          <tbody>
            {rows.map((leave) => {
              const isPending = leave.status.toLowerCase() === 'pending' || leave.status === '';
              return (
                <tr
                  key={leave.notion_id}
                  className="border-t border-[var(--border-color)] hover:bg-[var(--subtle-bg)]/60"
                >
                  <td className="px-4 py-2.5 font-medium text-[var(--text-primary)] whitespace-nowrap">
                    {leave.name || 'Unknown'}
                  </td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">
                    {leave.leave_type || 'Leave'}
                  </td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">
                    {formatDate(leave.period_start)}
                    {leave.period_end && leave.period_end !== leave.period_start && (
                      <> – {formatDate(leave.period_end)}</>
                    )}
                  </td>
                  <td
                    className="px-4 py-2.5 text-[var(--text-muted)] hidden md:table-cell max-w-[24rem] truncate"
                    title={leave.reason || undefined}
                  >
                    {leave.reason || '—'}
                  </td>
                  {showStatusColumn && (
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <StatusBadge status={leave.status || 'Pending'} />
                    </td>
                  )}
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {leave.decided_by_name ? (
                      <div className="text-[var(--text-secondary)]">
                        {leave.decided_by_name}
                        {leave.decided_at && (
                          <div className="text-[11px] text-[var(--text-muted)]">{formatDateTime(leave.decided_at)}</div>
                        )}
                      </div>
                    ) : (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {isPending && (
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          onClick={() => onAction(leave.notion_id, 'approve')}
                          disabled={actionLoading === leave.notion_id}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-all duration-150 cursor-pointer disabled:opacity-50"
                        >
                          <CheckCircle className="w-3 h-3" />
                          Approve
                        </button>
                        <button
                          onClick={() => onAction(leave.notion_id, 'reject')}
                          disabled={actionLoading === leave.notion_id}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 ring-1 ring-inset ring-red-200/60 dark:ring-red-500/20 rounded-md transition-all duration-150 cursor-pointer disabled:opacity-50"
                        >
                          <XCircle className="w-3 h-3" />
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function LeaveReviewClient({ currentUserName }: { currentUserName: string }) {
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');

  useEffect(() => {
    fetch('/api/partner/leaves')
      .then((res) => res.json())
      .then((data) => setLeaves(data.leaves ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleAction = async (notionId: string, action: 'approve' | 'reject') => {
    setActionLoading(notionId);
    try {
      const res = await fetch('/api/partner/leaves', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notionId, action }),
      });
      if (res.ok) {
        const nowIso = new Date().toISOString();
        setLeaves((prev) =>
          prev.map((l) =>
            l.notion_id === notionId
              ? {
                  ...l,
                  status: action === 'approve' ? 'Approved' : 'Rejected',
                  approved: action === 'approve',
                  decided_by_name: currentUserName,
                  decided_at: nowIso,
                }
              : l
          )
        );
      }
    } catch {
      // silently fail
    } finally {
      setActionLoading(null);
    }
  };

  const pendingLeaves = useMemo(
    () => leaves.filter((l) => l.status.toLowerCase() === 'pending' || l.status === ''),
    [leaves],
  );
  const pendingCount = pendingLeaves.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-[var(--text-muted)]">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading leave requests...
        </div>
      </div>
    );
  }

  const tableLeaves =
    filter === 'all'
      ? leaves
      : leaves.filter((l) => l.status.toLowerCase() === filter);

  return (
    <div>
      {/* Filter tabs */}
      <div className="flex items-center gap-1 mb-6 bg-[var(--subtle-bg)] rounded-lg p-1 w-fit">
        {(['pending', 'all', 'approved', 'rejected'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 cursor-pointer capitalize ${
              filter === f
                ? 'bg-[var(--card-bg)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {f}
            {f === 'pending' && pendingCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400 rounded-full">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {filter === 'pending' ? (
        pendingLeaves.length === 0 ? (
          <div className="text-center py-16 text-[var(--text-muted)]">
            <Calendar className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium">No pending leave requests</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pendingLeaves.map((leave) => (
              <div
                key={leave.notion_id}
                className="relative overflow-hidden bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] pl-6 pr-5 py-5 transition-all duration-200 hover:shadow-[var(--shadow-card-hover)] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-amber-400 dark:before:bg-amber-500/70"
              >
                <div className="flex items-center gap-6 justify-between">
                  <div className="flex items-start gap-3 min-w-0 max-w-sm">
                    <Avatar name={leave.name || ''} avatarUrl={leave.avatar_url} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-[15px] font-semibold text-[var(--text-primary)] leading-tight">
                          {leave.name || 'Unknown'}
                        </h3>
                        <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-[var(--subtle-bg)] text-[var(--text-secondary)]">
                          {leave.leave_type || 'Leave'}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                        <Calendar className="w-3 h-3" />
                        <span className="tabular-nums">
                          {formatDateWithWeekday(leave.period_start)}
                          {leave.period_end && leave.period_end !== leave.period_start && (
                            <> &ndash; {formatDateWithWeekday(leave.period_end)}</>
                          )}
                        </span>
                      </div>
                      {leave.reason && (
                        <p className="mt-2 text-sm text-[var(--text-secondary)] leading-relaxed line-clamp-3">
                          {leave.reason}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0">
                    <OverlapStrip target={leave} all={leaves} />
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleAction(leave.notion_id, 'approve')}
                      disabled={actionLoading === leave.notion_id}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 rounded-lg shadow-sm transition-all duration-150 cursor-pointer disabled:opacity-50"
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      Approve
                    </button>
                    <button
                      onClick={() => handleAction(leave.notion_id, 'reject')}
                      disabled={actionLoading === leave.notion_id}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 ring-1 ring-inset ring-red-200/60 dark:ring-red-500/20 rounded-lg transition-all duration-150 cursor-pointer disabled:opacity-50"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : tableLeaves.length === 0 ? (
        <div className="text-center py-16 text-[var(--text-muted)]">
          <Calendar className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium">No {filter === 'all' ? '' : filter} leave requests</p>
        </div>
      ) : (
        <HistoricTable
          leaves={tableLeaves}
          showStatusColumn={filter === 'all'}
          actionLoading={actionLoading}
          onAction={handleAction}
        />
      )}
    </div>
  );
}
