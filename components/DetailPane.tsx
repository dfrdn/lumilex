'use client';

import { useEffect, useState, useCallback, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { X, ExternalLink, FileText, CheckSquare, Gavel, FolderOpen, Handshake, Paperclip } from 'lucide-react';
import type { DeliverableFileVersion, DeliverableComment } from '@/types/notion';
import { useDetailPane } from './DetailPaneContext';
import PaneDeliverable from './pane/PaneDeliverable';
import PaneTask from './pane/PaneTask';
import PaneHearing from './pane/PaneHearing';
import PaneFiling from './pane/PaneFiling';
import PaneMeeting from './pane/PaneMeeting';
import PaneFile from './pane/PaneFile';

interface Person { id: string; name: string; initials: string; position: string; avatarUrl?: string | null; }

// Minimal shape DetailPane itself needs. Individual Pane* components
// receive the full payload and type-narrow internally.
interface PaneData {
  name?: string;
  [key: string]: unknown;
}

const ENTITY_META: Record<string, { label: string; icon: LucideIcon; path: string }> = {
  deliverables: { label: 'Deliverable', icon: FileText, path: '/dashboard/deliverables' },
  tasks: { label: 'Task', icon: CheckSquare, path: '/dashboard/tasks' },
  hearings: { label: 'Hearing', icon: Gavel, path: '/dashboard/hearings' },
  filings: { label: 'Filing', icon: FolderOpen, path: '/dashboard/deliverables' },
  meetings: { label: 'Meeting', icon: Handshake, path: '/dashboard/meetings' },
  files: { label: 'File', icon: Paperclip, path: '/dashboard/files' },
};

export default function DetailPane() {
  const { pane, closePane } = useDetailPane();
  const [data, setData] = useState<PaneData | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  // Deliverable-specific activity payload — only populated when entity === 'deliverables'.
  const [versions, setVersions] = useState<DeliverableFileVersion[]>([]);
  const [comments, setComments] = useState<DeliverableComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);

  // Fetch data when pane opens. Data is cleared 300ms after close so the
  // exit transition animates with content still visible instead of a
  // flashed-empty drawer. The shell itself is always rendered (once
  // mounted), so the translate-x-0 <-> translate-x-full class flip is
  // enough to drive the slide — no rAF/flushSync gymnastics required.
  useEffect(() => {
    if (!pane) {
      const timer = setTimeout(() => {
        setData(null);
        setPeople([]);
        setVersions([]);
        setComments([]);
        setError(null);
      }, 300);
      return () => clearTimeout(timer);
    }

    // setState-in-effect is intentional: we're kicking off a fetch side
    // effect and need loading/error state to reflect its lifecycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);

    fetch(`/api/entity-detail?entity=${pane.entity}&id=${pane.id}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load');
        return res.json();
      })
      .then(json => {
        setData(json.data);
        setPeople(json.people);
        setVersions(json.versions ?? []);
        setComments(json.comments ?? []);
      })
      .catch(() => setError('Could not load details'))
      .finally(() => setLoading(false));
  }, [pane]);

  // Escape key closes
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') closePane();
  }, [closePane]);

  useEffect(() => {
    if (pane) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [pane, handleKeyDown]);

  // SSR guard — everything else stays rendered so CSS can animate.
  if (!mounted) return null;

  const meta = pane ? ENTITY_META[pane.entity] : null;
  const Icon = meta?.icon || FileText;
  const fullPageHref = pane && meta ? `${meta.path}/${pane.id}` : '#';

  function renderContent() {
    if (loading) {
      return (
        <div className="space-y-4 animate-pulse">
          <div className="flex gap-2">
            <div className="h-6 w-20 bg-[var(--subtle-bg)] rounded-full" />
            <div className="h-6 w-16 bg-[var(--subtle-bg)] rounded-full" />
          </div>
          <div className="space-y-3">
            <div className="h-3 w-16 bg-[var(--subtle-bg)] rounded" />
            <div className="h-4 w-full bg-[var(--subtle-bg)] rounded" />
            <div className="h-3 w-16 bg-[var(--subtle-bg)] rounded mt-3" />
            <div className="h-4 w-3/4 bg-[var(--subtle-bg)] rounded" />
            <div className="h-3 w-16 bg-[var(--subtle-bg)] rounded mt-3" />
            <div className="h-4 w-1/2 bg-[var(--subtle-bg)] rounded" />
          </div>
          <div className="border-t border-[var(--border-color)] pt-3">
            <div className="h-3 w-20 bg-[var(--subtle-bg)] rounded mb-2" />
            <div className="flex gap-1.5">
              <div className="h-7 w-28 bg-[var(--subtle-bg)] rounded-full" />
              <div className="h-7 w-24 bg-[var(--subtle-bg)] rounded-full" />
            </div>
          </div>
        </div>
      );
    }
    if (error) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-10 h-10 rounded-full bg-red-50 dark:bg-red-500/10 flex items-center justify-center mb-3">
            <X className="w-5 h-5 text-red-500 dark:text-red-400" />
          </div>
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      );
    }
    if (!data || !pane) return null;

    // PaneHearing and PaneMeeting have strict internal data types; the
    // rest accept `any`. The API guarantees the shape per entity, so we
    // cast via unknown at the strict sites rather than widening all the
    // Pane components' prop types.
    switch (pane.entity) {
      case 'deliverables': return <PaneDeliverable data={data} people={people} versions={versions} comments={comments} />;
      case 'tasks': return <PaneTask data={data} people={people} />;
      case 'hearings': return <PaneHearing data={data as unknown as ComponentProps<typeof PaneHearing>['data']} people={people} />;
      case 'filings': return <PaneFiling data={data} people={people} />;
      case 'meetings': return <PaneMeeting data={data as unknown as ComponentProps<typeof PaneMeeting>['data']} people={people} />;
      case 'files': return <PaneFile data={data} people={people} />;
      default: return null;
    }
  }

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 top-14 z-[35] bg-black/20 dark:bg-black/40 backdrop-blur-[2px] transition-opacity duration-300 ${
          pane ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={closePane}
        aria-hidden="true"
      />

      {/* Drawer — wider on desktop so version history has room to breathe */}
      <div
        aria-hidden={!pane}
        className={`fixed top-14 right-0 bottom-0 z-[35] w-full max-w-md lg:max-w-2xl bg-[var(--card-bg)] border-l border-[var(--border-color)] shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
          pane ? 'translate-x-0' : 'translate-x-full pointer-events-none'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-color)] bg-[var(--card-bg)] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              {meta?.label || 'Detail'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <a
              href={fullPageHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gold-600 dark:text-gold-400 hover:text-gold-700 dark:hover:text-gold-300 px-2.5 py-1.5 rounded-lg hover:bg-gold-50 dark:hover:bg-gold-400/10 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open
            </a>
            <button
              onClick={closePane}
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] transition-colors"
              aria-label="Close pane"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Title */}
        {data && (
          <div className="px-5 pt-4 pb-2 shrink-0">
            <h3 className="text-base font-semibold text-foreground leading-snug">
              {data.name || '(Untitled)'}
            </h3>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {renderContent()}
        </div>
      </div>
    </>,
    document.body
  );
}
