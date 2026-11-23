'use client';

import { useState, useEffect, useCallback } from 'react';
import { Users, Plus, Trash2, Edit3, Check, X, Shield } from 'lucide-react';
import { toast } from 'sonner';
import type { Party } from '@/types/conflicts';

const ROLE_OPTIONS = [
  { value: 'client', label: 'Client', color: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300' },
  { value: 'opposing_party', label: 'Opposing Party', color: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300' },
  { value: 'co-counsel', label: 'Co-Counsel', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300' },
  { value: 'witness', label: 'Witness', color: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300' },
  { value: 'interested_party', label: 'Interested Party', color: 'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300' },
];

const ENTITY_TYPE_OPTIONS = [
  { value: 'individual', label: 'Individual' },
  { value: 'organization', label: 'Organization' },
];

interface Props {
  matterId: string;
  isAdmin?: boolean;
}

export default function PartiesSection({ matterId, isAdmin = false }: Props) {
  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  // Add form state
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('opposing_party');
  const [newEntityType, setNewEntityType] = useState('individual');
  const [newTin, setNewTin] = useState('');
  const [newContact, setNewContact] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchParties = useCallback(async () => {
    const res = await fetch(`/api/parties?matterId=${matterId}`);
    if (res.ok) {
      const data = await res.json();
      setParties(data.parties);
    }
    setLoading(false);
  }, [matterId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the parties on mount; state is set when the response arrives
    fetchParties();
  }, [fetchParties]);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    const res = await fetch('/api/parties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matterId,
        partyName: newName.trim(),
        partyRole: newRole,
        entityType: newEntityType,
        tin: newTin.trim(),
        contactInfo: newContact.trim(),
        notes: newNotes.trim(),
      }),
    });
    if (res.ok) {
      const { party } = (await res.json()) as { party: Party };
      setParties((prev) => [...prev, party].sort((a, b) => a.party_name.localeCompare(b.party_name)));
      setNewName(''); setNewRole('opposing_party'); setNewEntityType('individual');
      setNewTin(''); setNewContact(''); setNewNotes('');
      setShowAddForm(false);
    } else {
      toast.error('Failed to add party');
    }
    setSaving(false);
  };

  const handleDelete = async (id: number) => {
    const removed = parties.find((p) => p.id === id);
    setParties((prev) => prev.filter((p) => p.id !== id));
    const res = await fetch('/api/parties', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).catch(() => null);
    if (!res?.ok) {
      if (removed) setParties((prev) => [...prev, removed].sort((a, b) => a.party_name.localeCompare(b.party_name)));
      toast.error('Failed to delete party');
    }
  };

  const handleInlineEdit = async (id: number, field: string, value: string) => {
    const previous = parties.find((p) => p.id === id);
    setParties((prev) => prev.map((p) => p.id === id ? { ...p, [field]: value } : p));
    setEditingId(null);
    const res = await fetch('/api/parties', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, field, value }),
    }).catch(() => null);
    if (!res?.ok) {
      if (previous) setParties((prev) => prev.map((p) => p.id === id ? { ...p, [field]: previous[field as keyof Party] } : p));
      toast.error('Failed to save');
    }
  };

  // Group by role
  const grouped = ROLE_OPTIONS.map((role) => ({
    ...role,
    parties: parties.filter((p) => p.party_role === role.value),
  })).filter((g) => g.parties.length > 0);

  return (
    <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden animate-fade-up mb-6">
      <div className="px-6 py-4 border-b border-[var(--border-color)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-[var(--text-muted)]" />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
            Parties ({parties.length})
          </h2>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-lg bg-navy-50 text-navy-600 hover:bg-navy-100 dark:bg-navy-500/10 dark:text-navy-400 dark:hover:bg-navy-500/20 transition-colors"
          >
            <Plus className="w-3 h-3" />
            Add Party
          </button>
        )}
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="px-6 py-4 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-[var(--text-muted)] block mb-1">Name *</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Party name"
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-navy-500/30"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-[var(--text-muted)] block mb-1">Role</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-navy-500/30"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-[var(--text-muted)] block mb-1">Entity Type</label>
              <select
                value={newEntityType}
                onChange={(e) => setNewEntityType(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-navy-500/30"
              >
                {ENTITY_TYPE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-[var(--text-muted)] block mb-1">TIN</label>
              <input
                value={newTin}
                onChange={(e) => setNewTin(e.target.value)}
                placeholder="Tax ID"
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-navy-500/30"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[11px] font-medium text-[var(--text-muted)] block mb-1">Notes</label>
              <input
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="Additional notes"
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-navy-500/30"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button
              onClick={() => setShowAddForm(false)}
              className="px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={!newName.trim() || saving}
              className="px-3 py-1.5 text-xs font-medium text-white bg-navy-600 hover:bg-navy-700 disabled:opacity-50 rounded-lg transition-colors"
            >
              {saving ? 'Adding...' : 'Add Party'}
            </button>
          </div>
        </div>
      )}

      {/* Party list */}
      <div className="divide-y divide-[var(--border-color)]">
        {loading ? (
          <div className="px-6 py-8 text-center">
            <div className="w-5 h-5 border-2 border-navy-300 border-t-navy-600 dark:border-navy-700 dark:border-t-navy-300 rounded-full animate-spin mx-auto mb-2" />
            <p className="text-xs text-[var(--text-muted)]">Loading parties...</p>
          </div>
        ) : parties.length === 0 ? (
          <div className="px-6 py-8 text-center">
            <Users className="w-8 h-8 text-[var(--text-muted)] mx-auto mb-2 opacity-40" />
            <p className="text-xs text-[var(--text-muted)]">No parties recorded yet</p>
          </div>
        ) : (
          grouped.map((group) => (
            <div key={group.value}>
              <div className="px-6 py-2 bg-[var(--bg-secondary)]">
                <span className={`inline-flex px-2 py-0.5 text-[10px] font-bold uppercase rounded ${group.color}`}>
                  {group.label} ({group.parties.length})
                </span>
              </div>
              {group.parties.map((party) => (
                <div key={party.id} className="px-6 py-3 flex items-center gap-3 hover:bg-[var(--bg-hover)] transition-colors group">
                  <div className="min-w-0 flex-1">
                    {editingId === party.id ? (
                      <EditablePartyName
                        value={party.party_name}
                        onSave={(v) => handleInlineEdit(party.id, 'party_name', v)}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-[var(--text-primary)]">{party.party_name}</p>
                        <span className="text-[10px] text-[var(--text-muted)] capitalize">
                          {party.entity_type}
                        </span>
                      </div>
                    )}
                    {(party.tin || party.notes) && (
                      <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                        {party.tin && <span className="font-mono">TIN: {party.tin}</span>}
                        {party.tin && party.notes && ' · '}
                        {party.notes}
                      </p>
                    )}
                    {party.source !== 'manual' && (
                      <span className="text-[10px] text-[var(--text-muted)] italic">
                        via {party.source.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => setEditingId(party.id)}
                        className="p-1.5 rounded-md hover:bg-[var(--bg-secondary)] text-[var(--text-muted)]"
                        title="Edit"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(party.id)}
                        className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-500 dark:hover:text-red-400"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function EditablePartyName({
  value,
  onSave,
  onCancel,
}: {
  value: string;
  onSave: (v: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(value);
  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave(text);
          if (e.key === 'Escape') onCancel();
        }}
        className="px-2 py-1 text-sm rounded border border-navy-300 dark:border-navy-600 bg-[var(--card-bg)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-navy-500"
      />
      <button onClick={() => onSave(text)} className="p-1 text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded dark:text-emerald-400">
        <Check className="w-3.5 h-3.5" />
      </button>
      <button onClick={onCancel} className="p-1 text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] rounded">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
