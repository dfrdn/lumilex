/**
 * The roles a visitor to the public demo can sign in as, and the copy the
 * picker shows for each. Pure and client-safe: the login page renders it, and
 * lib/firm/config.ts takes the key set from here for `settings.demo`.
 *
 * Which staff member plays each role is data, not code — `settings.demo.personas`
 * maps a key to a `team.person_id`, written by scripts/demo/build.ts.
 */

/** In the order the picker shows them. */
export const DEMO_PERSONA_KEYS = ['partner', 'lawyer', 'finance', 'admin', 'liaison'] as const;

export type DemoPersonaKey = (typeof DEMO_PERSONA_KEYS)[number];

export function isDemoPersonaKey(value: unknown): value is DemoPersonaKey {
  return typeof value === 'string' && (DEMO_PERSONA_KEYS as readonly string[]).includes(value);
}

export const DEMO_PERSONA_COPY: Record<DemoPersonaKey, { label: string; blurb: string }> = {
  partner: {
    label: 'Partner',
    blurb: 'Matter briefs, the review queue, billing review and firm-wide analytics.',
  },
  lawyer: {
    label: 'Associate',
    blurb: 'Drafts and versions, deadlines, hearings, timekeeping and the Library.',
  },
  finance: {
    label: 'Finance',
    blurb: 'Invoices, collections, deposits, expenses and profitability.',
  },
  admin: {
    label: 'Office admin',
    blurb: 'The firm’s records: clients, matters, files and the admin tables.',
  },
  liaison: {
    label: 'Liaison',
    blurb: 'Errands, filings and court runs, assigned and tracked.',
  },
};
