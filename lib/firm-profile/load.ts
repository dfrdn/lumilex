/**
 * Reading the firm's current profile. Shared by the proposal package, which
 * binds the profile as an annex, and by the engagement proposal, whose cover
 * band carries the same address and contact lines the profile publishes — the
 * letter and the annex behind it must not disagree about where the firm is or
 * what number to ring.
 *
 * There is no in-code fallback. A firm that has not saved a profile gets an
 * error, never another firm's — an engagement proposal that binds someone
 * else's profile as Annex "B" is worse than an export that refuses to run.
 */

import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import type { FirmProfileContent, FirmProfileRow } from './types';
import { getFirmInvoiceSettings } from '@/lib/billing/firm-defaults';
import type { ProposalFirmContact, ProposalPayment } from '@/lib/engagement-proposal/types';

/**
 * The profile the firm publishes. Service-role: firm-wide reference content
 * with no per-user scoping, needed while assembling a package.
 */
export async function loadFirmProfile(firmId: string): Promise<FirmProfileContent> {
  const supabase = getServiceDbForFirm(firmId);
  const { data } = await supabase
    .from('firm_profiles')
    .select('*')
    .order('is_default', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle<FirmProfileRow>();
  if (!data?.content) {
    throw new Error(
      'This firm has no saved firm profile — create one under Admin → Firm profile before generating documents that use it.',
    );
  }
  return data.content;
}

/**
 * The cover band's seed and its fallback. Narrowed to the four lines the band
 * prints — the profile's block also carries page furniture ("Contact Us", the
 * office label) that belongs to the profile's own contact page, not a letter.
 */
export async function loadFirmContact(firmId: string): Promise<ProposalFirmContact> {
  const { addressLines, phone, email, website } = (await loadFirmProfile(firmId)).contact;
  return { addressLines, phone, email, website };
}

/**
 * How the client pays, taken from the firm's invoice settings rather than a
 * second copy: a proposal naming one account and the invoice that follows it
 * naming another is how a payment goes to the wrong place.
 */
export async function loadPaymentDetails(firmId: string): Promise<ProposalPayment> {
  const settings = await getFirmInvoiceSettings(firmId);
  return {
    bankName: settings.bankName,
    accountName: settings.bankAccountName,
    accountNo: settings.bankAccountNo,
    tin: settings.firmTIN,
    note: '',
  };
}
