'use client';

import { useCallback } from 'react';
import { Check, X } from 'lucide-react';
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
  compact?: boolean;
  onStatusChange?: (action: 'attended' | 'cancelled') => void;
}

export default function HearingActionButtons({
  hearingId,
  hearingName,
  hearingType,
  hearingDate,
  isAttended,
  status,
  attendeeIds,
  matterId,
  matterName,
  compact = false,
  onStatusChange,
}: Props) {
  const {
    showAttendConfirm, setShowAttendConfirm,
    showCancelConfirm, setShowCancelConfirm,
    showDTR, setShowDTR,
    loading, markedAttended, markedCancelled,
    handleAttend, handleCancel, dtrPrefill,
  } = useHearingActions({
    hearingId, hearingName, hearingType, hearingDate,
    isAttended, status, attendeeIds, matterId, matterName, onStatusChange,
  });

  const handleAttendClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setShowAttendConfirm(true);
  }, [setShowAttendConfirm]);

  const handleCancelClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setShowCancelConfirm(true);
  }, [setShowCancelConfirm]);

  return (
    <>
      <div className={`flex items-center ${compact ? 'gap-1' : 'gap-1.5'}`} onClick={(e) => e.stopPropagation()}>
        {markedCancelled ? (
          compact ? (
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-500/15 text-red-500 dark:text-red-400" title="Cancelled">
              <X className="w-3 h-3" />
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-md px-2 py-0.5">
              <X className="w-3 h-3" />
              Cancelled
            </span>
          )
        ) : markedAttended ? (
          compact ? (
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" title="Attended">
              <Check className="w-3 h-3" />
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 rounded-md px-2 py-0.5">
              <Check className="w-3 h-3" />
              Attended
            </span>
          )
        ) : compact ? (
          <>
            <button
              type="button"
              onClick={handleAttendClick}
              title="Mark as Attended"
              className="action-lift inline-flex items-center justify-center w-5 h-5 rounded-full border border-[var(--border-color)] text-[var(--text-muted)] hover:text-emerald-600 hover:bg-emerald-500/10 hover:border-emerald-400/40 cursor-pointer"
            >
              <Check className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={handleCancelClick}
              title="Mark as Cancelled"
              className="action-lift inline-flex items-center justify-center w-5 h-5 rounded-full border border-[var(--border-color)] text-[var(--text-muted)] hover:text-red-500 hover:bg-red-500/10 hover:border-red-400/40 cursor-pointer dark:hover:text-red-400"
            >
              <X className="w-3 h-3" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={handleAttendClick}
              title="Mark as Attended"
              className="action-lift inline-flex items-center gap-1 text-[10px] max-sm:text-xs max-sm:min-h-9 max-sm:px-3 font-semibold rounded-md px-2 py-0.5 border border-[var(--border-color)] text-[var(--text-muted)] max-sm:text-[var(--text-secondary)] hover:text-emerald-600 hover:bg-emerald-50 hover:border-emerald-300 dark:hover:text-emerald-400 dark:hover:bg-emerald-500/10 dark:hover:border-emerald-500/30 cursor-pointer"
            >
              <Check className="w-3 h-3" />
              Mark attended
            </button>
            <button
              type="button"
              onClick={handleCancelClick}
              title="Mark as Cancelled"
              className="action-lift inline-flex items-center gap-1 text-[10px] max-sm:text-xs max-sm:min-h-9 max-sm:px-3 font-semibold rounded-md px-2 py-0.5 border border-[var(--border-color)] text-[var(--text-muted)] max-sm:text-[var(--text-secondary)] hover:text-red-500 hover:bg-red-50 hover:border-red-300 dark:hover:text-red-400 dark:hover:bg-red-500/10 dark:hover:border-red-500/30 cursor-pointer"
            >
              <X className="w-3 h-3" />
              Mark cancelled
            </button>
          </>
        )}
      </div>

      <ConfirmDialog
        open={showAttendConfirm}
        onConfirm={handleAttend}
        onCancel={() => setShowAttendConfirm(false)}
        title="Mark as Attended?"
        message={`Mark "${hearingName}" as attended?`}
        confirmLabel="Mark Attended"
        variant="primary"
        loading={loading}
      />

      <ConfirmDialog
        open={showCancelConfirm}
        onConfirm={handleCancel}
        onCancel={() => setShowCancelConfirm(false)}
        title="Mark as Cancelled?"
        message={`Mark "${hearingName}" as cancelled?`}
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
