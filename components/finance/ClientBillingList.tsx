'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import ClientBillingProfileModal from '@/components/finance/ClientBillingProfileModal';
import type { ClientBillingProfile } from '@/lib/billing/client-profile';
import { formatDate } from '@/lib/format-date';
import { toManilaDay } from '@/lib/dates';

export interface ClientBillingRow {
  id: string;
  name: string;
  status: string | null;
  contactEmail: string | null;
  /** Has a matter billing config or a saved profile — the clients finance bills. */
  billed: boolean;
  profile: ClientBillingProfile;
  updatedAt: string | null;
}

const CARD = 'rounded-xl border border-stone-200 dark:border-[rgba(255,255,255,0.08)] bg-card';

/** Every client with its billing profile at a glance; a row opens the profile. */
export default function ClientBillingList({ rows: initial, paragraphLabels }: { rows: ClientBillingRow[]; paragraphLabels: Record<string, string> }) {
  const [rows, setRows] = useState(initial);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'billed' | 'all'>('billed');
  const [open, setOpen] = useState<string | null>(null);

  const billedCount = rows.filter((r) => r.billed).length;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => (scope === 'all' || r.billed) && (!q || r.name.toLowerCase().includes(q)));
  }, [rows, query, scope]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clients"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[var(--border-color)] bg-transparent focus:outline-none focus:border-gold-400"
          />
        </div>
        <div className="inline-flex rounded-lg border border-stone-200 dark:border-[rgba(255,255,255,0.1)] overflow-hidden text-sm">
          {([['billed', `Billed (${billedCount})`], ['all', `All clients (${rows.length})`]] as const).map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => setScope(v)}
              className={`px-3 py-1.5 transition-colors cursor-pointer ${scope === v ? 'bg-navy-100 text-navy-800 dark:bg-gold-400/15 dark:text-gold-300' : 'text-[var(--text-secondary)] hover:bg-stone-50 dark:hover:bg-white/5'}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className={`${CARD} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border-color)]">
              <th className="px-4 py-2.5 font-medium">Client</th>
              <th className="px-4 py-2.5 font-medium">Addressed to</th>
              <th className="px-4 py-2.5 font-medium">Email</th>
              <th className="px-4 py-2.5 font-medium">VAT</th>
              <th className="px-4 py-2.5 font-medium">Early payment</th>
              <th className="px-4 py-2.5 font-medium">Paragraphs</th>
              <th className="px-4 py-2.5 font-medium">Edited</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const p = r.profile;
              const addressee = p.letterAddressee === 'person'
                ? (p.attnName || r.name)
                : p.attnName ? `Attn. ${p.attnName}` : 'The company';
              const extras = [
                p.initialStatement ? 'Initial statement' : null,
                p.includeLessenFeesNote ? 'Lessen fees' : null,
                ...(p.optionalParagraphs ?? []).map((k) => paragraphLabels[k] ?? k),
              ].filter(Boolean);
              return (
                <tr
                  key={r.id}
                  onClick={() => setOpen(r.id)}
                  className="border-b last:border-0 border-[var(--border-color)] hover:bg-stone-50 dark:hover:bg-white/5 cursor-pointer"
                >
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-foreground">{r.name}</span>
                    {r.status && r.status !== 'Active' && <span className="ml-2 text-[11px] text-[var(--text-muted)]">{r.status}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                    <span className="text-[11px] mr-1.5 px-1.5 py-0.5 rounded bg-stone-100 dark:bg-white/10">{p.letterAddressee === 'person' ? 'Person' : 'Company'}</span>
                    {addressee}
                  </td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)] truncate max-w-[220px]">{p.clientEmail || r.contactEmail || <span className="text-rose-600 dark:text-rose-400">None</span>}</td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">{p.includeVAT ? 'With VAT' : '—'}</td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                    {p.earlyPaymentDiscountPercent && p.earlyPaymentDays ? `${p.earlyPaymentDiscountPercent}% within ${p.earlyPaymentDays} days` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">{extras.length ? extras.join(', ') : '—'}</td>
                  <td className="px-4 py-2.5 text-[var(--text-muted)] whitespace-nowrap">{r.updatedAt ? formatDate(toManilaDay(r.updatedAt)) : 'Not set'}</td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-[var(--text-secondary)]">No clients match.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {open && (
        <ClientBillingProfileModal
          clientId={open}
          onClose={() => setOpen(null)}
          onSaved={(profile) => setRows((prev) => prev.map((r) => (r.id === open ? { ...r, profile, billed: true, updatedAt: new Date().toISOString() } : r)))}
        />
      )}
    </div>
  );
}
