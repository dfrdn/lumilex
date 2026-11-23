'use client';

import { useState } from 'react';
import { Pencil, Trash2, Check, X, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { ClientPartnerNote } from '@/lib/queries/client-notes';
import { formatManilaDate } from '@/lib/finance/format';

interface Props {
  clientId: string;
  initialNotes: ClientPartnerNote[];
}

export default function ClientNotesPanel({ clientId, initialNotes }: Props) {
  const [notes, setNotes] = useState<ClientPartnerNote[]>(initialNotes);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editBody, setEditBody] = useState('');

  async function addNote() {
    const body = draft.trim();
    if (!body || adding) return;
    setAdding(true);
    try {
      const res = await fetch('/api/partner/client-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, body }),
      });
      if (!res.ok) throw new Error();
      const { note } = await res.json();
      setNotes((prev) => [note, ...prev]);
      setDraft('');
    } catch {
      toast.error('Could not save note');
    } finally {
      setAdding(false);
    }
  }

  async function saveEdit(id: number) {
    const body = editBody.trim();
    if (!body) return;
    const prev = notes;
    setNotes((cur) => cur.map((n) => (n.id === id ? { ...n, body, updatedAt: new Date().toISOString() } : n)));
    setEditingId(null);
    try {
      const res = await fetch('/api/partner/client-notes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, body }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setNotes(prev);
      // Reopen the editor with the attempted text so the edit isn't lost.
      setEditingId(id);
      setEditBody(body);
      toast.error('Could not update note');
    }
  }

  async function deleteNote(id: number) {
    const prev = notes;
    setNotes((cur) => cur.filter((n) => n.id !== id));
    try {
      const res = await fetch('/api/partner/client-notes', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setNotes(prev);
      toast.error('Could not delete note');
    }
  }

  return (
    <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] p-5">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)] mb-3">
        Partner Notes
      </h2>

      <div className="mb-4">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a note about this client — interests, relationship context, preferences…"
          rows={2}
          className="w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--subtle-bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-gold-300/50 dark:focus:ring-gold-500/40"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={addNote}
            disabled={!draft.trim() || adding}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-navy-700 text-white hover:bg-navy-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add note
          </button>
        </div>
      </div>

      {notes.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)] py-2">No notes yet.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="group rounded-lg border border-[var(--border-color)] bg-[var(--subtle-bg)] px-3 py-2.5">
              {editingId === n.id ? (
                <div>
                  <textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    rows={2}
                    className="w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-gold-300/50 dark:focus:ring-gold-500/40"
                    autoFocus
                  />
                  <div className="mt-1.5 flex justify-end gap-1.5">
                    <button onClick={() => saveEdit(n.id)} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20">
                      <Check className="w-3 h-3" /> Save
                    </button>
                    <button onClick={() => setEditingId(null)} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800">
                      <X className="w-3 h-3" /> Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap">{n.body}</p>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-[11px] text-[var(--text-muted)]">
                      {n.authorName} · {formatManilaDate(n.createdAt)}
                    </span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => {
                          setEditingId(n.id);
                          setEditBody(n.body);
                        }}
                        title="Edit"
                        className="p-1 rounded-md text-stone-400 hover:text-stone-600 hover:bg-stone-100 dark:text-stone-500 dark:hover:text-stone-300 dark:hover:bg-stone-800"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => deleteNote(n.id)}
                        title="Delete"
                        className="p-1 rounded-md text-stone-400 hover:text-red-600 hover:bg-red-50 dark:text-stone-500 dark:hover:text-red-400 dark:hover:bg-red-500/10"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
