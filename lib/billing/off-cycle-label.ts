/**
 * Pure wording helpers for off-cycle invoices, kept apart from
 * lib/billing/off-cycle so the request form can use them in the browser.
 */

const KIND_LABEL: Record<string, string> = {
  acceptance: 'Acceptance Fee',
};

/** Default "billing statement for …" wording, from what the bill carries. */
export function defaultPeriodLabel(lines: Array<{ kind: string; description: string }>): string {
  const parts = [...new Set(lines.map((l) =>
    KIND_LABEL[l.kind] ?? (l.kind === 'milestone' ? l.description.replace(/^Milestone — /, '') : l.description),
  ))].filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length > 3) return 'the fees itemized in the attached breakdown';
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** What the client is asked to remit before VAT: the fees. */
export function offCycleTotal(lines: Array<{ amount?: number | null }>): number {
  return Math.round(lines.reduce((s, l) => s + (Number(l.amount) || 0), 0) * 100) / 100;
}
