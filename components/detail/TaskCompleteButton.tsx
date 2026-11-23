'use client';

import { useState } from 'react';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';

interface Props {
  taskId: string;
  initialDone: boolean;
}

export default function TaskCompleteButton({ taskId, initialDone }: Props) {
  const [done, setDone] = useState(initialDone);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const next = !done;
    setDone(next);
    setBusy(true);
    try {
      const res = await fetch('/api/task', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: taskId, done: next }),
      });
      if (!res.ok) throw new Error('Failed to update task');
    } catch (err) {
      console.error(err);
      setDone(!next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg ring-1 ring-inset transition-colors duration-150 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer ${
        done
          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200/60 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20 dark:hover:bg-emerald-500/20'
          : 'bg-navy-800 text-white ring-navy-800 hover:bg-navy-700 dark:bg-gold-500/15 dark:text-gold-200 dark:ring-gold-500/25 dark:hover:bg-gold-500/25'
      }`}
    >
      {busy ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : done ? (
        <CheckCircle2 className="w-4 h-4" />
      ) : (
        <Circle className="w-4 h-4" />
      )}
      {done ? 'Completed — mark as not done' : 'Mark as done'}
    </button>
  );
}
