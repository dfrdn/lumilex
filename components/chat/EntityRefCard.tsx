'use client';

import { FileText, CheckSquare, Gavel, Handshake, FolderOpen, Paperclip } from 'lucide-react';
import { useDetailPane } from '@/components/DetailPaneContext';
import type { EntityRef, ChatEntityType } from '@/types/chat';

const ENTITY_CONFIG: Record<ChatEntityType, { icon: typeof FileText; color: string; paneEntity: string }> = {
  deliverable: {
    icon: FileText,
    color: 'text-purple-500 bg-purple-500/10',
    paneEntity: 'deliverables',
  },
  task: {
    icon: CheckSquare,
    color: 'text-blue-500 bg-blue-500/10',
    paneEntity: 'tasks',
  },
  hearing: {
    icon: Gavel,
    color: 'text-emerald-500 bg-emerald-500/10 dark:text-emerald-400',
    paneEntity: 'hearings',
  },
  meeting: {
    icon: Handshake,
    color: 'text-cyan-500 bg-cyan-500/10',
    paneEntity: 'meetings',
  },
  filing: {
    icon: FolderOpen,
    color: 'text-amber-500 bg-amber-500/10',
    paneEntity: 'deliverables', // filings are external deliverables
  },
  file: {
    icon: Paperclip,
    color: 'text-rose-500 bg-rose-500/10',
    paneEntity: 'files',
  },
};

export default function EntityRefCard({ entityRef }: { entityRef: EntityRef }) {
  const { openPane } = useDetailPane();
  const config = ENTITY_CONFIG[entityRef.type];
  const Icon = config.icon;

  return (
    <button
      onClick={() => openPane(config.paneEntity, entityRef.id)}
      className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-card hover:bg-[var(--subtle-bg)] transition-colors text-left"
    >
      <div className={`shrink-0 w-6 h-6 rounded flex items-center justify-center ${config.color}`}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground truncate">{entityRef.name}</p>
        <p className="text-[10px] text-[var(--text-muted)] capitalize">{entityRef.type}</p>
      </div>
    </button>
  );
}
