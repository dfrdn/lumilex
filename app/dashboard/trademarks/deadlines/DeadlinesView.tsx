'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft, AlertTriangle, CalendarClock, CalendarDays, CalendarRange, Clock3, Mail, MailCheck, Send, Check, ChevronDown, CheckCircle2 } from 'lucide-react';
import CellDropdown from '@/components/admin/CellDropdown';
import type {
  DashboardDeadline,
  DeadlineKind,
  DeadlineUrgency,
} from '@/lib/trademark-deadlines';
import { refNo } from '@/lib/trademark-deadlines';
import SendTrademarkReportModal from '@/components/SendTrademarkReportModal';
import { toast } from 'sonner';
import { TrademarkActionButton, recordedToast } from '@/components/trademarks/actions';
import { actionForDeadline, type ActionSpec } from '@/lib/trademarks/actions';
import { formatDateShort } from '@/lib/format-date';
import { DueChip, RowThumb, StatusPill } from '@/components/ui/primitives';
import SummaryCards from '@/components/ui/SummaryCards';
import ListSection from '@/components/ui/ListSection';
import { BTN_OUTLINE, CARD, type PillTone } from '@/components/ui/tone';
import { confirmAction } from '@/components/ui/confirm';

const KIND_ORDER: DeadlineKind[] = [
  '1st Publication Fee', 'Issuance Fee', 'OA Response', 'Revival', '3-DAU', '5-DAU', 'Renewal', 'Renewal DAU', 'Renewal 5-DAU',
  'Local Filing', 'IR Renewal',
];

/** Prosecution in the mark's status colours; upkeep in amber, renewal in green. */
const KIND_TONE: Record<DeadlineKind, PillTone> = {
  '1st Publication Fee': 'blue',
  'Issuance Fee': 'blue',
  'OA Response': 'rose',
  Revival: 'rose',
  '3-DAU': 'amber',
  '5-DAU': 'amber',
  Renewal: 'emerald',
  'Renewal DAU': 'amber',
  'Renewal 5-DAU': 'amber',
  'Local Filing': 'amber',
  'IR Renewal': 'emerald',
};

const BUCKETS: { key: DeadlineUrgency; label: string; sub: string; icon: React.ReactNode; accent: 'rose' | 'amber' | 'navy' | 'stone' }[] = [
  { key: 'overdue', label: 'Overdue', sub: 'past the due date', icon: <AlertTriangle className="w-4 h-4" />, accent: 'rose' },
  { key: 'due_this_week', label: 'This week', sub: 'due within 7 days', icon: <Clock3 className="w-4 h-4" />, accent: 'amber' },
  { key: 'due_this_month', label: 'This month', sub: 'due within 30 days', icon: <CalendarClock className="w-4 h-4" />, accent: 'amber' },
  { key: 'due_within_90', label: 'Next 90 days', sub: 'due within 90 days', icon: <CalendarDays className="w-4 h-4" />, accent: 'navy' },
  { key: 'future', label: 'Later', sub: 'beyond 90 days', icon: <CalendarRange className="w-4 h-4" />, accent: 'stone' },
];

type ReportedFilter = 'any' | 'unreported' | 'reported';

interface Props {
  deadlines: DashboardDeadline[];
}

function deadlineKey(d: DashboardDeadline): string {
  // Two hand-entered filings on one mark can fall due the same day.
  return `${d.trademark.id}|${d.kind}|${d.localDeadlineId ?? d.due}`;
}

export default function DeadlinesView({ deadlines: deadlinesProp }: Props) {
  const [deadlines, setDeadlines] = useState(deadlinesProp);
  useEffect(() => { setDeadlines(deadlinesProp); }, [deadlinesProp]);

  const [kindFilter, setKindFilter] = useState<DeadlineKind | 'all'>('all');
  const [urgencyFilter, setUrgencyFilter] = useState<DeadlineUrgency | 'all'>('all');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [reportedFilter, setReportedFilter] = useState<ReportedFilter>('any');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modalDeadlines, setModalDeadlines] = useState<DashboardDeadline[] | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const clients = useMemo(() => {
    const set = new Map<string, string>();
    for (const d of deadlines) {
      if (d.trademark.clientId) set.set(d.trademark.clientId, d.trademark.clientName);
    }
    return [...set.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [deadlines]);

  const filtered = useMemo(() => {
    return deadlines.filter((d) => {
      if (kindFilter !== 'all' && d.kind !== kindFilter) return false;
      if (urgencyFilter !== 'all' && d.urgency !== urgencyFilter) return false;
      if (clientFilter !== 'all' && d.trademark.clientId !== clientFilter) return false;
      if (reportedFilter === 'unreported' && d.lastReport) return false;
      if (reportedFilter === 'reported' && !d.lastReport) return false;
      return true;
    });
  }, [deadlines, kindFilter, urgencyFilter, clientFilter, reportedFilter]);

  const grouped = useMemo(() => {
    const map = new Map<DeadlineUrgency, DashboardDeadline[]>();
    for (const d of filtered) {
      const list = map.get(d.urgency) ?? [];
      list.push(d);
      map.set(d.urgency, list);
    }
    return map;
  }, [filtered]);

  const totals = useMemo(() => {
    const counts: Record<DeadlineUrgency, number> = {
      overdue: 0,
      due_this_week: 0,
      due_this_month: 0,
      due_within_90: 0,
      future: 0,
    };
    for (const d of deadlines) counts[d.urgency]++;
    return counts;
  }, [deadlines]);

  const selectedDeadlines = useMemo(
    () => deadlines.filter((d) => selected.has(deadlineKey(d))),
    [deadlines, selected],
  );

  const selectedByClient = useMemo(() => {
    const map = new Map<string, DashboardDeadline[]>();
    for (const d of selectedDeadlines) {
      const cid = d.trademark.clientId ?? '__unknown__';
      const list = map.get(cid) ?? [];
      list.push(d);
      map.set(cid, list);
    }
    return [...map.values()];
  }, [selectedDeadlines]);

  function toggle(d: DashboardDeadline) {
    const k = deadlineKey(d);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function clearSelection() { setSelected(new Set()); }

  function openSendForRow(d: DashboardDeadline) {
    setModalDeadlines([d]);
  }

  function openSendForSelection() {
    if (selectedByClient.length === 0) return;
    if (selectedByClient.length > 1) {
      toast.error('That selection spans several clients — send per row, or filter to one client first.');
      return;
    }
    setModalDeadlines(selectedByClient[0]);
  }

  /** Record a report against these deadlines locally, as the server just did. */
  function markReported(keys: Set<string>, report: { sentAt: string; recipientEmail: string }) {
    setDeadlines((prev) =>
      prev.map((d) =>
        keys.has(deadlineKey(d))
          ? { ...d, lastReport: { trademarkId: d.trademark.id, deadlineKind: d.kind, deadlineDue: d.due, sentAt: report.sentAt, sentBy: '', recipientEmail: report.recipientEmail } }
          : d,
      ),
    );
  }

  async function bulkMarkReported() {
    if (selectedDeadlines.length === 0) return;
    const n = selectedDeadlines.length;
    if (!(await confirmAction({ title: `Mark ${n} deadline${n === 1 ? '' : 's'} as reported?`, message: 'No email is sent; this only records that the client was told.', confirmLabel: 'Mark reported' }))) return;
    setBulkBusy(true);
    try {
      const res = await fetch('/api/trademark/mark-reported', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deadlines: selectedDeadlines.map((d) => ({
            trademarkId: d.trademark.id, kind: d.kind, due: d.due,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      const markedKeys = new Set(selectedDeadlines.map(deadlineKey));
      markReported(markedKeys, { sentAt: new Date().toISOString(), recipientEmail: '' });
      toast.success(`${markedKeys.size} marked reported`);
      clearSelection();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="space-y-5 pb-24">
      <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
        <Link href="/dashboard/trademarks" className="inline-flex items-center gap-1 hover:text-stone-900 dark:hover:text-stone-100 transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> All trademarks
        </Link>
      </div>

      <SummaryCards
        className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
        cards={BUCKETS.map((b) => ({
          key: b.key,
          label: b.label,
          value: totals[b.key],
          sub: b.sub,
          icon: b.icon,
          accent: b.accent,
          active: urgencyFilter === b.key,
          onClick: () => setUrgencyFilter(urgencyFilter === b.key ? 'all' : b.key),
        }))}
      />

      {/* Filters */}
      <div className={`${CARD} flex flex-wrap gap-x-4 gap-y-2 items-center px-4 py-3`}>
        <FilterSelect
          label="Type"
          value={kindFilter}
          onChange={(v) => setKindFilter(v as DeadlineKind | 'all')}
          options={[
            { value: 'all', label: 'All types' },
            ...KIND_ORDER.map((k) => ({ value: k, label: k })),
          ]}
        />
        <FilterSelect
          label="Urgency"
          value={urgencyFilter}
          onChange={(v) => setUrgencyFilter(v as DeadlineUrgency | 'all')}
          options={[
            { value: 'all', label: 'All urgencies' },
            ...BUCKETS.map((b) => ({ value: b.key, label: b.label })),
          ]}
        />
        <FilterSelect
          label="Client"
          value={clientFilter}
          onChange={setClientFilter}
          options={[
            { value: 'all', label: 'All clients' },
            ...clients.map(([id, name]) => ({ value: id, label: name })),
          ]}
        />
        <FilterSelect
          label="Reported"
          value={reportedFilter}
          onChange={(v) => setReportedFilter(v as ReportedFilter)}
          options={[
            { value: 'any', label: 'Any' },
            { value: 'unreported', label: 'Not yet reported' },
            { value: 'reported', label: 'Already reported' },
          ]}
        />
        <span className="ml-auto text-xs tabular-nums text-stone-500 dark:text-stone-400">
          {filtered.length} of {deadlines.length} deadlines
        </span>
      </div>

      {/* Buckets */}
      {BUCKETS.map((b) => {
        const list = grouped.get(b.key);
        if (!list || list.length === 0) return null;
        return (
          <ListSection
            key={b.key}
            title={b.label}
            icon={b.key === 'overdue' ? <AlertTriangle className="w-4 h-4 text-rose-500" /> : undefined}
            count={`${list.length} deadline${list.length === 1 ? '' : 's'}`}
            tone={b.key === 'overdue' ? 'bg-rose-50/60 dark:bg-rose-500/[0.06]' : undefined}
          >
            <ul className="divide-y divide-stone-100 dark:divide-white/[0.06]">
              {list.map((d, i) => (
                <DeadlineRow
                  key={deadlineKey(d)}
                  index={i}
                  d={d}
                  selected={selected.has(deadlineKey(d))}
                  onToggle={() => toggle(d)}
                  onSend={() => openSendForRow(d)}
                  onRecorded={(spec) => {
                    // The deadline is satisfied; anything it opens up (a renewal's
                    // declarations) appears on the next load.
                    const key = deadlineKey(d);
                    const at = Math.max(deadlines.findIndex((x) => deadlineKey(x) === key), 0);
                    setDeadlines((prev) => prev.filter((x) => deadlineKey(x) !== key));
                    recordedToast(`${spec.label} — ${d.trademark.mark}`, {
                      trademarkId: d.trademark.id,
                      action: spec.action,
                      officeActionId: spec.officeActionId,
                      onUndone: () =>
                        setDeadlines((prev) =>
                          prev.some((x) => deadlineKey(x) === key)
                            ? prev
                            : [...prev.slice(0, at), d, ...prev.slice(at)],
                        ),
                    });
                  }}
                />
              ))}
            </ul>
          </ListSection>
        );
      })}

      {filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-stone-200 dark:border-white/10 px-6 py-12 text-center">
          {deadlines.length === 0 ? (
            <>
              <CheckCircle2 className="w-6 h-6 mx-auto text-emerald-500 mb-2" />
              <p className="text-sm text-stone-600 dark:text-stone-300">Nothing owed across the book.</p>
            </>
          ) : (
            <>
              <p className="text-sm text-stone-600 dark:text-stone-300">No deadlines match these filters.</p>
              <button
                type="button"
                onClick={() => {
                  setKindFilter('all');
                  setUrgencyFilter('all');
                  setClientFilter('all');
                  setReportedFilter('any');
                }}
                className="mt-2 text-xs text-navy-700 dark:text-navy-300 hover:underline underline-offset-2"
              >
                Clear filters
              </button>
            </>
          )}
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="reveal fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-stone-900 text-stone-50 rounded-2xl shadow-2xl shadow-stone-900/30 px-4 py-2.5 flex items-center gap-3">
          <span className="text-xs">
            <span className="font-semibold">{selected.size}</span> selected
            {selectedByClient.length > 1 && (
              <span className="text-amber-300 ml-1">· {selectedByClient.length} clients</span>
            )}
          </span>
          <button
            type="button"
            onClick={openSendForSelection}
            disabled={bulkBusy || selectedByClient.length !== 1}
            title={selectedByClient.length !== 1 ? 'Selection must be from a single client' : 'Compose a single email for this client'}
            className="press inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-navy-600 hover:bg-navy-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-3.5 h-3.5" /> Send report
          </button>
          <button
            type="button"
            onClick={bulkMarkReported}
            disabled={bulkBusy}
            className="press inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-stone-700 hover:bg-stone-600 cursor-pointer disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" /> Mark reported
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="text-xs text-stone-300 hover:text-white cursor-pointer"
          >
            Clear
          </button>
        </div>
      )}


      {modalDeadlines && (
        <SendTrademarkReportModal
          open
          onClose={() => { setModalDeadlines(null); clearSelection(); }}
          deadlines={modalDeadlines}
          onReported={(report) => markReported(new Set(modalDeadlines.map(deadlineKey)), report)}
        />
      )}
    </div>
  );
}

function FilterSelect({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className="text-stone-500 dark:text-stone-400">{label}</span>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`press inline-flex items-center gap-1 px-2 py-1 rounded-lg border cursor-pointer transition-colors ${
          value === options[0]?.value
            ? 'border-stone-200 dark:border-white/10 text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-white/5'
            : 'border-navy-300 text-navy-800 bg-navy-50 dark:border-navy-400/40 dark:text-navy-200 dark:bg-navy-500/15'
        }`}
      >
        {current?.label}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      {open && (
        <CellDropdown
          mode="single"
          value={value}
          options={options.map((o) => ({ id: o.value, label: o.label }))}
          onSelect={(id) => {
            setOpen(false);
            onChange(id ?? options[0].value);
          }}
          onClose={() => setOpen(false)}
          anchorRef={ref}
        />
      )}
    </span>
  );
}

function DeadlineRow({
  d, index, selected, onToggle, onSend, onRecorded,
}: {
  d: DashboardDeadline;
  index: number;
  selected: boolean;
  onToggle: () => void;
  onSend: () => void;
  onRecorded: (spec: ActionSpec) => void;
}) {
  const t = d.trademark;
  const record = d.notYetOpen ? null : actionForDeadline(d.kind, d.officeAction);

  return (
    <li
      style={{ '--i': Math.min(index, 12) } as React.CSSProperties}
      className={`rise-in group px-5 py-3 flex items-center gap-3 transition-colors ${
        selected ? 'bg-navy-50/60 dark:bg-navy-500/10' : 'hover:bg-stone-50/70 dark:hover:bg-white/[0.02]'
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        aria-label={`Select ${t.mark || 'this mark'} — ${d.kind}`}
        className="rounded border-stone-300 dark:border-white/15 text-navy-700 dark:text-navy-300 focus:ring-navy-300 dark:focus:ring-navy-500/40 cursor-pointer"
      />

      <Link href={`/dashboard/trademarks/${t.id}`} className="flex items-center gap-2.5 min-w-0 flex-1">
        <span className="hidden sm:block">
          <RowThumb name={t.mark || '?'} />
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-stone-900 dark:text-stone-50 truncate group-hover:text-navy-700 dark:group-hover:text-navy-300 transition-colors">
            {t.mark || '(Untitled)'}
          </span>
          <span className="block text-[11px] text-stone-500 dark:text-stone-400 truncate">
            {t.clientName || '—'}
            {t.country !== 'PH' ? ` · ${t.country}` : ''}
          </span>
        </span>
      </Link>

      <div className="w-28 shrink-0">
        <StatusPill label={d.title ?? d.kind} tone={KIND_TONE[d.kind]} />
      </div>

      <div className="w-40 shrink-0">
        <DueChip due={d.due} />
        {d.notYetOpen && (
          <p className="text-[11px] text-stone-400 dark:text-stone-500 mt-0.5" title="IPOPHL will not accept the filing before this date">
            Opens {d.opens && formatDateShort(d.opens)}
          </p>
        )}
        {d.extendedDue && d.urgency !== 'future' && (
          <p
            className="text-[11px] text-stone-400 dark:text-stone-500 mt-0.5"
            title={d.extensionBasis === 'surcharge'
              ? 'Late filing still accepted until this date on payment of the surcharge'
              : 'Last day if an extension is requested before the due date, with fee'}
          >
            {d.extensionBasis === 'surcharge' ? 'Late to' : 'Ext.'} {formatDateShort(d.extendedDue)}
          </p>
        )}
      </div>

      <div className="hidden md:block w-36 shrink-0">
        {d.lastReport ? (
          <div className="flex items-center gap-1.5 text-[11px] text-stone-600 dark:text-stone-300" title={d.lastReport.recipientEmail ? `Sent to ${d.lastReport.recipientEmail}` : 'Marked reported (no email)'}>
            <MailCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>Reported {formatDateShort(d.lastReport.sentAt)}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-[11px] text-stone-400 dark:text-stone-500">
            <Mail className="w-3.5 h-3.5" />
            <span>Not yet reported</span>
          </div>
        )}
      </div>

      <div className="hidden 2xl:block w-32 shrink-0">
        <p className="text-[11px] font-mono text-stone-400 dark:text-stone-500 truncate">{refNo(t)}</p>
      </div>

      <div className="w-36 shrink-0 flex justify-end">
        {record && (
          <TrademarkActionButton trademarkId={t.id} spec={{ ...record, primary: false }} size="sm" onDone={() => onRecorded(record)} />
        )}
      </div>

      <button
        type="button"
        onClick={onSend}
        disabled={!t.contactEmail}
        title={t.contactEmail ? 'Compose client report' : 'Add a contact email on this trademark first'}
        className={`${BTN_OUTLINE} shrink-0 px-2.5 py-1.5 cursor-pointer disabled:cursor-not-allowed`}
      >
        <Send className="w-3 h-3" />
        Send
      </button>
    </li>
  );
}
