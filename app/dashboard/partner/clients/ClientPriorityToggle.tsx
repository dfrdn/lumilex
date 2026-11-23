'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  clientId: string;
  /** Controlled value — the parent owns priority state. */
  priority: boolean;
  /** Called optimistically with the requested value; called again to revert on failure. */
  onChange: (next: boolean) => void;
  size?: number;
  withLabel?: boolean;
}

/**
 * Presentational star toggle. The parent is the single source of truth for
 * `priority`; this component issues the PATCH and signals optimistic + rollback
 * values through `onChange`.
 */
export default function ClientPriorityToggle({ clientId, priority, onChange, size = 16, withLabel = false }: Props) {
  const [saving, setSaving] = useState(false);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (saving) return;

    const next = !priority;
    onChange(next);
    setSaving(true);
    try {
      const res = await fetch('/api/partner/client-priority', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, priority: next }),
      });
      if (!res.ok) throw new Error('Request failed');
    } catch {
      onChange(!next);
      toast.error('Could not update priority');
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={priority}
      title={priority ? 'Priority client — click to unflag' : 'Flag as priority client'}
      className={`inline-flex items-center gap-1.5 rounded-md transition-colors duration-150 ${
        withLabel ? 'px-2.5 py-1 text-xs font-semibold border' : 'p-0.5'
      } ${
        priority
          ? withLabel
            ? 'bg-gold-50 text-gold-700 border-gold-200/60 dark:bg-gold-500/10 dark:text-gold-400 dark:border-gold-500/20'
            : 'text-gold-500 dark:text-gold-400'
          : withLabel
            ? 'bg-transparent text-stone-500 border-stone-200 hover:text-stone-700 dark:text-stone-400 dark:border-stone-700'
            : 'text-stone-300 hover:text-stone-400 dark:text-stone-600 dark:hover:text-stone-500'
      } ${saving ? 'opacity-60' : ''}`}
    >
      <Star className={priority ? 'fill-current' : ''} style={{ width: size, height: size }} />
      {withLabel && (priority ? 'Priority' : 'Flag as priority')}
    </button>
  );
}
