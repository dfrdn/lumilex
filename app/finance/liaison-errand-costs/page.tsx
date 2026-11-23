import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import LiaisonErrandCostsView from '@/components/finance/LiaisonErrandCostsView';
import { getLiaisonErrandCosts } from '@/lib/finance/liaison-errand-costs';
import { monthRange } from '@/lib/dates';

export const metadata: Metadata = { title: 'Liaison Errand Costs' };

export const revalidate = 0;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Default range = the current month in Asia/Manila. */
function currentMonthRange(): { from: string; to: string } {
  const { start, end } = monthRange();
  return { from: start, to: end };
}

export default async function LiaisonErrandCostsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; liaison?: string }>;
}) {
  const session = await requireRouteAccess('/finance/liaison-errand-costs');

  const sp = await searchParams;
  const def = currentMonthRange();
  let from = sp.from && DATE_RE.test(sp.from) ? sp.from : def.from;
  let to = sp.to && DATE_RE.test(sp.to) ? sp.to : def.to;
  // Tolerate an inverted range rather than silently returning nothing.
  if (from > to) [from, to] = [to, from];

  const report = await getLiaisonErrandCosts(from, to, session.firmId);

  return (
    <LiaisonErrandCostsView report={report} from={from} to={to} initialLiaison={sp.liaison ?? 'all'} />
  );
}
