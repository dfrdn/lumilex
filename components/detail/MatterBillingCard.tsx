'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import {
  Receipt, Pencil, Upload, FileText, Lock, Plus, Check, Trash2, Layers, Flag,
} from 'lucide-react';
import BillingConfigModal from '../finance/BillingConfigModal';
import FilePreviewModal from '../FilePreviewModal';
import DatePickerInput from '../DatePickerInput';
import { manilaMonth, manilaToday } from '@/lib/dates';

interface BillingConfig {
  id: number;
  matter_id: string;
  billing_type:
    | 'litigation'
    | 'retainer'
    | 'fixed_retainer'
    | 'fixed_fee'
    | 'acceptance_per_action'
    | 'acceptance_per_milestone';
  acceptance_fee: number | null;
  acceptance_fee_paid: boolean;
  monthly_retainer: number | null;
  retainer_hours_cap: number | null;
  hourly_rate_override: number | null;
  fixed_fee_amount: number | null;
  success_fee_percent: number | null;
  success_fee_amount: number | null;
  engagement_date: string | null;
  engagement_file_path: string | null;
  engagement_file_name: string | null;
  billing_settings: Record<string, unknown>;
  notes: string;
}

interface ActionRow {
  id: number;
  name: string;
  rate: number;
  cap: number | null;
  unit_label: string;
}

interface ActionEntryRow {
  id: number;
  action_id: number;
  entry_date: string;
  quantity: number;
  description: string;
  invoiced: boolean;
}

interface MilestoneRow {
  id: number;
  name: string;
  description: string;
  fee: number;
  target_date: string | null;
  reached_at: string | null;
  invoiced: boolean;
}

function fmt(n: number | null) {
  if (n === null || n === undefined) return '—';
  return `₱${Number(n).toLocaleString('en-PH')}`;
}

const TYPE_LABELS: Record<string, string> = {
  litigation: 'Litigation',
  retainer: 'Retainer',
  fixed_retainer: 'Fixed Retainer',
  fixed_fee: 'Fixed Fee',
  acceptance_per_action: 'Per Action',
  acceptance_per_milestone: 'Per Milestone',
};

const TYPE_COLORS: Record<string, string> = {
  litigation: 'bg-red-50 text-red-700 ring-red-200/60 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20',
  retainer: 'bg-blue-50 text-blue-700 ring-blue-200/60 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/20',
  fixed_retainer: 'bg-indigo-50 text-indigo-700 ring-indigo-200/60 dark:bg-indigo-500/10 dark:text-indigo-400 dark:ring-indigo-500/20',
  fixed_fee: 'bg-emerald-50 text-emerald-700 ring-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20',
  acceptance_per_action: 'bg-amber-50 text-amber-700 ring-amber-200/60 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20',
  acceptance_per_milestone: 'bg-purple-50 text-purple-700 ring-purple-200/60 dark:bg-purple-500/10 dark:text-purple-400 dark:ring-purple-500/20',
};

export default function MatterBillingCard({ matterId }: { matterId: string }) {
  const q = encodeURIComponent(matterId);
  const { data: configRes, isLoading: loading, mutate: fetchConfig } = useSWR<{ data: BillingConfig | null }>(
    `/api/finance/matter-billing?matterId=${q}`,
    fetcher,
  );
  const config = configRes?.data ?? null;
  const [modalOpen, setModalOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Per-action / per-milestone rows, read only when the billing type uses them.
  const perAction = config?.billing_type === 'acceptance_per_action';
  const perMilestone = config?.billing_type === 'acceptance_per_milestone';
  const { data: actionsRes, mutate: mutateActions } = useSWR<{ actions: ActionRow[] }>(
    perAction ? `/api/finance/matter-billing/actions?matterId=${q}` : null,
    fetcher,
  );
  const { data: entriesRes, mutate: mutateEntries } = useSWR<{ entries: ActionEntryRow[] }>(
    perAction ? `/api/finance/matter-billing/action-entries?matterId=${q}` : null,
    fetcher,
  );
  const { data: milestonesRes, mutate: fetchMilestones } = useSWR<{ milestones: MilestoneRow[] }>(
    perMilestone ? `/api/finance/matter-billing/milestones?matterId=${q}` : null,
    fetcher,
  );
  const actions = actionsRes?.actions ?? [];
  const actionEntries = entriesRes?.entries ?? [];
  const milestones = milestonesRes?.milestones ?? [];
  const fetchActions = () => { void mutateActions(); void mutateEntries(); };

  // Inline "log action" form state
  const [logActionId, setLogActionId] = useState<number | null>(null);
  const [logDate, setLogDate] = useState<string | null>(manilaToday());
  const [logQuantity, setLogQuantity] = useState('1');
  const [logDescription, setLogDescription] = useState('');
  const [logSubmitting, setLogSubmitting] = useState(false);

  const handleViewEngagement = async () => {
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/finance/matter-billing/engagement?matterId=${matterId}`);
      const json = await res.json();
      if (json.url) {
        setPreviewUrl(json.url);
        setPreviewOpen(true);
      }
    } catch { /* ignore */ }
    setPreviewLoading(false);
  };

  const handleLogAction = async () => {
    if (!logActionId || !logDate) return;
    setLogSubmitting(true);
    try {
      const res = await fetch('/api/finance/matter-billing/action-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matterId,
          actionId: logActionId,
          entryDate: logDate,
          quantity: parseInt(logQuantity) || 1,
          description: logDescription,
        }),
      });
      if (res.ok) {
        setLogActionId(null);
        setLogDescription('');
        setLogQuantity('1');
        fetchActions();
      }
    } catch { /* ignore */ }
    setLogSubmitting(false);
  };

  const handleDeleteEntry = async (id: number) => {
    try {
      const res = await fetch(`/api/finance/matter-billing/action-entries?id=${id}`, { method: 'DELETE' });
      if (res.ok) fetchActions();
    } catch { /* ignore */ }
  };

  const handleMarkReached = async (id: number, reached: boolean) => {
    try {
      const res = await fetch('/api/finance/matter-billing/milestones', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, reached }),
      });
      if (res.ok) void fetchMilestones();
    } catch { /* ignore */ }
  };

  if (loading) {
    return (
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden animate-fade-up">
        <div className="px-5 py-4 border-b border-[var(--border-color)]">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Billing</h2>
        </div>
        <div className="px-5 py-6">
          <div className="h-4 w-32 rounded skeleton-shimmer" />
        </div>
      </div>
    );
  }

  const usesAcceptance = config && (
    config.billing_type === 'litigation' ||
    config.billing_type === 'acceptance_per_action' ||
    config.billing_type === 'acceptance_per_milestone'
  );

  return (
    <>
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden animate-fade-up">
        <div className="px-5 py-4 border-b border-[var(--border-color)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-[var(--text-muted)]" />
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Billing</h2>
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded-full bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400"
              title="Visible to Partners and Finance only"
            >
              <Lock className="w-2.5 h-2.5" />
              Partners &amp; Finance
            </span>
          </div>
          {config && (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="p-1.5 rounded-lg hover:bg-gold-50 dark:hover:bg-gold-500/10 transition-colors cursor-pointer"
              title="Edit billing config"
            >
              <Pencil className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            </button>
          )}
        </div>

        {!config ? (
          <div className="px-5 py-6 text-center">
            <p className="text-sm text-[var(--text-muted)] mb-3">No billing configuration</p>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gold-50 text-gold-700 hover:bg-gold-100 border border-gold-200/60 dark:bg-gold-500/10 dark:text-gold-400 dark:border-gold-500/30 dark:hover:bg-gold-500/20 transition-colors cursor-pointer"
            >
              <Receipt className="w-3.5 h-3.5" />
              Set Up Billing
            </button>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-color)]">
            {/* Billing Type */}
            <div className="px-5 py-3">
              <span className={`inline-flex items-center px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-full ring-1 ring-inset ${TYPE_COLORS[config.billing_type] ?? TYPE_COLORS.litigation}`}>
                {TYPE_LABELS[config.billing_type] ?? config.billing_type}
              </span>
            </div>

            {/* Acceptance fee row (shared by litigation/per-action/per-milestone) */}
            {usesAcceptance && (
              <div className="px-5 py-3">
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--text-muted)]">Acceptance Fee</span>
                  <span className="font-medium text-[var(--text-primary)]">
                    {fmt(config.acceptance_fee)}
                    {config.acceptance_fee_paid && (
                      <span className="ml-1.5 text-[10px] text-emerald-600 dark:text-emerald-400">Paid</span>
                    )}
                  </span>
                </div>
              </div>
            )}

            {/* Type-specific fee structure */}
            <div className="px-5 py-3 space-y-1.5">
              {config.billing_type === 'litigation' && (
                <>
                  {config.hourly_rate_override && (
                    <div className="flex justify-between text-xs">
                      <span className="text-[var(--text-muted)]">Hourly Rate</span>
                      <span className="font-medium text-[var(--text-primary)]">{fmt(config.hourly_rate_override)}/hr</span>
                    </div>
                  )}
                  {(config.success_fee_percent || config.success_fee_amount) && (
                    <div className="flex justify-between text-xs">
                      <span className="text-[var(--text-muted)]">Success Fee</span>
                      <span className="font-medium text-[var(--text-primary)]">
                        {config.success_fee_percent ? `${config.success_fee_percent}%` : fmt(config.success_fee_amount)}
                      </span>
                    </div>
                  )}
                </>
              )}
              {config.billing_type === 'retainer' && (
                <>
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--text-muted)]">Monthly Retainer</span>
                    <span className="font-medium text-[var(--text-primary)]">{fmt(config.monthly_retainer)}/mo</span>
                  </div>
                  {config.retainer_hours_cap && (
                    <div className="flex justify-between text-xs">
                      <span className="text-[var(--text-muted)]">Hours Cap</span>
                      <span className="font-medium text-[var(--text-primary)]">{config.retainer_hours_cap} hrs</span>
                    </div>
                  )}
                  {config.hourly_rate_override && (
                    <div className="flex justify-between text-xs">
                      <span className="text-[var(--text-muted)]">Excess Rate</span>
                      <span className="font-medium text-[var(--text-primary)]">{fmt(config.hourly_rate_override)}/hr</span>
                    </div>
                  )}
                </>
              )}
              {config.billing_type === 'fixed_retainer' && (
                <>
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--text-muted)]">Monthly Retainer</span>
                    <span className="font-medium text-[var(--text-primary)]">{fmt(config.monthly_retainer)}/mo</span>
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)]">Flat — hours informational only.</p>
                </>
              )}
              {config.billing_type === 'fixed_fee' && (
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--text-muted)]">Fixed Fee</span>
                  <span className="font-medium text-[var(--text-primary)]">{fmt(config.fixed_fee_amount)}</span>
                </div>
              )}
              {config.billing_type === 'acceptance_per_action' && (
                <ActionPanel
                  actions={actions}
                  entries={actionEntries}
                  logActionId={logActionId}
                  setLogActionId={setLogActionId}
                  logDate={logDate}
                  setLogDate={setLogDate}
                  logQuantity={logQuantity}
                  setLogQuantity={setLogQuantity}
                  logDescription={logDescription}
                  setLogDescription={setLogDescription}
                  logSubmitting={logSubmitting}
                  onLog={handleLogAction}
                  onDeleteEntry={handleDeleteEntry}
                />
              )}
              {config.billing_type === 'acceptance_per_milestone' && (
                <MilestonePanel milestones={milestones} onToggle={handleMarkReached} />
              )}
            </div>

            {/* Engagement Agreement */}
            <div className="px-5 py-3">
              {config.engagement_file_path ? (
                <button
                  type="button"
                  onClick={handleViewEngagement}
                  disabled={previewLoading}
                  className="inline-flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline cursor-pointer disabled:opacity-60"
                >
                  <FileText className="w-3.5 h-3.5" />
                  {config.engagement_file_name ?? 'Engagement Agreement'}
                  {previewLoading && <span className="text-[10px] text-[var(--text-muted)]">Loading…</span>}
                </button>
              ) : (
                <span className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5" />
                  No engagement agreement
                </span>
              )}
              {config.engagement_date && (
                <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                  Engaged {new Date(config.engagement_date + 'T00:00:00Z').toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila' })}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <BillingConfigModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        matterId={matterId}
        existing={config}
        onSaved={() => {
          void fetchConfig();
          if (perAction) fetchActions();
          if (perMilestone) void fetchMilestones();
        }}
      />

      <FilePreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        files={
          previewUrl && config?.engagement_file_name
            ? [{ name: config.engagement_file_name, url: previewUrl }]
            : []
        }
      />
    </>
  );
}

function ActionPanel(props: {
  actions: ActionRow[];
  entries: ActionEntryRow[];
  logActionId: number | null;
  setLogActionId: (id: number | null) => void;
  logDate: string | null;
  setLogDate: (v: string | null) => void;
  logQuantity: string;
  setLogQuantity: (v: string) => void;
  logDescription: string;
  setLogDescription: (v: string) => void;
  logSubmitting: boolean;
  onLog: () => void;
  onDeleteEntry: (id: number) => void;
}) {
  const {
    actions, entries, logActionId, setLogActionId, logDate, setLogDate,
    logQuantity, setLogQuantity, logDescription, setLogDescription, logSubmitting,
    onLog, onDeleteEntry,
  } = props;

  if (actions.length === 0) {
    return (
      <div className="text-xs text-[var(--text-muted)] italic flex items-center gap-1.5">
        <Layers className="w-3.5 h-3.5" />
        No actions configured. Edit the billing config to add some.
      </div>
    );
  }

  const month = manilaMonth();
  const monthEntries = entries.filter((e) => e.entry_date?.startsWith(month));

  return (
    <div className="space-y-2">
      {actions.map((a) => {
        const aEntries = monthEntries.filter((e) => e.action_id === a.id);
        const usedQty = aEntries.reduce((s, e) => s + (e.quantity ?? 1), 0);
        const capHit = a.cap != null && usedQty >= a.cap;
        return (
          <div key={a.id} className="rounded-md border border-[var(--border-color)] bg-subtle/40">
            <div className="px-2.5 py-2 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--text-primary)] truncate">{a.name}</p>
                <p className="text-[10px] text-[var(--text-muted)]">
                  {fmt(a.rate)}{a.unit_label ? ` / ${a.unit_label}` : ''}
                  {a.cap != null && ` · ${usedQty}/${a.cap} this month`}
                  {a.cap == null && usedQty > 0 && ` · ${usedQty} this month`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLogActionId(logActionId === a.id ? null : a.id)}
                disabled={capHit}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md bg-gold-50 text-gold-700 hover:bg-gold-100 border border-gold-200/60 dark:bg-gold-500/10 dark:text-gold-400 dark:border-gold-500/30 dark:hover:bg-gold-500/20 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                title={capHit ? 'Monthly cap reached' : 'Log occurrence'}
              >
                <Plus className="w-3 h-3" />
                Log
              </button>
            </div>
            {logActionId === a.id && (
              <div className="px-2.5 pb-2.5 space-y-2 border-t border-[var(--border-color)] pt-2">
                <div className="flex gap-2 items-center">
                  <DatePickerInput variant="cell" value={logDate} onChange={setLogDate} />
                  <input
                    type="number"
                    min="1"
                    value={logQuantity}
                    onChange={(e) => setLogQuantity(e.target.value)}
                    className="w-16 px-2 py-1 text-xs rounded-md bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-gold-300"
                    placeholder="Qty"
                  />
                </div>
                <input
                  value={logDescription}
                  onChange={(e) => setLogDescription(e.target.value)}
                  placeholder="Description (optional)"
                  className="w-full px-2 py-1 text-xs rounded-md bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-gold-300"
                />
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => setLogActionId(null)}
                    className="px-2 py-1 text-[11px] rounded-md bg-subtle text-[var(--text-secondary)] hover:bg-stone-100 dark:hover:bg-stone-800 border border-[var(--border-color)] cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={onLog}
                    disabled={logSubmitting}
                    className="px-2 py-1 text-[11px] rounded-md bg-gold-500 text-white hover:bg-gold-600 disabled:opacity-50 cursor-pointer"
                  >
                    {logSubmitting ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            )}
            {aEntries.length > 0 && (
              <ul className="divide-y divide-[var(--border-color)] border-t border-[var(--border-color)]">
                {aEntries.map((e) => (
                  <li key={e.id} className="px-2.5 py-1.5 flex items-center justify-between text-[11px]">
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
                          onClick={() => onDeleteEntry(e.id)}
                          className="p-0.5 rounded hover:bg-red-50 dark:hover:bg-red-500/10 text-red-500 cursor-pointer"
                          aria-label="Delete entry"
                        >
                          <Trash2 className="w-3 h-3" />
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
  );
}

function MilestonePanel(props: {
  milestones: MilestoneRow[];
  onToggle: (id: number, reached: boolean) => void;
}) {
  const { milestones, onToggle } = props;

  if (milestones.length === 0) {
    return (
      <div className="text-xs text-[var(--text-muted)] italic flex items-center gap-1.5">
        <Flag className="w-3.5 h-3.5" />
        No milestones configured. Edit the billing config to add some.
      </div>
    );
  }

  return (
    <ul className="space-y-1.5">
      {milestones.map((m) => (
        <li
          key={m.id}
          className="rounded-md border border-[var(--border-color)] bg-subtle/40 px-2.5 py-2"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-[var(--text-primary)]">{m.name}</p>
              {m.description && (
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{m.description}</p>
              )}
              <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                {fmt(m.fee)}
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
                onClick={() => onToggle(m.id, false)}
                className="px-2 py-1 text-[11px] rounded-md bg-subtle text-[var(--text-secondary)] hover:bg-stone-100 dark:hover:bg-stone-800 border border-[var(--border-color)] cursor-pointer shrink-0"
                title="Mark as not reached (only allowed before invoicing)"
              >
                Undo
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onToggle(m.id, true)}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md bg-gold-50 text-gold-700 hover:bg-gold-100 border border-gold-200/60 dark:bg-gold-500/10 dark:text-gold-400 dark:border-gold-500/30 dark:hover:bg-gold-500/20 cursor-pointer shrink-0"
              >
                <Check className="w-3 h-3" />
                Mark Reached
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
