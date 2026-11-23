'use client';

import SharedClientReportModal, { type SentClientReport } from '@/components/client-reports/ClientReportModal';
import { REPORT_EVENTS, annexDocumentFor, type ReportEvent } from '@/lib/trademarks/client-report';
import { ROUND_STEPS, ROUND_STEP_SUFFIX, STEP_LABEL } from '@/lib/trademarks/file-steps';
import { uploadStepFile, type TrademarkFileEntry } from '@/components/trademarks/actions';

function stepName(step: string | null): string {
  if (!step) return 'Not on the timeline';
  if (ROUND_STEPS.has(step as never)) {
    const suffix = ROUND_STEP_SUFFIX[step as keyof typeof ROUND_STEP_SUFFIX];
    return suffix ? `Office Action — ${suffix}` : 'Office Action';
  }
  return STEP_LABEL[step as keyof typeof STEP_LABEL] ?? step;
}

/** Review and send the report on a step taken on a mark, from the firm's own trademark mailbox. */
export default function ClientReportModal({
  trademarkId, event, onClose, onSent, onFileAdded, onUseOwnPaper,
}: {
  trademarkId: string;
  /** Mount one per report (keyed by event), so each opens on a fresh draft. */
  event: ReportEvent;
  onClose: () => void;
  onSent: (report: SentClientReport & { event: ReportEvent }) => void;
  /** A paper uploaded here as an annex is kept on the mark, off the timeline. */
  onFileAdded?: (file: TrademarkFileEntry) => void;
  /** Send a letter the team wrote and saved as PDF instead, through the uploaded-report flow. */
  onUseOwnPaper?: () => void;
}) {
  return (
    <SharedClientReportModal
      api={`/api/trademark/${trademarkId}/client-report`}
      report={{ event }}
      title={REPORT_EVENTS[event].label}
      owner="mark"
      groupLabel={stepName}
      uploadAnnex={async (file) => {
        const saved = await uploadStepFile(trademarkId, file, null);
        onFileAdded?.(saved);
        return { id: saved.id, name: saved.name, sizeBytes: saved.sizeBytes, group: null, document: annexDocumentFor(saved), url: saved.url };
      }}
      onClose={onClose}
      onSent={(r) => onSent({ ...r, event })}
      onUseOwnPaper={onUseOwnPaper}
    />
  );
}
