'use client';

import { CheckCircle2, XCircle } from 'lucide-react';
import { BTN_GHOST_DANGER, BTN_PRIMARY } from '@/components/ui/tone';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import AddDTRModal from '@/components/AddDTRModal';
import { useHearingActions } from '@/hooks/use-hearing-actions';

interface Props {
  hearingId: string;
  hearingName: string;
  hearingType: string;
  hearingDate: string | null;
  isAttended: boolean;
  status: string;
  attendeeIds: string[];
  matterId: string | null;
  matterName: string;
}

export default function HearingActions({
  hearingId,
  hearingName,
  hearingType,
  hearingDate,
  isAttended,
  status,
  attendeeIds,
  matterId,
  matterName,
}: Props) {
  // Don't router.refresh() in handleAttend — it re-evaluates the layout's
  // attendance check and can unmount the page before the DTR modal is used.
  const {
    showAttendConfirm, setShowAttendConfirm,
    showCancelConfirm, setShowCancelConfirm,
    showDTR, setShowDTR,
    loading, markedAttended, markedCancelled,
    handleAttend, handleCancel, dtrPrefill,
  } = useHearingActions({
    hearingId, hearingName, hearingType, hearingDate,
    isAttended, status, attendeeIds, matterId, matterName,
  });

  const showAttendBtn = !markedAttended && !markedCancelled;
  const showCancelBtn = !markedCancelled && !markedAttended;

  return (
    <>
      {(showAttendBtn || showCancelBtn) && (
        <div className="flex items-center gap-2">
          {showAttendBtn && (
            <button
              type="button"
              onClick={() => setShowAttendConfirm(true)}
              className={`${BTN_PRIMARY} px-3 py-1.5`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Mark as Attended
            </button>
          )}
          {showCancelBtn && (
            <button
              type="button"
              onClick={() => setShowCancelConfirm(true)}
              className={`${BTN_GHOST_DANGER} px-3 py-1.5`}
            >
              <XCircle className="w-3.5 h-3.5" />
              Mark as Cancelled
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={showAttendConfirm}
        onConfirm={handleAttend}
        onCancel={() => setShowAttendConfirm(false)}
        title="Mark as Attended?"
        message={`This will mark "${hearingName}" as attended and open a DTR form to log your time.`}
        confirmLabel="Mark Attended"
        variant="primary"
        loading={loading}
      />

      <ConfirmDialog
        open={showCancelConfirm}
        onConfirm={handleCancel}
        onCancel={() => setShowCancelConfirm(false)}
        title="Mark as Cancelled?"
        message={`This will mark "${hearingName}" as cancelled. This action cannot be easily undone.`}
        confirmLabel="Mark Cancelled"
        variant="danger"
        loading={loading}
      />

      <AddDTRModal
        open={showDTR}
        onClose={() => {
          setShowDTR(false);
        }}
        prefill={dtrPrefill}
      />
    </>
  );
}
