'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import {
  Users,
  Scale,
  FileText,
  CheckSquare,
  Handshake,
  Gavel,
  FolderOpen,
  Paperclip,
} from 'lucide-react';
import AddRowModal from '@/components/admin/AddRowModal';
import { ENTITY_CONFIGS } from '@/lib/admin/entity-config';
import type { LucideIcon } from 'lucide-react';

interface EntityCard {
  key: string;
  label: string;
  icon: LucideIcon;
  count: number;
}

const ICONS: Record<string, LucideIcon> = {
  clients: Users,
  matters: Scale,
  deliverables: FileText,
  tasks: CheckSquare,
  meetings: Handshake,
  hearings: Gavel,
  filings: FolderOpen,
  files: Paperclip,
};

// Filings is a virtual view — no direct add
const NO_ADD_ENTITIES = new Set(['filings']);

interface Props {
  counts: Record<string, number>;
}

export default function AdminOverviewGrid({ counts }: Props) {
  const [addEntity, setAddEntity] = useState<string | null>(null);
  const [liveCounts, setLiveCounts] = useState(counts);
  useEffect(() => { setLiveCounts(counts); }, [counts]);

  const cards: EntityCard[] = [
    'clients', 'matters', 'deliverables', 'tasks',
    'meetings', 'hearings', 'filings', 'files',
  ].map((key) => ({
    key,
    label: ENTITY_CONFIGS[key]?.labelPlural ?? key,
    icon: ICONS[key] ?? FileText,
    count: liveCounts[key] ?? 0,
  }));

  const activeConfig = addEntity ? ENTITY_CONFIGS[addEntity] : null;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 page-stagger">
        {cards.map((card) => {
          const Icon = card.icon;
          const canAdd = !NO_ADD_ENTITIES.has(card.key);

          return (
            <div
              key={card.key}
              className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-5 hover:shadow-[var(--shadow-card-hover)] hover:border-[var(--border-hover)] transition-all duration-200 group hover-lift"
            >
              <Link href={`/admin/${card.key}`} className="block">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 rounded-xl bg-navy-100 dark:bg-navy-800/50 flex items-center justify-center text-navy-600 dark:text-navy-300 group-hover:bg-gold-100 dark:group-hover:bg-gold-500/15 group-hover:text-gold-600 dark:group-hover:text-gold-400 transition-colors duration-200">
                    <Icon className="w-4.5 h-4.5" />
                  </div>
                </div>
                <p className="text-2xl font-bold text-foreground tabular-nums font-mono">
                  {card.count.toLocaleString()}
                </p>
                <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                  {card.label}
                </p>
              </Link>
              {canAdd && (
                <button
                  onClick={() => setAddEntity(card.key)}
                  className="mt-3 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-dashed border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--border-hover)] hover:text-foreground hover:bg-[var(--hover-bg)] transition-all duration-150 cursor-pointer press"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add {ENTITY_CONFIGS[card.key]?.labelSingular ?? card.label}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {activeConfig && addEntity && (
        <AddRowModal
          open
          onClose={() => setAddEntity(null)}
          entity={addEntity}
          entityLabel={activeConfig.labelSingular}
          fields={activeConfig.fields}
          onSuccess={() => {
            setLiveCounts((c) => ({ ...c, [addEntity]: (c[addEntity] ?? 0) + 1 }));
            setAddEntity(null);
          }}
        />
      )}
    </>
  );
}
