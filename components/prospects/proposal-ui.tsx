'use client';

/**
 * Form chrome shared by the two surfaces that build a proposal — the draft form
 * that creates one and the editor that revises it. Both are the same firm
 * document at different stages, so a control that looks one way in one of them
 * and another way in the other reads as two different tools.
 */

import { useRef, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import CellDropdown from '@/components/admin/CellDropdown';

/** A tier as the live schedule publishes it. `monthlyFee: null` means negotiated. */
export interface RetainerTierOption {
  label: string;
  hours: number | null;
  monthlyFee: number | null;
}

export const ARRANGEMENTS = [
  { id: 'retainer', label: 'Monthly retainer' },
  { id: 'hourly', label: 'Hourly at schedule rates' },
  { id: 'acceptance_completion', label: 'Acceptance fee + completion fee' },
  { id: 'litigation', label: 'Litigation — acceptance + completion + hourly' },
  { id: 'fixed', label: 'Fixed / package fee' },
  { id: 'custom', label: 'Custom' },
];

export const BLOCK_KINDS = [
  { id: 'para', label: 'Paragraph' },
  { id: 'subheading', label: 'Sub-heading' },
  { id: 'labelled', label: 'Bold lead-in + text' },
  { id: 'list', label: 'List' },
  { id: 'feeTable', label: 'Fee table' },
];

export const inputCls =
  'w-full px-2.5 py-1.5 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-navy-500/30';
export const labelCls = 'block text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1';

export function Card({ title, subtitle, children, actions }: {
  title: string; subtitle?: string; children: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden">
      <div className="px-5 py-3.5 border-b border-[var(--border-color)] flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">{title}</h2>
          {subtitle && <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
        </div>
        {actions}
      </div>
      <div className="px-5 py-4 space-y-3">{children}</div>
    </div>
  );
}

export function IconBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button type="button" title={title} onClick={onClick}
      className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] shrink-0">
      {children}
    </button>
  );
}

export function AddBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">
      <Plus className="w-3.5 h-3.5" /> {label}
    </button>
  );
}

/** A single-select styled to match the app — never a native <select>. */
export function Picker({ label, value, options, onSelect, placeholder }: {
  label?: string;
  value: string | null;
  options: { id: string; label: string }[];
  onSelect: (id: string | null) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <div>
      {label && <span className={labelCls}>{label}</span>}
      <button type="button" ref={ref} onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-left">
        <span className={value ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}>
          {options.find((o) => o.id === value)?.label ?? placeholder ?? 'Select…'}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
      </button>
      {open && (
        <CellDropdown
          mode="single"
          value={value}
          options={options}
          onSelect={(id) => { onSelect(id); setOpen(false); }}
          onClose={() => setOpen(false)}
          anchorRef={ref}
        />
      )}
    </div>
  );
}

/** Multi-select over the scope library, styled to match the single Picker. */
export function MultiPicker({ label, values, options, onChange, placeholder }: {
  label?: string;
  values: string[];
  options: { id: string; label: string; sublabel?: string }[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const chosen = options.filter((o) => values.includes(o.id));
  return (
    <div>
      {label && <span className={labelCls}>{label}</span>}
      <button type="button" ref={ref} onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-left">
        <span className={chosen.length ? 'text-[var(--text-primary)] truncate' : 'text-[var(--text-muted)]'}>
          {chosen.length ? chosen.map((o) => o.label).join(', ') : placeholder ?? 'Select…'}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
      </button>
      {open && (
        <CellDropdown
          mode="multi"
          value={values}
          options={options}
          onSelect={onChange}
          onClose={() => setOpen(false)}
          anchorRef={ref}
        />
      )}
    </div>
  );
}

