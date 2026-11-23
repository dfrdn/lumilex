'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Plus, Pencil, Trash2, Loader2, PlayCircle, AlertTriangle } from 'lucide-react';
import { confirmAction } from '@/components/ui/confirm';
import { toast } from 'sonner';

interface RuleCondition {
  status?: string;
  idle_days_min?: number;
  due_date_lte_days?: number;
}

interface RuleAction {
  notify?: { roles?: string[]; persons?: string[] };
  reroute?: { append_role_to_currently_with?: string };
}

interface SlaRule {
  id: string;
  name: string;
  description: string | null;
  applies_to_matter_type: string | null;
  applies_to_deliverable_type: string | null;
  condition: RuleCondition;
  action: RuleAction;
  is_active: boolean;
  sort_order: number;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const KNOWN_ROLES = ['lawyer', 'partner', 'monitoring_partner', 'admin', 'finance', 'super_user'];

export default function SlaRulesEditor() {
  const { data, mutate, isLoading } = useSWR<{ rules: SlaRule[] }>('/api/sla/rules', fetcher);
  const [editing, setEditing] = useState<SlaRule | 'new' | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const runEvaluate = async () => {
    setEvaluating(true);
    setLastResult(null);
    try {
      const r = await fetch('/api/sla/evaluate', { method: 'POST' });
      const j = await r.json();
      if (r.ok) {
        setLastResult(`Evaluated ${j.evaluated} deliverables → ${j.newBreaches} new breach(es), ${j.resolved} resolved.`);
      } else {
        setLastResult(`Error: ${j.error ?? r.status}`);
      }
    } catch (err) {
      setLastResult(`Error: ${(err as Error).message}`);
    } finally {
      setEvaluating(false);
    }
  };

  const deleteRule = async (id: string) => {
    if (!(await confirmAction({ title: 'Delete this rule?', message: 'Existing breaches are kept.', confirmLabel: 'Delete', danger: true }))) return;
    await fetch(`/api/sla/rules/${id}`, { method: 'DELETE' });
    mutate();
  };

  const toggleActive = async (rule: SlaRule) => {
    await fetch(`/api/sla/rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !rule.is_active }),
    });
    mutate();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 text-zinc-400 animate-spin" />
      </div>
    );
  }

  const rules = data?.rules ?? [];

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-gold-500 text-white hover:bg-gold-600 dark:bg-gold-600 dark:hover:bg-gold-500 cursor-pointer"
          >
            <Plus className="w-4 h-4" /> New rule
          </button>
          <button
            type="button"
            onClick={runEvaluate}
            disabled={evaluating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer disabled:opacity-50"
          >
            {evaluating ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            Run now
          </button>
        </div>
        {lastResult && (
          <div className="text-xs text-zinc-500 dark:text-zinc-400">{lastResult}</div>
        )}
      </div>

      {rules.length === 0 ? (
        <div className="text-center py-16 text-sm text-zinc-400 dark:text-zinc-500 border border-dashed border-zinc-200 dark:border-zinc-700 rounded-lg">
          No SLA rules yet. Click <strong>New rule</strong> to author one.
        </div>
      ) : (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">Rule</th>
                <th className="text-left px-4 py-2 font-semibold">Match</th>
                <th className="text-left px-4 py-2 font-semibold">Condition</th>
                <th className="text-left px-4 py-2 font-semibold">Action</th>
                <th className="text-right px-4 py-2 font-semibold">Active</th>
                <th className="text-right px-4 py-2 font-semibold">&nbsp;</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rules.map((r) => (
                <tr key={r.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-zinc-800 dark:text-zinc-200">{r.name}</div>
                    {r.description && <div className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">{r.description}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-zinc-600 dark:text-zinc-400">
                    {r.applies_to_matter_type ? <div>matter: <code>{r.applies_to_matter_type}</code></div> : null}
                    {r.applies_to_deliverable_type ? <div>type: <code>{r.applies_to_deliverable_type}</code></div> : null}
                    {!r.applies_to_matter_type && !r.applies_to_deliverable_type && <span className="text-zinc-400">any</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-zinc-600 dark:text-zinc-400">
                    <ConditionSummary c={r.condition} />
                  </td>
                  <td className="px-4 py-2.5 text-xs text-zinc-600 dark:text-zinc-400">
                    <ActionSummary a={r.action} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => toggleActive(r)}
                      className={`relative inline-flex w-9 h-5 rounded-full transition-colors cursor-pointer ${
                        r.is_active ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600'
                      }`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${r.is_active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="inline-flex gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing(r)}
                        className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 cursor-pointer"
                        title="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRule(r.id)}
                        className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 cursor-pointer"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <RuleEditorModal
          rule={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            mutate();
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ConditionSummary({ c }: { c: RuleCondition }) {
  const parts: string[] = [];
  if (c.status) parts.push(`status = "${c.status}"`);
  if (c.idle_days_min != null) parts.push(`idle ≥ ${c.idle_days_min}d`);
  if (c.due_date_lte_days != null) {
    parts.push(c.due_date_lte_days < 0 ? `overdue ≥ ${-c.due_date_lte_days}d` : `due ≤ ${c.due_date_lte_days}d`);
  }
  return <span>{parts.join(' AND ') || <em className="text-zinc-400">empty</em>}</span>;
}

function ActionSummary({ a }: { a: RuleAction }) {
  const parts: string[] = [];
  const roles = a.notify?.roles ?? [];
  const persons = a.notify?.persons ?? [];
  if (roles.length + persons.length > 0) {
    parts.push(`notify ${[...roles.map((r) => r), ...persons.map((p) => p.slice(0, 6))].join(', ')}`);
  }
  if (a.reroute?.append_role_to_currently_with) {
    parts.push(`reroute → ${a.reroute.append_role_to_currently_with}`);
  }
  if (parts.length === 0) return <em className="text-zinc-400">dry-run</em>;
  return <span>{parts.join(' · ')}</span>;
}

// ── Modal ─────────────────────────────────────────────────────────────

function RuleEditorModal({
  rule,
  onClose,
  onSaved,
}: {
  rule: SlaRule | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(rule?.name ?? '');
  const [description, setDescription] = useState(rule?.description ?? '');
  const [matterType, setMatterType] = useState(rule?.applies_to_matter_type ?? '');
  const [deliverableType, setDeliverableType] = useState(rule?.applies_to_deliverable_type ?? '');
  const [status, setStatus] = useState(rule?.condition?.status ?? '');
  const [idleDays, setIdleDays] = useState<string>(
    rule?.condition?.idle_days_min != null ? String(rule.condition.idle_days_min) : '',
  );
  const [dueDays, setDueDays] = useState<string>(
    rule?.condition?.due_date_lte_days != null ? String(rule.condition.due_date_lte_days) : '',
  );
  const [notifyRoles, setNotifyRoles] = useState<string[]>(rule?.action?.notify?.roles ?? []);
  const [rerouteRole, setRerouteRole] = useState(rule?.action?.reroute?.append_role_to_currently_with ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const condition: RuleCondition = {};
    if (status) condition.status = status;
    // idle_days_min must be a positive integer (server Zod enforces .positive()).
    // The string '0' is truthy, so guard on the parsed number, not the string.
    const idleParsed = parseInt(idleDays, 10);
    if (Number.isFinite(idleParsed) && idleParsed > 0) condition.idle_days_min = idleParsed;
    // due_date_lte_days may legitimately be 0 (due today) or negative (overdue),
    // so accept any parseable integer including 0.
    const dueParsed = parseInt(dueDays, 10);
    if (dueDays.trim() !== '' && Number.isFinite(dueParsed)) condition.due_date_lte_days = dueParsed;

    const action: RuleAction = {};
    if (notifyRoles.length > 0) action.notify = { roles: notifyRoles };
    if (rerouteRole) action.reroute = { append_role_to_currently_with: rerouteRole };

    const body = {
      name: name.trim(),
      description: description.trim() || null,
      applies_to_matter_type: matterType.trim() || null,
      applies_to_deliverable_type: deliverableType.trim() || null,
      condition,
      action,
      is_active: rule?.is_active ?? true,
      sort_order: rule?.sort_order ?? 0,
    };

    const url = rule ? `/api/sla/rules/${rule.id}` : '/api/sla/rules';
    const method = rule ? 'PATCH' : 'POST';
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (r.ok) onSaved();
    else toast.error('Save failed.');
  };

  return (
    <div className="fixed inset-0 bg-black/40 dark:bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-auto">
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">{rule ? 'Edit rule' : 'New SLA rule'}</h2>
        </div>
        <div className="p-6 space-y-5">
          <Field label="Name" required>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. In Review > 3 days"
              className="w-full px-3 py-2 text-sm rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
            />
          </Field>
          <Field label="Description">
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Why this rule exists (shown in admin)"
              className="w-full px-3 py-2 text-sm rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
            />
          </Field>

          <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4 grid grid-cols-2 gap-4">
            <Field label="Matter type (optional)">
              <input
                type="text"
                value={matterType}
                onChange={(e) => setMatterType(e.target.value)}
                placeholder="any"
                className="w-full px-3 py-2 text-sm rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800"
              />
            </Field>
            <Field label="Deliverable type (optional)">
              <input
                type="text"
                value={deliverableType}
                onChange={(e) => setDeliverableType(e.target.value)}
                placeholder="any"
                className="w-full px-3 py-2 text-sm rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800"
              />
            </Field>
          </div>

          <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-3">Condition (AND)</h3>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Status equals">
                <input
                  type="text"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  placeholder="any"
                  className="w-full px-3 py-2 text-sm rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                />
              </Field>
              <Field label="Idle ≥ (days)">
                <input
                  type="number"
                  min="1"
                  value={idleDays}
                  onChange={(e) => setIdleDays(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                />
              </Field>
              <Field label="Due in ≤ (days)" hint="negative = overdue">
                <input
                  type="number"
                  value={dueDays}
                  onChange={(e) => setDueDays(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                />
              </Field>
            </div>
          </div>

          <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-3">Action</h3>
            <Field label="Notify roles">
              <div className="flex flex-wrap gap-2">
                {KNOWN_ROLES.map((r) => {
                  const on = notifyRoles.includes(r);
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() =>
                        setNotifyRoles((prev) =>
                          on ? prev.filter((x) => x !== r) : [...prev, r],
                        )
                      }
                      className={`px-2.5 py-1 text-xs rounded-full border cursor-pointer ${
                        on
                          ? 'bg-gold-100 border-gold-300 text-gold-800 dark:bg-gold-900/30 dark:border-gold-700 dark:text-gold-300'
                          : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
                      }`}
                    >
                      {r}
                    </button>
                  );
                })}
              </div>
            </Field>
            <div className="mt-3">
              <Field label="Reroute: append role to currently_with_ids" hint="leave blank for notify-only">
                <select
                  value={rerouteRole}
                  onChange={(e) => setRerouteRole(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                >
                  <option value="">— none —</option>
                  {KNOWN_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>

          {notifyRoles.length === 0 && !rerouteRole && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-900/20 text-[11px] text-amber-800 dark:text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              No notify or reroute set — rule will log breaches silently (dry-run mode).
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-gold-500 text-white hover:bg-gold-600 cursor-pointer disabled:opacity-50"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
        {hint && <span className="text-zinc-400 dark:text-zinc-500 font-normal ml-1">({hint})</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
