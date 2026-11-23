/**
 * Controlled vocabulary for the document type that file analysis extracts.
 *
 * The model writes free text (145 distinct values over ~4,400 analyzed files:
 * "order", "complaint-affidavit", "letter|notice", "sheriff's return"…), so
 * every facet and filter that groups files by type goes through here rather
 * than showing the raw string.
 */
export const DOCUMENT_TYPES = [
  'Order / Writ',
  'Decision',
  'Resolution',
  'Summons / Subpoena',
  'Pleading',
  'Motion / Manifestation',
  'Affidavit',
  'Letter',
  'Notice',
  'Certificate',
  'Report',
  'Contract / Deed',
  'Power of Attorney',
  'Transcript',
  'Receipt / Payment',
  'Other',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

// First match wins, so compound names sit above the generic word they contain
// ("complaint-affidavit" is an affidavit, "authorization letter" is an
// authority, "pre-trial brief" is a pleading rather than a transcript).
const RULES: ReadonlyArray<readonly [DocumentType, RegExp]> = [
  ['Affidavit', /affidavit|declaration|deposition|verification|sworn statement/],
  ['Power of Attorney', /power of attorney|\bspa\b|authorization|authority/],
  ['Summons / Subpoena', /subpoena|summons|sheriff|officer's return/],
  ['Decision', /decision|judg(e)?ment|ruling/],
  ['Order / Writ', /\border\b|\bwrit\b|warrant/],
  ['Resolution', /resolution/],
  ['Notice', /\bnotice\b/],
  ['Letter', /letter|correspondence|transmittal|indorsement|endorsement|request|response|inquiry|conformity|demand/],
  ['Motion / Manifestation', /motion|manifestation|compliance|entry of appearance|submission|explanation|formal offer|offer of evidence/],
  ['Pleading', /complaint|answer|reply|rejoinder|petition|comment|opposition|position paper|brief|appeal|memorandum|information|pleading/],
  ['Certificate', /certificate|certification|clearance|permit|licen[cs]e/],
  ['Report', /report|minutes|assessment|blotter|statement/],
  ['Contract / Deed', /contract|agreement|addendum|deed|mortgage|settlement|quitclaim|waiver|release|undertaking|\bwill\b|\bbond\b|lease|compromise/],
  ['Transcript', /transcript|stenograph|\btsn\b|trial/],
  ['Receipt / Payment', /receipt|voucher|invoice|\bcheck\b|cheque|payment|\bbill\b|quotation|estimate|disbursement|acknowledg/],
];

/**
 * What a deliverable's `type` means to a reader. The stored values describe
 * the audience (External, Internal, For Client); a header or listing shows the
 * kind of document that implies.
 */
export const DELIVERABLE_TYPE_LABELS: Record<string, string> = {
  'External': 'Pleading',
  'Internal': 'Memo',
  'For Client': 'Client letter',
  'Status Report': 'Status report',
};

export function deliverableTypeLabel(type: string | null | undefined): string {
  const t = (type ?? '').trim();
  if (!t) return 'Other';
  return DELIVERABLE_TYPE_LABELS[t] ?? t;
}

/**
 * Map the analysis's free-text document type onto the controlled vocabulary.
 * Returns null when the analysis recorded nothing, and 'Other' when it
 * recorded something the vocabulary doesn't cover.
 */
export function normalizeDocumentType(raw: string | null | undefined): DocumentType | null {
  if (!raw) return null;
  // The model sometimes lists several kinds ("letter|notice", "report; notice
  // of inquest"). The first is the primary one.
  const primary = raw.split(/[|;/]/)[0]?.trim().toLowerCase().replace(/_/g, ' ') ?? '';
  if (!primary) return null;
  for (const [type, pattern] of RULES) {
    if (pattern.test(primary)) return type;
  }
  return 'Other';
}
