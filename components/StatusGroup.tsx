'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface Props {
  label: string;
  count: number;
  dotClass: string;
  textClass: string;
  badgeClass: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export default function StatusGroup({
  label,
  count,
  dotClass,
  textClass,
  badgeClass,
  defaultOpen = true,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-2.5 mb-1 w-full group cursor-pointer"
      >
        <ChevronDown className={`w-3 h-3 shrink-0 text-[var(--text-muted)] group-hover:text-[var(--text-secondary)] transition-transform duration-250 ease-out ${open ? 'rotate-0' : '-rotate-90'}`} />
        <span className={`w-2 h-2 rounded-full shrink-0 transition-opacity duration-200 ${dotClass}`} />
        <h4 className={`text-xs font-semibold uppercase tracking-wider ${textClass}`}>{label}</h4>
        <span className={`text-[10px] tabular-nums font-medium rounded-full px-1.5 py-px ${badgeClass}`}>{count}</span>
      </button>
      <div className="collapse-grid" data-open={open}>
        <div className="collapse-inner">
          <div className="space-y-0.5">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
