import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';
// ── Deliverable workflow action determination ──────────────────────

export interface DeliverableAction {
  label: string;
  /** New status to set, or null when status stays the same (e.g. handoff between reviewers) */
  newStatus: string | null;
  needsComment: boolean;
  needsDTR: boolean;
  /** Button color intent */
  variant: 'primary' | 'warning' | 'neutral';
  /** Which role should "Currently With" update to after this action.
   *  'nextReviewer' = next reviewer in the pipeline after the current one.
   *  'drafter' = back to drafter. 'draftersAndReviewers' = all drafters + all reviewers
   *  (used on For Finalization so the whole team sees the deliverable is being pre-finalized).
   *  'recipients' = all reviewer_ids (used on internal Mark as Done so recipients can acknowledge).
   *  'clear' = nobody. null = don't update. */
  updatesCurrentlyWith?: 'nextReviewer' | 'drafter' | 'draftersAndReviewers' | 'recipients' | 'clear' | null;
  /** When true, prompt the user to pick a revert target (drafter vs current reviewer) */
  needsRevertTarget?: boolean;
  /** Index into reviewerIds to show as read-only submit target */
  reviewTargetIndex?: number;
  /** When true, let the user pick which reviewer to submit to from the full pipeline */
  needsReviewTargetPicker?: boolean;
  /** Starting index in reviewerIds for the picker options (default 0 = show all) */
  reviewTargetPickerStartIndex?: number;
}

/**
 * Returns the available forward, revert, and utility actions for a deliverable
 * based on its current status and reviewer assignments.
 *
 * @param currentReviewerIndex — index of the reviewer who currently has it (-1 if not with a reviewer)
 * @param reviewerCount — total number of reviewers in the pipeline
 * @param type — deliverable type ('Internal' skips the review/finalization arc)
 */
export function getAvailableActions(
  currentStatus: string,
  reviewerCount: number,
  currentReviewerIndex: number,
  type?: string,
): DeliverableAction[] {
  const actions: DeliverableAction[] = [];
  const hasReviewers = reviewerCount > 0;
  const isWithLastReviewer = currentReviewerIndex === reviewerCount - 1;
  const hasNextReviewer = currentReviewerIndex >= 0 && currentReviewerIndex < reviewerCount - 1;
  const isInternal = type === 'Internal';

  switch (currentStatus) {
    case DELIVERABLE_STATUS.NOT_STARTED:
      actions.push({
        label: 'Start Drafting',
        newStatus: DELIVERABLE_STATUS.DRAFTING,
        needsComment: false,
        needsDTR: false,
        variant: 'primary',
        updatesCurrentlyWith: 'drafter',
      });
      break;

    case DELIVERABLE_STATUS.DRAFTING:
      if (isInternal) {
        actions.push({
          label: 'Submit',
          newStatus: DELIVERABLE_STATUS.SUBMITTED,
          needsComment: true,
          needsDTR: true,
          variant: 'primary',
          updatesCurrentlyWith: 'recipients',
        });
      } else {
        actions.push({
          label: 'For Review',
          newStatus: DELIVERABLE_STATUS.UNDER_REVIEW,
          needsComment: true,
          needsDTR: true,
          variant: 'primary',
          updatesCurrentlyWith: null, // resolved by component based on picker
          reviewTargetIndex: 0,
          needsReviewTargetPicker: reviewerCount > 1,
          reviewTargetPickerStartIndex: 0,
        });
      }
      break;

    case DELIVERABLE_STATUS.UNDER_REVIEW:
      // Forward: hand off to next reviewer (only if not already with the last one)
      if (hasNextReviewer) {
        const remainingReviewers = reviewerCount - (currentReviewerIndex + 1);
        actions.push({
          label: 'For Review',
          newStatus: null, // status stays "Under Review"
          needsComment: true,
          needsDTR: true,
          variant: 'primary',
          updatesCurrentlyWith: 'nextReviewer',
          reviewTargetIndex: currentReviewerIndex + 1,
          needsReviewTargetPicker: remainingReviewers > 1,
          reviewTargetPickerStartIndex: currentReviewerIndex + 1,
        });
      }
      if (isWithLastReviewer || reviewerCount === 0) {
        actions.push({
          label: 'For Finalization',
          newStatus: DELIVERABLE_STATUS.FINALIZING,
          needsComment: true,
          needsDTR: true,
          variant: 'primary',
          updatesCurrentlyWith: 'draftersAndReviewers',
        });
      }
      // Revert
      actions.push({
        label: 'For Revision',
        newStatus: DELIVERABLE_STATUS.REVISING,
        needsComment: true,
        needsDTR: true,
        variant: 'warning',
        updatesCurrentlyWith: 'drafter',
        needsRevertTarget: hasReviewers,
      });
      break;

    case DELIVERABLE_STATUS.REVISING:
      actions.push({
        label: 'For Review',
        newStatus: DELIVERABLE_STATUS.UNDER_REVIEW,
        needsComment: true,
        needsDTR: true,
        variant: 'primary',
        updatesCurrentlyWith: null, // resolved by component based on picker
        reviewTargetIndex: 0, // default to first reviewer
        needsReviewTargetPicker: reviewerCount > 1,
      });
      break;

    case DELIVERABLE_STATUS.FINALIZING:
      actions.push({
        label: 'Mark as Pre-finalized',
        newStatus: DELIVERABLE_STATUS.PRE_FINALIZED,
        needsComment: true,
        needsDTR: true,
        variant: 'primary',
        updatesCurrentlyWith: null, // keep currently_with through finalization
      });
      break;

    case DELIVERABLE_STATUS.PRE_FINALIZED:
      actions.push({
        label: 'Mark as Finalized',
        newStatus: DELIVERABLE_STATUS.OUTBOX,
        needsComment: true,
        needsDTR: false,
        variant: 'primary',
        updatesCurrentlyWith: null, // keep currently_with through finalization
      });
      break;

    case DELIVERABLE_STATUS.OUTBOX:
      actions.push({
        label: 'Mark as Filed/Sent Out',
        newStatus: DELIVERABLE_STATUS.FILED_OR_SENT_OUT,
        needsComment: false,
        needsDTR: false,
        variant: 'primary',
        updatesCurrentlyWith: null, // keep currently_with through outbox/send
      });
      break;

    case DELIVERABLE_STATUS.SUBMITTED:
      if (isInternal) {
        actions.push({
          label: 'Acknowledge',
          newStatus: DELIVERABLE_STATUS.ACKNOWLEDGED,
          needsComment: false,
          needsDTR: false,
          variant: 'primary',
          updatesCurrentlyWith: 'clear',
        });
      }
      break;

    default:
      break;
  }

  // "Awaiting Client" is available on active statuses (not Filed/Sent, not Archived, not already Awaiting).
  // Hidden for Internal — internal deliverables have no external client.
  const awaitingClientTerminalStatuses: readonly string[] = [DELIVERABLE_STATUS.FILED_OR_SENT_OUT, DELIVERABLE_STATUS.ARCHIVED, DELIVERABLE_STATUS.AWAITING_CLIENT];
  if (!isInternal && !awaitingClientTerminalStatuses.includes(currentStatus)) {
    actions.push({
      label: DELIVERABLE_STATUS.AWAITING_CLIENT,
      newStatus: DELIVERABLE_STATUS.AWAITING_CLIENT,
      needsComment: false,
      needsDTR: false,
      variant: 'neutral',
      updatesCurrentlyWith: null,
    });
  }

  // Archive is available on every deliverable except those already archived or filed/sent out.
  // Hidden for Internal — internal deliverables move to Acknowledged as their terminal state.
  if (!isInternal && currentStatus !== DELIVERABLE_STATUS.ARCHIVED && currentStatus !== DELIVERABLE_STATUS.FILED_OR_SENT_OUT) {
    actions.push({
      label: 'Archive',
      newStatus: DELIVERABLE_STATUS.ARCHIVED,
      needsComment: false,
      needsDTR: false,
      variant: 'neutral',
      updatesCurrentlyWith: 'clear',
    });
  }

  return actions;
}
