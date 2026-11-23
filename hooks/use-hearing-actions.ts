'use client';

import { useState, useCallback } from 'react';
import { type DTRPrefill } from '@/components/AddDTRModal';
import { notifyStatusReportCreated } from '@/lib/status-report-toast';
import { manilaToday, toManilaDay } from '@/lib/dates';

interface UseHearingActionsArgs {
  hearingId: string;
  hearingName: string;
  hearingType: string;
  hearingDate: string | null;
  isAttended: boolean;
  status: string;
  attendeeIds: string[];
  matterId: string | null;
  matterName: string;
  onStatusChange?: (action: 'attended' | 'cancelled') => void;
}

/**
 * Shared logic behind the two hearing-action surfaces — the compact list pills
 * (HearingActionButtons) and the detail-page buttons (HearingActions). Owns the
 * mark-attended / mark-cancelled calls, the resulting state, the auto-created
 * status-report toast, and the DTR pre-fill. The components differ only in markup.
 */
export function useHearingActions({
  hearingId,
  hearingName,
  hearingType,
  hearingDate,
  isAttended,
  status,
  attendeeIds,
  matterId,
  matterName,
  onStatusChange,
}: UseHearingActionsArgs) {
  const [showAttendConfirm, setShowAttendConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showDTR, setShowDTR] = useState(false);
  const [loading, setLoading] = useState(false);
  const [markedAttended, setMarkedAttended] = useState(isAttended);
  const [markedCancelled, setMarkedCancelled] = useState(status === 'Cancelled');

  const handleAttend = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/mark-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity: 'hearings', notionId: hearingId, action: 'attended' }),
      });
      if (!res.ok) throw new Error('Failed');
      await notifyStatusReportCreated(res);
      setMarkedAttended(true);
      setShowAttendConfirm(false);
      setShowDTR(true);
      onStatusChange?.('attended');
    } catch {
      setShowAttendConfirm(false);
    } finally {
      setLoading(false);
    }
  }, [hearingId, onStatusChange]);

  const handleCancel = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/mark-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity: 'hearings', notionId: hearingId, action: 'cancelled' }),
      });
      if (!res.ok) throw new Error('Failed');
      setMarkedCancelled(true);
      setShowCancelConfirm(false);
      onStatusChange?.('cancelled');
    } catch {
      setShowCancelConfirm(false);
    } finally {
      setLoading(false);
    }
  }, [hearingId, onStatusChange]);

  const dtrTask = hearingType === 'Filing' ? 'Filing' : 'Hearing';
  const [today] = useState(() => manilaToday());
  const dtrDate = hearingDate ? toManilaDay(hearingDate) : today;

  const dtrPrefill: DTRPrefill = {
    remarks: hearingName,
    task: dtrTask,
    date: dtrDate,
    hours: 1,
    minutes: 0,
    withIds: attendeeIds,
    matterId,
    matterName,
  };

  return {
    showAttendConfirm,
    setShowAttendConfirm,
    showCancelConfirm,
    setShowCancelConfirm,
    showDTR,
    setShowDTR,
    loading,
    markedAttended,
    markedCancelled,
    handleAttend,
    handleCancel,
    dtrPrefill,
  };
}
