'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2, X } from 'lucide-react';
import ClientCombobox from '@/components/finance/ClientCombobox';
import SearchableSelect from '@/components/SearchableSelect';
import { pesoExact } from '@/lib/finance/format';
import { defaultPeriodLabel, offCycleTotal } from '@/lib/billing/off-cycle-label';

interface OutstandingFee {
  kind: 'acceptance' | 'milestone';
  matterId: string;
  matterName: string | null;
  description: string;
  amount: number;
  milestoneId?: number;
}

interface ClientMatter {
  id: string;
  name: string;
}

interface AdHocRow {
  key: number;
  description: string;
  amount: string;
  matterId: string;
}

function feeKey(f: OutstandingFee): string {
  return f.kind === 'milestone' ? `milestone:${f.milestoneId}` : `${f.kind}:${f.matterId}`;
}

const inputClass =
  'w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40';
const labelClass = 'block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1';

/**
 * Finance files an off-cycle invoice: a fee-only bill (acceptance fee,
 * a reached milestone, ad-hoc items) issued now rather than with the
 * month's invoice. It goes to the managing partner, whose approval generates
 * the draft.
 */
export default function OffCycleInvoiceModal({
  open,
  onClose,
  onSubmitted,
}: {
  open: boolean;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [clients, setClients] = useState<string[]>([]);
  const [client, setClient] = useState('');
  const [matters, setMatters] = useState<ClientMatter[]>([]);
  const [fees, setFees] = useState<OutstandingFee[]>([]);
  const [loadingFees, setLoadingFees] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adHoc, setAdHoc] = useState<AdHocRow[]>([]);
  const [periodLabel, setPeriodLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setClient('');
    setMatters([]);
    setFees([]);
    setSelected(new Set());
    setAdHoc([]);
    setPeriodLabel('');
    setNotes('');
    setError('');
    if (clients.length > 0) return;
    fetch('/api/finance/off-cycle-invoices/outstanding')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Failed to load clients (${r.status})`))))
      .then((d) => setClients(d.clients ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load clients'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    setLoadingFees(true);
    setSelected(new Set());
    setAdHoc([]);
    setError('');
    fetch(`/api/finance/off-cycle-invoices/outstanding?client=${encodeURIComponent(client)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Failed to load fees (${r.status})`))))
      .then((d) => {
        if (cancelled) return;
        setMatters(d.matters ?? []);
        setFees(d.fees ?? []);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load fees'))
      .finally(() => !cancelled && setLoadingFees(false));
    return () => { cancelled = true; };
  }, [client]);

  const chosenFees = fees.filter((f) => selected.has(feeKey(f)));
  const adHocLines = adHoc
    .map((r) => ({ kind: 'adhoc', description: r.description.trim(), amount: Number(r.amount) }))
    .filter((r) => r.description && Number.isFinite(r.amount) && r.amount > 0);
  const previewLines = [...chosenFees, ...adHocLines];
  const total = offCycleTotal(previewLines);
  const suggestedLabel = defaultPeriodLabel(previewLines);
  const incompleteAdHoc = adHoc.some((r) => (r.description.trim() || r.amount) && !(r.description.trim() && Number(r.amount) > 0));

  const matterOptions = useMemo(
    () => [{ id: '', label: 'No specific matter' }, ...matters.map((m) => ({ id: m.id, label: m.name }))],
    [matters],
  );

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const handleSubmit = async () => {
    setSaving(true);
    setError('');
    try {
      const items = [
        ...chosenFees.map((f) =>
          f.kind === 'milestone'
            ? { kind: 'milestone' as const, milestoneId: f.milestoneId }
            : { kind: f.kind, matterId: f.matterId }),
        ...adHoc
          .filter((r) => r.description.trim() && Number(r.amount) > 0)
          .map((r) => ({ kind: 'adhoc' as const, description: r.description.trim(), amount: Number(r.amount), matterId: r.matterId || null })),
      ];
      const res = await fetch('/api/finance/off-cycle-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientName: client, items, periodLabel: periodLabel.trim() || undefined, notes: notes.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.details?.join('; ') || data.error || `Failed to submit (${res.status})`);
      onSubmitted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    // The overlay scrolls, not the modal body: the client and matter pickers
    // open as absolutely positioned menus, which a scrolling body would clip.
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 backdrop-blur-sm animate-fade-in">
      <div className="flex min-h-full items-center justify-center py-8">
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-xl w-full max-w-xl mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
          <h2 className="text-sm font-semibold text-foreground">Off-cycle invoice</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded-lg hover:bg-subtle cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-[11px] text-[var(--text-muted)]">
            Bills named fees now, separately from the monthly invoice. No time or expenses go on it.
            The managing partner approves it, and the approval generates the draft here in Invoices.
          </p>

          <div>
            <label className={labelClass}>Client</label>
            <ClientCombobox clients={clients} value={client} onChange={setClient} countNoun="client" />
          </div>

          {client && (
            <div>
              <p className={labelClass}>Outstanding fees</p>
              {loadingFees ? (
                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>
              ) : fees.length === 0 ? (
                <p className="text-[11px] text-[var(--text-muted)]">
                  No acceptance fee or reached milestone is outstanding for this client. Milestones must be
                  marked reached on the matter&apos;s billing config first. You can still bill additional items below.
                </p>
              ) : (
                <ul className="space-y-1">
                  {fees.map((f) => {
                    const key = feeKey(f);
                    return (
                      <li key={key}>
                        <label className="flex items-center gap-2.5 rounded-md border border-[var(--border-color)] bg-[var(--subtle-bg)] px-2.5 py-1.5 text-xs cursor-pointer">
                          <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} className="accent-gold-500" />
                          <span className="flex-1 min-w-0">
                            <span className="text-foreground">{f.description}</span>
                            {f.matterName && <span className="ml-1.5 text-[var(--text-muted)] truncate">· {f.matterName}</span>}
                          </span>
                          <span className="tabular-nums text-foreground">{pesoExact(f.amount)}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {client && !loadingFees && (
            <div>
              <p className={labelClass}>Additional items</p>
              <div className="space-y-2">
                {adHoc.map((row) => (
                  <div key={row.key} className="grid grid-cols-[1fr_7rem_auto] gap-2 items-start">
                    <div className="space-y-1.5">
                      <input
                        type="text"
                        value={row.description}
                        onChange={(e) => setAdHoc((prev) => prev.map((r) => (r.key === row.key ? { ...r, description: e.target.value } : r)))}
                        placeholder="e.g. Success fee"
                        className={inputClass}
                      />
                      {matters.length > 1 && (
                        <SearchableSelect
                          options={matterOptions}
                          value={row.matterId}
                          onChange={(id) => setAdHoc((prev) => prev.map((r) => (r.key === row.key ? { ...r, matterId: id } : r)))}
                          placeholder="Matter (optional)"
                        />
                      )}
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={row.amount}
                      onChange={(e) => setAdHoc((prev) => prev.map((r) => (r.key === row.key ? { ...r, amount: e.target.value } : r)))}
                      placeholder="0.00"
                      className={`${inputClass} text-right tabular-nums`}
                    />
                    <button
                      type="button"
                      onClick={() => setAdHoc((prev) => prev.filter((r) => r.key !== row.key))}
                      aria-label="Remove item"
                      className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-600 dark:hover:text-red-400 hover:bg-subtle cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setAdHoc((prev) => [...prev, { key: Date.now(), description: '', amount: '', matterId: matters.length === 1 ? matters[0].id : '' }])}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-gold-600 dark:text-gold-400 hover:underline cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> Add item
                </button>
              </div>
            </div>
          )}

          {previewLines.length > 0 && (
            <>
              <div>
                <label className={labelClass}>Billing statement for</label>
                <input
                  type="text"
                  value={periodLabel}
                  onChange={(e) => setPeriodLabel(e.target.value)}
                  placeholder={suggestedLabel}
                  className={inputClass}
                />
                <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                  Reads &ldquo;our billing statement for {periodLabel.trim() || suggestedLabel}&rdquo; on the letter, in place of the month.
                </p>
              </div>
              <div>
                <label className={labelClass}>Note to the managing partner</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Optional — why this is billed now"
                  className={`${inputClass} resize-none`}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg bg-subtle px-3 py-2 text-xs">
                <span className="text-[var(--text-muted)]">Total (before VAT)</span>
                <span className="font-semibold text-foreground tabular-nums">{pesoExact(total)}</span>
              </div>
            </>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 p-2.5 text-[11px] text-red-700 dark:text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[var(--border-color)]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-subtle text-[var(--text-secondary)] hover:bg-stone-100 dark:hover:bg-stone-800 border border-[var(--border-color)] cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || !client || previewLines.length === 0 || incompleteAdHoc}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-gold-500 text-white hover:bg-gold-600 disabled:opacity-50 cursor-pointer"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Send for approval'}
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
