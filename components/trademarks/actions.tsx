'use client';

import { toast } from 'sonner';
import type { OfficeActionKind, Trademark, TrademarkFile, TrademarkFileStep, TrademarkStatus } from '@/types/notion';
import DatedActionButton, { type DateField } from '@/components/ui/DatedActionButton';
import { ACTION_FILE_STEP, UNCONFIRMED_RECEIPT_ACTIONS, type ActionSpec, type TrademarkAction } from '@/lib/trademarks/actions';
import { uploadViaSignedUrl } from '@/lib/corporations/upload-file';

/** A paper on a mark, with a link to open it. */
export type TrademarkFileEntry = TrademarkFile & { url: string | null };

export interface ActionPayload {
  /** The day it happened — filed, paid, or received. */
  date?: string;
  regDate?: string;
  /** The date on a document IPOPHL sent; its periods count from it. */
  mailingDate?: string;
  officeActionId?: string;
  kind?: OfficeActionKind;
  title?: string;
  respondBy?: string;
  /** Recorded without the day it was received, which nobody can confirm yet. */
  receivedUnconfirmed?: boolean;
}

/** Runs an action. Resolves with the updated trademark (and the round it touched), or null after showing why it failed. */
export async function runTrademarkAction(
  trademarkId: string,
  action: TrademarkAction,
  payload: ActionPayload = {},
): Promise<{ trademark: Trademark; officeActionId: string | null } | null> {
  try {
    const res = await fetch(`/api/trademark/${trademarkId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.details?.[0] ?? data.error ?? 'Action failed');
    return { trademark: data.trademark as Trademark, officeActionId: data.officeActionId ?? null };
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Action failed');
    return null;
  }
}

/** Takes back a recorded step. Resolves with the updated trademark, or null after showing why it couldn't. */
export async function undoTrademarkAction(
  trademarkId: string,
  action: TrademarkAction,
  previousStatus?: TrademarkStatus,
  officeActionId?: string,
): Promise<Trademark | null> {
  try {
    const res = await fetch(`/api/trademark/${trademarkId}/undo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, previousStatus, officeActionId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not undo that');
    return data.trademark as Trademark;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not undo that');
    return null;
  }
}

/** Uploads a paper filed under a timeline step. Throws with the reason on failure. */
export async function uploadStepFile(
  trademarkId: string,
  file: File,
  step: TrademarkFileStep | null,
  officeActionId: string | null = null,
): Promise<TrademarkFileEntry> {
  const data = await uploadViaSignedUrl<{ file?: TrademarkFileEntry }>(`/api/trademark/${trademarkId}/files`, file, {
    step,
    officeActionId,
  });
  if (!data.file) throw new Error(`Could not upload ${file.name}`);
  return data.file;
}

/** Says a step was recorded, with an Undo that takes it straight back. */
export function recordedToast(
  message: string,
  { trademarkId, action, previousStatus, officeActionId, onUndone }: {
    trademarkId: string;
    action: TrademarkAction;
    previousStatus?: TrademarkStatus;
    officeActionId?: string | null;
    onUndone: (updated: Trademark) => void;
  },
) {
  toast.success(message, {
    action: {
      label: 'Undo',
      onClick: async () => {
        const updated = await undoTrademarkAction(trademarkId, action, previousStatus, officeActionId ?? undefined);
        if (updated) {
          onUndone(updated);
          toast.success('Undone');
        }
      },
    },
  });
}

const ROUND_KIND_LABEL: Record<OfficeActionKind, string> = {
  office_action: 'Office Action',
  final_rejection: 'Final rejection',
  provisional_refusal: 'Provisional refusal',
};

/** The prompt an action shows: the COR asks for two dates, anything IPOPHL sends for the date on it and the day it came. */
function fieldsFor(spec: ActionSpec, regDate: string | null): DateField[] {
  switch (spec.dateMode) {
    case 'cor':
      return [
        {
          key: 'regDate',
          label: 'Registration date (printed on the COR)',
          hint: 'DAU and renewal deadlines count from this date.',
          initial: regDate,
          optional: true,
          placeholder: 'Same as received',
        },
        { key: 'date', label: 'COR received on' },
      ];
    case 'notice':
      return [
        { key: 'mailingDate', label: 'Date on the document', hint: 'Its periods count from this date.', initial: null },
        {
          key: 'date',
          label: 'Received on',
          ...(UNCONFIRMED_RECEIPT_ACTIONS.has(spec.action) ? { unconfirmable: 'Not confirmed yet' } : {}),
        },
        ...(spec.action === 'oa_received'
          ? [spec.respondByRequired
              ? { key: 'respondBy', label: 'Respond by', hint: 'As stated on the notice.', initial: null, allowFuture: true }
              : {
                  key: 'respondBy',
                  label: 'Respond by — only if the examiner set a shorter period',
                  hint: 'Leave empty for the usual 2 months, extendible to 4.',
                  initial: null,
                  optional: true,
                  allowFuture: true,
                }]
          : []),
      ];
    case 'one':
      return [{ key: 'date', label: spec.dateLabel ?? 'Date' }];
    default:
      return [];
  }
}

/**
 * A button that records a trademark step, asking for its dates first when it
 * has them, and — for a step that comes with a paper — the document, which is
 * filed under the step once it's recorded.
 */
export function TrademarkActionButton({
  trademarkId, spec, regDate = null, expectedRegDate = null, onDone, size = 'md',
}: {
  trademarkId: string;
  spec: ActionSpec;
  /** Current registration date — the COR prompt's starting value. */
  regDate?: string | null;
  /** The date the mark was deemed registered, when it can be worked out — used if none is on record. */
  expectedRegDate?: string | null;
  onDone: (updated: Trademark, file: TrademarkFileEntry | null, officeActionId: string | null) => void;
  size?: 'sm' | 'md';
}) {
  const step = ACTION_FILE_STEP[spec.action] ?? null;
  const isOa = spec.action === 'oa_received';
  const kinds = spec.roundKinds ?? ['office_action', 'final_rejection'];
  return (
    <DatedActionButton
      label={spec.label}
      primary={spec.primary}
      size={size}
      fields={fieldsFor(spec, regDate ?? expectedRegDate)}
      choice={isOa ? {
        key: 'kind',
        initial: kinds[0],
        options: kinds.map((k) => ({ value: k, label: ROUND_KIND_LABEL[k] })),
      } : undefined}
      text={isOa ? {
        key: 'title',
        // A designation's refusal may come from an office abroad.
        label: spec.roundKinds ? 'What the office called it (optional)' : 'What IPOPHL called it (optional)',
        placeholder: spec.roundKinds ? 'e.g. Notice of provisional refusal' : 'e.g. Registrability Report',
      } : undefined}
      fileLabel={step ? 'Document' : undefined}
      onRun={async (d, extras) => {
        const result = await runTrademarkAction(trademarkId, spec.action, {
          date: d.date ?? undefined,
          regDate: d.regDate ?? undefined,
          mailingDate: d.mailingDate ?? undefined,
          respondBy: d.respondBy ?? undefined,
          officeActionId: spec.officeActionId,
          kind: isOa ? (extras.choice as OfficeActionKind) : undefined,
          title: isOa ? extras.text : undefined,
          receivedUnconfirmed: extras.unconfirmed.includes('date') || undefined,
        });
        if (!result) return false;
        let uploaded: TrademarkFileEntry | null = null;
        if (extras.file && step) {
          try {
            uploaded = await uploadStepFile(trademarkId, extras.file, step, result.officeActionId);
          } catch (e) {
            toast.error(`Recorded, but the document didn’t upload${e instanceof Error ? `: ${e.message}` : ''}. Attach it from the timeline.`);
          }
        }
        onDone(result.trademark, uploaded, result.officeActionId);
        return true;
      }}
    />
  );
}
