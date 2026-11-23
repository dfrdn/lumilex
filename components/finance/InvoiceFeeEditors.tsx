'use client';

/**
 * Inline editors for the two billing types whose fees accumulate during the
 * month: per-action entries (Court Appearance, Page, etc.) and per-milestone
 * fees. Used by both the Invoice Generator preview and the Billing Review
 * bundle page so finance can log everything that'll be billed without
 * bouncing to each matter's detail page.
 */

import { useState } from 'react';
import { manilaToday } from '@/lib/dates';

// ── Shared types ────────────────────────────────────────────────────

export interface ActionContextRow {
  matterId: string;
  matterName: string;
  actions: Array<{
    id: number;
    name: string;
    rate: number;
    cap: number | null;
    unit_label: string;
    monthlyQuantity: number;
  }>;
  entries: Array<{
    id: number;
    action_id: number;
    entry_date: string;
    quantity: number;
    description: string;
    invoiced: boolean;
  }>;
}

export interface MilestoneContextRow {
  matterId: string;
  matterName: string;
  milestones: Array<{
    id: number;
    name: string;
    description: string;
    fee: number;
    target_date: string | null;
    reached_at: string | null;
    invoiced: boolean;
  }>;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount);
}

// ── ActionLoggerSection ─────────────────────────────────────────────

export function ActionLoggerSection({
  contexts,
  month,
  onChanged,
}: {
  contexts: ActionContextRow[];
  month: string;
  onChanged: () => void;
}) {
  const [openFor, setOpenFor] = useState<number | null>(null);
  const [date, setDate] = useState(() => {
    const today = manilaToday();
    return today.startsWith(month) ? today : `${month}-01`;
  });
  const [quantity, setQuantity] = useState('1');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const log = async (matterId: string, actionId: number) => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/finance/matter-billing/action-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matterId,
          actionId,
          entryDate: date,
          quantity: parseInt(quantity) || 1,
          description,
        }),
      });
      if (res.ok) {
        setOpenFor(null);
        setDescription('');
        setQuantity('1');
        onChanged();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const deleteEntry = async (id: number) => {
    const res = await fetch(`/api/finance/matter-billing/action-entries?id=${id}`, { method: 'DELETE' });
    if (res.ok) onChanged();
  };

  return (
    <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--border-color)]">
        <h2 className="text-sm font-semibold text-foreground">Per-Action Matters</h2>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          Log occurrences before generating the invoice. Caps reset each month.
        </p>
      </div>
      <div className="divide-y divide-[var(--border-color)]">
        {contexts.map((ctx) => (
          <div key={ctx.matterId} className="px-5 py-3">
            <p className="text-sm font-medium text-foreground mb-2">{ctx.matterName}</p>
            <div className="space-y-2">
              {ctx.actions.map((a) => {
                const capHit = a.cap != null && a.monthlyQuantity >= a.cap;
                const entries = ctx.entries.filter((e) => e.action_id === a.id);
                return (
                  <div key={a.id} className="rounded-md border border-[var(--border-color)] bg-[var(--subtle-bg)]">
                    <div className="px-3 py-2 flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-[var(--text-primary)]">{a.name}</p>
                        <p className="text-[10px] text-[var(--text-muted)]">
                          {formatCurrency(a.rate)}{a.unit_label ? ` / ${a.unit_label}` : ''}
                          {a.cap != null && ` · ${a.monthlyQuantity}/${a.cap} this month`}
                          {a.cap == null && a.monthlyQuantity > 0 && ` · ${a.monthlyQuantity} this month`}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setOpenFor(openFor === a.id ? null : a.id)}
                        disabled={capHit}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-gold-50 text-gold-700 hover:bg-gold-100 border border-gold-200/60 dark:bg-gold-500/10 dark:text-gold-400 dark:border-gold-500/30 dark:hover:bg-gold-500/20 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        title={capHit ? 'Monthly cap reached' : 'Log occurrence'}
                      >
                        + Log
                      </button>
                    </div>
                    {openFor === a.id && (
                      <div className="px-3 pb-3 pt-2 border-t border-[var(--border-color)] space-y-2">
                        <div className="flex gap-2 items-center">
                          <input
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className="px-2 py-1 text-xs rounded-md bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40"
                          />
                          <input
                            type="number"
                            min="1"
                            value={quantity}
                            onChange={(e) => setQuantity(e.target.value)}
                            className="w-16 px-2 py-1 text-xs rounded-md bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40"
                            placeholder="Qty"
                          />
                        </div>
                        <input
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          placeholder="Description (optional)"
                          className="w-full px-2 py-1 text-xs rounded-md bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40"
                        />
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setOpenFor(null)}
                            className="px-2 py-1 text-[11px] rounded-md bg-[var(--background)] text-[var(--text-secondary)] hover:bg-stone-100 dark:hover:bg-stone-800 border border-[var(--border-color)] cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => log(ctx.matterId, a.id)}
                            disabled={submitting}
                            className="px-2 py-1 text-[11px] rounded-md bg-gold-500 text-white hover:bg-gold-600 disabled:opacity-50 cursor-pointer"
                          >
                            {submitting ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </div>
                    )}
                    {entries.length > 0 && (
                      <ul className="divide-y divide-[var(--border-color)] border-t border-[var(--border-color)]">
                        {entries.map((e) => (
                          <li key={e.id} className="px-3 py-1.5 flex items-center justify-between text-[11px]">
                            <div className="min-w-0">
                              <span className="text-[var(--text-secondary)]">{e.entry_date}</span>
                              {e.quantity > 1 && <span className="ml-1 text-[var(--text-muted)]">×{e.quantity}</span>}
                              {e.description && <span className="ml-2 text-[var(--text-muted)] truncate">{e.description}</span>}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {e.invoiced ? (
                                <span className="text-[10px] text-emerald-600 dark:text-emerald-400">Invoiced</span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => deleteEntry(e.id)}
                                  className="text-[10px] text-red-600 dark:text-red-400 hover:underline cursor-pointer"
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── MilestoneTogglerSection ─────────────────────────────────────────

export function MilestoneTogglerSection({
  contexts,
  onChanged,
}: {
  contexts: MilestoneContextRow[];
  onChanged: () => void;
}) {
  const toggle = async (id: number, reached: boolean) => {
    const res = await fetch('/api/finance/matter-billing/milestones', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, reached }),
    });
    if (res.ok) onChanged();
  };

  return (
    <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--border-color)]">
        <h2 className="text-sm font-semibold text-foreground">Per-Milestone Matters</h2>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          Mark milestones reached to add their fees to the invoice.
        </p>
      </div>
      <div className="divide-y divide-[var(--border-color)]">
        {contexts.map((ctx) => (
          <div key={ctx.matterId} className="px-5 py-3">
            <p className="text-sm font-medium text-foreground mb-2">{ctx.matterName}</p>
            <ul className="space-y-1.5">
              {ctx.milestones.map((m) => (
                <li
                  key={m.id}
                  className="rounded-md border border-[var(--border-color)] bg-[var(--subtle-bg)] px-3 py-2 flex items-start justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-[var(--text-primary)]">{m.name}</p>
                    {m.description && <p className="text-[11px] text-[var(--text-muted)]">{m.description}</p>}
                    <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                      {formatCurrency(m.fee)}
                      {m.target_date && ` · target ${m.target_date}`}
                      {m.reached_at && ` · reached ${m.reached_at.slice(0, 10)}`}
                      {m.invoiced && ' · invoiced'}
                    </p>
                  </div>
                  {m.invoiced ? (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 shrink-0">Billed</span>
                  ) : m.reached_at ? (
                    <button
                      type="button"
                      onClick={() => toggle(m.id, false)}
                      className="px-2 py-1 text-[11px] rounded-md bg-[var(--background)] text-[var(--text-secondary)] hover:bg-stone-100 dark:hover:bg-stone-800 border border-[var(--border-color)] cursor-pointer shrink-0"
                    >
                      Undo
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggle(m.id, true)}
                      className="px-2 py-1 text-[11px] font-medium rounded-md bg-gold-50 text-gold-700 hover:bg-gold-100 border border-gold-200/60 dark:bg-gold-500/10 dark:text-gold-400 dark:border-gold-500/30 dark:hover:bg-gold-500/20 cursor-pointer shrink-0"
                    >
                      Mark Reached
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
