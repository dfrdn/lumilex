'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { buildCapitalStructure, type HoldingRow, type ShareClass } from '@/lib/corporations/capital-structure';
import type { Corporation, CorporationPerson } from '@/types/corporations';

interface Props {
  corporation: Corporation;
  people: CorporationPerson[];
}

const INPUT = 'w-full px-2 py-1 text-sm border border-stone-200 dark:border-white/10 rounded outline-none focus:border-navy-600';
const peso = (n: number | null) =>
  n === null ? '—' : n.toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/**
 * Declares the corporation's share classes, and shows what the GIS will make of
 * them.
 *
 * Only authorized capital is entered here. Subscribed and paid-up are read off
 * the shareholder list rather than typed, so they can't drift from who actually
 * holds what — the preview below is exactly what lands on the form.
 */
export default function CapitalStructureEditor({ corporation, people }: Props) {
  const [classes, setClasses] = useState<ShareClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/corporation/${corporation.id}/share-classes`)
      .then((r) => r.json())
      .then((d) => {
        if (live) setClasses(d.shareClasses ?? []);
      })
      .catch(() => {})
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [corporation.id]);

  const cap = useMemo(() => buildCapitalStructure(classes, people), [classes, people]);

  async function addClass() {
    setAdding(true);
    setError('');
    try {
      const res = await fetch(`/api/corporation/${corporation.id}/share-classes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ className: classes.length === 0 ? 'Common' : `Class ${classes.length + 1}` }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not add the class.');
        return;
      }
      setClasses((prev) => [...prev, data.shareClass]);
    } finally {
      setAdding(false);
    }
  }

  async function saveClass(id: number, patch: Partial<ShareClass>) {
    const res = await fetch(`/api/corporation/${corporation.id}/share-classes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classId: id, ...patch }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Save failed.');
      return;
    }
    setClasses((prev) => prev.map((c) => (c.id === id ? data.shareClass : c)));
    setError('');
  }

  async function removeClass(c: ShareClass) {
    const res = await fetch(`/api/corporation/${corporation.id}/share-classes?classId=${c.id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      // The in-use case is the interesting one — it names how many holders.
      toast.error(data?.error ?? 'Could not remove the class.');
      return;
    }
    setClasses((prev) => prev.filter((x) => x.id !== c.id));
  }

  return (
    <section className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100">Share Classes</h3>
        <button
          onClick={addClass}
          disabled={adding}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-stone-700 dark:text-stone-200 border border-stone-300 dark:border-white/15 rounded-lg hover:bg-stone-50 dark:hover:bg-white/5 disabled:opacity-50"
        >
          <Plus className="w-3 h-3" /> Add class
        </button>
      </div>
      <p className="text-[11px] text-stone-500 dark:text-stone-400 mb-3">
        Authorized capital, by class. Subscribed and paid-up are read from the shareholdings on the
        People tab — they aren&rsquo;t entered here.
      </p>

      {error && (
        <p className="mb-2 text-xs text-rose-600 dark:text-rose-400 inline-flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {error}
        </p>
      )}

      {loading ? (
        <p className="text-xs text-stone-400 dark:text-stone-500">Loading…</p>
      ) : classes.length === 0 ? (
        <p className="text-xs text-stone-500 dark:text-stone-400">
          No classes declared. The GIS will fall back to the single aggregate on this record.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-stone-400 dark:text-stone-500 text-left">
              <th className="pb-1 font-medium">Class</th>
              <th className="pb-1 font-medium w-32">Auth. shares</th>
              <th className="pb-1 font-medium w-28">Par value</th>
              <th className="pb-1 font-medium w-32 text-right">Amount</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {classes.map((c) => {
              const amount =
                c.authorizedShares != null && c.parValue != null ? c.authorizedShares * c.parValue : null;
              return (
                <tr key={c.id} className="border-t border-stone-100 dark:border-white/10">
                  <td className="py-1.5 pr-2">
                    <input
                      className={INPUT}
                      defaultValue={c.className}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== c.className) void saveClass(c.id, { className: v });
                      }}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      className={INPUT}
                      defaultValue={c.authorizedShares ?? ''}
                      onBlur={(e) => {
                        const v = e.target.value.trim() === '' ? null : Number(e.target.value);
                        if (v !== c.authorizedShares) void saveClass(c.id, { authorizedShares: v });
                      }}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      className={INPUT}
                      defaultValue={c.parValue ?? ''}
                      onBlur={(e) => {
                        const v = e.target.value.trim() === '' ? null : Number(e.target.value);
                        if (v !== c.parValue) void saveClass(c.id, { parValue: v });
                      }}
                    />
                  </td>
                  <td className="py-1.5 pr-2 text-right font-mono text-xs text-stone-600 dark:text-stone-300">{peso(amount)}</td>
                  <td className="py-1.5">
                    <button
                      onClick={() => void removeClass(c)}
                      className="p-1 text-stone-400 dark:text-stone-500 hover:text-rose-600 dark:hover:text-rose-400"
                      title="Remove class"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
            <tr className="border-t border-stone-200 dark:border-white/10">
              <td colSpan={3} className="py-1.5 text-xs font-medium text-stone-600 dark:text-stone-300">
                Total authorized
              </td>
              <td className="py-1.5 text-right font-mono text-xs font-semibold text-stone-800 dark:text-stone-100">
                {peso(cap.authorizedTotal)}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      )}

      <div className="mt-5 pt-4 border-t border-stone-100 dark:border-white/10">
        <h4 className="text-xs font-semibold text-stone-700 dark:text-stone-200 mb-2">
          Derived from shareholdings
          <span className="ml-2 font-normal text-stone-400 dark:text-stone-500">this is what the GIS will show</span>
        </h4>
        {cap.subscribed.total === 0 ? (
          <p className="text-xs text-stone-500 dark:text-stone-400">
            No shareholdings recorded yet. Add subscribed and paid amounts against each person on the
            People tab.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <HoldingTable title="Subscribed" section={cap.subscribed} />
            <HoldingTable title="Paid-up" section={cap.paidUp} />
          </div>
        )}
        {cap.subscribed.total > 0 && (
          <p className="mt-2 text-[11px] text-stone-500 dark:text-stone-400">
            Foreign equity: <span className="font-medium text-stone-700 dark:text-stone-200">{cap.foreignEquityPercent.toFixed(2)}%</span>
          </p>
        )}
      </div>
    </section>
  );
}

function HoldingTable({
  title,
  section,
}: {
  title: string;
  section: { filipino: HoldingRow[]; foreign: HoldingRow[]; total: number };
}) {
  const rows = [...section.filipino, ...section.foreign];
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-1">{title}</p>
      <table className="w-full text-xs">
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.nationality}|${r.className}`} className="border-t border-stone-100 dark:border-white/10">
              <td className="py-1 text-stone-700 dark:text-stone-200">
                {r.nationality} · {r.className}
                <span className="text-stone-400 dark:text-stone-500"> ({r.stockholders})</span>
              </td>
              <td className="py-1 text-right font-mono text-stone-600 dark:text-stone-300">{peso(r.amount)}</td>
              <td className="py-1 pl-2 text-right text-stone-400 dark:text-stone-500 w-14">{r.percent.toFixed(1)}%</td>
            </tr>
          ))}
          <tr className="border-t border-stone-200 dark:border-white/10">
            <td className="py-1 font-medium text-stone-700 dark:text-stone-200">Total</td>
            <td className="py-1 text-right font-mono font-semibold text-stone-800 dark:text-stone-100">{peso(section.total)}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
