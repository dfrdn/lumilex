'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { X, Trash2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import type { Corporation } from '@/types/corporations';

interface Props {
  open: boolean;
  corporation: Corporation;
  /** Dependent-row counts, already loaded by the detail page. */
  counts: { people: number; files: number; meetings: number; resolutions: number };
  matterNames: Record<string, string>;
  clientNames: Record<string, string>;
  onClose: () => void;
}

/**
 * Deleting a corporation cascades four tables and orphans anything the FK
 * can't reach, so the dialog states the blast radius before asking for the
 * name. The name check is enforced server-side too — this is the explanation,
 * not the gate.
 */
export default function DeleteCorporationModal({
  open,
  corporation,
  counts,
  matterNames,
  clientNames,
  onClose,
}: Props) {
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const name = corporation.approvedName ?? corporation.proposedNames[0] ?? '';

  useEffect(() => {
    if (!open) return;
    setTyped('');
    setError('');
  }, [open]);

  if (!open) return null;

  const linkedMatters = [
    { id: corporation.incorporationMatterId, label: 'Incorporation' },
    { id: corporation.postIncorporationMatterId, label: 'Post-Incorporation' },
    { id: corporation.housekeepingMatterId, label: 'Corporate Housekeeping' },
    { id: corporation.retainerMatterId, label: 'Retainer' },
  ].filter((m): m is { id: string; label: string } => Boolean(m.id));

  const clientName = corporation.clientId ? clientNames[corporation.clientId] ?? corporation.clientId : null;

  const removed = [
    counts.people && `${counts.people} ${counts.people === 1 ? 'person' : 'people'}`,
    counts.files && `${counts.files} ${counts.files === 1 ? 'file' : 'files'}`,
    counts.meetings && `${counts.meetings} ${counts.meetings === 1 ? 'meeting' : 'meetings'}`,
    counts.resolutions && `${counts.resolutions} ${counts.resolutions === 1 ? 'resolution' : 'resolutions'}`,
  ].filter(Boolean) as string[];

  const canSubmit = typed.trim() === name && name.length > 0 && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`/api/corporation/${corporation.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmName: typed.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? 'Could not delete this corporation.');
        return;
      }
      toast.success(`${name} deleted.`);
      router.push('/dashboard/corporations');
    } catch {
      setError('Could not delete this corporation.');
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto"
      onClick={() => !submitting && onClose()}
    >
      <div className="bg-white dark:bg-card rounded-xl shadow-2xl w-full max-w-lg my-8" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-stone-200 dark:border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-rose-600 dark:text-rose-400" />
            <h2 className="text-base font-semibold text-stone-800 dark:text-stone-100">Delete corporation</h2>
          </div>
          <button onClick={onClose} disabled={submitting} className="p-1 rounded hover:bg-stone-100 dark:hover:bg-white/10">
            <X className="w-4 h-4 text-stone-500 dark:text-stone-400" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30">
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <p className="text-xs text-rose-800 dark:text-rose-300">
              This permanently removes <span className="font-medium">{name || '(unnamed corporation)'}</span>
              {removed.length ? <> along with its {removed.join(', ')}</> : null}. It cannot be undone.
            </p>
          </div>

          {(linkedMatters.length > 0 || clientName) && (
            <div className="px-3 py-2.5 rounded-lg bg-stone-50 dark:bg-white/5 border border-stone-200 dark:border-white/10">
              <p className="text-xs font-medium text-stone-700 dark:text-stone-200 mb-1.5">Left in place</p>
              <ul className="space-y-1 text-xs text-stone-600 dark:text-stone-300">
                {linkedMatters.map((m) => (
                  <li key={m.id}>
                    <span className="text-stone-500 dark:text-stone-400">{m.label} matter:</span> {matterNames[m.id] ?? m.id}
                  </li>
                ))}
                {clientName && (
                  <li>
                    <span className="text-stone-500 dark:text-stone-400">Client:</span> {clientName}
                  </li>
                )}
              </ul>
              <p className="mt-2 text-[11px] text-stone-500 dark:text-stone-400">
                Matters keep their time entries and billing, so they are not deleted. Close or reassign them
                separately if they are no longer live.
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-stone-600 dark:text-stone-300 mb-1">
              Type <span className="font-mono text-stone-800 dark:text-stone-100">{name}</span> to confirm
            </label>
            <input
              className="w-full px-3 py-2 text-sm border border-stone-300 dark:border-white/15 rounded-lg outline-none focus:border-rose-500"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={submitting}
              autoComplete="off"
            />
          </div>

          {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-stone-200 dark:border-white/10 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-sm text-stone-600 dark:text-stone-300 rounded-lg hover:bg-stone-100 dark:hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="px-3 py-1.5 text-sm font-medium text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:bg-stone-300 dark:disabled:bg-stone-700"
          >
            {submitting ? 'Deleting…' : 'Delete corporation'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
