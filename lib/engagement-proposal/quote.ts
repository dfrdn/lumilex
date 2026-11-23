/**
 * Checks a proposal's quoted figures against the firm's live fee schedule.
 *
 * The drafting model writes the fee prose, and a partner may edit it. Neither
 * is a reliable source for a number that ends up in a signed engagement
 * agreement, so every figure the proposal states is re-derived here from the
 * schedule and the arithmetic is redone. Issues surface in the builder before
 * the PDF is produced; nothing is silently corrected, because a partner may
 * have deliberately agreed an off-schedule rate.
 */

import type { ProfessionalBody } from '@/lib/fee-schedule/types';
import type { ProposalQuote } from './types';

export interface QuoteIssue {
  field: string;
  message: string;
  /** `error` — the figure contradicts the schedule or its own arithmetic.
   *  `warning` — deliberate departures are legitimate, but say so out loud. */
  severity: 'error' | 'warning';
}

/** Money compares to the centavo; floats from percentage maths need the slack. */
function differs(a: number, b: number): boolean {
  return Math.abs(a - b) > 0.005;
}

const money = (n: number) =>
  `P${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function checkQuote(quote: ProposalQuote | undefined, body: ProfessionalBody | null): QuoteIssue[] {
  if (!quote) return [];
  const issues: QuoteIssue[] = [];

  if (quote.arrangement === 'retainer') {
    if (!quote.tierLabel) {
      issues.push({ field: 'tierLabel', message: 'No retainer tier is named, so the fee cannot be checked against the schedule.', severity: 'warning' });
    }

    const tier = body?.retainer.tiers.find(
      (t) => t.label.toLowerCase() === quote.tierLabel?.toLowerCase(),
    );

    if (quote.tierLabel && body && !tier) {
      issues.push({
        field: 'tierLabel',
        message: `"${quote.tierLabel}" is not a tier in the current fee schedule (${body.retainer.tiers.map((t) => t.label).join(', ')}).`,
        severity: 'error',
      });
    }

    if (tier) {
      if (quote.monthlyFee != null && tier.monthlyFee != null && differs(quote.monthlyFee, tier.monthlyFee)) {
        issues.push({
          field: 'monthlyFee',
          message: `The proposal quotes ${money(quote.monthlyFee)} a month; ${tier.label} in the fee schedule is ${money(tier.monthlyFee)}.`,
          severity: 'warning',
        });
      }
      if (quote.retainerHours != null && tier.hours != null && quote.retainerHours !== tier.hours) {
        issues.push({
          field: 'retainerHours',
          message: `The proposal covers ${quote.retainerHours} hours a month; ${tier.label} in the fee schedule covers ${tier.hours}.`,
          severity: 'warning',
        });
      }
    }

    if (body && quote.initialFeeMonths != null && quote.initialFeeMonths !== body.retainer.initialFeeMonths) {
      issues.push({
        field: 'initialFeeMonths',
        message: `The proposal sets the initial fee at ${quote.initialFeeMonths} months of the retainer; the fee schedule says ${body.retainer.initialFeeMonths}.`,
        severity: 'warning',
      });
    }

    // The stated initial fee must equal its own stated multiplier — an
    // arithmetic slip here is never intentional.
    if (quote.initialFee != null && quote.monthlyFee != null && quote.initialFeeMonths != null) {
      const expected = quote.monthlyFee * quote.initialFeeMonths;
      if (differs(quote.initialFee, expected)) {
        issues.push({
          field: 'initialFee',
          message: `The initial fee is stated as ${money(quote.initialFee)}, but ${quote.initialFeeMonths} × ${money(quote.monthlyFee)} is ${money(expected)}.`,
          severity: 'error',
        });
      }
    }
  }

  if (quote.arrangement === 'litigation') {
    if (!quote.caseType) {
      issues.push({ field: 'caseType', message: 'No case type is named, so the acceptance fee cannot be checked against the schedule.', severity: 'warning' });
    }

    const fee = body?.acceptance.fees.find(
      (f) => f.matter.toLowerCase() === quote.caseType?.toLowerCase(),
    );

    if (quote.caseType && body && !fee) {
      issues.push({
        field: 'caseType',
        message: `"${quote.caseType}" is not a matter the current fee schedule prices (${body.acceptance.fees.map((f) => f.matter).join(', ')}).`,
        severity: 'error',
      });
    }

    if (fee && quote.acceptanceFee != null && differs(quote.acceptanceFee, fee.standard)) {
      issues.push({
        field: 'acceptanceFee',
        message: `The proposal quotes an acceptance fee of ${money(quote.acceptanceFee)}; ${fee.matter} in the fee schedule is ${money(fee.standard)}.`,
        severity: 'warning',
      });
    }
  }

  // The completion-fee arithmetic is the same wherever one is quoted.
  if (quote.arrangement === 'acceptance_completion' || quote.arrangement === 'litigation') {
    if (quote.completionFee != null && quote.completionFeePct != null && quote.transactionValue != null) {
      const expected = (quote.transactionValue * quote.completionFeePct) / 100;
      if (differs(quote.completionFee, expected)) {
        issues.push({
          field: 'completionFee',
          message: `The completion fee is stated as ${money(quote.completionFee)}, but ${quote.completionFeePct}% of ${money(quote.transactionValue)} is ${money(expected)}.`,
          severity: 'error',
        });
      }
    }
    if (quote.completionFeePct != null && quote.transactionValue == null) {
      issues.push({
        field: 'transactionValue',
        message: quote.arrangement === 'litigation'
          ? 'A completion fee is quoted as a percentage but no amount at stake is recorded, so the indicative amount cannot be shown.'
          : 'A completion fee is quoted as a percentage but no transaction value is recorded, so the indicative amount cannot be shown.',
        severity: 'warning',
      });
    }
  }

  return issues;
}

/** Derived figures for a tier, so the builder never asks a human to multiply. */
export function retainerFiguresFor(body: ProfessionalBody, tierLabel: string): ProposalQuote | null {
  const tier = body.retainer.tiers.find((t) => t.label.toLowerCase() === tierLabel.toLowerCase());
  if (!tier || tier.monthlyFee == null) return null;
  const months = body.retainer.initialFeeMonths;
  return {
    arrangement: 'retainer',
    tierLabel: tier.label,
    monthlyFee: tier.monthlyFee,
    retainerHours: tier.hours ?? undefined,
    initialFeeMonths: months,
    initialFee: tier.monthlyFee * months,
  };
}

/**
 * The acceptance fee the schedule sets for a contested matter of this kind.
 * Litigation is the one arrangement whose headline figure the schedule states
 * outright, so the drafter picks the case type and the number follows.
 */
export function litigationFiguresFor(body: ProfessionalBody, caseType: string): ProposalQuote | null {
  const fee = body.acceptance.fees.find((f) => f.matter.toLowerCase() === caseType.toLowerCase());
  if (!fee) return null;
  return {
    arrangement: 'litigation',
    caseType: fee.matter,
    acceptanceFee: fee.standard,
  };
}

/** Figures a drafter negotiated for a tier the schedule prices "subject to negotiation". */
export interface CustomRetainerFigures {
  retainerHours?: number;
  monthlyFee?: number;
  initialFeeMonths?: number;
}

/**
 * The quote for a negotiated retainer. The schedule has no figures for the
 * Custom tier by design, so they come from the drafter — and once they are on
 * the quote the scope section's hour cap is filled from them rather than
 * written into the prose by hand.
 */
export function customRetainerFigures(
  tierLabel: string,
  figures: CustomRetainerFigures,
  fallbackInitialFeeMonths?: number,
): ProposalQuote | null {
  const { retainerHours, monthlyFee } = figures;
  if (retainerHours == null && monthlyFee == null) return null;

  const months = figures.initialFeeMonths ?? fallbackInitialFeeMonths;
  return {
    arrangement: 'retainer',
    tierLabel,
    ...(monthlyFee == null ? {} : { monthlyFee }),
    ...(retainerHours == null ? {} : { retainerHours }),
    ...(months == null ? {} : { initialFeeMonths: months }),
    ...(monthlyFee == null || months == null ? {} : { initialFee: monthlyFee * months }),
  };
}
