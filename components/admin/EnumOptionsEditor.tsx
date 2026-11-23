'use client';

import { useMemo, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { Plus, Trash2, ArrowUp, ArrowDown, EyeOff, Eye, Save } from 'lucide-react';
import type { EnumOption } from '@/lib/enum-options';
import { ACTIVE_ENUM_OPTIONS_KEY } from '@/hooks/use-enum-options';
import { confirmAction } from '@/components/ui/confirm';

interface GroupKey {
  entity: string;
  field: string;
  label: string;
  description?: string;
}

interface ApiResponse { options: EnumOption[] }

interface Props {
  groups: GroupKey[];
  /** When true, value rows expose a "Code" input bound to metadata.code (matter types). */
  showMatterCode?: boolean;
}

export default function EnumOptionsEditor({ groups, showMatterCode = true }: Props) {
  const initialKey = groups[0] ? `${groups[0].entity}:${groups[0].field}` : '';
  const [activeKey, setActiveKey] = useState<string>(initialKey);
  const active = groups.find((g) => `${g.entity}:${g.field}` === activeKey) ?? groups[0];

  if (!active) {
    return <p className="text-sm text-zinc-500">No editable groups available.</p>;
  }

  return (
    <div className="flex h-full">
      {groups.length > 1 && (
        <aside className="w-56 shrink-0 border-r border-zinc-200 dark:border-zinc-800 overflow-y-auto">
          <ul className="py-2">
            {groups.map((g) => {
              const key = `${g.entity}:${g.field}`;
              const isActive = key === activeKey;
              return (
                <li key={key}>
                  <button
                    onClick={() => setActiveKey(key)}
                    className={`w-full text-left px-4 py-2 text-sm transition ${
                      isActive
                        ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium'
                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                    }`}
                  >
                    {g.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      )}
      <div className="flex-1 overflow-y-auto p-6">
        <GroupEditor group={active} showMatterCode={showMatterCode && active.entity === 'matters' && active.field === 'type'} />
      </div>
    </div>
  );
}

function GroupEditor({ group, showMatterCode }: { group: GroupKey; showMatterCode: boolean }) {
  const key = `/api/enum-options?entity=${encodeURIComponent(group.entity)}&field=${encodeURIComponent(group.field)}&all=1`;
  const { data, isLoading, mutate: mutateGroup } = useSWR<ApiResponse>(key);
  const { mutate: mutateCache } = useSWRConfig();
  // Refresh this editor's list and the shared list the dropdowns read.
  const mutate = () => Promise.all([mutateGroup(), mutateCache(ACTIVE_ENUM_OPTIONS_KEY)]);
  const options = useMemo(() => data?.options ?? [], [data]);

  const [newValue, setNewValue] = useState('');
  const [newCode, setNewCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function addOption() {
    const value = newValue.trim();
    if (!value) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { entity: group.entity, field: group.field, value };
      if (showMatterCode && newCode.trim()) {
        body.metadata = { code: Number(newCode) };
      }
      const res = await fetch('/api/enum-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text();
        toast.error(t || 'Failed to add');
        return;
      }
      setNewValue('');
      setNewCode('');
      await mutate();
      toast.success('Added');
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: number, body: Record<string, unknown>) {
    const res = await fetch(`/api/enum-options/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      toast.error(t || 'Failed to update');
      return false;
    }
    await mutate();
    return true;
  }

  async function remove(id: number) {
    if (!(await confirmAction({ title: 'Delete this option?', message: 'Existing rows that reference it will still display the value as plain text.', confirmLabel: 'Delete', danger: true }))) return;
    const res = await fetch(`/api/enum-options/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const t = await res.text();
      toast.error(t || 'Failed to delete');
      return;
    }
    await mutate();
    toast.success('Deleted');
  }

  async function move(id: number, direction: 'up' | 'down') {
    const idx = options.findIndex((o) => o.id === id);
    if (idx === -1) return;
    const swapWith = direction === 'up' ? options[idx - 1] : options[idx + 1];
    if (!swapWith) return;
    const me = options[idx];
    await Promise.all([
      fetch(`/api/enum-options/${me.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sort_order: swapWith.sort_order }),
      }),
      fetch(`/api/enum-options/${swapWith.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sort_order: me.sort_order }),
      }),
    ]);
    await mutate();
  }

  return (
    <div className="max-w-3xl">
      <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{group.label}</h2>
      {group.description && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{group.description}</p>
      )}
      <p className="text-xs text-zinc-400 mt-1">
        Stored at <code className="font-mono">{group.entity}.{group.field}</code>
      </p>

      <div className="mt-6 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900 text-xs uppercase text-zinc-500">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Value</th>
              {showMatterCode && <th className="text-left px-3 py-2 font-medium w-24">Code</th>}
              <th className="px-3 py-2 font-medium w-32">Order</th>
              <th className="px-3 py-2 font-medium w-24">Active</th>
              <th className="px-3 py-2 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={showMatterCode ? 5 : 4} className="px-3 py-6 text-center text-zinc-400">Loading…</td></tr>
            )}
            {!isLoading && options.length === 0 && (
              <tr><td colSpan={showMatterCode ? 5 : 4} className="px-3 py-6 text-center text-zinc-400">No options yet.</td></tr>
            )}
            {options.map((opt, idx) => (
              <Row
                key={opt.id}
                opt={opt}
                showMatterCode={showMatterCode}
                canMoveUp={idx > 0}
                canMoveDown={idx < options.length - 1}
                onPatch={patch}
                onRemove={remove}
                onMove={move}
              />
            ))}
          </tbody>
          <tfoot className="bg-zinc-50 dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800">
            <tr>
              <td className="px-3 py-2">
                <input
                  type="text"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addOption(); }}
                  placeholder="New value"
                  className="w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-700"
                />
              </td>
              {showMatterCode && (
                <td className="px-3 py-2">
                  <input
                    type="number"
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value)}
                    placeholder="e.g. 70"
                    className="w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded px-2 py-1.5 text-sm"
                  />
                </td>
              )}
              <td colSpan={2}></td>
              <td className="px-3 py-2">
                <button
                  onClick={addOption}
                  disabled={busy || !newValue.trim()}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  <Plus size={12} /> Add
                </button>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Row({
  opt,
  showMatterCode,
  canMoveUp,
  canMoveDown,
  onPatch,
  onRemove,
  onMove,
}: {
  opt: EnumOption;
  showMatterCode: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onPatch: (id: number, body: Record<string, unknown>) => Promise<boolean>;
  onRemove: (id: number) => void;
  onMove: (id: number, dir: 'up' | 'down') => void;
}) {
  const [value, setValue] = useState(opt.value);
  const [code, setCode] = useState<string>(
    typeof opt.metadata?.code === 'number' ? String(opt.metadata.code) : '',
  );
  const id = opt.id!;

  const valueChanged = value !== opt.value;
  const codeChanged =
    showMatterCode && code !== (typeof opt.metadata?.code === 'number' ? String(opt.metadata.code) : '');
  const dirty = valueChanged || codeChanged;

  async function save() {
    const body: Record<string, unknown> = {};
    if (valueChanged) body.value = value.trim();
    if (codeChanged) body.metadata = { ...(opt.metadata ?? {}), code: code === '' ? null : Number(code) };
    if (Object.keys(body).length === 0) return;
    const ok = await onPatch(id, body);
    if (ok) toast.success('Saved');
  }

  return (
    <tr className={opt.is_active ? '' : 'opacity-50'}>
      <td className="px-3 py-1.5">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full bg-transparent border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700 focus:border-zinc-400 dark:focus:border-zinc-500 rounded px-2 py-1 text-sm focus:outline-none"
        />
      </td>
      {showMatterCode && (
        <td className="px-3 py-1.5">
          <input
            type="number"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full bg-transparent border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700 focus:border-zinc-400 dark:focus:border-zinc-500 rounded px-2 py-1 text-sm focus:outline-none"
          />
        </td>
      )}
      <td className="px-3 py-1.5">
        <div className="flex items-center justify-center gap-1">
          <button
            onClick={() => onMove(id, 'up')}
            disabled={!canMoveUp}
            className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30"
            title="Move up"
          >
            <ArrowUp size={14} />
          </button>
          <button
            onClick={() => onMove(id, 'down')}
            disabled={!canMoveDown}
            className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30"
            title="Move down"
          >
            <ArrowDown size={14} />
          </button>
        </div>
      </td>
      <td className="px-3 py-1.5 text-center">
        <button
          onClick={() => onPatch(id, { is_active: !opt.is_active })}
          className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
          title={opt.is_active ? 'Hide' : 'Show'}
        >
          {opt.is_active ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
      </td>
      <td className="px-3 py-1.5">
        <div className="flex items-center justify-end gap-1">
          {dirty && (
            <button
              onClick={save}
              className="p-1 rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30"
              title="Save"
            >
              <Save size={14} />
            </button>
          )}
          <button
            onClick={() => onRemove(id)}
            className="p-1 rounded text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}
