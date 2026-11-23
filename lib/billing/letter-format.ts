/**
 * Date formatting for billing letters. The firm's house style is `DD Month YYYY`
 * (e.g. "08 June 2026") — day-first, zero-padded day, full month name. Every
 * date that surfaces in a billing letter (letter date, due date, engagement
 * date, "as of" labels, revision notices) goes through here so they all match.
 */

const MANILA = 'Asia/Manila';

/** Greeting used when no salutation is configured on the matter / invoice. */
export const DEFAULT_SALUTATION = 'Gentlemen/Mesdames:';

/**
 * Format a Date as `DD Month YYYY` in the firm's timezone (Asia/Manila).
 *
 * Built from individual `en-US` parts rather than a single `toLocaleDateString`
 * call so the ordering is always day-first regardless of the runtime's ICU
 * locale data, and the day is reliably zero-padded.
 */
export function formatLetterDate(date: Date = new Date()): string {
  const day = date.toLocaleString('en-US', { day: '2-digit', timeZone: MANILA });
  const month = date.toLocaleString('en-US', { month: 'long', timeZone: MANILA });
  const year = date.toLocaleString('en-US', { year: 'numeric', timeZone: MANILA });
  return `${day} ${month} ${year}`;
}

/**
 * The "previous balance" label carried onto the next letter — e.g.
 * "outstanding balance for periods through 31 May 2026", or "advance deposit on
 * file as of 09 June 2026" for an advance-deposit credit. `asOf` is the date the
 * balance is measured at (today's date is used when absent). The phrasing is
 * derived from the SIGNED `balance` (negative = advance-deposit credit) so
 * callers can't forget to flag the credit case.
 *
 * The outstanding case says "for periods through" rather than "as of" because
 * the figure is a roll-up of billed PERIODS, and the firm routinely issues an
 * invoice one or two months after the period it covers. A June letter carrying
 * April's opening plus a May invoice sent in June totals what is owed for work
 * through May — but that amount was not yet outstanding on 31 May, so "as of"
 * would overstate the balance on the date it names. A deposit keeps "as of": it
 * is a recorded trust balance on a date, not accrued over periods.
 */
export function formatBalanceLabel(
  asOf: string | null | undefined,
  balance: number,
): string {
  const date = formatLetterDate(asOf ? new Date(asOf) : new Date());
  return balance < 0
    ? `advance deposit on file as of ${date}`
    : `outstanding balance for periods through ${date}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/**
 * Normalize a date-ish string to `DD Month YYYY`. ISO dates / timestamps
 * (e.g. "2026-06-08" straight from a date column) are reformatted; anything the
 * user typed as free text ("14 August 2023") is left untouched so we never
 * mangle a value we can't confidently parse.
 */
export function normalizeLetterDate(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!ISO_DATE.test(trimmed)) return trimmed;
  // A bare YYYY-MM-DD parses as UTC midnight; anchor it explicitly to Manila
  // (+08:00) so the calendar day is stable when formatted back in Manila,
  // regardless of the server's own timezone.
  const d = new Date(trimmed.length === 10 ? `${trimmed}T00:00:00+08:00` : trimmed);
  if (isNaN(d.getTime())) return trimmed;
  return formatLetterDate(d);
}

/**
 * What a sent invoice is for, in the words its letter used: the billing month
 * ("October 2026"), or an off-cycle invoice's own label ("Acceptance Fee").
 * Email subjects and reminders read it so they name the same thing the letter
 * does.
 */
export function invoicePeriodDisplay(inv: { billing_month: string; billing_settings?: Record<string, unknown> | null }): string {
  const label = inv.billing_settings?.billingPeriodLabel;
  if (typeof label === 'string' && label.trim()) return label.trim();
  const [year, mon] = inv.billing_month.split('-');
  return new Date(parseInt(year), parseInt(mon) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
