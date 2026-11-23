// Source-of-truth taxonomy for PH legal issuances.
// Used by:
// - UI filter chips in components/issuances/IssuancesPage.tsx
// - The /api/issuances validation layer (POST + scrape-batch)
// - The scheduled remote agent (routine) prompts — each routine references
//   exactly one source's entry here when listing valid `type` values.

export type SourceKey =
  | 'sc' | 'doj' | 'bir' | 'sec' | 'bsp' | 'ipo' | 'npc' | 'amlc';

export interface SourceMeta {
  key: SourceKey;
  label: string;
  shortLabel: string;
  url: string;
  /** When true, the scraper is currently disabled — UI surfaces a manual-add hint. */
  scrapingDisabled?: boolean;
}

export const SOURCES: Record<SourceKey, SourceMeta> = {
  sc:   {
    key: 'sc',
    label: 'Supreme Court',
    shortLabel: 'SC',
    url: 'https://sc.judiciary.gov.ph/decisions-and-resolutions/',
    // The decisions/resolutions listing is rendered client-side (a plain scrape
    // returns only nav chrome) and there's no clean per-issuance index. Needs
    // Firecrawl browser actions or a different endpoint before enabling.
    scrapingDisabled: true,
  },
  doj:  {
    key: 'doj',
    label: 'Department of Justice',
    shortLabel: 'DOJ',
    url: 'https://www.doj.gov.ph/issuances.html',
  },
  bir:  {
    key: 'bir',
    label: 'Bureau of Internal Revenue',
    shortLabel: 'BIR',
    url: 'https://www.bir.gov.ph/home',
  },
  sec:  {
    key: 'sec',
    label: 'Securities and Exchange Commission',
    shortLabel: 'SEC',
    url: 'https://www.sec.gov.ph/',
  },
  bsp:  {
    key: 'bsp',
    label: 'Bangko Sentral ng Pilipinas',
    shortLabel: 'BSP',
    url: 'https://www.bsp.gov.ph/Pages/Regulations/BSPIssuances/PublishedIssuances.aspx',
    // SharePoint-rendered: the issuance list loads via JS and is also published
    // as yearly .xlsx files. A plain scrape returns only page chrome. Needs an
    // XLSX-ingest path (we already have exceljs) before this can be enabled.
    scrapingDisabled: true,
  },
  ipo:  {
    key: 'ipo',
    label: 'Intellectual Property Office',
    shortLabel: 'IPOPHL',
    url: 'https://www.ipophil.gov.ph/administrative-issuances',
  },
  npc:  {
    key: 'npc',
    label: 'National Privacy Commission',
    shortLabel: 'NPC',
    url: 'https://privacy.gov.ph/',
  },
  amlc: {
    key: 'amlc',
    label: 'Anti-Money Laundering Council',
    shortLabel: 'AMLC',
    url: 'http://www.amlc.gov.ph/laws/amlc-issuances',
    // Listing is scattered across news/announcement paths with no clean index
    // page; the obvious /amlc-resolutions URL 404s. Needs per-page discovery
    // before this can be enabled.
    scrapingDisabled: true,
  },
};

export const SOURCE_KEYS = Object.keys(SOURCES) as SourceKey[];

/** Issuance type taxonomy per source. The routine prompt must use one of these
 * exact strings so server-side dedup via UNIQUE(source, type, number) works. */
export const TYPE_TAXONOMY: Record<SourceKey, string[]> = {
  sc:   ['Decision', 'Resolution', 'A.M.', 'Bar Matter', 'OCA Circular'],
  doj:  ['Department Circular', 'Department Order', 'Memorandum Circular', 'Opinion'],
  bir:  [
    'Revenue Regulation',
    'Revenue Memorandum Circular',
    'Revenue Memorandum Order',
    'Revenue Administrative Order',
    'Revenue Delegation Authority Order',
  ],
  sec:  ['Memorandum Circular', 'Opinion', 'Notice', 'Resolution'],
  bsp:  ['Circular', 'Memorandum', 'Circular-Letter'],
  ipo:  ['Memorandum Circular', 'Office Order', 'Advisory'],
  npc:  ['Advisory Opinion', 'NPC Circular', 'Advisory'],
  amlc: ['Resolution', 'Advisory', 'Guidelines'],
};

/** Practice-area tags. Free-form `tags[]` stays open-ended; this list drives
 * the filter chip group so practice classification is consistent. */
export const PRACTICE_AREAS = [
  'tax',
  'corporate',
  'banking',
  'capital-markets',
  'intellectual-property',
  'data-privacy',
  'aml',
  'criminal',
  'civil',
  'labor',
  'litigation',
  'administrative',
  'family',
  'immigration',
  'real-estate',
  'energy',
  'environment',
  'admiralty',
] as const;

export type PracticeArea = (typeof PRACTICE_AREAS)[number];

export function isValidSource(s: string): s is SourceKey {
  return s in SOURCES;
}

export function isValidType(source: SourceKey, type: string): boolean {
  return TYPE_TAXONOMY[source].includes(type);
}
