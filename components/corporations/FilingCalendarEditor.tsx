'use client';

import { useMemo, useRef, useState } from 'react';
import { ChevronDown, Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import CellDropdown from '@/components/admin/CellDropdown';
import DatePickerInput from '@/components/DatePickerInput';
import { dueDateInfo, type FilingCalendarEntry } from '@/lib/corporations/obligations';
import { shortDate } from '@/lib/corporations/status';
import type { RedateChange } from '@/lib/corporations/redate';
import type { Corporation } from '@/types/corporations';
import { confirmAction } from '@/components/ui/confirm';

type Entry = FilingCalendarEntry & { id: number; updatedAt: string | null };
type Obligation = 'afs' | 'itr';

const LABEL: Record<Obligation, string> = {
  afs: 'Audited Financial Statements (SEC)',
  itr: 'Annual income tax return (BIR)',
};

const OBLIGATION_OPTIONS = [
  { id: 'afs', label: LABEL.afs },
  { id: 'itr', label: LABEL.itr },
];

interface Draft {
  obligation: Obligation;
  filingYear: string;
  dueDate: string | null;
  originalDueDate: string | null;
  source: string;
}

/** A December year-end company with no SEC number — what projections are shown for. */
const DECEMBER = { fiscalYearEndMonth: 12, secRegistrationNo: null } as unknown as Corporation;

export default function FilingCalendarEditor({ initial, canEdit, thisYear }: { initial: Entry[]; canEdit: boolean; thisYear: number }) {
  const [entries, setEntries] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<{ obligation: Obligation; filingYear: number; changes: RedateChange[] } | null>(null);
  const [redating, setRedating] = useState(false);
  const obligationRef = useRef<HTMLButtonElement>(null);
  const [obligationOpen, setObligationOpen] = useState(false);

  // What the board uses for this year and next where nobody has entered a date.
  const projections = useMemo(() => {
    const out: { obligation: Obligation; year: number; date: string | null; source: string | null }[] = [];
    for (const year of [thisYear, thisYear + 1]) {
      for (const obligation of ['afs', 'itr'] as const) {
        if (entries.some((e) => e.obligation === obligation && e.filingYear === year)) continue;
        const info = dueDateInfo(obligation, year - 1, { corporation: DECEMBER, calendar: entries });
        out.push({ obligation, year, date: info.date, source: info.provisional ? info.source : info.source ?? 'Standing rule' });
      }
    }
    return out;
  }, [entries, thisYear]);

  const years = [...new Set(entries.map((e) => e.filingYear))].sort((a, b) => b - a);

  function startNew() {
    setDraft({ obligation: 'afs', filingYear: String(thisYear + 1), dueDate: null, originalDueDate: null, source: '' });
  }

  function startEdit(e: Entry) {
    setDraft({
      obligation: e.obligation,
      filingYear: String(e.filingYear),
      dueDate: e.dueDate,
      originalDueDate: e.originalDueDate ?? null,
      source: e.source ?? '',
    });
  }

  async function save() {
    if (!draft || saving) return;
    const filingYear = Number(draft.filingYear);
    if (!Number.isInteger(filingYear) || !draft.dueDate) {
      toast.error('A filing year and a due date are both needed.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/corporation-calendar', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          obligation: draft.obligation,
          filingYear,
          dueDate: draft.dueDate,
          originalDueDate: draft.originalDueDate,
          digitSchedule: null,
          source: draft.source.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? 'Could not save.');
        return;
      }
      const entry = data.entry as Entry;
      setEntries((prev) => [entry, ...prev.filter((e) => e.id !== entry.id)]);
      setDraft(null);
      const changes = (data.pending ?? []) as RedateChange[];
      setPending(changes.length ? { obligation: entry.obligation, filingYear: entry.filingYear, changes } : null);
      toast.success(`${entry.obligation.toUpperCase()} ${entry.filingYear} saved.`);
    } finally {
      setSaving(false);
    }
  }

  async function remove(e: Entry) {
    if (!(await confirmAction({ title: `Remove the ${e.obligation.toUpperCase()} ${e.filingYear} date?`, message: 'The year goes back to its projection.', confirmLabel: 'Remove', danger: true }))) return;
    const res = await fetch(`/api/corporation-calendar?id=${e.id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? 'Could not remove.');
      return;
    }
    setEntries((prev) => prev.filter((x) => x.id !== e.id));
  }

  async function applyRedate() {
    if (!pending || redating) return;
    setRedating(true);
    try {
      const res = await fetch('/api/corporation-calendar/redate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ obligation: pending.obligation, filingYear: pending.filingYear }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? 'Re-date failed.');
        return;
      }
      toast.success(`Moved ${data.changes.length} filing(s) to the new date.`);
      setPending(null);
    } finally {
      setRedating(false);
    }
  }

  return (
    <div className="space-y-4 max-w-4xl">
      {pending && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-amber-900 dark:text-amber-300">
                {pending.changes.length} open {pending.obligation.toUpperCase()} filing{pending.changes.length === 1 ? '' : 's'} for{' '}
                {pending.filingYear} still carr{pending.changes.length === 1 ? 'ies' : 'y'} the old date.
              </p>
              <ul className="mt-1.5 space-y-0.5 text-xs text-amber-900/80 dark:text-amber-300/80">
                {pending.changes.map((c) => (
                  <li key={c.notionId}>
                    {c.name}: {c.from ? shortDate(c.from) : 'no date'} → {shortDate(c.to)}
                  </li>
                ))}
              </ul>
            </div>
            <button onClick={() => setPending(null)} className="text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-300" title="Leave them">
              <X className="w-4 h-4" />
            </button>
          </div>
          <button
            onClick={applyRedate}
            disabled={redating}
            className="mt-3 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-700 text-white hover:bg-amber-800 disabled:opacity-50"
          >
            {redating ? 'Moving…' : 'Move them to the new date'}
          </button>
        </div>
      )}

      <section className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl px-5 py-4">
        <div className="flex items-center justify-between gap-3 mb-1">
          <h2 className="text-sm font-semibold text-stone-800 dark:text-stone-100">Deadlines on record</h2>
          {canEdit && !draft && (
            <button
              onClick={startNew}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border border-stone-300 dark:border-white/15 text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-white/5"
            >
              <Plus className="w-3 h-3" /> Add a year
            </button>
          )}
        </div>
        <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">
          For December year-end companies. Others keep the standing rules: AFS 120 days after year end, ITR on the 15th day of the
          fourth month.
        </p>

        {draft && (
          <div className="mb-4 rounded-lg border border-navy-200 dark:border-navy-500/30 bg-navy-50/40 dark:bg-navy-500/10 p-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[11px] font-medium text-stone-600 dark:text-stone-300">Filing</span>
                <button
                  ref={obligationRef}
                  type="button"
                  onClick={() => setObligationOpen((o) => !o)}
                  className="mt-1 w-full inline-flex items-center justify-between px-2.5 py-1.5 text-sm rounded-lg border border-stone-300 dark:border-white/15 bg-white dark:bg-card"
                >
                  {LABEL[draft.obligation]}
                  <ChevronDown className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
                </button>
                {obligationOpen && (
                  <CellDropdown
                    mode="single"
                    value={draft.obligation}
                    options={OBLIGATION_OPTIONS}
                    allowClear={false}
                    anchorRef={obligationRef}
                    onClose={() => setObligationOpen(false)}
                    onSelect={(id) => {
                      if (id) setDraft((d) => (d ? { ...d, obligation: id as Obligation } : d));
                      setObligationOpen(false);
                    }}
                  />
                )}
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-stone-600 dark:text-stone-300">Filing year (when it is due)</span>
                <input
                  inputMode="numeric"
                  value={draft.filingYear}
                  onChange={(e) => setDraft((d) => (d ? { ...d, filingYear: e.target.value.replace(/\D/g, '').slice(0, 4) } : d))}
                  className="mt-1 w-full px-2.5 py-1.5 text-sm rounded-lg border border-stone-300 dark:border-white/15"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-stone-600 dark:text-stone-300">Due date in force</span>
                <DatePickerInput value={draft.dueDate} onChange={(v) => setDraft((d) => (d ? { ...d, dueDate: v } : d))} className="mt-1 w-full" />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-stone-600 dark:text-stone-300">Date first set, if since extended</span>
                <DatePickerInput
                  value={draft.originalDueDate}
                  onChange={(v) => setDraft((d) => (d ? { ...d, originalDueDate: v } : d))}
                  placeholder="Not extended"
                  className="mt-1 w-full"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-[11px] font-medium text-stone-600 dark:text-stone-300">Source</span>
              <input
                value={draft.source}
                onChange={(e) => setDraft((d) => (d ? { ...d, source: e.target.value } : d))}
                placeholder="e.g. SEC MC No. 9-2026, extended by the Commission en banc on 14 April 2026"
                className="mt-1 w-full px-2.5 py-1.5 text-sm rounded-lg border border-stone-300 dark:border-white/15"
              />
            </label>
            <div className="flex gap-2">
              <button
                onClick={save}
                disabled={saving}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-navy-800 text-white hover:bg-navy-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setDraft(null)} className="px-3 py-1.5 text-xs font-medium rounded-lg text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-white/10">
                Cancel
              </button>
            </div>
          </div>
        )}

        {years.length === 0 ? (
          <p className="text-xs text-stone-500 dark:text-stone-400">No deadlines entered yet.</p>
        ) : (
          <div className="divide-y divide-stone-100 dark:divide-white/10">
            {years.map((year) => (
              <div key={year} className="py-2.5">
                <div className="text-xs font-semibold text-stone-500 dark:text-stone-400 mb-1">{year}</div>
                {entries
                  .filter((e) => e.filingYear === year)
                  .sort((a, b) => a.obligation.localeCompare(b.obligation))
                  .map((e) => (
                    <div key={e.id} className="flex items-start gap-3 py-1">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-stone-800 dark:text-stone-100">
                          {LABEL[e.obligation]} —{' '}
                          <span className="font-medium tabular-nums">
                            {e.dueDate ? shortDate(e.dueDate) : 'by SEC number digit'}
                          </span>
                          {e.originalDueDate && (
                            <span className="text-xs text-stone-500 dark:text-stone-400"> (first set {shortDate(e.originalDueDate)})</span>
                          )}
                        </div>
                        {e.source && <div className="text-[11px] text-stone-500 dark:text-stone-400">{e.source}</div>}
                      </div>
                      {canEdit && (
                        <div className="flex gap-1 shrink-0">
                          <button onClick={() => startEdit(e)} className="p-1 text-stone-400 dark:text-stone-500 hover:text-navy-700 dark:hover:text-navy-300" title="Edit">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => void remove(e)} className="p-1 text-stone-400 dark:text-stone-500 hover:text-rose-600 dark:hover:text-rose-400" title="Remove">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            ))}
          </div>
        )}
      </section>

      {projections.length > 0 && (
        <section className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl px-5 py-4">
          <h2 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-1">Not yet published</h2>
          <p className="text-xs text-stone-500 dark:text-stone-400 mb-3">
            What the board uses until the year&apos;s circular is entered above. AFS dates are projected from the latest date the SEC
            first set (extensions don&apos;t carry forward); the ITR stays on the statutory 15 April.
          </p>
          <ul className="space-y-1">
            {projections.map((p) => (
              <li key={`${p.obligation}-${p.year}`} className="text-sm text-stone-700 dark:text-stone-200">
                {LABEL[p.obligation]} {p.year} —{' '}
                <span className="italic tabular-nums">{p.date ? shortDate(p.date) : '—'}</span>
                {p.source && <span className="text-[11px] text-stone-500 dark:text-stone-400"> · {p.source}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
