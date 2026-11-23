import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import { parseInsightsTab } from '@/lib/finance/insights-tabs';
import BillingInsights from '@/components/finance/BillingInsights';
import CashFlowDashboard from '@/components/finance/CashFlowDashboard';
import ProfitabilityReport from '@/components/finance/ProfitabilityReport';
import InsightsTabs from './InsightsTabs';

export const metadata: Metadata = { title: 'Insights' };

export const revalidate = 30;

/*
 * What the billing data says, one tab per question (?tab=,
 * lib/finance/insights-tabs): Leakage, Cash flow, Profitability.
 * /finance/cash-flow and /finance/profitability redirect to their tabs.
 */
export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireRouteAccess('/finance/insights');
  const tab = parseInsightsTab((await searchParams).tab);

  return (
    <>
      <div className="mb-5">
        <InsightsTabs tab={tab} />
      </div>
      {tab === 'cash-flow' ? <CashFlowDashboard /> : tab === 'profitability' ? <ProfitabilityReport /> : <BillingInsights />}
    </>
  );
}
