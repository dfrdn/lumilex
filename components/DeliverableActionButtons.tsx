'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { ChevronRight, RotateCcw, Clock, Play, Archive, Trash2 } from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import DatePickerInput from '@/components/DatePickerInput';
import DeliverableCommentModal, { type TeamMember, type RevertTarget } from '@/components/DeliverableCommentModal';
import AddDTRModal, { type DTRPrefill } from '@/components/AddDTRModal';
import RowActionMenu, { type ActionMenuItem } from '@/components/RowActionMenu';
import { getAvailableActions, type DeliverableAction } from '@/lib/deliverable-actions';
import { commitUpload, uploadToSignedUrl } from '@/lib/upload';
import { notifyStatusReportCreated } from '@/lib/status-report-toast';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';
import { manilaToday } from '@/lib/dates';
import { BTN_GHOST_DANGER, BTN_OUTLINE, BTN_PRIMARY } from '@/components/ui/tone';

// ── Types ───────────────────────────────────────────────────────

export type DeliverableActionPatch = {
  status?: string;
  currentlyWithIds?: string[];
  /** The day it was filed or sent out, when this action filed it. */
  dateDone?: string;
};

interface Props {
  deliverableId: string;
  deliverableName: string;
  status: string;
  type?: string;
  matterId: string | null;
  matterName: string;
  drafterIds: string[];
  reviewerIds: string[];
  currentlyWithIds: string[];
  /** "compact" for pill-buttons, "full" for detail page, "menu" for kebab overflow */
  variant?: 'compact' | 'full' | 'menu';
  /** Stack compact buttons vertically */
  stacked?: boolean;
  /**
   * Notify the parent of state changes after a successful workflow action.
   * The detail page passes this to feed changes into the shared shell state;
   * list views pass it to splice the row in place. When omitted, the button
   * still updates its own local status, but neighbouring components on the
   * page won't see the change until the next navigation.
   */
  onActionComplete?: (patch: DeliverableActionPatch) => void;
}

// ── Variant styles ──────────────────────────────────────────────

const VARIANT_STYLES: Record<DeliverableAction['variant'], { compact: string; full: string; icon: typeof ChevronRight }> = {
  primary: {
    compact: 'bg-emerald-50 text-emerald-700 border-emerald-200/60 hover:bg-emerald-100 hover:border-emerald-300 dark:bg-emerald-500/10 dark:border-emerald-500/25 dark:text-emerald-300 dark:hover:bg-emerald-500/20 dark:hover:border-emerald-500/40',
    full: BTN_PRIMARY,
    icon: ChevronRight,
  },
  warning: {
    compact: 'bg-gold-50 text-gold-700 border-gold-200/60 hover:bg-gold-100 hover:border-gold-300 dark:bg-gold-500/10 dark:border-gold-500/25 dark:hover:bg-gold-500/20 dark:hover:border-gold-500/40 dark:text-gold-300',
    full: BTN_OUTLINE,
    icon: RotateCcw,
  },
  neutral: {
    compact: 'bg-stone-50 text-stone-500 border-stone-200/60 hover:bg-stone-100 hover:border-stone-300 dark:bg-stone-800 dark:border-stone-700/60 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:border-stone-600',
    full: BTN_OUTLINE,
    icon: Clock,
  },
};

// ── Component ───────────────────────────────────────────────────

export default function DeliverableActionButtons({
  deliverableId,
  deliverableName,
  status,
  type,
  matterId,
  matterName,
  drafterIds,
  reviewerIds,
  currentlyWithIds,
  variant = 'compact',
  stacked = false,
  onActionComplete,
}: Props) {
  // Derived — find which reviewer currently has the deliverable
  const currentReviewerIndex = reviewerIds.findIndex((id) => currentlyWithIds.includes(id));

  // State
  const [currentStatus, setCurrentStatus] = useState(status);
  const [selectedAction, setSelectedAction] = useState<DeliverableAction | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showComment, setShowComment] = useState(false);
  const [showDTR, setShowDTR] = useState(false);
  const [dtrSourceStatus, setDtrSourceStatus] = useState<string | null>(null);
  const [pendingDtrPatch, setPendingDtrPatch] = useState<DeliverableActionPatch | null>(null);
  const [loading, setLoading] = useState(false);
  // When it went out — today unless it is being recorded after the fact.
  const [filedOn, setFiledOn] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamFetched, setTeamFetched] = useState(false);

  // Update displayed actions when parent status changes
  useEffect(() => {
    setCurrentStatus(status);
  }, [status]);

  // Fetch team members for @mention (lazy — only when comment modal needed)
  const ensureTeamMembers = useCallback(async () => {
    if (teamFetched) return;
    try {
      const res = await fetch('/api/people');
      if (res.ok) {
        const data = await res.json();
        const members: TeamMember[] = (data.people ?? []).map((p: { person_id: string; name: string; initials: string }) => ({
          personId: p.person_id,
          name: p.name,
          initials: p.initials,
        }));
        setTeamMembers(members);
      }
    } catch { /* ignore */ }
    setTeamFetched(true);
  }, [teamFetched]);

  // Resolve which person IDs to set as "Currently With" after an action
  const resolveCurrentlyWith = useCallback((updatesTo: DeliverableAction['updatesCurrentlyWith'], targetIndex?: number): string[] | undefined => {
    switch (updatesTo) {
      case 'drafter': return drafterIds;
      case 'draftersAndReviewers': {
        // Union of drafters + all reviewers, de-duped, preserving order.
        const seen = new Set<string>();
        const combined: string[] = [];
        for (const id of [...drafterIds, ...reviewerIds]) {
          if (!seen.has(id)) {
            seen.add(id);
            combined.push(id);
          }
        }
        return combined;
      }
      case 'nextReviewer': {
        const nextIdx = currentReviewerIndex + 1;
        return nextIdx < reviewerIds.length ? [reviewerIds[nextIdx]] : [];
      }
      case 'recipients': return [...reviewerIds];
      case 'clear': return [];
      default:
        // If a specific target index is provided, use it
        if (targetIndex !== undefined && targetIndex >= 0 && targetIndex < reviewerIds.length) {
          return [reviewerIds[targetIndex]];
        }
        return undefined;
    }
  }, [drafterIds, reviewerIds, currentReviewerIndex]);

  // ── Action handlers ─────────────────────────────────────────

  const triggerAction = useCallback(async (action: DeliverableAction) => {
    setSelectedAction(action);

    if (action.needsComment) {
      await ensureTeamMembers();
      setShowComment(true);
    } else {
      // No comment needed — show confirm dialog
      if (action.newStatus === DELIVERABLE_STATUS.FILED_OR_SENT_OUT) setFiledOn(manilaToday());
      setShowConfirm(true);
    }
  }, [ensureTeamMembers]);

  const handleActionClick = useCallback((e: React.MouseEvent, action: DeliverableAction) => {
    e.stopPropagation();
    e.preventDefault();
    void triggerAction(action);
  }, [triggerAction]);

  // Handle simple confirm (Start Drafting, Awaiting Client, Filed/Sent Out).
  // Resolves whether the action went through.
  const handleConfirm = useCallback(async (): Promise<boolean> => {
    if (!selectedAction) return false;
    const oldStatus = currentStatus;
    const newStatus = selectedAction.newStatus || currentStatus;
    const newCurrentlyWithIds = resolveCurrentlyWith(selectedAction.updatesCurrentlyWith, selectedAction.reviewTargetIndex);
    const dateDone = newStatus === DELIVERABLE_STATUS.FILED_OR_SENT_OUT && newStatus !== oldStatus
      ? filedOn ?? manilaToday()
      : undefined;
    // The move is predictable, so every list shows it now; a refusal puts it back.
    setCurrentStatus(newStatus);
    setShowConfirm(false);
    onActionComplete?.({ status: newStatus, currentlyWithIds: newCurrentlyWithIds, ...(dateDone ? { dateDone } : {}) });
    setLoading(true);
    try {
      const res = await fetch('/api/deliverable-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notionId: deliverableId,
          action: selectedAction.label,
          oldStatus,
          newStatus,
          currentlyWithIds: newCurrentlyWithIds,
          dateDone,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Action failed' }));
        throw new Error(errData.error || 'Action failed');
      }
      toast.success(`${selectedAction.label} — "${deliverableName}"`);
      await notifyStatusReportCreated(res);
      return true;
    } catch (err) {
      setCurrentStatus(oldStatus);
      onActionComplete?.({ status: oldStatus, currentlyWithIds });
      const message = err instanceof Error ? err.message : 'Something went wrong';
      toast.error(`Action failed: ${message}`);
      return false;
    } finally {
      setLoading(false);
    }
  }, [selectedAction, deliverableId, deliverableName, currentStatus, currentlyWithIds, resolveCurrentlyWith, onActionComplete, filedOn]);

  // Handle comment + optional files + optional revert/review target submit
  const handleCommentSubmit = useCallback(async (data: {
    comment: string; mentions: string[]; files?: File[]; revertTarget?: RevertTarget; reviewTargetChoice?: number;
  }) => {
    if (!selectedAction) return;
    setLoading(true);
    try {
      // Upload files first if provided
      let fileUrl: string | undefined;
      let fileName: string | undefined;
      let fileSize: number | undefined;

      if (data.files && data.files.length > 0) {
        try {
          // Step 1: Get signed upload URLs from the server (small JSON request)
          const urlRes = await fetch('/api/deliverable-file/upload-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              deliverableId,
              action: selectedAction.label,
              files: data.files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
            }),
          });

          if (!urlRes.ok) {
            const errData = await urlRes.json().catch(() => ({ error: 'Upload failed' }));
            throw new Error(errData.error || 'Failed to prepare upload');
          }

          const { uploads, version } = await urlRes.json();

          // Step 2: Upload each file directly to Supabase Storage (bypasses Vercel body limit)
          for (let i = 0; i < data.files.length; i++) {
            const file = data.files[i];
            const upload = uploads[i];
            await uploadToSignedUrl(upload.signedUrl, file, {
              name: file.name,
              size: file.size,
              type: file.type,
            });
          }

          // Step 3: Commit — only now do we insert the deliverable_files rows, so
          // a failed upload can never leave an orphan row pointing at empty storage.
          // commitUpload rides keepalive + retry so a dropped commit can't strand
          // the just-uploaded object with no row.
          await commitUpload('/api/deliverable-file/upload-url', {
            confirm: true,
            deliverableId,
            action: selectedAction.label,
            version,
            uploads: data.files.map((f, i) => ({
              storagePath: uploads[i].storagePath,
              name: f.name,
              size: f.size,
            })),
          });

          // Use the first file's info for the action log
          fileUrl = uploads[0].storagePath;
          fileName = data.files[0].name;
          fileSize = data.files[0].size;
        } catch (uploadErr) {
          const msg = uploadErr instanceof Error ? uploadErr.message : 'Upload failed';
          console.error('[file-upload] Failed:', uploadErr);
          toast.error(`File upload failed: ${msg}`, { description: 'The action will continue without the files.' });
        }
      }

      // Determine action overrides based on revert target or review target choice
      let actionNewStatus = selectedAction.newStatus;
      let actionLabel = selectedAction.label;
      let resolvedCurrentlyWith: string[] | undefined;

      if (data.revertTarget === 'initial') {
        // Revert to the initial reviewer (reviewerIds[0]) — the modal labels this
        // option "Initial Reviewer" and shows that person's name. Status stays
        // "Under Review" since it's a handoff back to an earlier reviewer.
        actionNewStatus = null;
        const initialReviewerId = reviewerIds[0];
        resolvedCurrentlyWith = initialReviewerId ? [initialReviewerId] : [];
        const reviewerName = teamMembers.find((m) => m.personId === initialReviewerId)?.name;
        actionLabel = `For Revision (to ${reviewerName || 'Reviewer'})`;
      } else if (data.reviewTargetChoice !== undefined) {
        // User picked a specific reviewer from the picker
        const targetIdx: number = data.reviewTargetChoice;
        resolvedCurrentlyWith = [reviewerIds[targetIdx]!];
        const reviewerName = teamMembers.find((m) => m.personId === reviewerIds[targetIdx])?.name;
        if (targetIdx > 0) {
          actionLabel = `For Review (to ${reviewerName || 'Reviewer'})`;
        }
      } else {
        resolvedCurrentlyWith = resolveCurrentlyWith(selectedAction.updatesCurrentlyWith, selectedAction.reviewTargetIndex);
      }

      // Execute the workflow action
      const res = await fetch('/api/deliverable-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notionId: deliverableId,
          action: actionLabel,
          oldStatus: currentStatus,
          newStatus: actionNewStatus || currentStatus,
          comment: data.comment,
          mentions: data.mentions.map((id) => {
            const member = teamMembers.find((m) => m.personId === id);
            return { id, name: member?.name || '' };
          }),
          fileUrl,
          fileName,
          fileSize,
          currentlyWithIds: resolvedCurrentlyWith,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Action failed' }));
        throw new Error(errData.error || 'Action failed');
      }

      const oldStatus = currentStatus;
      const newStatus = actionNewStatus || currentStatus;
      const patch: DeliverableActionPatch = { status: newStatus, currentlyWithIds: resolvedCurrentlyWith };
      setCurrentStatus(newStatus);
      setShowComment(false);
      toast.success(`${actionLabel} — "${deliverableName}"`);
      await notifyStatusReportCreated(res);

      if (selectedAction.needsDTR) {
        // Hold the parent-list update until the DTR modal closes. In filtered/grouped
        // list views (e.g. "Currently with me"), applying the patch now drops this row
        // out of view and unmounts the component before the DTR modal can mount — so the
        // DTR prompt would silently never appear.
        setDtrSourceStatus(oldStatus);
        setPendingDtrPatch(patch);
        setShowDTR(true);
      } else {
        onActionComplete?.(patch);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      toast.error(`Action failed: ${message}`);
      setShowComment(false);
    } finally {
      setLoading(false);
    }
  }, [selectedAction, deliverableId, currentStatus, resolveCurrentlyWith, onActionComplete, teamMembers]);

  // ── DTR prefill ───────────────────────────────────────────────

  const [today] = useState(() => manilaToday());
  const dtrTaskMap: Record<string, string> = {
    [DELIVERABLE_STATUS.DRAFTING]: 'Draft',
    [DELIVERABLE_STATUS.UNDER_REVIEW]: 'Review and Revise',
    [DELIVERABLE_STATUS.REVISING]: 'Review and Revise',
    [DELIVERABLE_STATUS.FINALIZING]: 'Finalize',
  };
  const dtrPrefill: DTRPrefill = {
    remarks: deliverableName,
    task: dtrTaskMap[dtrSourceStatus ?? currentStatus] ?? 'Others',
    date: today,
    hours: 1,
    minutes: 0,
    withIds: [],
    matterId,
    matterName,
  };

  // ── Render actions based on displayed status ──────────────────

  const displayedActions = getAvailableActions(currentStatus, reviewerIds.length, currentReviewerIndex, type);

  if (displayedActions.length === 0) return null;

  // ── Shared modals ──────────────────────────────────────────────

  // Archive-while-mid-review warning: if a user tries to archive a deliverable
  // that's still in active review, the assignees have pending notifications
  // and may be about to work on it. Show a louder, destructive-variant dialog.
  const ACTIVE_REVIEW_STATUSES = new Set<string>([
    DELIVERABLE_STATUS.UNDER_REVIEW,
    DELIVERABLE_STATUS.REVISING,
    DELIVERABLE_STATUS.FINALIZING,
    DELIVERABLE_STATUS.PRE_FINALIZED,
  ]);
  const isArchiveMidReview =
    selectedAction?.label === 'Archive' &&
    ACTIVE_REVIEW_STATUSES.has(currentStatus);

  const confirmTitle = isArchiveMidReview
    ? 'Archive mid-review?'
    : (selectedAction?.label ?? '');
  const confirmMessage = isArchiveMidReview
    ? `"${deliverableName}" is currently "${currentStatus}". Archiving now will remove it from everyone's queue and clear pending review notifications. Use "Awaiting Client" instead if you just want to pause it. Continue?`
    : `${selectedAction?.label} "${deliverableName}"?`;
  const asksFiledOn = selectedAction?.newStatus === DELIVERABLE_STATUS.FILED_OR_SENT_OUT;
  const filedOnInvalid = asksFiledOn && (!filedOn || filedOn > today);

  const confirmVariant: 'primary' | 'danger' =
    isArchiveMidReview || selectedAction?.variant === 'warning'
      ? 'danger'
      : 'primary';

  const modals = (
    <>
      <ConfirmDialog
        open={showConfirm}
        onConfirm={handleConfirm}
        onCancel={() => { setShowConfirm(false); setSelectedAction(null); }}
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel={selectedAction?.label ?? 'Confirm'}
        variant={confirmVariant}
        loading={loading}
        confirmDisabled={filedOnInvalid}
      >
        {asksFiledOn && (
          <div>
            <p className="text-xs text-[var(--text-secondary)] mb-1">Filed or sent on</p>
            <DatePickerInput value={filedOn} onChange={setFiledOn} hasError={!!filedOn && filedOn > today} />
            {filedOn && filedOn > today && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">Pick today or an earlier date.</p>
            )}
          </div>
        )}
      </ConfirmDialog>

      <DeliverableCommentModal
        open={showComment}
        onClose={() => { setShowComment(false); setSelectedAction(null); }}
        onSubmit={handleCommentSubmit}
        actionLabel={selectedAction?.label ?? ''}
        deliverableName={deliverableName}
        loading={loading}
        teamMembers={teamMembers}
        showRevertTarget={selectedAction?.needsRevertTarget}
        drafterIds={drafterIds}
        reviewerIds={reviewerIds}
        reviewTargetIndex={selectedAction?.reviewTargetIndex}
        showReviewTargetPicker={selectedAction?.needsReviewTargetPicker}
        reviewTargetPickerStartIndex={selectedAction?.reviewTargetPickerStartIndex}
      />

      <AddDTRModal
        open={showDTR}
        onClose={() => {
          setShowDTR(false);
          setSelectedAction(null);
          if (pendingDtrPatch) {
            onActionComplete?.(pendingDtrPatch);
            setPendingDtrPatch(null);
          }
        }}
        prefill={dtrPrefill}
      />
    </>
  );

  // ── Menu variant (forward pill + kebab overflow) ──────────────

  if (variant === 'menu') {
    // Pull the primary "advance forward" action out of the menu and surface
    // it as a visible pill — leaves revert/utility/archive in the kebab.
    const forwardAction = displayedActions.find((a) => a.variant === 'primary');
    const overflowActions = forwardAction
      ? displayedActions.filter((a) => a !== forwardAction)
      : displayedActions;

    const items: ActionMenuItem[] = overflowActions.map((action) => {
      const Icon = action.label === 'Archive' ? Trash2
        : action.variant === 'primary' ? Play
        : action.variant === 'warning' ? RotateCcw
        : action.variant === 'neutral' ? Clock : ChevronRight;
      const itemVariant: ActionMenuItem['variant'] = action.label === 'Archive'
        ? 'danger'
        : action.variant === 'primary' ? 'primary'
        : action.variant === 'warning' ? 'warning'
        : 'default';
      return {
        label: action.label,
        icon: Icon,
        variant: itemVariant,
        onClick: () => { void triggerAction(action); },
        divider: action.label === 'Archive',
      };
    });

    return (
      <>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {forwardAction && (
            <button
              type="button"
              onClick={(e) => handleActionClick(e, forwardAction)}
              title={forwardAction.label}
              className="action-lift inline-flex items-center gap-1 px-2 py-0.5 text-[10px] max-sm:min-h-9 max-sm:px-3 max-sm:text-xs font-medium rounded-full border cursor-pointer ring-1 ring-inset ring-current/5 bg-emerald-50 text-emerald-700 border-emerald-200/60 hover:bg-emerald-100 hover:border-emerald-300 dark:hover:border-emerald-500/50 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30 dark:hover:bg-emerald-500/20"
            >
              <ChevronRight className="w-2.5 h-2.5 shrink-0" />
              <span className="max-w-[120px] max-sm:max-w-[200px] truncate">{forwardAction.label}</span>
            </button>
          )}
          {items.length > 0 && (
            <RowActionMenu
              items={items}
              label={forwardAction ? `More actions for ${deliverableName}` : `Actions for ${deliverableName}`}
            />
          )}
        </div>
        {modals}
      </>
    );
  }

  // ── Compact variant (pills) ───────────────────────────────────

  if (variant === 'compact') {
    return (
      <>
        <div className={`flex ${stacked ? 'flex-col items-start' : 'items-center'} gap-1`} onClick={(e) => e.stopPropagation()}>
          {displayedActions.map((action) => {
            const style = VARIANT_STYLES[action.variant];
            const Icon = action.label === 'Archive' ? Trash2
              : action.variant === 'primary' ? Play
              : action.variant === 'warning' ? RotateCcw
              : action.variant === 'neutral' ? Clock : ChevronRight;

            return (
              <button
                key={action.label}
                type="button"
                onClick={(e) => handleActionClick(e, action)}
                title={action.label}
                className={`action-lift inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full border cursor-pointer ring-1 ring-inset ring-current/5 ${action.label === 'Archive' ? 'bg-red-50 text-red-600 border-red-200/60 hover:bg-red-100 hover:border-red-300 dark:bg-red-500/10 dark:border-red-500/25 dark:text-red-400 dark:hover:bg-red-500/20 dark:hover:border-red-500/40' : style.compact}`}
              >
                <Icon className="w-2.5 h-2.5 shrink-0" />
                <span className="hidden sm:inline max-w-[72px] truncate">{action.label}</span>
              </button>
            );
          })}
        </div>
        {modals}
      </>
    );
  }

  // ── Full variant (detail page buttons) ────────────────────────

  return (
    <>
      <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {displayedActions.map((action) => {
          const style = VARIANT_STYLES[action.variant];
          const Icon = action.label === 'Archive' ? Trash2
            : action.variant === 'primary' ? ChevronRight
            : action.variant === 'warning' ? RotateCcw
            : action.variant === 'neutral' ? Clock : Archive;

          return (
            <button
              key={action.label}
              type="button"
              onClick={(e) => handleActionClick(e, action)}
              className={`${action.label === 'Archive' ? BTN_GHOST_DANGER : style.full} px-3 py-1.5 cursor-pointer`}
            >
              <Icon className="w-3.5 h-3.5" />
              {action.label}
            </button>
          );
        })}
      </div>
      {modals}
    </>
  );
}
