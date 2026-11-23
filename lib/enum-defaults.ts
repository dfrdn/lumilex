/**
 * The client-safe half of lib/enum-options.ts: the bootstrap option lists,
 * importable from client components without pulling the firm-scoped service
 * client into the browser bundle. lib/enum-options.ts re-exports both.
 */

/**
 * Bootstrap fallback. Mirrors the seeded rows in
 * supabase/migrations/20260522_create_enum_options.sql. Used when DB
 * fetch fails or returns an empty list for a given group, so a stale
 * client cache or transient outage never produces an empty dropdown.
 */
export const DEFAULTS: Record<string, Record<string, string[]>> = {
  matters: {
    type: ['Retainer', 'Litigation', 'Labor', 'Special Project', 'Tax', 'Immigration', 'Incorporation', 'Post-Incorporation', 'Corporate Housekeeping', 'Intellectual Property'],
  },
  deliverables: {
    type: ['Internal', 'External', 'For Client', 'Status Report'],
    subtype: ['Judicial Affidavit', 'Complaint', 'Answer', 'Reply', 'Motion', 'Comment/Opposition', 'Position Paper', 'Memorandum', 'Manifestation', 'Petition', 'Pre-Trial Brief', 'Demand Letter', 'Contract/Agreement', 'Notice', 'Compliance', 'Other'],
  },
  meetings: {
    type: ['Internal Discussion', 'Client Meeting', 'Court Appearance', 'Hearing', 'Conference', 'Deposition', 'Mediation', 'Other'],
  },
  hearings: {
    type: ['Initial Hearing', 'Pre-Trial', 'Trial', 'Promulgation', 'Motion Hearing'],
  },
  files: {
    origin: ['Court', 'Client', 'Firm', 'Respondent', 'Complainant', 'Petitioner', 'Plaintiff', 'Defendant', 'Accused'],
  },
  trademarks: {
    type: ['Wordmark', 'Combined', 'Device'],
  },
  ph_holidays: {
    type: ['regular', 'special_non_working', 'special_working'],
  },
  leaves: {
    leave_type: ['Vacation Leave', 'Sick Leave', 'Emergency Leave', 'Personal Leave'],
  },
  feedbacks: {
    type: ['Grievance', 'Inquiry', 'Request', 'Suggestion', 'General'],
  },
  reimbursements: {
    expense_category: ['Transportation', 'Filing Fees', 'Meals', 'Supplies', 'Postage', 'Printing', 'Other'],
  },
  firm_expenses: {
    category: ['Rent', 'Payroll', 'Utilities', 'Software', 'Taxes', 'Professional Fees', 'Office Supplies', 'Bank Charges', 'Other'],
  },
};

export function getDefaultValues(entity: string, field: string): string[] {
  return DEFAULTS[entity]?.[field] ?? [];
}
