'use client';

import { useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Check, ExternalLink, Undo2, ChevronDown } from 'lucide-react';
import CellDropdown from '@/components/admin/CellDropdown';
import DatePickerInput from '@/components/DatePickerInput';
import type { Corporation, CorporationFile, CorporationMeeting, CorporationPerson } from '@/types/corporations';
import type { FilingCalendarEntry } from '@/lib/corporations/obligations';
import { buildComplianceGrid, manilaToday } from '@/lib/corporations/status';
import ComplianceGrid from './ComplianceGrid';
import GenerateGisCard from './GenerateGisCard';
import FilingHistory from './FilingHistory';
import { DELIVERABLE_STATUS, isDelivered } from '@/lib/deliverable-status';

interface Props {
  corporation: Corporation;
  files: CorporationFile[];
  onFilesChange: React.Dispatch<React.SetStateAction<CorporationFile[]>>;
  deliverables: Array<Record<string, unknown>>;
  onDeliverablesChange: React.Dispatch<React.SetStateAction<Array<Record<string, unknown>>>>;
  matterNames: Record<string, string>;
  people: CorporationPerson[];
  meetings: CorporationMeeting[];
  calendar: FilingCalendarEntry[];
  openRequestMatterIds: string[];
}

const TYPE_STYLES: Record<string, string> = {
  'SEC GIS': 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30',
  'SEC AFS': 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-500/30',
  'BIR Filing': 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30',
  'Other Compliance': 'bg-stone-100 dark:bg-white/10 text-stone-600 dark:text-stone-300 border-stone-200 dark:border-white/10',
};

const TYPES = ['SEC GIS', 'SEC AFS', 'BIR Filing', 'Other Compliance'];
const PRIORITIES = ['High', 'Medium', 'Low'];

// A compliance item is done once filed; the view summarizes that as
// "Submitted" in its displayed text.
const DONE_DB_STATUS = DELIVERABLE_STATUS.FILED_OR_SENT_OUT;
const isCompletedStatus = isDelivered;

export default function CorporationComplianceTab({
  corporation,
  files,
  onFilesChange,
  deliverables,
  onDeliverablesChange,
  matterNames,
  people,
  meetings,
  calendar,
  openRequestMatterIds,
}: Props) {
  const grid = useMemo(
    () =>
      buildComplianceGrid({
        corporation,
        files,
        people,
        meetings,
        calendar,
        openRequestMatterIds,
        today: manilaToday(),
        deliverables: deliverables.map((d) => ({
          notionId: d.notion_id as string,
          type: (d.type as string) ?? '',
          name: (d.name as string) ?? '',
          externalDueDate: (d.external_due_date as string | null) ?? null,
          status: (d.status as string) ?? '',
        })),
      }),
    [corporation, files, people, meetings, calendar, openRequestMatterIds, deliverables],
  );
  const effectiveMatterName = corporation.effectiveBillingMatterId
    ? matterNames[corporation.effectiveBillingMatterId] ?? null
    : null;
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  // Sort: incomplete first by due date, then completed by date_done desc
  const sorted = [...deliverables].sort((a, b) => {
    const aDone = isCompletedStatus((a.status as string) ?? '');
    const bDone = isCompletedStatus((b.status as string) ?? '');
    if (aDone !== bDone) return aDone ? 1 : -1;
    if (aDone) {
      const ad = (a.date_done as string) ?? '';
      const bd = (b.date_done as string) ?? '';
      return bd.localeCompare(ad);
    }
    const ad = (a.external_due_date as string) ?? '9999';
    const bd = (b.external_due_date as string) ?? '9999';
    return ad.localeCompare(bd);
  });

  async function patchStatus(notionId: string, body: Record<string, unknown>, optimistic: Record<string, unknown>) {
    setActionError('');
    setBusy(notionId);
    const snapshot = deliverables;
    onDeliverablesChange((prev) => prev.map((r) => (r.notion_id as string) === notionId ? { ...r, ...optimistic } : r));
    const res = await fetch(`/api/corporation/${corporation.id}/compliance/${notionId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      onDeliverablesChange(snapshot);
      setActionError(`Update failed: ${data.error ?? res.statusText}`);
      return;
    }
    const updated = data.deliverable as Record<string, unknown> | undefined;
    if (updated) {
      onDeliverablesChange((prev) => prev.map((r) => (r.notion_id as string) === notionId ? updated : r));
    }
  }

  function markDone(notionId: string) {
    void patchStatus(notionId, { status: DONE_DB_STATUS }, { status: DONE_DB_STATUS });
  }

  function reopen(notionId: string) {
    void patchStatus(notionId, { status: DELIVERABLE_STATUS.NOT_STARTED, dateDone: null }, { status: DELIVERABLE_STATUS.NOT_STARTED, date_done: null });
  }

  return (
    <div className="space-y-4">
      <ComplianceGrid rows={grid} />

      <GenerateGisCard corporation={corporation} />

      <FilingHistory
        corporation={corporation}
        deliverables={deliverables}
        files={files}
        onFilesChange={onFilesChange}
      />

      <div className="flex items-center justify-between">
        <div className="text-xs text-stone-500 dark:text-stone-400">
          {corporation.effectiveBillingMatterId
            ? (
              <>
                Showing deliverables routed through effective billing matter:{' '}
                <span className="text-stone-700 dark:text-stone-200 font-medium">
                  {effectiveMatterName ?? <span className="font-mono">{corporation.effectiveBillingMatterId}</span>}
                </span>
              </>
            )
            : <span className="text-rose-600 dark:text-rose-400">No effective billing matter — set engagement scope to enable.</span>}
        </div>
        <button
          onClick={() => setCreating(true)}
          disabled={!corporation.effectiveBillingMatterId}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-navy-800 text-white hover:bg-navy-700 disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" /> New Compliance Item
        </button>
      </div>

      {actionError && (
        <div className="px-3 py-2 text-xs rounded bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300">{actionError}</div>
      )}

      {sorted.length === 0 ? (
        <div className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-8 text-center text-sm text-stone-500 dark:text-stone-400">
          No compliance deliverables yet.
          {!corporation.secRegistrationDate && (
            <div className="mt-2 text-xs">
              Set the SEC registration date on the Overview tab to raise the GIS, AFS and BIR deadlines. The business permit is tracked as a task.
            </div>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {sorted.map((d) => {
            const type = (d.type as string) ?? '';
            const status = (d.status as string) ?? '';
            const done = isCompletedStatus(status);
            const style = TYPE_STYLES[type] ?? 'bg-stone-50 dark:bg-white/5 text-stone-600 dark:text-stone-300 border-stone-200 dark:border-white/10';
            const notionId = d.notion_id as string;
            return (
              <li key={notionId} className={`bg-white dark:bg-card border rounded-xl p-4 flex items-center justify-between gap-3 ${done ? 'opacity-60' : 'border-stone-200 dark:border-white/10'}`}>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-semibold ${done ? 'text-stone-500 dark:text-stone-400 line-through' : 'text-stone-800 dark:text-stone-100'} truncate`}>
                    {d.name as string}
                  </div>
                  <div className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                    Due: <span className={done ? '' : 'text-stone-700 dark:text-stone-200 font-medium'}>{(d.external_due_date as string) ?? '—'}</span>
                    {' · '}Status: <span className={done ? 'text-emerald-700 dark:text-emerald-300' : 'text-stone-700 dark:text-stone-200'}>{done ? 'Submitted' : status}</span>
                    {(d.priority as string) && <> · Priority: {d.priority as string}</>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full border ${style}`}>
                    {type}
                  </span>
                  {done ? (
                    <button
                      onClick={() => reopen(notionId)}
                      disabled={busy === notionId}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-stone-300 dark:border-white/15 rounded hover:bg-amber-50 dark:hover:bg-amber-500/10 hover:border-amber-300 dark:hover:border-amber-500/30 hover:text-amber-700 dark:hover:text-amber-300 disabled:opacity-50"
                      title="Re-open (mark as Not started)"
                    >
                      <Undo2 className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => markDone(notionId)}
                      disabled={busy === notionId}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-stone-300 dark:border-white/15 rounded hover:bg-emerald-50 dark:hover:bg-emerald-500/10 hover:border-emerald-300 dark:hover:border-emerald-500/30 hover:text-emerald-700 dark:hover:text-emerald-300 disabled:opacity-50"
                      title="Mark as Submitted"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <a
                    href={`/dashboard/deliverables/${notionId}`}
                    className="inline-flex items-center px-2 py-1 text-xs text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-100"
                    title="Open in deliverables for full workflow"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {creating && (
        <NewComplianceItemModal
          corporationId={corporation.id}
          onClose={() => setCreating(false)}
          onSaved={(created) => {
            setCreating(false);
            if (created) onDeliverablesChange((prev) => [created, ...prev]);
          }}
        />
      )}
    </div>
  );
}

function ModalSelect({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">{label}</span>
      <button
        type="button"
        ref={anchorRef}
        onClick={() => setOpen((o) => !o)}
        className="w-full px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg bg-white dark:bg-card text-left flex items-center justify-between gap-2"
      >
        <span className="truncate">{value}</span>
        <ChevronDown className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500 shrink-0" />
      </button>
      {open && (
        <CellDropdown
          mode="single"
          value={value}
          options={options.map((o) => ({ id: o, label: o }))}
          onSelect={(id) => { if (id) onChange(id); setOpen(false); }}
          onClose={() => setOpen(false)}
          anchorRef={anchorRef}
        />
      )}
    </div>
  );
}

function NewComplianceItemModal({ corporationId, onClose, onSaved }: { corporationId: string; onClose: () => void; onSaved: (created: Record<string, unknown> | null) => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('Other Compliance');
  const [externalDueDate, setExternalDueDate] = useState('');
  const [priority, setPriority] = useState('Medium');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/corporation/${corporationId}/compliance`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type, externalDueDate: externalDueDate || null, priority }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? 'Failed');
      return;
    }
    onSaved((data.deliverable as Record<string, unknown> | undefined) ?? null);
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !busy && onClose()}>
      <div className="bg-white dark:bg-card rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-stone-200 dark:border-white/10">
          <h2 className="text-sm font-semibold text-stone-800 dark:text-stone-100">New Compliance Item</h2>
        </div>
        <div className="px-5 py-4 space-y-3">
          <label className="block">
            <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. BIR 2550Q (Q2 2026)"
              className="w-full px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg outline-none"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <ModalSelect label="Type" value={type} options={TYPES} onChange={setType} />
            <ModalSelect label="Priority" value={priority} options={PRIORITIES} onChange={setPriority} />
          </div>
          <div>
            <span className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">Due Date</span>
            <DatePickerInput value={externalDueDate || null} onChange={(v) => setExternalDueDate(v ?? '')} placeholder="Select due date" />
          </div>
          {error && <div className="px-3 py-2 text-xs rounded bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300">{error}</div>}
        </div>
        <div className="px-5 py-3 border-t border-stone-200 dark:border-white/10 flex justify-end gap-2">
          <button onClick={() => !busy && onClose()} className="px-3 py-1.5 text-xs text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-white/5 rounded">Cancel</button>
          <button onClick={submit} disabled={busy || !name.trim()} className="px-3 py-1.5 text-xs font-medium rounded bg-navy-800 text-white hover:bg-navy-700 disabled:opacity-50">
            {busy ? 'Adding…' : 'Add Item'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
