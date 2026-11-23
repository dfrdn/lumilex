'use client';

import { useMemo, useState, useEffect } from 'react';
import { MapPin, CheckCircle2, PlayCircle, AlertCircle, Pencil, Trash2 } from 'lucide-react';
import type { LiaisonTask } from '@/lib/queries/liaison';
import CompleteErrandModal from './CompleteErrandModal';
import DatePickerInput from '@/components/DatePickerInput';
import { confirmAction } from '@/components/ui/confirm';
import { toast } from 'sonner';

interface LiaisonOption { person_id: string; name: string; role: string }

interface Props {
  tasks: LiaisonTask[];
  /** UI mode: chief sees all, owner sees own w/ complete action, reader is read-only */
  mode: 'chief' | 'owner' | 'reader';
  /** session user.notionUserId — used to decide if "owner" actions are visible */
  meId?: string;
  onEdit?: (task: LiaisonTask) => void;
  /** Required in chief mode — enables inline reassignment. */
  liaisonOfficers?: LiaisonOption[];
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const PRIORITY_STYLES: Record<string, string> = {
  high: 'text-rose-600 dark:text-rose-400',
  normal: 'text-stone-500 dark:text-stone-400',
  low: 'text-stone-400 dark:text-stone-500',
};

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila',
  });
}

export default function LiaisonTasksTable({ tasks: tasksProp, mode, meId, onEdit, liaisonOfficers }: Props) {
  const [tasks, setTasks] = useState(tasksProp);
  useEffect(() => { setTasks(tasksProp); }, [tasksProp]);

  const [filter, setFilter] = useState<'all' | 'open' | 'completed'>('open');
  const [completing, setCompleting] = useState<LiaisonTask | null>(null);
  // Track which row/field is currently in inline-edit mode.
  const [editingCell, setEditingCell] = useState<{ id: number; field: 'assignee' | 'scheduled' } | null>(null);

  function applyTaskPatch(id: number, patch: Partial<LiaisonTask>) {
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, ...patch } : t));
  }

  async function patchTask(id: number, body: Partial<LiaisonTask>) {
    const previous = tasks.find((t) => t.id === id);
    const optimistic: Partial<LiaisonTask> = { ...body };
    if (body.assigned_to) {
      const officer = liaisonOfficers?.find((o) => o.person_id === body.assigned_to);
      if (officer) optimistic.assigned_to_name = officer.name;
    }
    applyTaskPatch(id, optimistic);
    setEditingCell(null);
    try {
      const res = await fetch(`/api/liaison-tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json().catch(() => ({}));
      if (data.task) applyTaskPatch(id, data.task);
    } catch {
      if (previous) applyTaskPatch(id, previous);
      toast.error('Could not update the errand');
    }
  }

  const filtered = useMemo(() => {
    if (filter === 'open') {
      return tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled');
    }
    if (filter === 'completed') return tasks.filter((t) => t.status === 'completed');
    return tasks;
  }, [tasks, filter]);

  async function markInProgress(t: LiaisonTask) {
    applyTaskPatch(t.id, { status: 'in_progress' });
    try {
      const res = await fetch(`/api/liaison-tasks/${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress' }),
      });
      if (!res.ok) throw new Error('Failed');
    } catch {
      applyTaskPatch(t.id, { status: t.status });
      toast.error('Could not start the errand');
    }
  }

  async function deleteTask(t: LiaisonTask) {
    if (!(await confirmAction({ title: `Delete errand "${t.title}"?`, confirmLabel: 'Delete', danger: true }))) return;
    const index = tasks.findIndex((x) => x.id === t.id);
    setTasks((prev) => prev.filter((x) => x.id !== t.id));
    try {
      const res = await fetch(`/api/liaison-tasks/${t.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
    } catch {
      setTasks((prev) => (prev.some((x) => x.id === t.id) ? prev : [...prev.slice(0, index), t, ...prev.slice(index)]));
      toast.error('Could not delete the errand');
    }
  }

  return (
    <div>
      {/* Filter pills */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-1 bg-[var(--subtle-bg)] rounded-lg p-0.5 w-fit">
          {(['open', 'completed', 'all'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 cursor-pointer ${
                filter === f
                  ? 'bg-[var(--card-bg)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {f === 'open' ? 'Open' : f === 'completed' ? 'Completed' : 'All'}
            </button>
          ))}
        </div>
        <span className="text-xs text-stone-400 dark:text-stone-500">
          {filtered.length} errand{filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-[var(--border-color)] rounded-xl">
          <AlertCircle className="w-6 h-6 mx-auto text-stone-300 dark:text-stone-600 mb-2" />
          <p className="text-sm text-stone-500 dark:text-stone-400">No errands to show.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-color)] bg-card shadow-[var(--shadow-card)]">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] bg-[var(--subtle-bg)]">
                <th className="text-left px-4 py-3 border-b border-[var(--border-color)]">Errand</th>
                <th className="text-left px-4 py-3 border-b border-[var(--border-color)]">Destination</th>
                <th className="text-left px-4 py-3 border-b border-[var(--border-color)]">Assignee</th>
                <th className="text-left px-4 py-3 border-b border-[var(--border-color)]">Scheduled</th>
                <th className="text-left px-4 py-3 border-b border-[var(--border-color)]">Due</th>
                <th className="text-left px-4 py-3 border-b border-[var(--border-color)]">Status</th>
                <th className="text-right px-4 py-3 border-b border-[var(--border-color)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const isOwner = meId === t.assigned_to;
                const canComplete =
                  (mode === 'owner' || (mode === 'chief' && isOwner)) &&
                  t.status !== 'completed' && t.status !== 'cancelled';
                const canMarkProgress = canComplete && t.status === 'pending';
                return (
                  <tr
                    key={t.id}
                    className="group hover:bg-[var(--subtle-bg)] transition-colors text-sm"
                  >
                    <td className="px-4 py-3 border-b border-[var(--border-color)]">
                      <div className="flex items-start gap-2">
                        <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                          t.priority === 'high' ? 'bg-rose-500'
                            : t.priority === 'low' ? 'bg-stone-300 dark:bg-stone-600'
                            : 'bg-stone-400 dark:bg-stone-500'
                        }`} />
                        <div>
                          <div className="font-medium text-foreground">{t.title}</div>
                          {t.purpose && (
                            <div className="text-xs text-stone-500 dark:text-stone-400 mt-0.5 line-clamp-2">
                              {t.purpose}
                            </div>
                          )}
                          {t.matter_name && (
                            <div className="text-[11px] text-stone-400 dark:text-stone-500 mt-0.5">
                              Matter: {t.matter_name}
                            </div>
                          )}
                          <div className={`text-[10px] uppercase tracking-wider mt-1 ${PRIORITY_STYLES[t.priority] ?? ''}`}>
                            {t.priority} priority
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 border-b border-[var(--border-color)] whitespace-nowrap">
                      {t.zone_name ? (
                        <div className="flex items-center gap-1.5 text-foreground">
                          <MapPin className="w-3.5 h-3.5 text-stone-400" />
                          <span>{t.zone_name}</span>
                          {t.zone_round_trip_rate != null && (
                            <span className="text-[11px] text-stone-400">
                              · ₱{Number(t.zone_round_trip_rate).toLocaleString('en-PH')}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-stone-400 dark:text-stone-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 border-b border-[var(--border-color)] whitespace-nowrap text-foreground">
                      {mode === 'chief' && liaisonOfficers && t.status !== 'completed' && t.status !== 'cancelled' && editingCell?.id === t.id && editingCell.field === 'assignee' ? (
                        <select
                          autoFocus
                          defaultValue={t.assigned_to}
                          onChange={(e) => patchTask(t.id, { assigned_to: e.target.value })}
                          onBlur={() => setEditingCell(null)}
                          className="px-2 py-1 text-sm rounded-md border border-gold-400 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40"
                        >
                          {liaisonOfficers.map((o) => (
                            <option key={o.person_id} value={o.person_id}>
                              {o.name}{o.role === 'chief_liaison_officer' ? ' (Chief)' : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <button
                          type="button"
                          disabled={mode !== 'chief' || !liaisonOfficers || t.status === 'completed' || t.status === 'cancelled'}
                          onClick={() => setEditingCell({ id: t.id, field: 'assignee' })}
                          className={`text-left ${
                            mode === 'chief' && liaisonOfficers && t.status !== 'completed' && t.status !== 'cancelled'
                              ? 'cursor-pointer border-b border-dotted border-transparent hover:border-stone-400 transition-colors'
                              : 'cursor-default'
                          }`}
                          title={mode === 'chief' && t.status !== 'completed' ? 'Click to reassign' : undefined}
                        >
                          {t.assigned_to_name || '—'}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 border-b border-[var(--border-color)] whitespace-nowrap text-foreground">
                      {mode === 'chief' && t.status !== 'completed' && t.status !== 'cancelled' && editingCell?.id === t.id && editingCell.field === 'scheduled' ? (
                        <div className="w-40">
                          <DatePickerInput
                            variant="cell"
                            value={t.scheduled_for}
                            onChange={(v) => patchTask(t.id, { scheduled_for: v ?? null })}
                            placeholder="Pick a date"
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={mode !== 'chief' || t.status === 'completed' || t.status === 'cancelled'}
                          onClick={() => setEditingCell({ id: t.id, field: 'scheduled' })}
                          className={`text-left ${
                            mode === 'chief' && t.status !== 'completed' && t.status !== 'cancelled'
                              ? 'cursor-pointer border-b border-dotted border-transparent hover:border-stone-400 transition-colors'
                              : 'cursor-default'
                          }`}
                          title={mode === 'chief' && t.status !== 'completed' ? 'Click to reschedule' : undefined}
                        >
                          {fmtDate(t.scheduled_for)}
                        </button>
                      )}
                    </td>
                    <td
                      className="px-4 py-3 border-b border-[var(--border-color)] whitespace-nowrap text-foreground"
                      title={t.due_date ? 'Inherited from the linked deliverable' : 'No deliverable linked — no deadline'}
                    >
                      {fmtDate(t.due_date)}
                    </td>
                    <td className="px-4 py-3 border-b border-[var(--border-color)] whitespace-nowrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${STATUS_STYLES[t.status] ?? ''}`}>
                        {t.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 border-b border-[var(--border-color)] text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        {canMarkProgress && (
                          <button
                            type="button"
                            onClick={() => markInProgress(t)}
                            className="p-1.5 rounded-md text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20 transition-colors"
                            title="Mark in progress"
                          >
                            <PlayCircle className="w-4 h-4" />
                          </button>
                        )}
                        {canComplete && (
                          <button
                            type="button"
                            onClick={() => setCompleting(t)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-900/20 dark:hover:bg-emerald-900/40 transition-colors text-xs font-medium"
                            title="Mark completed"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Complete
                          </button>
                        )}
                        {mode === 'chief' && t.status !== 'completed' && onEdit && (
                          <button
                            type="button"
                            onClick={() => onEdit(t)}
                            className="p-1.5 rounded-md text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800/50 transition-colors"
                            title="Edit"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {mode === 'chief' && (
                          <button
                            type="button"
                            onClick={() => deleteTask(t)}
                            className="p-1.5 rounded-md text-stone-400 hover:bg-red-50 hover:text-red-600 dark:text-stone-500 dark:hover:bg-red-900/20 dark:hover:text-red-400 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {completing && (
        <CompleteErrandModal
          task={completing}
          onClose={() => setCompleting(null)}
          onCompleted={(updated) => {
            const id = completing.id;
            setCompleting(null);
            if (updated) {
              applyTaskPatch(id, updated);
            } else {
              applyTaskPatch(id, { status: 'completed' });
            }
          }}
        />
      )}
    </div>
  );
}
