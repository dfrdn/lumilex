/**
 * Placeholder hourly rates, one row per position in the firm's seniority order.
 *
 * Source: `SENIORITY_ORDER` in lib/billing/seniority.ts — the list the billing
 * breakdown and the retainer cap-split already sort by. Seeding the positions
 * (rather than leaving the table empty) means finance opens
 * /finance/settings/rates and sees the rows it has to price, instead of an
 * empty screen and no hint of what the app expects a position to be called.
 *
 * Every rate is 0. That is the point: a rate nobody has set must be arithmetically
 * obvious, not plausible. A seeded 5,000 would bill a client at another firm's
 * price and look entirely normal on the invoice; a seeded 0 produces a zero line
 * that no one signs off. Invoicing is separately blocked until the firm's invoice
 * settings are completed (lib/billing/firm-defaults.ts), so a 0-rate bill cannot
 * reach a client in the window before finance prices these.
 */

import { SENIORITY_ORDER } from '@/lib/billing/seniority';
import type { BillingRateSeed } from './types';

/** Obviously-unset. See the note above before changing it to a "sensible" number. */
export const PLACEHOLDER_HOURLY_RATE = 0;

export const SEED_BILLING_RATES: BillingRateSeed[] = SENIORITY_ORDER.map((position) => ({
  position,
  hourly_rate: PLACEHOLDER_HOURLY_RATE,
  currency: 'PHP',
}));
