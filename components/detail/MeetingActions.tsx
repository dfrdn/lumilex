'use client';

import { useState, useCallback } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { BTN_PRIMARY } from '@/components/ui/tone';
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
}

export default function MeetingActions({
  meetingId,
  meetingName,
  meetingType,
  meetingDate,
  isAttended,
  attendeeIds,
  matterId,
  matterName,
}: Props) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [showDTR, setShowDTR] = useState(false);
  const [markedAttended, setMarkedAttended] = useState(isAttended);

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
      if (!res.ok) throw new Error('Failed to update');
    } catch {
      setMarkedAttended(false);
      setShowDTR(false);
      toast.error('Could not mark the meeting attended');
    }
  }, [meetingId]);

  // Determine DTR task based on meeting type
  const dtrTask = meetingType === 'Internal Discussion' ? 'Internal Discussion' : 'Meeting';

  // Parse date for DTR
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
      {!markedAttended && (
        <div>
          <button
            type="button"
            onClick={() => setShowConfirm(true)}
            className={`${BTN_PRIMARY} px-3 py-1.5`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Mark as Attended
          </button>
        </div>
      )}

      <ConfirmDialog
        open={showConfirm}
        onConfirm={handleConfirm}
        onCancel={() => setShowConfirm(false)}
        title="Mark as Attended?"
        message={`This will mark "${meetingName}" as attended and open a DTR form to log your time.`}
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
