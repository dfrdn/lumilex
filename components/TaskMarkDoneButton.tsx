'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  taskId: string;
  done?: boolean;
}

export default function TaskDoneCheckbox({ taskId, done = false }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [optimistic, setOptimistic] = useState(done);
  const busy = submitting;
  const checked = optimistic;

  async function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    const next = !checked;
    setOptimistic(next);
    setSubmitting(true);
    try {
      const res = await fetch('/api/task', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: taskId, done: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || 'Could not update task.');
      }
    } catch (err) {
      setOptimistic(!next);
      toast.error(err instanceof Error ? err.message : 'Could not update task.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? 'Mark task as not done' : 'Mark task as done'}
      title={checked ? 'Mark as not done' : 'Mark as done'}
      className="group/check flex items-center justify-center w-4 h-4 max-sm:w-9 max-sm:h-9 max-sm:-m-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {/* The box stays 16px; on a phone the button around it is the tap target, taking up no extra room. */}
      <span
        className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center transition-colors duration-150 ${
          checked
            ? 'bg-emerald-500 border-emerald-500 text-white group-hover/check:bg-emerald-600 group-hover/check:border-emerald-600'
            : 'border-stone-300 dark:border-stone-600 bg-transparent group-hover/check:border-emerald-500 group-hover/check:bg-emerald-50 dark:group-hover/check:bg-emerald-500/10'
        }`}
      >
        {checked && <Check className="w-3 h-3" strokeWidth={3} />}
      </span>
    </button>
  );
}
