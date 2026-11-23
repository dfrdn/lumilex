import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

/**
 * Identity, not privilege: is this person the firm's Managing Partner?
 *
 * super_user does NOT pass. The MP is a specific human holding a specific
 * office (approving billing bundles, setting salaries) — a developer escape
 * hatch standing in
 * for that person would put the wrong name on those decisions. Callers that
 * genuinely need a super_user override should say so explicitly at the call
 * site rather than folding it in here.
 *
 * `firmId` is part of the question, not plumbing: "the Managing Partner" is an
 * office within one firm, so the lookup is scoped to the caller's own firm.
 */
export async function isManagingPartner(
  personId: string | null | undefined,
  firmId: string,
): Promise<boolean> {
  if (!personId) return false;
  const { data } = await getServiceDbForFirm(firmId)
    .from('team')
    .select('position')
    .eq('person_id', personId)
    .eq('active', true)
    .limit(1)
    .maybeSingle();
  return data?.position === 'Managing Partner';
}

/** Who holds the office now, by the same test as `isManagingPartner` — for notifying them. */
export async function managingPartnerIds(firmId: string): Promise<string[]> {
  const { data, error } = await getServiceDbForFirm(firmId)
    .from('team')
    .select('person_id')
    .eq('position', 'Managing Partner')
    .eq('active', true);
  if (error) throw error;
  return (data ?? []).map((m: { person_id: string }) => m.person_id);
}
