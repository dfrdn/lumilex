/**
 * Figure-free fee-schedule skeletons: the four slugs the app reasons about, with
 * their page structure, headings, and the statutory Philippine boilerplate every
 * firm's schedule carries — and not one price.
 *
 * This is the seed-pack module that has to exist rather than being a
 * convenience. `loadFeeSchedules()` used to layer saved rows over
 * `lib/fee-schedule/default.ts` **per slug**, and that file held one real firm's
 * 2026 rate card — so a firm with no `fee_schedules` rows quoted, and bound as
 * Annex "A", another firm's prices. That file is deleted and the loader now
 * throws; these rows are what a firm actually starts from, here and in the
 * fee-schedule CMS.
 *
 * Nothing here is priced, and deliberately so:
 *   - `tiers` carry `hours: null, monthlyFee: null`, so `pricedTiers()` returns
 *     nothing and the proposal's fee section cannot quote a figure the firm has
 *     never set. A tier seeded at 0 would be quotable, and would quote zero.
 *   - `rates` and `fees` are empty for the same reason: `PositionRate.standard`
 *     is a required number, so the only honest placeholder is no row at all.
 *   - the IP schedules ship their column headers and no groups.
 *
 * The cover is letterhead, so it stays blank — the admin fills it in under
 * Admin → Fee schedules.
 */

import type { FeeScheduleContent } from '@/lib/fee-schedule/types';
import type { FeeScheduleSeed } from './types';

const YEAR = String(new Date().getFullYear());

const UNSET_TIER_NOTE = 'Not set — price this tier in Admin → Fee schedules';

function cover(title: string, subtitle: string): FeeScheduleContent['cover'] {
  return {
    firmName: '',
    title,
    subtitle,
    edition: `${YEAR} Edition`,
    footnote: 'Philippines  |  Strictly Confidential',
    addressLines: [],
    email: '',
    website: '',
    phone: '',
  };
}

/** 12% VAT is statute, not a firm's commercial position. */
const VAT_NOTE = {
  label: 'Professional Fees',
  text: 'Professional fees quoted are exclusive of the applicable 12% value-added tax (VAT).',
};

const DISBURSEMENTS_NOTE = {
  label: 'Disbursements',
  text:
    'Service fees exclude administrative disbursements — official filing and registration fees, ' +
    'bank charges, courier and mailing, printing, and notarization — which are billed at cost.',
};

const PROFESSIONAL: FeeScheduleContent = {
  slug: 'professional',
  name: 'Professional Fee Schedule',
  runningTitle: 'Professional Fee Schedule',
  year: YEAR,
  cover: cover('Fee Schedule', 'Retainer  ·  Hourly  ·  Acceptance Fees'),
  body: {
    kind: 'professional',
    intro:
      'This schedule sets out the Firm’s standard professional fees. It accompanies the Firm’s ' +
      'engagement proposal and forms an integral part of it.',
    retainer: {
      heading: 'Monthly Retainer Fees',
      paragraphs: [
        'The Firm offers fixed monthly retainer packages for clients requiring ongoing legal ' +
          'advisory support. Each tier includes a monthly cap of legal service hours and a ' +
          'corresponding discount on the Firm’s hourly rates. The hourly rates apply once the ' +
          'monthly cap of legal service hours is reached.',
      ],
      // The Initial Fee is a multiple of the monthly retainer; with no tier
      // priced there is nothing to multiply, and 0 keeps it from asserting a
      // commitment period the firm has not chosen.
      initialFeeMonths: 0,
      tiers: [
        { label: 'Tier I', hours: null, monthlyFee: null, discountPct: null, note: UNSET_TIER_NOTE },
        { label: 'Tier II', hours: null, monthlyFee: null, discountPct: null, note: UNSET_TIER_NOTE },
        { label: 'Tier III', hours: null, monthlyFee: null, discountPct: null, note: UNSET_TIER_NOTE },
        { label: 'Custom', hours: null, monthlyFee: null, discountPct: null, note: 'Subject to negotiation' },
      ],
    },
    hourly: {
      heading: 'Hourly Rates',
      paragraphs: [
        'For matters billed on a time basis, the following hourly rates apply. Clients on a ' +
          'monthly retainer are billed at the discounted rate corresponding to their retainer tier.',
      ],
      rates: [],
    },
    acceptance: {
      heading: 'Acceptance Fees',
      paragraphs: [
        'Acceptance fees are one-time fees payable upon engagement for the matters listed below, ' +
          'and are separate from the fees for services rendered.',
      ],
      fees: [],
    },
  },
  notesHeading: 'Notes',
  notes: [VAT_NOTE, DISBURSEMENTS_NOTE],
  footnotes: [],
};

function ipSchedule(
  slug: string,
  name: string,
  subtitle: string,
  serviceColumnLabel: string,
): FeeScheduleContent {
  return {
    slug,
    name,
    runningTitle: name,
    year: YEAR,
    cover: cover('Fee Schedule', subtitle),
    body: {
      kind: 'table',
      intro: '',
      columns: [
        { label: serviceColumnLabel, flex: 3, align: 'left' },
        { label: 'Professional Fee', flex: 1, align: 'center' },
        { label: 'Official Fee', flex: 1, align: 'center' },
      ],
      groups: [],
    },
    notesHeading: 'Notes',
    notes: [VAT_NOTE, DISBURSEMENTS_NOTE],
    footnotes: [],
  };
}

export const SEED_FEE_SCHEDULES: FeeScheduleSeed[] = [
  PROFESSIONAL,
  ipSchedule('trademark', 'Trademark Fee Schedule', 'Trademark Prosecution', 'Service'),
  ipSchedule(
    'patent',
    'Patent Fee Schedule',
    'Inventions  ·  Utility Models  ·  Industrial Designs',
    'Service',
  ),
  ipSchedule('copyright', 'Copyright Fee Schedule', 'Enrolment  ·  Recordation', 'Service'),
].map((content, index) => ({
  slug: content.slug,
  name: content.name,
  is_active: true,
  sort_order: index,
  content,
}));
