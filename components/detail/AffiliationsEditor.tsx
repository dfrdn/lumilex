'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, ChevronDown, AlertCircle } from 'lucide-react';
import CellDropdown from '@/components/admin/CellDropdown';
import type { Corporation, CorporationAffiliation, AffiliationRelation } from '@/types/corporations';

interface Props {
  corporation: Corporation;
}

const RELATIONS: AffiliationRelation[] = ['Parent', 'Subsidiary', 'Affiliate'];
const INPUT = 'w-full px-2 py-1 text-sm border border-stone-200 dark:border-white/10 rounded outline-none focus:border-navy-600';

/**
 * Parent, subsidiaries and affiliates — the intercompany block on GIS page 1.
 *
 * The form has one parent slot and five others, which the server enforces; this
 * only has to make them enterable.
 */
export default function AffiliationsEditor({ corporation }: Props) {
  const [rows, setRows] = useState<CorporationAffiliation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/corporation/${corporation.id}/affiliations`)
      .then((r) => r.json())
      .then((d) => live && setRows(d.affiliations ?? []))
      .catch(() => {})
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [corporation.id]);

  async function add() {
    if (adding) return;
    setAdding(true);
    setError('');
    const relation: AffiliationRelation = rows.some((r) => r.relation === 'Parent')
      ? 'Subsidiary'
      : 'Parent';
    const res = await fetch(`/api/corporation/${corporation.id}/affiliations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relation, name: 'New company' }),
    }).finally(() => setAdding(false));
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Could not add.');
      return;
    }
    setRows((prev) => [...prev, data.affiliation]);
  }

  async function save(id: number, patch: Partial<CorporationAffiliation>) {
    const res = await fetch(`/api/corporation/${corporation.id}/affiliations`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ affiliationId: id, ...patch }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Save failed.');
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === id ? data.affiliation : r)));
    setError('');
  }

  async function remove(id: number) {
    const res = await fetch(`/api/corporation/${corporation.id}/affiliations?affiliationId=${id}`, {
      method: 'DELETE',
    });
    if (res.ok) setRows((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <section className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100">Intercompany Affiliations</h3>
        <button
          onClick={add}
          disabled={adding}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-stone-700 dark:text-stone-200 border border-stone-300 dark:border-white/15 rounded-lg hover:bg-stone-50 dark:hover:bg-white/5 disabled:opacity-50"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>
      <p className="text-[11px] text-stone-500 dark:text-stone-400 mb-3">
        Parent company, subsidiaries and affiliates. Carried onto the GIS.
      </p>

      {error && (
        <p className="mb-2 text-xs text-rose-600 dark:text-rose-400 inline-flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {error}
        </p>
      )}

      {loading ? (
        <p className="text-xs text-stone-400 dark:text-stone-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-stone-500 dark:text-stone-400">None recorded.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <AffiliationRow key={r.id} row={r} onSave={save} onRemove={remove} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AffiliationRow({
  row,
  onSave,
  onRemove,
}: {
  row: CorporationAffiliation;
  onSave: (id: number, patch: Partial<CorporationAffiliation>) => void;
  onRemove: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);

  return (
    <li className="grid grid-cols-12 gap-2 items-start">
      <div className="col-span-3 relative">
        <button
          ref={anchor}
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center justify-between px-2 py-1 text-xs border border-stone-200 dark:border-white/10 rounded bg-white dark:bg-card hover:border-stone-400"
        >
          {row.relation}
          <ChevronDown className="w-3 h-3 text-stone-400 dark:text-stone-500" />
        </button>
        {open && (
          <CellDropdown
            mode="single"
            value={row.relation}
            options={RELATIONS.map((x) => ({ id: x, label: x }))}
            onSelect={(v) => {
              if (v && v !== row.relation) onSave(row.id, { relation: v as AffiliationRelation });
              setOpen(false);
            }}
            onClose={() => setOpen(false)}
            anchorRef={anchor}
          />
        )}
      </div>
      <input
        className={`${INPUT} col-span-4`}
        defaultValue={row.name}
        placeholder="Company name"
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v && v !== row.name) onSave(row.id, { name: v });
        }}
      />
      <input
        className={`${INPUT} col-span-2 font-mono`}
        defaultValue={row.secRegistrationNo ?? ''}
        placeholder="SEC reg. no."
        onBlur={(e) => {
          const v = e.target.value.trim() || null;
          if (v !== row.secRegistrationNo) onSave(row.id, { secRegistrationNo: v });
        }}
      />
      <input
        className={`${INPUT} col-span-2`}
        defaultValue={row.address ?? ''}
        placeholder="Address"
        onBlur={(e) => {
          const v = e.target.value.trim() || null;
          if (v !== row.address) onSave(row.id, { address: v });
        }}
      />
      <button
        onClick={() => onRemove(row.id)}
        className="col-span-1 p-1 text-stone-400 dark:text-stone-500 hover:text-rose-600 dark:hover:text-rose-400 justify-self-start"
        title="Remove"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </li>
  );
}
