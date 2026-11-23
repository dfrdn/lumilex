/*
 * The Deliverables list's saved filters. Each is a view of one page,
 * /dashboard/deliverables, chosen by `?view=`; the default is the person's own
 * and leaves `view` out of the query, so a link to the firm-wide list has to say
 * `view=all`. Filings, Status Reports, Internal and the by-status list were
 * pages of their own and redirect here.
 */

export const DELIVERABLE_VIEWS = [
  { key: 'mine', label: 'Mine' },
  { key: 'all', label: 'All' },
  { key: 'filings', label: 'Filings' },
  { key: 'status-reports', label: 'Status reports' },
  { key: 'internal', label: 'Internal' },
  { key: 'by-status', label: 'By status' },
] as const;

export type DeliverableView = (typeof DELIVERABLE_VIEWS)[number]['key'];

const KEYS: ReadonlySet<string> = new Set(DELIVERABLE_VIEWS.map((v) => v.key));

export function parseDeliverableView(v: string | undefined): DeliverableView {
  return v && KEYS.has(v) ? (v as DeliverableView) : 'mine';
}

/** The URL of a view, with any extra query (the by-status view's `status`). */
export function deliverablesHref(view: DeliverableView, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams(view === 'mine' ? extra : { view, ...extra });
  const qs = params.toString();
  return qs ? `/dashboard/deliverables?${qs}` : '/dashboard/deliverables';
}
