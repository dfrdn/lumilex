/*
 * Finance Insights: what the billing data says, one tab per question, chosen
 * by `?tab=`. Leakage (the default, what /finance/insights always showed),
 * billable time lost before it is invoiced; Cash flow, money in and out by
 * month; Profitability, revenue against the cost of time, per matter.
 * /finance/cash-flow and /finance/profitability redirect to their tabs.
 *
 * Kept free of imports, so the nav and any screen can link to a tab.
 */

export const INSIGHTS_PATH = '/finance/insights';

export const INSIGHTS_TABS = [
  { key: 'leakage', label: 'Leakage' },
  { key: 'cash-flow', label: 'Cash flow' },
  { key: 'profitability', label: 'Profitability' },
] as const;

export type InsightsTab = (typeof INSIGHTS_TABS)[number]['key'];

const TAB_KEYS: ReadonlySet<string> = new Set(INSIGHTS_TABS.map((t) => t.key));

export function parseInsightsTab(v: string | undefined): InsightsTab {
  return v && TAB_KEYS.has(v) ? (v as InsightsTab) : 'leakage';
}

/** The URL of a tab; the default has no query. */
export function insightsHref(tab: InsightsTab): string {
  return tab === 'leakage' ? INSIGHTS_PATH : `${INSIGHTS_PATH}?tab=${tab}`;
}
