'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Loader2, Check, Pencil, Plus, Trash2, MapPin } from 'lucide-react';
import { pesoExact } from '@/lib/finance/format';
import { confirmAction } from '@/components/ui/confirm';

interface Zone {
  id: number;
  /** Internal tariff — actual cost reimbursed to the liaison. */
  round_trip_rate: number;
  /** External tariff — client-facing, markup-inclusive rate billed to the client. */
  external_rate: number;
  name: string;
  notes: string;
  active: boolean;
  updated_by_name: string;
  updated_at: string;
}

export default function TransportationTariffEditor() {
  const { data, error: loadError, isLoading: loading, mutate } = useSWR<{ zones?: Zone[] }>('/api/transportation-zones?all=1', async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed (${res.status})`);
    return res.json();
  });
  const zones = data?.zones ?? [];
  const [actionError, setError] = useState<string | null>(null);
  const error = actionError ?? (loadError ? (loadError instanceof Error ? loadError.message : 'Failed to load') : null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRate, setNewRate] = useState('');
  const [newExternal, setNewExternal] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    await mutate();
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    const rate = Number(newRate);
    if (!Number.isFinite(rate) || rate < 0) return;
    // External defaults to the internal rate when left blank.
    const external = newExternal.trim() === '' ? rate : Number(newExternal);
    if (!Number.isFinite(external) || external < 0) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/transportation-zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          round_trip_rate: rate,
          external_rate: external,
          notes: newNotes.trim(),
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? 'Failed');
      }
      setNewName(''); setNewRate(''); setNewExternal(''); setNewNotes(''); setCreating(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivate(zone: Zone) {
    if (!(await confirmAction({ title: `Deactivate "${zone.name}"?`, message: "Existing errands and reimbursements keep their reference but it won't appear in new errands.", confirmLabel: 'Deactivate' }))) return;
    await fetch(`/api/transportation-zones/${zone.id}`, { method: 'DELETE' });
    await load();
  }

  async function handleReactivate(zone: Zone) {
    await fetch(`/api/transportation-zones/${zone.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: true }),
    });
    await load();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground font-serif mb-1 flex items-center gap-2">
            <MapPin className="w-5 h-5 text-gold-600 dark:text-gold-400" />
            Transportation Tariff
          </h1>
          <p className="text-xs text-stone-400 dark:text-stone-500">
            Round-trip rates per destination. <strong>Internal</strong> is the actual cost reimbursed
            to the liaison; <strong>External</strong> is the client-facing rate (with markup) billed
            as a transportation expense. Both are applied when a liaison completes an errand.
          </p>
          <a
            href="/finance/liaison-errand-costs"
            className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-gold-600 hover:text-gold-700 dark:text-gold-400 dark:hover:text-gold-300"
          >
            View liaison errand cost report →
          </a>
        </div>
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gold-600 text-white text-sm font-medium hover:bg-gold-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Destination
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
          {error}
          <button onClick={load} className="ml-2 underline text-xs">Retry</button>
        </div>
      )}

      {creating && (
        <div className="mb-4 p-4 rounded-xl border border-gold-200 dark:border-gold-700/50 bg-gold-50/40 dark:bg-gold-900/10">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
            <input
              autoFocus
              placeholder="Destination name (e.g. BIR Quezon City)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="px-3 py-2 rounded-lg bg-background border border-[var(--border-color)] text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold-400"
            />
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="Internal rate (PHP)"
              value={newRate}
              onChange={(e) => setNewRate(e.target.value)}
              className="px-3 py-2 rounded-lg bg-background border border-[var(--border-color)] text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold-400"
            />
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="External rate (defaults to internal)"
              value={newExternal}
              onChange={(e) => setNewExternal(e.target.value)}
              className="px-3 py-2 rounded-lg bg-background border border-[var(--border-color)] text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold-400"
            />
            <input
              placeholder="Notes (optional)"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              className="px-3 py-2 rounded-lg bg-background border border-[var(--border-color)] text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold-400"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setCreating(false); setNewName(''); setNewRate(''); setNewNotes(''); }}
              className="px-3 py-1.5 rounded-lg text-sm text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800/50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={submitting || !newName.trim() || !newRate}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-gold-600 text-white hover:bg-gold-700 disabled:opacity-60"
            >
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Add
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-[var(--border-color)] bg-card shadow-[var(--shadow-card)]">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] bg-[var(--subtle-bg)]">
              <th className="text-left px-5 py-3 border-b border-[var(--border-color)]">Destination</th>
              <th className="text-right px-5 py-3 border-b border-[var(--border-color)]">Internal (liaison)</th>
              <th className="text-right px-5 py-3 border-b border-[var(--border-color)]">External (client)</th>
              <th className="text-right px-5 py-3 border-b border-[var(--border-color)]">Margin</th>
              <th className="text-left px-5 py-3 border-b border-[var(--border-color)]">Notes</th>
              <th className="text-left px-5 py-3 border-b border-[var(--border-color)]">Last Updated</th>
              <th className="text-right px-5 py-3 border-b border-[var(--border-color)]">Status</th>
            </tr>
          </thead>
          <tbody>
            {zones.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-12 text-center text-sm text-stone-400 dark:text-stone-500">
                  No destinations yet. Click <strong>Add Destination</strong> to create one.
                </td>
              </tr>
            ) : (
              zones.map((z) => (
                <ZoneRow key={z.id} zone={z} onChange={load} onDeactivate={handleDeactivate} onReactivate={handleReactivate} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ZoneRow({ zone, onChange, onDeactivate, onReactivate }: {
  zone: Zone;
  onChange: () => Promise<void>;
  onDeactivate: (z: Zone) => Promise<void>;
  onReactivate: (z: Zone) => Promise<void>;
}) {
  const [editingRate, setEditingRate] = useState(false);
  const [editingExternal, setEditingExternal] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [draftRate, setDraftRate] = useState(String(zone.round_trip_rate));
  const [draftExternal, setDraftExternal] = useState(String(zone.external_rate));
  const [draftNotes, setDraftNotes] = useState(zone.notes);
  const [saving, setSaving] = useState(false);
  const [savedField, setSavedField] = useState<'round_trip_rate' | 'external_rate' | 'notes' | null>(null);

  async function saveField(field: 'round_trip_rate' | 'external_rate' | 'notes', value: number | string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/transportation-zones/${zone.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (res.ok) {
        setSavedField(field);
        setTimeout(() => setSavedField(null), 1500);
        await onChange();
      }
    } finally {
      setSaving(false);
      setEditingRate(false);
      setEditingExternal(false);
      setEditingNotes(false);
    }
  }

  const commitRate = () => {
    const n = parseFloat(draftRate);
    if (!Number.isFinite(n) || n === zone.round_trip_rate) {
      setEditingRate(false);
      return;
    }
    saveField('round_trip_rate', n);
  };

  const commitExternal = () => {
    const n = parseFloat(draftExternal);
    if (!Number.isFinite(n) || n === zone.external_rate) {
      setEditingExternal(false);
      return;
    }
    saveField('external_rate', n);
  };

  const margin = Number(zone.external_rate) - Number(zone.round_trip_rate);

  return (
    <tr className={`group hover:bg-[var(--subtle-bg)] transition-colors ${!zone.active ? 'opacity-60' : ''}`}>
      <td className="px-5 py-3 text-sm text-foreground font-medium border-b border-[var(--border-color)]">
        {zone.name}
      </td>
      <td className="px-5 py-3 text-sm text-foreground text-right border-b border-[var(--border-color)]">
        {editingRate ? (
          <div className="flex items-center justify-end gap-1">
            <span className="text-[var(--text-muted)]">₱</span>
            <input
              type="number"
              step="0.01"
              value={draftRate}
              onChange={(e) => setDraftRate(e.target.value)}
              onBlur={commitRate}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRate();
                if (e.key === 'Escape') setEditingRate(false);
              }}
              className="w-28 px-2 py-1 text-sm text-right rounded-md bg-background border border-gold-400 text-foreground focus:outline-none focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40"
              autoFocus
            />
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-muted)]" />}
          </div>
        ) : (
          <div
            className="flex items-center justify-end gap-1.5 cursor-pointer"
            onClick={() => { if (!zone.active) return; setDraftRate(String(zone.round_trip_rate)); setEditingRate(true); }}
          >
            <span>{pesoExact(zone.round_trip_rate)}</span>
            {savedField === 'round_trip_rate' ? (
              <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
            ) : zone.active ? (
              <Pencil className="w-3 h-3 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
            ) : null}
          </div>
        )}
      </td>
      <td className="px-5 py-3 text-sm text-foreground text-right border-b border-[var(--border-color)]">
        {editingExternal ? (
          <div className="flex items-center justify-end gap-1">
            <span className="text-[var(--text-muted)]">₱</span>
            <input
              type="number"
              step="0.01"
              value={draftExternal}
              onChange={(e) => setDraftExternal(e.target.value)}
              onBlur={commitExternal}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitExternal();
                if (e.key === 'Escape') setEditingExternal(false);
              }}
              className="w-28 px-2 py-1 text-sm text-right rounded-md bg-background border border-gold-400 text-foreground focus:outline-none focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40"
              autoFocus
            />
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-muted)]" />}
          </div>
        ) : (
          <div
            className="flex items-center justify-end gap-1.5 cursor-pointer"
            onClick={() => { if (!zone.active) return; setDraftExternal(String(zone.external_rate)); setEditingExternal(true); }}
          >
            <span>{pesoExact(zone.external_rate)}</span>
            {savedField === 'external_rate' ? (
              <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
            ) : zone.active ? (
              <Pencil className="w-3 h-3 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
            ) : null}
          </div>
        )}
      </td>
      <td className="px-5 py-3 text-sm text-right border-b border-[var(--border-color)] whitespace-nowrap">
        <span className={margin > 0 ? 'text-emerald-600 dark:text-emerald-400' : margin < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-[var(--text-muted)]'}>
          {pesoExact(margin)}
        </span>
      </td>
      <td className="px-5 py-3 text-sm text-foreground border-b border-[var(--border-color)]">
        {editingNotes ? (
          <input
            value={draftNotes}
            onChange={(e) => setDraftNotes(e.target.value)}
            onBlur={() => saveField('notes', draftNotes)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveField('notes', draftNotes);
              if (e.key === 'Escape') setEditingNotes(false);
            }}
            autoFocus
            className="w-full px-2 py-1 text-sm rounded-md bg-background border border-gold-400 text-foreground focus:outline-none focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40"
          />
        ) : (
          <span
            className="text-stone-500 dark:text-stone-400 cursor-pointer"
            onClick={() => { if (!zone.active) return; setDraftNotes(zone.notes); setEditingNotes(true); }}
          >
            {zone.notes || <em className="text-stone-300 dark:text-stone-600">add note</em>}
          </span>
        )}
      </td>
      <td className="px-5 py-3 text-xs text-stone-500 dark:text-stone-400 border-b border-[var(--border-color)]">
        {zone.updated_by_name && <div>{zone.updated_by_name}</div>}
        <div>{new Date(zone.updated_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' })}</div>
      </td>
      <td className="px-5 py-3 text-right border-b border-[var(--border-color)]">
        {zone.active ? (
          <button
            type="button"
            onClick={() => onDeactivate(zone)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-stone-500 hover:bg-red-50 hover:text-red-600 dark:hover:text-red-400 dark:hover:bg-red-900/20 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            Deactivate
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onReactivate(zone)}
            className="text-xs text-gold-600 hover:text-gold-700 dark:text-gold-400 dark:hover:text-gold-300 underline"
          >
            Reactivate
          </button>
        )}
      </td>
    </tr>
  );
}
