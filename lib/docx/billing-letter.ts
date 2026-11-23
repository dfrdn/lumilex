import { buildLetterBody } from './letter-body';
import { placeOnLetterhead } from './on-letterhead';
import { billingLetterParagraphs, type BillingLetterParams } from '@/lib/billing/letter-content';

/**
 * The billing letter, on the firm's letterhead.
 *
 * The words come from lib/billing/letter-content.ts, in the wording finance
 * keeps on the Billing Letter page; this only lays them on the same sheet as
 * every other letter the firm sends.
 */
export async function generateBillingLetterDocx(firmId: string, params: BillingLetterParams): Promise<Buffer> {
  return placeOnLetterhead(firmId, (parts) => buildLetterBody(billingLetterParagraphs(params), parts));
}
