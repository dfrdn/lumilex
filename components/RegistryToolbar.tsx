'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Plus, Search, X } from 'lucide-react';
import AddCorporationModal from '@/components/AddCorporationModal';
import AddTrademarkModal from '@/components/AddTrademarkModal';

/**
 * Search and the New Corporation / New trademark button. The search lives in `?q=` and the
 * list is filtered in the database, so it scales with the book — typing
 * updates the URL after a short pause.
 */
export default function RegistryToolbar({ placeholder, kind = 'corporation' }: { placeholder: string; kind?: 'corporation' | 'trademark' }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [pending, startTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  const first = useRef(true);

  // An empty list's "New …" links here with ?new=1: open the form, then drop the flag.
  const wantsNew = params.get('new') === '1';
  useEffect(() => {
    if (!wantsNew) return;
    setCreateOpen(true);
    const next = new URLSearchParams(params.toString());
    next.delete('new');
    // replaceState, not router.replace: it lands during hydration, which a router navigation can miss.
    window.history.replaceState(null, '', `${pathname}${next.toString() ? `?${next}` : ''}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsNew]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (q.trim()) next.set('q', q.trim());
      else next.delete('q');
      next.delete('page');
      startTransition(() => router.replace(`${pathname}${next.toString() ? `?${next}` : ''}`, { scroll: false }));
    }, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative flex-1 min-w-[220px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 dark:text-stone-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-9 pr-9 py-2.5 text-sm rounded-xl border border-stone-200 dark:border-white/10 bg-white dark:bg-card text-stone-800 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-navy-200 dark:focus:ring-navy-500/30"
        />
        {pending ? (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-stone-400" />
        ) : q ? (
          <button
            type="button"
            onClick={() => setQ('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
            title="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        ) : null}
      </label>
      <button
        type="button"
        onClick={() => setCreateOpen(true)}
        className="press inline-flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium rounded-xl bg-navy-800 text-white hover:bg-navy-700 dark:bg-navy-600 dark:hover:bg-navy-500 transition-colors"
      >
        <Plus className="w-4 h-4" />
        {kind === 'trademark' ? 'New trademark' : 'New corporation'}
      </button>
      {kind === 'trademark' ? (
        <AddTrademarkModal open={createOpen} onClose={() => setCreateOpen(false)} />
      ) : (
        <AddCorporationModal open={createOpen} onClose={() => setCreateOpen(false)} />
      )}
    </div>
  );
}
