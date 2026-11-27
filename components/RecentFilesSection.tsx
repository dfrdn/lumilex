'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Calendar, Scale, FileText, MailOpen, Loader2, Inbox, ClipboardList, Undo2,
} from 'lucide-react';
import type { NotionFile } from '@/types/notion';
import SectionCard from '@/components/ui/SectionCard';
import FileAttachmentLinks from './FileAttachmentLinks';
import AddMeetingModal, { type MeetingPrefill } from './AddMeetingModal';
import AddFilingModal, { type FilingPrefill } from './AddFilingModal';
import RowActionMenu, { type ActionMenuItem } from './RowActionMenu';
import { useDetailPane } from './DetailPaneContext';
import { getSupabaseBrowserAuthClient } from '@/lib/supabase-browser';
import Avatar from './Avatar';
import { manilaToday } from '@/lib/dates';
import { confirmAction } from '@/components/ui/confirm';
import { toast } from 'sonner';
interface Props {
  newFiles: NotionFile[];
  readFiles: NotionFile[];
  userId: string;
}

interface FileSummaryInfo {
  shortSummary: string | null;
  status: string; // 'completed' | 'processing' | 'pending'
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-8 text-center text-sm text-[var(--text-muted)] animate-fade-in">
      {message}
    </div>
  );
}

/** Business-level action labels (must match lib/file-action.ts). When a file's
 *  action_taken matches one of these, the file is considered "acted upon" and
 *  the inbox hides further action buttons for all users. */
const ACTION_LABELS = new Set(['Internal Discussion', 'Prepare Response', 'Prepare Status Report']);

function isActedUpon(f: NotionFile): boolean {
  return !!(f.actionTaken && ACTION_LABELS.has(f.actionTaken));
}

export default function RecentFilesSection({ newFiles: initialNew, readFiles: initialRead, userId }: Props) {
  const [tab, setTab] = useState<'new' | 'read'>('new');
  const [newFiles, setNewFiles] = useState(initialNew);
  const [readFiles, setReadFiles] = useState(initialRead);
  const { openPane } = useDetailPane();

  // AI summary state
  const [summaries, setSummaries] = useState<Record<string, FileSummaryInfo>>({});

  // Person ID -> { name, initials } map, used to show actor on acted-upon
  // files and read-by initials.
  const [peopleById, setPeopleById] = useState<Record<string, { name: string; initials: string; avatarUrl: string | null }>>({});
  useEffect(() => {
    fetch('/api/people')
      .then((r) => r.json())
      .then((d) => {
        const map: Record<string, { name: string; initials: string; avatarUrl: string | null }> = {};
        for (const p of d.people ?? []) {
          if (p.person_id) {
            map[p.person_id] = {
              name: p.name ?? p.initials ?? p.person_id,
              initials: p.initials ?? '??',
              avatarUrl: p.avatar_url ?? null,
            };
          }
        }
        setPeopleById(map);
      })
      .catch(() => { /* ignore — we'll just display ids */ });
  }, []);

  // Realtime: subscribe to UPDATE events on the files table. When another
  // user claims an action (writing action_taken / acted_upon_by_ids),
  // patch our local state so the action badge appears and the buttons
  // disappear without a refresh.
  //
  // We keep a mutable ref of the set of visible file IDs so the subscription
  // is stable for the lifetime of the component — re-subscribing on every
  // state change would churn channels needlessly.
  const visibleIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    visibleIdsRef.current = new Set([...newFiles, ...readFiles].map((f) => f.id));
  }, [newFiles, readFiles]);

  useEffect(() => {
    const supabase = getSupabaseBrowserAuthClient();
    const channel = supabase
      .channel('inbox-files')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'files' },
        (payload) => {
          const row = payload.new as {
            notion_id?: string;
            action_taken?: string | null;
            acted_upon_by_ids?: string[] | null;
          };
          if (!row.notion_id || !visibleIdsRef.current.has(row.notion_id)) return;
          const apply = (arr: NotionFile[]) =>
            arr.map((f) => (f.id === row.notion_id
              ? { ...f, actionTaken: row.action_taken ?? null, actedUponByIds: row.acted_upon_by_ids ?? [] }
              : f));
          setNewFiles((prev) => apply(prev));
          setReadFiles((prev) => apply(prev));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Fetch AI summaries for all inbox files + subscribe to real-time updates
  useEffect(() => {
    const allFiles = [...initialNew, ...initialRead];
    if (allFiles.length === 0) return;

    const fileIds = allFiles.map((f) => f.id);

    let cancelled = false;

    // Initial batch fetch
    fetch(`/api/file-analysis/batch?fileIds=${encodeURIComponent(fileIds.join(','))}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data.summaries) {
          setSummaries(data.summaries);
        }
      })
      .catch(() => {});

    // Subscribe to real-time updates via SSE
    const es = new EventSource(`/api/realtime/file-analyses?ids=${encodeURIComponent(fileIds.join(','))}`);

    es.onmessage = (event) => {
      if (cancelled) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'update' && data.fileId) {
          setSummaries((prev) => ({
            ...prev,
            [data.fileId]: {
              shortSummary: data.analysis.shortSummary ?? prev[data.fileId]?.shortSummary ?? null,
              status: data.analysis.status,
            },
          }));
        }
      } catch { /* ignore */ }
    };

    es.onerror = () => {
      es.close();
    };

    return () => {
      cancelled = true;
      es.close();
    };
  }, [initialNew, initialRead]);

  // Modal state
  const [meetingPrefill, setMeetingPrefill] = useState<MeetingPrefill | null>(null);
  const [filingPrefill, setFilingPrefill] = useState<FilingPrefill | null>(null);
  const [generatingReport, setGeneratingReport] = useState<string | null>(null);

  // Pending file-action claim tracking. claimFileAction marks the file as
  // acted-upon BEFORE the modal opens; if the user closes the modal without
  // saving, we release the claim so the file becomes actionable again.
  // saved=true is set by the modal's onSaved callback to suppress the release.
  const pendingMeetingClaimRef = useRef<{ fileId: string; label: string; saved: boolean } | null>(null);
  const pendingFilingClaimRef = useRef<{ fileId: string; label: string; saved: boolean } | null>(null);

  const handleMarkRead = useCallback(async (file: NotionFile) => {
    // Optimistic update — move immediately for snappy UX
    setNewFiles((prev) => prev.filter((f) => f.id !== file.id));
    setReadFiles((prev) => (prev.some((f) => f.id === file.id) ? prev : [file, ...prev]));
    try {
      const res = await fetch('/api/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: file.id }),
      });
      if (!res.ok) throw new Error('Request failed');
    } catch {
      // Revert on failure
      setReadFiles((prev) => prev.filter((f) => f.id !== file.id));
      setNewFiles((prev) => (prev.some((f) => f.id === file.id) ? prev : [file, ...prev]));
    }
  }, []);

  const handleMarkUnread = useCallback(async (file: NotionFile) => {
    // Optimistic update
    setReadFiles((prev) => prev.filter((f) => f.id !== file.id));
    setNewFiles((prev) => (prev.some((f) => f.id === file.id) ? prev : [file, ...prev]));
    try {
      const res = await fetch('/api/mark-read', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: file.id }),
      });
      if (!res.ok) throw new Error('Request failed');
    } catch {
      // Revert on failure
      setNewFiles((prev) => prev.filter((f) => f.id !== file.id));
      setReadFiles((prev) => (prev.some((f) => f.id === file.id) ? prev : [file, ...prev]));
    }
  }, []);

  /** Patch a file in both newFiles + readFiles lists so the UI locks out
   *  further actions immediately without a refresh. */
  const patchFile = useCallback((fileId: string, patch: Partial<NotionFile>) => {
    const apply = (arr: NotionFile[]) =>
      arr.map((f) => (f.id === fileId ? { ...f, ...patch } : f));
    setNewFiles((prev) => apply(prev));
    setReadFiles((prev) => apply(prev));
  }, []);

  /** Claim the file-level action slot before opening a create modal.
   *  Returns true on success; false when another user has already acted. */
  const claimFileAction = useCallback(async (file: NotionFile, label: string): Promise<boolean> => {
    const res = await fetch('/api/file-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: file.id, label }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      patchFile(file.id, { actionTaken: label, actedUponByIds: [userId] });
      return true;
    }
    if (res.status === 409 && data?.existing) {
      patchFile(file.id, {
        actionTaken: data.existing.action_taken ?? null,
        actedUponByIds: data.existing.acted_upon_by_ids ?? [],
      });
      const actorId = (data.existing.acted_upon_by_ids ?? [])[0];
      const actor = actorId ? (peopleById[actorId]?.name ?? 'another user') : 'another user';
      toast.error(`Already acted on by ${actor} — ${data.existing.action_taken}`);
      return false;
    }
    toast.error(data.error || 'Failed to claim action');
    return false;
  }, [patchFile, peopleById, userId]);

  const handleSetID = useCallback(async (file: NotionFile) => {
    const claimed = await claimFileAction(file, 'Internal Discussion');
    if (!claimed) return;
    pendingMeetingClaimRef.current = { fileId: file.id, label: 'Internal Discussion', saved: false };

    // Today at 3:00 PM Manila time
    const dateStr = `${manilaToday()}T15:00`;
    setMeetingPrefill({
      name: `Internal Discussion - ${file.name}`,
      matterId: file.matterId,
      matterName: file.matter,
      type: 'Internal Discussion',
      date: dateStr,
      attendeeIds: [], // Will be resolved from matter team in the modal
    });
  }, [claimFileAction]);

  const handleScheduleFiling = useCallback(async (file: NotionFile) => {
    const claimed = await claimFileAction(file, 'Prepare Response');
    if (!claimed) return;
    pendingFilingClaimRef.current = { fileId: file.id, label: 'Prepare Response', saved: false };

    setFilingPrefill({
      name: `Filing of Response to ${file.name}`,
      matterId: file.matterId,
      matterName: file.matter,
      fileName: file.name,
      dateReceived: file.dateReceived ?? null,
    });
  }, [claimFileAction]);

  /** Release a pending file-action claim when the user closes a create-modal
   *  without saving. Best-effort — failures just leave the file locked, which
   *  the realtime subscription will eventually heal when another user acts. */
  const releaseClaim = useCallback(async (fileId: string, label: string) => {
    try {
      await fetch('/api/file-action', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId, label }),
      });
    } catch { /* ignore — server-side claim may already be gone */ }
    patchFile(fileId, { actionTaken: '', actedUponByIds: [] });
  }, [patchFile]);

  const handleMeetingClose = useCallback(() => {
    const claim = pendingMeetingClaimRef.current;
    pendingMeetingClaimRef.current = null;
    setMeetingPrefill(null);
    if (claim && !claim.saved) {
      releaseClaim(claim.fileId, claim.label);
    }
  }, [releaseClaim]);

  const handleFilingClose = useCallback(() => {
    const claim = pendingFilingClaimRef.current;
    pendingFilingClaimRef.current = null;
    setFilingPrefill(null);
    if (claim && !claim.saved) {
      releaseClaim(claim.fileId, claim.label);
    }
  }, [releaseClaim]);

  /** Undo a completed action so the file becomes actionable again. Only the
   *  original actor can undo their own claim — the DELETE endpoint enforces
   *  that server-side. Note: this only clears the file lock; any meeting,
   *  deliverable, or status-report record created as part of the action is
   *  left in place and must be removed separately. */
  const handleUndoAction = useCallback(async (file: NotionFile) => {
    const label = file.actionTaken;
    if (!label) return;
    if (!(await confirmAction({
      title: `Undo "${label}" on "${file.name}"?`,
      message: 'Any meeting, deliverable, or status report already created will not be deleted.',
      confirmLabel: 'Undo',
    }))) return;

    const prevActedUponByIds = file.actedUponByIds ?? [];
    // Optimistic clear
    patchFile(file.id, { actionTaken: '', actedUponByIds: [] });
    try {
      const res = await fetch('/api/file-action', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: file.id, label }),
      });
      if (!res.ok) throw new Error('Request failed');
    } catch {
      // Revert on failure
      patchFile(file.id, { actionTaken: label, actedUponByIds: prevActedUponByIds });
      toast.error('Failed to undo action. Try again.');
    }
  }, [patchFile]);

  const handleGenerateReport = useCallback(async (file: NotionFile) => {
    if (!file.matterId) return;
    if (!(await confirmAction({
      title: `Generate "Status Report - ${file.name}" and assign for final review?`,
      confirmLabel: 'Generate',
    }))) return;

    setGeneratingReport(file.id);
    try {
      const res = await fetch('/api/status-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: file.id,
          fileName: file.name,
          matterId: file.matterId,
        }),
      });
      const data = await res.json().catch(() => null);

      // Non-JSON response (Vercel 504 timeout page, etc.) — surface a useful
      // message instead of leaking the parser's "did not match the expected
      // pattern" wording.
      if (!data) {
        if (res.status === 504) {
          throw new Error('Request timed out. Try again — drafting can take a minute.');
        }
        throw new Error(`Server returned ${res.status}. Try again in a moment.`);
      }

      // 409 = another user already acted on this file. Patch the row so the
      // buttons hide and the existing action surfaces inline.
      if (res.status === 409 && data?.existing) {
        patchFile(file.id, {
          actionTaken: data.existing.action_taken ?? null,
          actedUponByIds: data.existing.acted_upon_by_ids ?? [],
        });
        const actorId = (data.existing.acted_upon_by_ids ?? [])[0];
        const actor = actorId ? (peopleById[actorId]?.name ?? 'another user') : 'another user';
        toast.error(`Already acted on by ${actor} — ${data.existing.action_taken}`);
        return;
      }

      if (!res.ok) throw new Error(data.error || 'Failed');
      // Route wrote action_taken on the server — patch locally to reflect.
      patchFile(file.id, { actionTaken: 'Prepare Status Report', actedUponByIds: [userId] });
      if (data.deliverableId) {
        openPane('deliverables', data.deliverableId);
      }
    } catch (err) {
      toast.error(`Failed to create status report: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setGeneratingReport(null);
    }
  }, [patchFile, peopleById, userId, openPane]);

  const handleCreateReport = useCallback(async (file: NotionFile) => {
    if (!file.matterId) return;
    if (!(await confirmAction({
      title: `Create a blank Status Report for "${file.name}"?`,
      message: 'Drafters and reviewer will be assigned from the matter team.',
      confirmLabel: 'Create',
    }))) return;

    setGeneratingReport(file.id);
    try {
      const res = await fetch('/api/status-report/from-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: file.id }),
      });
      const data = await res.json().catch(() => null);

      if (!data) {
        throw new Error(`Server returned ${res.status}. Try again in a moment.`);
      }

      if (res.status === 409 && data?.existing) {
        patchFile(file.id, {
          actionTaken: data.existing.action_taken ?? null,
          actedUponByIds: data.existing.acted_upon_by_ids ?? [],
        });
        const actorId = (data.existing.acted_upon_by_ids ?? [])[0];
        const actor = actorId ? (peopleById[actorId]?.name ?? 'another user') : 'another user';
        toast.error(`Already acted on by ${actor} — ${data.existing.action_taken}`);
        return;
      }

      if (!res.ok) throw new Error(data.error || 'Failed');
      patchFile(file.id, { actionTaken: 'Prepare Status Report', actedUponByIds: [userId] });
      if (data.deliverableId) {
        openPane('deliverables', data.deliverableId);
      }
    } catch (err) {
      toast.error(`Failed to create status report: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setGeneratingReport(null);
    }
  }, [patchFile, peopleById, userId, openPane]);

  const files = tab === 'new' ? newFiles : readFiles;
  const totalCount = newFiles.length + readFiles.length;

  const buildActionItems = (f: NotionFile): ActionMenuItem[] => {
    const items: ActionMenuItem[] = [];
    if (tab === 'new') {
      items.push({
        label: 'Mark as read',
        icon: MailOpen,
        variant: 'warning',
        onClick: () => handleMarkRead(f),
      });
    } else {
      items.push({
        label: 'Mark as unread',
        icon: MailOpen,
        onClick: () => handleMarkUnread(f),
      });
    }
    if (tab === 'new' && f.matterId && !isActedUpon(f)) {
      items.push({
        label: 'Set ID (Internal Discussion)',
        icon: Calendar,
        onClick: () => handleSetID(f),
        divider: true,
      });
      items.push({
        label: 'Create Deliverable',
        icon: Scale,
        onClick: () => handleScheduleFiling(f),
      });
      items.push({
        label: 'Create Status Report',
        icon: ClipboardList,
        onClick: () => handleCreateReport(f),
      });
      items.push({
        label: 'Generate Status Report',
        icon: FileText,
        badge: 'alpha',
        onClick: () => handleGenerateReport(f),
      });
    }
    // Undo is only offered to the actor who claimed the file. Other users
    // continue to see the existing "acted on by X" badge with no controls.
    if (isActedUpon(f) && (f.actedUponByIds ?? []).includes(userId)) {
      items.push({
        label: `Undo "${f.actionTaken}"`,
        icon: Undo2,
        variant: 'warning',
        divider: true,
        onClick: () => handleUndoAction(f),
      });
    }
    return items;
  };

  const renderFileRow = (f: NotionFile, i: number) => (
    <div
      key={f.id}
      className="group group/inbox animate-fade-up"
      style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
    >
      <div className="relative flex items-start justify-between max-sm:flex-wrap py-2.5 px-2.5 hover:bg-gold-50/40 dark:hover:bg-[rgba(185, 143, 69,0.06)] rounded-lg transition-all duration-150 hover:translate-x-0.5">
        {/* Left: title + subtitle */}
        <div className="flex-1 min-w-0 max-sm:basis-full">
          <button
            type="button"
            onClick={() => openPane('files', f.id)}
            className="group text-left w-full max-sm:min-h-9 cursor-pointer"
          >
            <p className="text-sm font-medium text-foreground group-hover:text-gold-600 dark:group-hover:text-gold-400 sm:truncate max-sm:break-words transition-colors duration-150">
              {f.name || '(Untitled)'}
            </p>
          </button>
          {f.matter && (
            <p className="text-xs text-[var(--text-secondary)] truncate mt-0.5">{f.matter}</p>
          )}
          {(() => {
            // Action badge — partner-level: green pill + actor initials; free
            // text from Notion sync: muted "Action: <text>".
            const actionBadge = f.actionTaken && isActedUpon(f) ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 text-[10px] font-medium">
                  {f.actionTaken}
                </span>
                {(f.actedUponByIds ?? [])[0] && (() => {
                  const aid = (f.actedUponByIds ?? [])[0];
                  const person = peopleById[aid];
                  return (
                    <span className="inline-flex items-center gap-1 text-[var(--text-muted)]">
                      <span>by</span>
                      <Avatar
                        avatarUrl={person?.avatarUrl ?? null}
                        initials={person?.initials ?? '··'}
                        name={person?.name ?? aid}
                        title={person?.name ?? aid}
                        size={18}
                        fallbackClassName="bg-stone-100 dark:bg-stone-800 text-[9px] font-bold text-stone-600 dark:text-stone-300 tabular-nums"
                      />
                    </span>
                  );
                })()}
              </span>
            ) : f.actionTaken ? (
              <span className="text-[var(--text-muted)]">
                <span className="font-semibold uppercase tracking-wider text-[10px]">Action:</span>{' '}
                <span className="text-[var(--text-secondary)]">{f.actionTaken}</span>
              </span>
            ) : null;

            // Read-by — others on the team who've marked it read. Skip current
            // user (filtered out of New tab; implicit in Read tab).
            const otherIds = (f.personsReadIds ?? []).filter((id) => id !== userId);
            const readBy = otherIds.length > 0 ? (
              <span className="inline-flex items-center gap-1 text-[var(--text-muted)]">
                <MailOpen className="w-2.5 h-2.5" />
                <span>Read by</span>
                {otherIds.slice(0, 4).map((id) => {
                  const person = peopleById[id];
                  return (
                    <Avatar
                      key={id}
                      avatarUrl={person?.avatarUrl ?? null}
                      initials={person?.initials ?? '··'}
                      name={person?.name ?? id}
                      title={person?.name ?? id}
                      size={18}
                      fallbackClassName="bg-stone-100 dark:bg-stone-800 text-[9px] font-bold text-stone-600 dark:text-stone-300 tabular-nums"
                    />
                  );
                })}
                {otherIds.length > 4 && <span>+{otherIds.length - 4}</span>}
              </span>
            ) : null;

            if (!actionBadge && !readBy) return null;

            return (
              <p className="mt-0.5 leading-snug text-[11px] flex flex-wrap items-center gap-x-2 gap-y-1">
                {actionBadge}
                {actionBadge && readBy && (
                  <span
                    aria-hidden
                    className="text-stone-400 dark:text-stone-500 text-[11px] leading-none select-none"
                  >
                    ✻
                  </span>
                )}
                {readBy}
              </p>
            );
          })()}
          {/* AI short summary */}
          {summaries[f.id]?.status === 'completed' && summaries[f.id]?.shortSummary && (
            <p className="text-[11px] italic text-[var(--text-muted)] mt-0.5 leading-snug line-clamp-2">
              {summaries[f.id].shortSummary}
            </p>
          )}
          {(summaries[f.id]?.status === 'processing' || summaries[f.id]?.status === 'pending') && (
            <div className="mt-1 h-2.5 w-48 max-w-full rounded-full skeleton-shimmer" />
          )}
        </div>
        {/* Right: date + preview + always-visible kebab menu */}
        <div className="flex items-center gap-2 ml-4 shrink-0 max-sm:ml-0 max-sm:mt-1 max-sm:basis-full max-sm:[&>:last-child]:ml-auto">
          {f.dateReceived && (
            <span className="text-[11px] font-mono text-[var(--text-muted)] whitespace-nowrap">
              {new Date(f.dateReceived + 'T00:00:00Z').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' })}
            </span>
          )}
          <FileAttachmentLinks files={f.fileUrls} />
          {generatingReport === f.id ? (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30">
              <Loader2 className="w-2.5 h-2.5 shrink-0 animate-spin" />
              <span>Generating…</span>
            </span>
          ) : (
            <RowActionMenu items={buildActionItems(f)} label={`Actions for ${f.name || 'file'}`} />
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <SectionCard
        id="inbox"
        title="Recent Files"
        icon={<Inbox className="w-5 h-5" />}
        count={newFiles.length}
        collapsible
        defaultOpen={false}
      >
        {/* Tab bar */}
        <div className="flex items-center gap-1 mb-3 bg-subtle rounded-lg p-0.5 w-fit">
          <button
            type="button"
            onClick={() => setTab('new')}
            className={`px-3 py-1 max-sm:min-h-9 text-xs font-medium rounded-md transition-all duration-150 cursor-pointer ${
              tab === 'new'
                ? 'bg-card text-foreground shadow-sm border border-[var(--border-color)]'
                : 'text-[var(--text-muted)] hover:text-foreground'
            }`}
          >
            New
            {newFiles.length > 0 && (
              <span className="ml-1.5 text-[10px] font-semibold bg-gold-100 text-gold-700 dark:bg-gold-400/15 dark:text-gold-400 rounded-full px-1.5 py-0.5 tabular-nums">
                {newFiles.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setTab('read')}
            className={`px-3 py-1 max-sm:min-h-9 text-xs font-medium rounded-md transition-all duration-150 cursor-pointer ${
              tab === 'read'
                ? 'bg-card text-foreground shadow-sm border border-[var(--border-color)]'
                : 'text-[var(--text-muted)] hover:text-foreground'
            }`}
          >
            Read
            {readFiles.length > 0 && (
              <span className="ml-1.5 text-[10px] font-semibold bg-subtle text-[var(--text-secondary)] rounded-full px-1.5 py-0.5 tabular-nums">
                {readFiles.length}
              </span>
            )}
          </button>
        </div>

        {files.length === 0 ? (
          <EmptyState message={tab === 'new' ? 'No new files' : 'No read files this month'} />
        ) : (
          <div className="space-y-0.5">
            {files.map((f, i) => renderFileRow(f, i))}
          </div>
        )}
      </SectionCard>

      {/* Modals */}
      <AddMeetingModal
        open={!!meetingPrefill}
        onClose={handleMeetingClose}
        onSaved={() => { if (pendingMeetingClaimRef.current) pendingMeetingClaimRef.current.saved = true; }}
        prefill={meetingPrefill}
        title="Set Internal Discussion"
        subtitle="Schedule a meeting for this file"
      />
      <AddFilingModal
        open={!!filingPrefill}
        onClose={handleFilingClose}
        onSaved={() => { if (pendingFilingClaimRef.current) pendingFilingClaimRef.current.saved = true; }}
        prefill={filingPrefill}
      />
    </>
  );
}
