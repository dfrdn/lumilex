'use client';

import { useState, useRef, useEffect } from 'react';
import { Plus, CheckSquare, Handshake, Gavel, FileText } from 'lucide-react';
import { ENTITY_CONFIGS } from '@/lib/admin/entity-config';
import AddRowModal from '@/components/admin/AddRowModal';
import type { EntityRef } from '@/types/chat';

const QUICK_ENTITIES = [
  { key: 'tasks',        label: 'Task',        icon: CheckSquare, color: 'text-blue-500',    refType: 'task' },
  { key: 'meetings',     label: 'Meeting',     icon: Handshake,   color: 'text-cyan-500',    refType: 'meeting' },
  { key: 'hearings',     label: 'Hearing',     icon: Gavel,       color: 'text-emerald-500 dark:text-emerald-400', refType: 'hearing' },
  { key: 'deliverables', label: 'Deliverable', icon: FileText,    color: 'text-purple-500',  refType: 'deliverable' },
] as const;

interface Props {
  matterId?: string | null;
  matterName?: string | null;
  onCreated?: (ref: EntityRef) => void;
}

export default function ChatQuickCreate({ matterId, matterName, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [open]);

  const config = selectedEntity ? ENTITY_CONFIGS[selectedEntity] : null;
  const entityMeta = QUICK_ENTITIES.find((e) => e.key === selectedEntity);

  const initialValues: Record<string, string> =
    matterName ? { matter_name: matterName } : {};
  const initialRelationIds: Record<string, string> =
    matterName && matterId ? { matter_name: matterId } : {};

  function handleSuccess(newRow?: Record<string, unknown>) {
    if (!onCreated || !newRow || !entityMeta) return;
    const id = (newRow.notion_id ?? newRow.id) as string | undefined;
    const name = (newRow.name) as string | undefined;
    if (id && name) {
      onCreated({ type: entityMeta.refType as EntityRef['type'], id, name });
    }
  }

  return (
    <>
      <div className="relative" ref={popoverRef}>
        <button
          onClick={() => setOpen((v) => !v)}
          className={`shrink-0 p-1.5 rounded-lg transition-colors ${
            open
              ? 'text-gold-400 bg-gold-500/10'
              : 'text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)]'
          }`}
          aria-label="Quick create"
        >
          <Plus className="w-4 h-4" />
        </button>

        {open && (
          <div className="chat-popover-in absolute bottom-full mb-2 left-0 bg-card border border-[var(--border-color)] rounded-xl shadow-lg py-1.5 min-w-[160px] z-20">
            <p className="px-3 pt-0.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Create new
            </p>
            {QUICK_ENTITIES.map(({ key, label, icon: Icon, color }) => (
              <button
                key={key}
                onClick={() => { setSelectedEntity(key); setOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-[var(--subtle-bg)] transition-colors text-left"
              >
                <Icon className={`w-4 h-4 shrink-0 ${color}`} />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {config && selectedEntity && (
        <AddRowModal
          open={true}
          onClose={() => setSelectedEntity(null)}
          entity={selectedEntity}
          entityLabel={config.labelSingular}
          fields={config.fields}
          initialValues={initialValues}
          initialRelationIds={initialRelationIds}
          onSuccess={handleSuccess}
        />
      )}
    </>
  );
}
