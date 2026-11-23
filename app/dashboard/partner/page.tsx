import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';

import PartnerAnalyticsDashboard from './PartnerAnalyticsDashboard';
import {
  getLawyerProfiles,
  getDTRAggregates,
  getDeliverableSnapshot,
  getHearingFilingAggregates,
  getMatterDistribution,
  getCurrentMonthSummary,
  getCaseOutcomes,
  getRevenueProjection,
  getDeliverableTurnaround,
  getLawyerUtilization,
} from '@/lib/queries/partner-analytics';
import { getBillingEfficiency, type BillingEfficiency } from '@/lib/queries/billing-efficiency';
import type {
  MonthlyDTRAggregate,
  DeliverableSnapshot,
  MonthlyHearingFilingAggregate,
  MatterDistribution,
  CurrentMonthSummary,
  CaseOutcomeStats,
  RevenueProjection,
  TurnaroundStats,
  LawyerUtilization,
} from '@/lib/queries/partner-analytics';
import { manilaYear } from '@/lib/dates';

export const metadata: Metadata = { title: 'Partner Overview' };

export const revalidate = 30;

interface Props {
  searchParams: Promise<{ year?: string; compare?: string }>;
}

export default async function PartnerOverviewPage({ searchParams }: Props) {
  const session = await requireRouteAccess('/dashboard/partner');

  const params = await searchParams;

  const currentYear = manilaYear();

  const year = params.year && /^\d{4}$/.test(params.year)
    ? Math.min(parseInt(params.year), currentYear)
    : currentYear;

  const compare = params.compare === '1' && year > 2020;

  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;
  const prevStartDate = `${year - 1}-01-01`;
  const prevEndDate = `${year - 1}-12-31`;

  // Fetch all data in parallel, the prior year's too when comparing.
  const allLawyersPromise = getLawyerProfiles(session.firmId);
  const prevYearPromise = compare
    ? Promise.allSettled([
        getDTRAggregates(session.firmId, prevStartDate, prevEndDate),
        getHearingFilingAggregates(session.firmId, prevStartDate, prevEndDate),
        getRevenueProjection(session.firmId, prevStartDate, prevEndDate),
      ])
    : null;

  const [dtrResult, delivResult, hfResult, matterResult, monthResult, outcomeResult, revenueResult, turnaroundResult, billingEffResult] = await Promise.allSettled([
    getDTRAggregates(session.firmId, startDate, endDate),
    getLawyerProfiles(session.firmId, true).then((activeLawyers) => getDeliverableSnapshot(session.firmId, activeLawyers)),
    getHearingFilingAggregates(session.firmId, startDate, endDate),
    allLawyersPromise.then((allLawyers) => getMatterDistribution(session.firmId, allLawyers)),
    getCurrentMonthSummary(session.firmId),
    getCaseOutcomes(session.firmId),
    getRevenueProjection(session.firmId, startDate, endDate),
    getDeliverableTurnaround(session.firmId),
    getBillingEfficiency(session.firmId, startDate, endDate),
  ]);

  const dtrAggregates: MonthlyDTRAggregate[] = dtrResult.status === 'fulfilled' ? dtrResult.value : [];
  const deliverableSnapshot: DeliverableSnapshot = delivResult.status === 'fulfilled'
    ? delivResult.value
    : { byStatus: [], total: 0, overdueCount: 0, byLawyer: [] };
  const hearingFilingAggregates: MonthlyHearingFilingAggregate[] = hfResult.status === 'fulfilled' ? hfResult.value : [];
  const matterDistribution: MatterDistribution = matterResult.status === 'fulfilled'
    ? matterResult.value
    : { byLawyer: [], byClient: [], total: 0 };
  const currentMonthSummary: CurrentMonthSummary = monthResult.status === 'fulfilled'
    ? monthResult.value
    : { totalHours: 0, billedHours: 0, unbilledHours: 0, entryCount: 0, byLawyer: [], byClient: [], daysElapsed: 0, daysInMonth: 30 };
  const caseOutcomes: CaseOutcomeStats = outcomeResult.status === 'fulfilled'
    ? outcomeResult.value
    : { total: 0, favorable: 0, unfavorable: 0, settled: 0, pending: 0, dismissed: 0, other: 0, byType: [], recentOutcomes: [] };
  const revenueData: RevenueProjection = revenueResult.status === 'fulfilled'
    ? revenueResult.value
    : { byMonth: [], byLawyer: [], byClient: [], totalRevenue: 0, totalBilledRevenue: 0 };
  const turnaroundStats: TurnaroundStats = turnaroundResult.status === 'fulfilled'
    ? turnaroundResult.value
    : { draftAvgDays: 0, finalizationAvgDays: 0, totalAvgDays: 0, byLawyer: [], trend: [] };
  const billingEfficiency: BillingEfficiency = billingEffResult.status === 'fulfilled'
    ? billingEffResult.value
    : {
        totalRawHours: 0,
        totalRawBillableHours: 0,
        totalEffectiveBillableHours: 0,
        totalProjectedRevenue: 0,
        totalActualBillable: 0,
        hasTentativeEdits: false,
        tentativeBundleCount: 0,
        byMonth: [],
      };

  // Compute utilization from DTR aggregates (no extra DB call)
  const allLawyers = await allLawyersPromise;
  const utilizationData: LawyerUtilization = await getLawyerUtilization(startDate, endDate, dtrAggregates, allLawyers);

  // YoY comparison data (only fetch when compare is on)
  let prevYearDTR: MonthlyDTRAggregate[] | undefined;
  let prevYearHF: MonthlyHearingFilingAggregate[] | undefined;
  let prevYearRevenue: RevenueProjection | undefined;

  if (prevYearPromise) {
    const [prevDTR, prevHF, prevRev] = await prevYearPromise;
    prevYearDTR = prevDTR.status === 'fulfilled' ? prevDTR.value : undefined;
    prevYearHF = prevHF.status === 'fulfilled' ? prevHF.value : undefined;
    prevYearRevenue = prevRev.status === 'fulfilled' ? prevRev.value : undefined;
  }

  return (
    <PartnerAnalyticsDashboard
      year={year}
      currentYear={currentYear}
      compare={compare}
      dtrAggregates={dtrAggregates}
      deliverableSnapshot={deliverableSnapshot}
      hearingFilingAggregates={hearingFilingAggregates}
      matterDistribution={matterDistribution}
      currentMonthSummary={currentMonthSummary}
      caseOutcomes={caseOutcomes}
      revenueData={revenueData}
      turnaroundStats={turnaroundStats}
      utilizationData={utilizationData}
      billingEfficiencyData={billingEfficiency}
      prevYearDTR={prevYearDTR}
      prevYearHF={prevYearHF}
      prevYearRevenue={prevYearRevenue}
    />
  );
}
