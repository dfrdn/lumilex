'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bike, Info } from 'lucide-react';
import DatePickerInput from '@/components/DatePickerInput';
import { pesoExact } from '@/lib/finance/format';
import type { LiaisonErrandCostReport } from '@/lib/finance/liaison-errand-costs';

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila',
  });
}

function marginClass(n: number) {
  return n > 0
    ? 'text-emerald-600 dark:text-emerald-400'
    : n < 0
      ? 'text-rose-600 dark:text-rose-400'
      : 'text-[var(--text-muted)]';
}

export default function LiaisonErrandCostsView({
  report,
  from,
  to,
  initialLiaison = 'all',
}: {
  report: LiaisonErrandCostReport;
  from: string;
  to: string;
  initialLiaison?: string;
}) {
  const router = useRouter();
  const [draftFrom, setDraftFrom] = useState<string | null>(from);
  const [draftTo, setDraftTo] = useState<string | null>(to);
  const [selected, setSelected] = useState<string>(initialLiaison);

  function navigate(nextSelected: string, f = draftFrom, t = draftTo) {
    const params = new URLSearchParams();
    if (f) params.set('from', f);
    if (t) params.set('to', t);
    if (nextSelected !== 'all') params.set('liaison', nextSelected);
    router.push(`/finance/liaison-errand-costs?${params.toString()}`);
  }

  // Keep the liaison selection in the URL so changing the date range doesn't lose it.
  function selectLiaison(key: string) {
    setSelected(key);
    navigate(key);
  }

  const summaries = useMemo(
    () => (selected === 'all' ? report.summaries : report.summaries.filter((s) => (s.liaisonId || s.liaison) === selected)),
    [report.summaries, selected],
  );
  const rows = useMemo(
    () => (selected === 'all' ? report.rows : report.rows.filter((r) => (r.liaisonId || r.liaison) === selected)),
    [report.rows, selected],
  );

  const filteredTotals = useMemo(() => ({
    errands: rows.length,
    internalTotal: rows.reduce((s, r) => s + r.internal, 0),
    externalTotal: rows.reduce((s, r) => s + r.external, 0),
    marginTotal: rows.reduce((s, r) => s + r.margin, 0),
  }), [rows]);

  const grouped = useMemo(() => {
    const m = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = r.liaisonId || r.liaison;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }
    return [...m.entries()];
  }, [rows]);

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-foreground font-serif mb-1 flex items-center gap-2">
            <Bike className="w-5 h-5 text-gold-600" />
            Liaison Errand Costs
          </h1>
          <p className="text-xs text-stone-400 dark:text-stone-500 max-w-2xl">
            Transportation expense per liaison, by tariff. <strong>Internal</strong> is reimbursed to
            the liaison (liquidation); <strong>External</strong> is billed to the client. Margin is the
            firm spread (billable trips only).
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="w-36">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">From</label>
            <DatePickerInput variant="token" value={draftFrom} onChange={setDraftFrom} placeholder="Start" />
          </div>
          <div className="w-36">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">To</label>
            <DatePickerInput variant="token" value={draftTo} onChange={setDraftTo} placeholder="End" />
          </div>
          <button
            type="button"
            onClick={() => navigate(selected)}
            className="px-4 py-2 rounded-xl bg-gold-600 text-white text-sm font-medium hover:bg-gold-700 transition-colors"
          >
            Apply
          </button>
        </div>
      </div>

      {/* Totals cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Errands" value={String(filteredTotals.errands)} />
        <StatCard label="Internal (liaison)" value={pesoExact(filteredTotals.internalTotal)} />
        <StatCard label="External (client)" value={pesoExact(filteredTotals.externalTotal)} />
        <StatCard label="Margin (firm)" value={pesoExact(filteredTotals.marginTotal)} valueClass={marginClass(filteredTotals.marginTotal)} />
      </div>

      {/* Liaison filter pills */}
      <div className="flex items-center gap-1 bg-[var(--subtle-bg)] rounded-lg p-0.5 w-fit mb-4 flex-wrap">
        <Pill active={selected === 'all'} onClick={() => selectLiaison('all')}>All liaisons</Pill>
        {report.summaries.map((s) => (
          <Pill key={s.liaisonId || s.liaison} active={selected === (s.liaisonId || s.liaison)} onClick={() => selectLiaison(s.liaisonId || s.liaison)}>
            {s.liaison}
          </Pill>
        ))}
      </div>

      {/* Summary table */}
      <div className="overflow-x-auto rounded-xl border border-[var(--border-color)] bg-card shadow-[var(--shadow-card)] mb-6">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] bg-[var(--subtle-bg)]">
              <th className="text-left px-5 py-3 border-b border-[var(--border-color)]">Liaison</th>
              <th className="text-right px-5 py-3 border-b border-[var(--border-color)]">Errands</th>
              <th className="text-right px-5 py-3 border-b border-[var(--border-color)]">Internal</th>
              <th className="text-right px-5 py-3 border-b border-[var(--border-color)]">External</th>
              <th className="text-right px-5 py-3 border-b border-[var(--border-color)]">Margin</th>
              <th className="text-right px-5 py-3 border-b border-[var(--border-color)]">Billable</th>
              <th className="text-right px-5 py-3 border-b border-[var(--border-color)]">Reimbursed</th>
              <th className="text-right px-5 py-3 border-b border-[var(--border-color)]">Billed</th>
            </tr>
          </thead>
          <tbody>
            {summaries.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-5 py-12 text-center text-sm text-stone-400 dark:text-stone-500">
                  No completed errands in this range.
                </td>
              </tr>
            ) : (
              <>
                {summaries.map((s) => (
                  <tr key={s.liaisonId || s.liaison} className="hover:bg-[var(--subtle-bg)] transition-colors text-sm">
                    <td className="px-5 py-3 border-b border-[var(--border-color)] font-medium text-foreground">{s.liaison}</td>
                    <td className="px-5 py-3 border-b border-[var(--border-color)] text-right text-foreground">{s.errands}</td>
                    <td className="px-5 py-3 border-b border-[var(--border-color)] text-right text-foreground">{pesoExact(s.internalTotal)}</td>
                    <td className="px-5 py-3 border-b border-[var(--border-color)] text-right text-foreground">{pesoExact(s.externalTotal)}</td>
                    <td className={`px-5 py-3 border-b border-[var(--border-color)] text-right ${marginClass(s.marginTotal)}`}>{pesoExact(s.marginTotal)}</td>
                    <td className="px-5 py-3 border-b border-[var(--border-color)] text-right text-stone-500 dark:text-stone-400">{s.billableErrands}/{s.errands}</td>
                    <td className="px-5 py-3 border-b border-[var(--border-color)] text-right text-stone-500 dark:text-stone-400">{s.reimbursedCount}/{s.errands}</td>
                    <td className="px-5 py-3 border-b border-[var(--border-color)] text-right text-stone-500 dark:text-stone-400">{s.billedCount}/{s.billableErrands}</td>
                  </tr>
                ))}
                <tr className="text-sm font-semibold bg-[var(--subtle-bg)]">
                  <td className="px-5 py-3 text-foreground">Total</td>
                  <td className="px-5 py-3 text-right text-foreground">{filteredTotals.errands}</td>
                  <td className="px-5 py-3 text-right text-foreground">{pesoExact(filteredTotals.internalTotal)}</td>
                  <td className="px-5 py-3 text-right text-foreground">{pesoExact(filteredTotals.externalTotal)}</td>
                  <td className={`px-5 py-3 text-right ${marginClass(filteredTotals.marginTotal)}`}>{pesoExact(filteredTotals.marginTotal)}</td>
                  <td className="px-5 py-3" colSpan={3} />
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* Computed-estimate note — shown whenever ANY row is not backed by posted ledger rows */}
      {report.anyComputed && report.totals.errands > 0 && (
        <div className="mb-6 flex items-start gap-2 px-4 py-3 rounded-xl border border-amber-200 dark:border-amber-700/40 bg-amber-50/60 dark:bg-amber-900/15 text-xs text-amber-800 dark:text-amber-300">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Some rows are computed from the zone tariff because no reimbursement/billing records were
            posted for them (errands completed before the dual-tariff pipeline, or not yet through it).
            Any pre-existing manually-filed transportation reimbursements are separate and may overlap;
            reconcile before paying out or billing.
          </span>
        </div>
      )}

      {/* Itemized detail per liaison */}
      {grouped.map(([key, items]) => {
        const name = items[0]?.liaison ?? key;
        const internal = items.reduce((s, r) => s + r.internal, 0);
        return (
          <div key={key} className="mb-6">
            <h2 className="text-sm font-semibold text-foreground mb-2">
              {name} <span className="text-stone-400 font-normal">· {items.length} errand{items.length === 1 ? '' : 's'} · {pesoExact(internal)} internal</span>
            </h2>
            <div className="overflow-x-auto rounded-xl border border-[var(--border-color)] bg-card shadow-[var(--shadow-card)]">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] bg-[var(--subtle-bg)]">
                    <th className="text-left px-4 py-2.5 border-b border-[var(--border-color)]">Date</th>
                    <th className="text-left px-4 py-2.5 border-b border-[var(--border-color)]">Errand</th>
                    <th className="text-left px-4 py-2.5 border-b border-[var(--border-color)]">Destination</th>
                    <th className="text-right px-4 py-2.5 border-b border-[var(--border-color)]">Internal</th>
                    <th className="text-right px-4 py-2.5 border-b border-[var(--border-color)]">External</th>
                    <th className="text-right px-4 py-2.5 border-b border-[var(--border-color)]">Margin</th>
                    <th className="text-left px-4 py-2.5 border-b border-[var(--border-color)]">Client</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.id} className="hover:bg-[var(--subtle-bg)] transition-colors text-sm">
                      <td className="px-4 py-2.5 border-b border-[var(--border-color)] whitespace-nowrap text-stone-500 dark:text-stone-400">{fmtDate(r.date)}</td>
                      <td className="px-4 py-2.5 border-b border-[var(--border-color)] text-foreground">{r.title}</td>
                      <td className="px-4 py-2.5 border-b border-[var(--border-color)] text-stone-500 dark:text-stone-400">{r.zoneName ?? '—'}</td>
                      <td className="px-4 py-2.5 border-b border-[var(--border-color)] text-right text-foreground whitespace-nowrap">{pesoExact(r.internal)}</td>
                      <td className="px-4 py-2.5 border-b border-[var(--border-color)] text-right whitespace-nowrap">
                        {r.billable ? (
                          <span className="text-foreground">
                            {pesoExact(r.external)}
                            {r.billAtInternal && <span className="ml-1 text-[10px] text-stone-400">no markup</span>}
                          </span>
                        ) : (
                          <span className="text-stone-400 dark:text-stone-500">not billed</span>
                        )}
                      </td>
                      <td className={`px-4 py-2.5 border-b border-[var(--border-color)] text-right whitespace-nowrap ${r.billable ? marginClass(r.margin) : ''}`}>{r.billable ? pesoExact(r.margin) : '—'}</td>
                      <td className="px-4 py-2.5 border-b border-[var(--border-color)] text-stone-500 dark:text-stone-400">{r.clientName || r.matterName || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatCard({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-card shadow-[var(--shadow-card)] px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
      <div className={`text-lg font-semibold mt-1 ${valueClass ?? 'text-foreground'}`}>{value}</div>
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 cursor-pointer ${
        active ? 'bg-[var(--card-bg)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
      }`}
    >
      {children}
    </button>
  );
}
