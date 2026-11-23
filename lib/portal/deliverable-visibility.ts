import { DELIVERABLE_STATUS, DELIVERED_STATUSES } from '@/lib/deliverable-status';

/**
 * Which deliverables, versions and register rows a client may see. Pure, so the
 * loaders, the download allowlists and the chat context all ask the same rule.
 */

const DELIVERED = new Set<string>(DELIVERED_STATUSES);

export const INTERNAL_DELIVERABLE_TYPE = 'Internal';
export const STATUS_REPORT_TYPE = 'Status Report';

/** The tag the team puts on the copy that was actually filed or sent. */
export const FILED_VERSION_ACTION = 'Filed version';

export interface DeliverableLike {
  type: string | null;
  status: string | null;
}

/** A finished filing or letter. Internal work never reaches the client, whatever its status. */
export function isFiledDeliverable(d: DeliverableLike): boolean {
  return (
    d.type !== INTERNAL_DELIVERABLE_TYPE &&
    d.type !== STATUS_REPORT_TYPE &&
    !!d.status &&
    DELIVERED.has(d.status)
  );
}

export function isSentStatusReport(d: DeliverableLike): boolean {
  return d.type === STATUS_REPORT_TYPE && d.status === DELIVERABLE_STATUS.FILED_OR_SENT_OUT;
}

/** A deliverable the client sees: a finished filing or letter, or a sent status report. */
export function isClientDeliverable(d: DeliverableLike): boolean {
  return isFiledDeliverable(d) || isSentStatusReport(d);
}

/**
 * Whether the client should read a finished deliverable as filed — lodged with
 * a court or an agency — rather than sent. Only `External` work is filed; a
 * `For Client` letter, contract or memo is sent.
 */
export function wasFiledWithAuthority(type: string | null): boolean {
  return type === 'External';
}

/**
 * Only the version the team tagged as the filed copy reaches the client. The
 * latest upload is often a draft started after filing, or a working DOCX on a
 * deliverable that was never given a filed copy.
 */
export function isFiledVersion(row: { action: string | null }): boolean {
  return !!row.action && row.action.toLowerCase().startsWith(FILED_VERSION_ACTION.toLowerCase());
}

/**
 * Whether a register row may be listed or opened. A row tied to a deliverable
 * is that deliverable's copy — often a draft or the working file of something
 * still in progress — so it reaches the client only when the deliverable does.
 */
export function isClientVisibleFileRow(
  row: { deliverable_id: string | null },
  shownDeliverables: { has(id: string): boolean },
): boolean {
  return !row.deliverable_id || shownDeliverables.has(row.deliverable_id);
}
