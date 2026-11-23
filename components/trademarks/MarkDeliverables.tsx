'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowUpRight, ClipboardList, Loader2, Plus } from 'lucide-react';
import type { Trademark } from '@/types/notion';
import type { MarkDeliverableOption } from '@/lib/trademarks/deliverables';
import { deliverableStatusTone, isClosed } from '@/lib/deliverable-status';
import { formatDate } from '@/lib/format-date';
import CellDropdown from '@/components/admin/CellDropdown';
import Button from '@/components/ui/Button';
import { DueChip, StatusPill, SubjectCard } from '@/components/ui/primitives';
import { confirmAction } from '@/components/ui/confirm';

export interface MarkDeliverable {
  id: string;
  name: string;
  status: string;
  due: string | null;
  doneOn: string | null;
  action: string | null;
  officeActionId: string | null;
  kind: string | null;
  /** The step on the mark it is the paper for, when it is one. */
  step: string | null;
}

/** A step work can be started for, with the name it will get and the matter it will sit under. */
export type MarkDeliverableChoice = MarkDeliverableOption & { name: string; matterName: string | null };

export interface MarkDeliverablesState {
  deliverables: MarkDeliverable[];
  options: MarkDeliverableChoice[];
  loading: boolean;
  creating: string | null;
  create: (o: MarkDeliverableChoice) => Promise<void>;
  reload: () => void;
}

const MUTED = 'text-stone-500 dark:text-stone-400';
const keyOf = (o: { action: string; officeActionId: string | null }) => `${o.action}|${o.officeActionId ?? ''}`;
const href = (id: string) => `/dashboard/deliverables/${id}`;

/**
 * The work on a mark: its deliverables, and starting one for a step. Reloaded
 * whenever the mark changes, since recording a step can file its deliverable.
 */
export function useMarkDeliverables(tm: Trademark): MarkDeliverablesState {
  const [deliverables, setDeliverables] = useState<MarkDeliverable[]>([]);
  const [options, setOptions] = useState<MarkDeliverableChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/trademark/${tm.id}/deliverables`)
      .then((r) => r.json())
      .then((d) => {
        setDeliverables(d.deliverables ?? []);
        setOptions(d.options ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tm.id]);

  useEffect(load, [load, tm]);

  /** Asks first — the new deliverable notifies its drafter and the admins — then creates it. */
  async function create(o: MarkDeliverableChoice) {
    if (!o.matterName) {
      toast.error('Link the mark to a matter first (Covered by)');
      return;
    }
    const ok = await confirmAction({
      title: 'Create this deliverable?',
      message: [
        `“${o.name}”`,
        o.due ? `due ${formatDate(o.due)}` : null,
        `under ${o.matterName}, with you as drafter.`,
      ].filter(Boolean).join(', ') + ' Filing it records the step on the mark.',
      confirmLabel: 'Create deliverable',
    });
    if (!ok) return;
    setCreating(keyOf(o));
    const res = await fetch(`/api/trademark/${tm.id}/deliverables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: o.action, officeActionId: o.officeActionId }),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    setCreating(null);
    if (!res?.ok || !data?.deliverable) {
      toast.error(data?.error ?? 'Could not create the deliverable');
      if (res?.status === 409) load();
      return;
    }
    const created = data.deliverable as MarkDeliverable;
    setDeliverables((prev) => [created, ...prev]);
    setOptions((prev) => prev.filter((x) => keyOf(x) !== keyOf(o)));
    toast.success('Deliverable created', {
      description: created.name,
      action: { label: 'Open', onClick: () => window.open(href(created.id), '_self') },
    });
  }

  return { deliverables, options, loading, creating, create, reload: load };
}

/** The open deliverable for a step, if any. */
export function openDeliverableFor(state: MarkDeliverablesState, action: string, officeActionId: string | null = null) {
  return state.deliverables.find(
    (d) => d.action === action && (d.officeActionId ?? null) === officeActionId && !isClosed(d.status),
  );
}

/**
 * Beside a step that can be a deliverable: the open one, linked with its
 * status, or a button that starts it.
 */
export function StepDeliverable({
  state, action, officeActionId = null, label = 'Create deliverable',
}: {
  state: MarkDeliverablesState;
  action: string;
  officeActionId?: string | null;
  label?: string;
}) {
  const open = openDeliverableFor(state, action, officeActionId);
  if (open) {
    return (
      <Link
        href={href(open.id)}
        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-stone-200 dark:border-white/10 text-xs text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-white/5"
        title={`Open ${open.name}`}
      >
        <ClipboardList className="w-3.5 h-3.5" />
        <span className="max-w-[12rem] truncate">{open.step ?? 'Deliverable'}</span>
        <StatusPill label={open.status} tone={deliverableStatusTone(open.status)} size="sm" />
      </Link>
    );
  }
  const option = state.options.find((o) => o.action === action && (o.officeActionId ?? null) === officeActionId);
  if (!option) return null;
  const busy = state.creating === keyOf(option);
  return (
    <Button variant="outline" className="h-8 inline-flex items-center gap-1.5" disabled={busy} onClick={() => void state.create(option)} title={`Start the deliverable: ${option.label}`}>
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
      {label}
    </Button>
  );
}

export default function MarkDeliverablesCard({ state }: { state: MarkDeliverablesState }) {
  const [picking, setPicking] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const { deliverables, options, loading, creating } = state;

  return (
    <SubjectCard
      title="Deliverables"
      icon={<ClipboardList className="w-4 h-4" />}
      action={
        options.length > 0 && (
          <>
            <Button ref={anchor} variant="outline" size="sm" className="inline-flex items-center gap-1" disabled={!!creating} onClick={() => setPicking((p) => !p)}>
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              New deliverable
            </Button>
            {picking && (
              <CellDropdown
                mode="single"
                value={null}
                anchorRef={anchor}
                minWidth={280}
                options={options.map((o) => ({ id: keyOf(o), label: o.label, sublabel: o.due ? `Due ${formatDate(o.due)}` : undefined }))}
                onSelect={(id) => {
                  setPicking(false);
                  const o = options.find((x) => keyOf(x) === id);
                  if (o) void state.create(o);
                }}
                onClose={() => setPicking(false)}
              />
            )}
          </>
        )
      }
      bodyClassName="pb-3"
    >
      {loading ? (
        <p className={`px-5 text-sm ${MUTED}`}>Loading…</p>
      ) : deliverables.length === 0 ? (
        <p className={`px-5 text-sm ${MUTED}`}>
          {options.length ? 'None yet. Start one for a step: filing it records the step here, and the dates and any undo stay in step both ways.' : 'None yet.'}
        </p>
      ) : (
        <ul className="divide-y divide-stone-100 dark:divide-white/[0.06]">
          {deliverables.map((d) => {
            const done = isClosed(d.status);
            return (
              <li key={d.id}>
                <Link href={href(d.id)} className="group flex items-center gap-3 px-5 py-2.5 hover:bg-stone-50/70 dark:hover:bg-white/[0.02] transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-stone-900 dark:text-stone-50 truncate group-hover:text-navy-700 dark:group-hover:text-navy-300">{d.name}</p>
                    {d.step && <p className={`text-[11px] ${MUTED}`}>{d.step}</p>}
                  </div>
                  {done ? (
                    d.doneOn && <span className={`text-xs whitespace-nowrap ${MUTED}`}>{formatDate(d.doneOn)}</span>
                  ) : (
                    d.due && <DueChip due={d.due} />
                  )}
                  <StatusPill label={d.status} tone={deliverableStatusTone(d.status)} size="sm" />
                  <ArrowUpRight className="w-3.5 h-3.5 text-stone-300 group-hover:text-stone-500 dark:text-stone-600 shrink-0" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </SubjectCard>
  );
}
