'use client';

import { useRef, useState } from 'react';
import { UserRound } from 'lucide-react';
import { toast } from 'sonner';
import CellDropdown, { type DropdownOption } from '@/components/admin/CellDropdown';

interface Props {
  clientId: string;
  /** Controlled value — the parent owns the relationship-partner person_id (or null). */
  value: string | null;
  /** Selectable partners (active, partner-role). */
  options: DropdownOption[];
  /** person_id → display name for every team member, so a non-selectable assignee still renders. */
  nameById: Record<string, string>;
  /** Called optimistically with the requested value; called again to revert on failure. */
  onChange: (next: string | null) => void;
  /** Show a descriptive empty-state label instead of a bare dash. */
  withLabel?: boolean;
}

/**
 * Presentational relationship-partner picker. The parent is the single source of
 * truth for `value`; this component issues the PATCH and signals optimistic +
 * rollback values through `onChange`. The displayed label resolves from `nameById`
 * (all team members), not just `options`, so an assignee who is inactive or no
 * longer partner-role still shows by name — flagged "(inactive)" — instead of
 * silently reading as unassigned. Mirrors the ClientPriorityToggle contract.
 */
export default function ClientRelationshipPartnerPicker({ clientId, value, options, nameById, onChange, withLabel = false }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  const assigned = value != null;
  const selectedName = assigned ? nameById[value] ?? 'Unknown' : null;
  // Assigned to someone who isn't a currently-selectable partner (inactive / re-roled / removed).
  const stale = assigned && !options.some((o) => o.id === value);

  async function save(next: string | null) {
    setOpen(false);
    if (next === value) return;

    const prev = value;
    onChange(next);
    setSaving(true);
    try {
      const res = await fetch('/api/partner/client-relationship-partner', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, relationshipPartnerId: next }),
      });
      if (!res.ok) throw new Error('Request failed');
    } catch {
      onChange(prev);
      toast.error('Could not update relationship partner');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        title={stale ? 'This partner is no longer active — reassign to update' : 'Set relationship partner for this client'}
        className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold border transition-colors duration-150 ${
          assigned
            ? 'bg-navy-50 text-navy-700 border-navy-200/60 dark:bg-navy-500/10 dark:text-navy-300 dark:border-navy-500/20'
            : 'bg-transparent text-stone-500 border-stone-200 hover:text-stone-700 dark:text-stone-400 dark:border-stone-700'
        } ${saving ? 'opacity-60' : ''}`}
      >
        <UserRound className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate max-w-[10rem]">{selectedName ?? (withLabel ? 'Assign relationship partner' : 'Assign')}</span>
        {stale && <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 shrink-0">(inactive)</span>}
      </button>
      {open && (
        <CellDropdown
          mode="single"
          options={options}
          value={value}
          onSelect={save}
          onClose={() => setOpen(false)}
          anchorRef={anchorRef}
          placeholder="Search partners..."
        />
      )}
    </>
  );
}
