'use client';

import { useState, useCallback } from 'react';
import { Check } from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { notifyStatusReportCreated } from '@/lib/status-report-toast';

interface Props {
  filingId: string;
  filingName: string;
  status: string;
  /** "compact" for calendar/list, "full" for detail page */
  variant?: 'compact' | 'full';
}

export default function FilingActionButtons({
  filingId,
  filingName,
  status,
  variant = 'compact',
}: Props) {
  const [showConfirm, setShowConfirm] = useState(false);
  const isFiled = status?.toLowerCase() === 'filed' || status?.toLowerCase() === 'done' || status?.toLowerCase() === 'completed';
  const [markedFiled, setMarkedFiled] = useState(isFiled);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setShowConfirm(true);
  }, []);

  const handleConfirm = useCallback(async () => {
    // Optimistic — close dialog and flip the pill immediately.
    setMarkedFiled(true);
    setShowConfirm(false);
    try {
      const res = await fetch('/api/mark-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity: 'filings', notionId: filingId, action: 'filed' }),
      });
      if (!res.ok) throw new Error('Failed');
      await notifyStatusReportCreated(res);
    } catch {
      // Revert on failure
      setMarkedFiled(false);
    }
  }, [filingId]);

  if (variant === 'full') {
    return (
      <>
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {markedFiled ? (
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 rounded-lg px-4 py-2 ring-1 ring-inset ring-emerald-200/60 dark:ring-emerald-500/20">
              <Check className="w-4 h-4" />
              Filed
            </span>
          ) : (
            <button
              type="button"
              onClick={handleClick}
              className="inline-flex items-center gap-2 text-sm font-semibold rounded-lg px-4 py-2 bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm transition-all duration-150 cursor-pointer"
            >
              <Check className="w-4 h-4" />
              Mark as Filed
            </button>
          )}
        </div>

        <ConfirmDialog
          open={showConfirm}
          onConfirm={handleConfirm}
          onCancel={() => setShowConfirm(false)}
          title="Mark as Filed?"
          message={`Mark "${filingName}" as filed?`}
          confirmLabel="Mark Filed"
          variant="primary"
        />
      </>
    );
  }

  // Compact variant (calendar / list rows)
  return (
    <>
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {markedFiled ? (
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" title="Filed">
            <Check className="w-3 h-3" />
          </span>
        ) : (
          <button
            type="button"
            onClick={handleClick}
            title="Mark as Filed"
            className="action-lift inline-flex items-center justify-center w-5 h-5 max-sm:w-9 max-sm:h-9 rounded-full border border-[var(--border-color)] text-[var(--text-muted)] hover:text-emerald-600 hover:bg-emerald-500/10 hover:border-emerald-400/40 cursor-pointer"
          >
            <Check className="w-3 h-3" />
          </button>
        )}
      </div>

      <ConfirmDialog
        open={showConfirm}
        onConfirm={handleConfirm}
        onCancel={() => setShowConfirm(false)}
        title="Mark as Filed?"
        message={`Mark "${filingName}" as filed?`}
        confirmLabel="Mark Filed"
        variant="primary"
      />
    </>
  );
}
