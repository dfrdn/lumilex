'use client';

import { useState, useEffect } from 'react';
import { Plus, Bike } from 'lucide-react';
import type { LiaisonTask } from '@/lib/queries/liaison';
import LiaisonTasksTable from '@/components/liaison/LiaisonTasksTable';
import CreateErrandModal from '@/components/liaison/CreateErrandModal';

interface LiaisonOption { person_id: string; name: string; role: string }

interface Props {
  tasks: LiaisonTask[];
  liaisonOfficers: LiaisonOption[];
  meId: string;
}

export default function LiaisonCommandCenter({ tasks: tasksProp, liaisonOfficers, meId }: Props) {
  const [tasks, setTasks] = useState(tasksProp);
  useEffect(() => { setTasks(tasksProp); }, [tasksProp]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<LiaisonTask | null>(null);

  const openCount = tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled').length;
  // Include the chief too — chiefs can assign errands to themselves.
  const byOfficer = liaisonOfficers.map((o) => ({
    ...o,
    open: tasks.filter(
      (t) => t.assigned_to === o.person_id && t.status !== 'completed' && t.status !== 'cancelled',
    ).length,
  }));

  return (
    <>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-gold-50 to-gold-100 dark:from-gold-900/30 dark:to-gold-800/20 flex items-center justify-center shadow-sm ring-1 ring-gold-200/40 dark:ring-gold-700/30">
            <Bike className="w-5 h-5 text-gold-600 dark:text-gold-400" />
          </div>
          <div>
            <h1 className="font-serif text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
              Liaison Command Center
            </h1>
            <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5 tracking-wide">
              {openCount} open errand{openCount === 1 ? '' : 's'} · Assign & track legwork
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { setEditing(null); setCreating(true); }}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gold-600 text-white text-sm font-medium hover:bg-gold-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Assign Errand
        </button>
      </div>

      {byOfficer.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-6">
          {byOfficer.map((o) => (
            <div
              key={o.person_id}
              className="rounded-xl border border-[var(--border-color)] bg-card px-4 py-3 shadow-[var(--shadow-card)]"
            >
              <div className="flex items-center gap-1.5 text-xs text-stone-400 dark:text-stone-500 uppercase tracking-wider">
                <span>{o.name}</span>
                {o.role === 'chief_liaison_officer' && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300">
                    Chief
                  </span>
                )}
              </div>
              <div className="mt-1 text-2xl font-semibold text-foreground">{o.open}</div>
              <div className="text-[11px] text-stone-400">open errand{o.open === 1 ? '' : 's'}</div>
            </div>
          ))}
        </div>
      )}

      <LiaisonTasksTable
        tasks={tasks}
        mode="chief"
        meId={meId}
        liaisonOfficers={liaisonOfficers}
        onEdit={(t) => { setEditing(t); setCreating(true); }}
      />

      <CreateErrandModal
        open={creating}
        onClose={() => { setCreating(false); setEditing(null); }}
        liaisonOfficers={liaisonOfficers}
        editing={editing}
        onSaved={(saved, isEdit) => {
          setTasks((prev) => {
            if (isEdit) {
              return prev.map((t) => t.id === saved.id ? saved : t);
            }
            return [saved, ...prev];
          });
        }}
      />
    </>
  );
}
