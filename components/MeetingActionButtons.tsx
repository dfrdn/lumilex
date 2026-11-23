'use client';

import { useState, useCallback } from 'react';
import { Check } from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { toast } from 'sonner';
import AddDTRModal, { type DTRPrefill } from '@/components/AddDTRModal';
import { manilaToday, toManilaDay } from '@/lib/dates';

interface Props {
  meetingId: string;
  meetingName: string;
  meetingType: string;
  meetingDate: string | null;
  isAttended: boolean;
  attendeeIds: string[];
  matterId: string | null;
  matterName: string;
  compact?: boolean;
  onStatusChange?: (action: 'attended') => void;
}

export default function MeetingActionButtons({
  meetingId,
  meetingName,
  meetingType,
  meetingDate,
  isAttended,
  attendeeIds,
  matterId,
  matterName,
  compact = false,
  onStatusChange,
}: Props) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [showDTR, setShowDTR] = useState(false);
  const [markedAttended, setMarkedAttended] = useState(isAttended);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setShowConfirm(true);
  }, []);

  const handleConfirm = useCallback(async () => {
    setMarkedAttended(true);
    setShowConfirm(false);
    setShowDTR(true);
    try {
      const res = await fetch('/api/mark-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity: 'meetings', notionId: meetingId, action: 'attended' }),
      });
      if (!res.ok) throw new Error('Failed');
      onStatusChange?.('attended');
    } catch {
      setMarkedAttended(false);
      setShowDTR(false);
      toast.error('Could not mark the meeting attended');
    }
  }, [meetingId, onStatusChange]);

  const dtrTask = meetingType === 'Internal Discussion' ? 'Internal Discussion' : 'Meeting';
  const [today] = useState(() => manilaToday());
  const dtrDate = meetingDate ? toManilaDay(meetingDate) : today;

  const dtrPrefill: DTRPrefill = {
    remarks: meetingName,
    task: dtrTask,
    date: dtrDate,
    hours: 1,
    minutes: 0,
    withIds: attendeeIds,
    matterId,
    matterName,
  };

  return (
    <>
      {markedAttended ? (
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
        <button
          type="button"
          onClick={handleClick}
          title="Mark as Attended"
          className="action-lift inline-flex items-center justify-center w-5 h-5 rounded-full border border-[var(--border-color)] text-[var(--text-muted)] hover:text-emerald-600 hover:bg-emerald-500/10 hover:border-emerald-400/40 cursor-pointer"
        >
          <Check className="w-3 h-3" />
        </button>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          title="Mark as Attended"
          className="action-lift inline-flex items-center gap-1 text-[10px] max-sm:text-xs max-sm:min-h-9 max-sm:px-3 font-semibold rounded-md px-2 py-0.5 border border-[var(--border-color)] text-[var(--text-muted)] max-sm:text-[var(--text-secondary)] hover:text-emerald-600 hover:bg-emerald-50 hover:border-emerald-300 dark:hover:text-emerald-400 dark:hover:bg-emerald-500/10 dark:hover:border-emerald-500/30 cursor-pointer"
        >
          <Check className="w-3 h-3" />
          Mark attended
        </button>
      )}

      <ConfirmDialog
        open={showConfirm}
        onConfirm={handleConfirm}
        onCancel={() => setShowConfirm(false)}
        title="Mark as Attended?"
        message={`Mark "${meetingName}" as attended?`}
        confirmLabel="Mark Attended"
        variant="primary"
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
