import { getDTRBundleEntries } from '@/lib/queries/effective-dtr';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { resolveLawyerPositions } from '@/lib/billing/lawyer-positions';

/**
 * Names on a bundle's billable time that resolve to no team row — the same set
 * fetchBillingData reports as `unresolvedLawyers`, computed without touching
 * any billed flag. The generation paths ask this BEFORE they reverse an
 * existing invoice's flags, so a bundle that can't be priced is refused while
 * the invoice it would have replaced is still intact.
 */
export async function unresolvedBundleLawyers(
  firmId: string,
  clientName: string,
  billingMonth: string,
): Promise<string[]> {
  const entries = await getDTRBundleEntries(firmId, {
    billingMonth,
    clientNames: [clientName],
    includeNonBillable: true,
  });
  const billable = entries
    .map((e) => e.effective)
    .filter((s): s is NonNullable<typeof s> => !!s && !s.nonBillable && !!s.date);
  if (billable.length === 0) return [];
  const { unresolved } = await resolveLawyerPositions(getServiceDbForFirm(firmId), firmId, billable);
  return unresolved;
}
