'use client';

import { useMemo } from 'react';
import Avatar from '@/components/Avatar';
import type { ClientManagementRow } from '@/lib/queries/client-management';
import type { DropdownOption } from '@/components/admin/CellDropdown';

/** Sentinel filter value for clients with no relationship partner. */
export const UNASSIGNED_KEY = '__unassigned__';

interface Props {
  /** All rows (unfiltered) — the overview always reflects the whole client book. */
  rows: ClientManagementRow[];
  /** Selectable partners, for avatars/initials. */
  partnerOptions: DropdownOption[];
  /** Active filter: a person_id, UNASSIGNED_KEY, or null (no filter). */
  selected: string | null;
  onSelect: (value: string | null) => void;
}

interface Bucket {
  id: string;
  name: string;
  /** Total clients assigned to this partner. */
  count: number;
  /** Subset of `count` whose lifecycle is Active. */
  activeClients: number;
  initials: string;
  avatarUrl: string | null;
  /** Whether this partner is a currently-selectable (active, partner-role) member. */
  selectable: boolean;
}

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function RelationshipPartnerAllocation({ rows, partnerOptions, selected, onSelect }: Props) {
  const { partners, unassigned, unassignedActive, total, assigned, maxCount } = useMemo(() => {
    const optionById = new Map(partnerOptions.map((o) => [o.id, o]));
    const buckets = new Map<string, Bucket>();
    let unassignedCount = 0;
    let unassignedActiveCount = 0;

    for (const r of rows) {
      const isActive = r.lifecycle === 'Active';
      if (!r.relationshipPartnerId) {
        unassignedCount++;
        if (isActive) unassignedActiveCount++;
        continue;
      }
      const id = r.relationshipPartnerId;
      const existing = buckets.get(id);
      if (existing) {
        existing.count++;
        if (isActive) existing.activeClients++;
        continue;
      }
      const opt = optionById.get(id);
      buckets.set(id, {
        id,
        name: r.relationshipPartnerName ?? opt?.label ?? 'Unknown',
        count: 1,
        activeClients: isActive ? 1 : 0,
        initials: opt?.initials ?? deriveInitials(r.relationshipPartnerName ?? ''),
        avatarUrl: opt?.avatarUrl ?? null,
        selectable: !!opt,
      });
    }

    // Surface active partners with zero clients so the coverage picture is complete.
    for (const o of partnerOptions) {
      if (!buckets.has(o.id)) {
        buckets.set(o.id, { id: o.id, name: o.label, count: 0, activeClients: 0, initials: o.initials ?? '??', avatarUrl: o.avatarUrl ?? null, selectable: true });
      }
    }

    const partnersList = [...buckets.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const totalCount = rows.length;
    return {
      partners: partnersList,
      unassigned: unassignedCount,
      unassignedActive: unassignedActiveCount,
      total: totalCount,
      assigned: totalCount - unassignedCount,
      maxCount: Math.max(1, ...partnersList.map((b) => b.count)),
    };
  }, [rows, partnerOptions]);

  if (total === 0) return null;

  const coveragePct = Math.round((assigned / total) * 100);

  function toggle(value: string) {
    onSelect(selected === value ? null : value);
  }

  return (
    <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] p-5 mb-4">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Relationship partner allocation</h2>
          <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">active / total clients per partner</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--text-muted)]">
            <span className="font-semibold text-[var(--text-secondary)] tabular-nums">{assigned}</span> of{' '}
            <span className="tabular-nums">{total}</span> assigned ({coveragePct}%)
          </span>
          {selected !== null && (
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="text-xs font-medium text-gold-600 dark:text-gold-400 hover:text-gold-700 dark:hover:text-gold-300 transition-colors"
            >
              Show all
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
        {partners.map((b) => {
          const isSel = selected === b.id;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => toggle(b.id)}
              aria-pressed={isSel}
              className={`flex items-center gap-3 rounded-lg px-2 py-1.5 -mx-2 text-left transition-colors ${
                isSel ? 'bg-navy-50 dark:bg-navy-500/10' : 'hover:bg-[var(--subtle-bg)]'
              } ${b.count === 0 ? 'opacity-55' : ''}`}
            >
              <Avatar
                avatarUrl={b.avatarUrl}
                initials={b.initials}
                name={b.name}
                size={26}
                fallbackClassName="bg-navy-100 text-navy-600 dark:bg-navy-500/15 dark:text-navy-300"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-sm truncate ${isSel ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-primary)]'}`}>
                    {b.name}
                    {!b.selectable && <span className="ml-1.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">(inactive)</span>}
                  </span>
                  <span className="text-sm tabular-nums shrink-0" title={`${b.activeClients} active of ${b.count} total`}>
                    <span className="font-semibold text-[var(--text-primary)]">{b.activeClients}</span>
                    <span className="text-[var(--text-muted)]"> / {b.count}</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
                  {/* Total bar (scaled to the busiest partner), split into active + inactive. */}
                  <div className="h-full flex" style={{ width: `${(b.count / maxCount) * 100}%` }}>
                    <div className="h-full bg-navy-500/80 dark:bg-navy-400/70" style={{ width: `${b.count > 0 ? (b.activeClients / b.count) * 100 : 0}%` }} />
                    <div className="h-full flex-1 bg-navy-500/25 dark:bg-navy-400/20" />
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {unassigned > 0 && (
        <button
          type="button"
          onClick={() => toggle(UNASSIGNED_KEY)}
          aria-pressed={selected === UNASSIGNED_KEY}
          className={`mt-3 pt-3 border-t border-[var(--border-color)] w-full flex items-center justify-between gap-2 transition-colors ${
            selected === UNASSIGNED_KEY ? 'text-amber-800 dark:text-amber-300' : 'text-amber-700 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300'
          }`}
        >
          <span className={`text-xs font-medium ${selected === UNASSIGNED_KEY ? 'underline underline-offset-2' : ''}`}>Unassigned</span>
          <span className="text-sm tabular-nums shrink-0" title={`${unassignedActive} active of ${unassigned} total`}>
            <span className="font-semibold">{unassignedActive}</span>
            <span className="opacity-70"> / {unassigned}</span>
          </span>
        </button>
      )}
    </div>
  );
}
