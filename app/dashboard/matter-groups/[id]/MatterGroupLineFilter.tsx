'use client';

import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Filter, Check, X, ChevronDown } from 'lucide-react';

interface MemberOption {
  id: string;
  name: string;
  matterCode: string;
}

interface Props {
  members: MemberOption[];
  /** Currently selected matter ids (empty array = all members, the default). */
  selected: string[];
}

/**
 * Multi-select filter: user picks which members to include. No selection
 * (or all selected) means "show everything". The filter is URL-backed
 * (`?matters=id1,id2`) so the server component can narrow its aggregated
 * data accordingly.
 */
export default function MatterGroupLineFilter({ members, selected }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [open]);

  const allSelected = selected.length === 0 || selected.length === members.length;
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const pushParams = useCallback((ids: string[]) => {
    const params = new URLSearchParams(searchParams.toString());
    if (ids.length === 0 || ids.length === members.length) {
      params.delete('matters');
    } else {
      params.set('matters', ids.join(','));
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }, [members.length, pathname, router, searchParams]);

  function toggle(id: string) {
    const base = allSelected ? members.map((m) => m.id) : [...selected];
    const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    pushParams(next);
  }

  function selectAll() { pushParams([]); }
  function selectNone() { pushParams(members.map((m) => m.id).slice(0, 1)); }

  const buttonLabel = allSelected
    ? `All ${members.length} matters`
    : `${selected.length} of ${members.length} matters`;

  return (
    <div className="mb-6">
      <div ref={ref} className="relative inline-block">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-sm text-[var(--text-primary)] hover:bg-[var(--subtle-bg)] transition-colors"
        >
          <Filter className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          <span>{buttonLabel}</span>
          <ChevronDown className={`w-3.5 h-3.5 text-[var(--text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {!allSelected && (
          <button
            onClick={selectAll}
            className="ml-2 inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X className="w-3 h-3" /> Clear filter
          </button>
        )}
        {open && (
          <div className="absolute left-0 mt-1 z-20 w-80 max-h-80 overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] shadow-lg">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-color)] text-[11px] text-[var(--text-muted)]">
              <button onClick={selectAll} className="hover:text-[var(--text-primary)] font-medium">Select all</button>
              <span>·</span>
              <button onClick={selectNone} className="hover:text-[var(--text-primary)] font-medium">Clear</button>
              <span className="ml-auto italic">Filters every section by matter</span>
            </div>
            <ul>
              {members.map((m) => {
                const isChecked = allSelected || selectedSet.has(m.id);
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => toggle(m.id)}
                      className={`w-full text-left flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-[var(--subtle-bg)] transition-colors ${isChecked ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}
                    >
                      <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${isChecked ? 'bg-navy-600 border-navy-600 text-white' : 'border-[var(--border-color)] bg-[var(--card-bg)]'}`}>
                        {isChecked && <Check className="w-3 h-3" />}
                      </span>
                      <span className="truncate">{m.name}</span>
                      {m.matterCode && <span className="ml-auto text-[10px] text-[var(--text-muted)] font-mono shrink-0">{m.matterCode}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
