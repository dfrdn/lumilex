'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';
import CellDropdown from '@/components/admin/CellDropdown';
import type { Corporation } from '@/types/corporations';
import type { CorporateScope } from '@/lib/corporations/matter-links';

const ROWS: { scope: CorporateScope; label: string; field: keyof Corporation }[] = [
  { scope: 'incorporation', label: 'Incorporation', field: 'incorporationMatterId' },
  { scope: 'post_incorporation', label: 'Post-incorporation', field: 'postIncorporationMatterId' },
  { scope: 'housekeeping', label: 'Housekeeping', field: 'housekeepingMatterId' },
  { scope: 'retainer', label: 'Retainer', field: 'retainerMatterId' },
];

interface MatterOption {
  id: string;
  name: string;
  clientName: string;
  matterCode: string | null;
}

/**
 * Which matter covers the company in each role. A retainer here is what puts
 * the company "under retainer" — one retainer matter can cover several
 * companies. Writes go to the company's matter_subjects links.
 */
export default function CorporationMatterLinks({
  corporation,
  matterNames,
  onUpdated,
}: {
  corporation: Corporation;
  matterNames: Record<string, string>;
  onUpdated?: (c: Corporation) => void;
}) {
  const [matters, setMatters] = useState<MatterOption[] | null>(null);
  const [editing, setEditing] = useState<CorporateScope | null>(null);
  const [saving, setSaving] = useState<CorporateScope | null>(null);
  const anchors = useRef<Partial<Record<CorporateScope, HTMLButtonElement | null>>>({});

  useEffect(() => {
    if (!editing || matters) return;
    fetch('/api/clients-matters')
      .then((r) => r.json())
      .then((d: { clients?: { id: string; name: string }[]; matters?: { id: string; name: string; code: string | null; clientId: string }[] }) => {
        const clientName = new Map((d.clients ?? []).map((c) => [c.id, c.name]));
        setMatters(
          (d.matters ?? []).map((m) => ({
            id: m.id,
            name: m.name,
            clientName: clientName.get(m.clientId) ?? '',
            matterCode: m.code ?? null,
          })),
        );
      })
      .catch(() => toast.error('Could not load matters.'));
  }, [editing, matters]);

  const label = (id: string | null) => (id ? matterNames[id] ?? matters?.find((m) => m.id === id)?.name ?? id : null);

  async function save(scope: CorporateScope, matterId: string | null) {
    setEditing(null);
    setSaving(scope);
    try {
      const res = await fetch(`/api/corporation/${corporation.id}/matters`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, matterId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? 'Could not change the matter.');
        return;
      }
      if (data.corporation) onUpdated?.(data.corporation as Corporation);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div>
      <div className="text-xs font-medium text-stone-600 dark:text-stone-300 mt-3 mb-1">Covered by</div>
      {ROWS.map(({ scope, label: rowLabel, field }) => {
        const id = corporation[field] as string | null;
        const name = label(id);
        return (
          <div key={scope} className="grid grid-cols-3 gap-3 py-2 border-b border-stone-100 dark:border-white/10 text-sm items-center">
            <span className="text-stone-500 dark:text-stone-400">{rowLabel}</span>
            <span className="col-span-2 flex items-center justify-between gap-2 min-w-0">
              {id && name ? (
                <Link href={`/dashboard/matters/${id}`} className="text-navy-700 dark:text-navy-300 hover:underline truncate">
                  {name}
                </Link>
              ) : (
                <span className="text-stone-400 dark:text-stone-500">{saving === scope ? 'Saving…' : '—'}</span>
              )}
              <button
                ref={(el) => {
                  anchors.current[scope] = el;
                }}
                type="button"
                onClick={() => setEditing((e) => (e === scope ? null : scope))}
                disabled={saving === scope}
                className="shrink-0 p-1 text-stone-400 dark:text-stone-500 hover:text-navy-700 dark:hover:text-navy-300 disabled:opacity-50"
                title={`Change the ${rowLabel.toLowerCase()} matter`}
              >
                <Pencil className="w-3 h-3" />
              </button>
              {editing === scope && (
                <CellDropdown
                  mode="single"
                  value={id}
                  placeholder={matters ? 'Search matters…' : 'Loading matters…'}
                  options={(matters ?? []).map((m) => ({
                    id: m.id,
                    label: m.matterCode ? `[${m.matterCode}] ${m.name}` : m.name,
                    sublabel: m.clientName,
                  }))}
                  anchorRef={{ current: anchors.current[scope] ?? null }}
                  onClose={() => setEditing(null)}
                  onSelect={(next) => void save(scope, next)}
                />
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
