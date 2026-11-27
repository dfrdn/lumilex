'use client';

import { useState, useEffect, useRef } from 'react';
import { Loader2, Check, Pencil } from 'lucide-react';

interface Rate {
  id: number;
  position: string;
  hourly_rate: number;
  currency: string;
  effective_from: string;
}

export default function RatesTable() {
  const [rates, setRates] = useState<Rate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch('/api/finance/rates')
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load rates (${r.status})`);
        return r.json();
      })
      .then((data) => setRates(data.rates ?? []))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load rates'))
      .finally(() => setLoading(false));
  }, [retryToken]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground font-serif mb-6">
        Billing Rates
      </h1>

      {error ? (
        <div className="text-center py-12 text-red-600 dark:text-red-400">
          <p className="text-sm">{error}</p>
          <button onClick={() => setRetryToken((n) => n + 1)} className="mt-2 text-xs underline">Retry</button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-[var(--border-color)] bg-card shadow-[var(--shadow-card)]">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              <th className="text-left px-5 py-3 border-b border-[var(--border-color)]">Position</th>
              <th className="text-right px-5 py-3 border-b border-[var(--border-color)]">Hourly Rate (PHP)</th>
            </tr>
          </thead>
          <tbody>
            {rates.map((rate) => (
              <RateRow
                key={rate.id}
                rate={rate}
                onSave={(newRate) => {
                  setRates((prev) =>
                    prev.map((r) => (r.id === rate.id ? { ...r, hourly_rate: newRate } : r)),
                  );
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RateRow({ rate, onSave }: { rate: Rate; onSave: (newRate: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(rate.hourly_rate));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = async () => {
    const num = parseFloat(draft);
    if (isNaN(num) || num === rate.hourly_rate) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/finance/rates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position: rate.position, hourlyRate: num }),
      });
      if (res.ok) {
        onSave(num);
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }
    } catch { /* ignore */ }
    setSaving(false);
    setEditing(false);
  };

  return (
    <tr className="group hover:bg-[var(--subtle-bg)] transition-colors">
      <td className="px-5 py-3 text-sm text-foreground font-medium border-b border-[var(--border-color)]">
        {rate.position}
      </td>
      <td className="px-5 py-3 text-sm text-foreground text-right border-b border-[var(--border-color)]">
        {editing ? (
          <div className="flex items-center justify-end gap-1">
            <span className="text-[var(--text-muted)]">PHP</span>
            <input
              ref={inputRef}
              type="number"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') setEditing(false);
              }}
              className="w-28 px-2 py-1 text-sm text-right rounded-md bg-background border border-gold-400 text-foreground focus:outline-none focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40"
              autoFocus
            />
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-muted)]" />}
          </div>
        ) : (
          <div
            className="group/cell flex items-center justify-end gap-1.5 cursor-pointer"
            onClick={() => {
              setDraft(String(rate.hourly_rate));
              setEditing(true);
            }}
          >
            <span>PHP {Number(rate.hourly_rate).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
            {saved ? (
              <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Pencil className="w-3 h-3 text-[var(--text-muted)] opacity-0 group-hover/cell:opacity-100 transition-opacity" />
            )}
          </div>
        )}
      </td>
    </tr>
  );
}
