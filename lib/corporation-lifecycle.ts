import type { Corporation, CorporationStatus } from '@/types/corporations';

/**
 * Statuses a human sets. Everything else is derived from the registration
 * record, so the pill can't drift away from what the firm actually holds.
 */
export const MANUAL_STATUSES: CorporationStatus[] = ['Pre-Incorporation', 'In SEC', 'Dissolved'];

/** Statuses computed from the registration fields — never hand-set. */
export const DERIVED_STATUSES: CorporationStatus[] = ['Registered', 'Active'];

export const ALL_STATUSES: CorporationStatus[] = [
  'Pre-Incorporation',
  'In SEC',
  'Registered',
  'Active',
  'Dissolved',
];

type LifecycleFields = Pick<
  Corporation,
  'status' | 'secRegistrationDate' | 'birCorDate' | 'businessPermitNo' | 'businessPermitIssuedDate'
>;

/**
 * A corporation is operating once it can legally trade: BIR Certificate of
 * Registration issued and a business permit on file.
 *
 * SSS / PhilHealth / Pag-IBIG employer numbers are deliberately NOT part of
 * this test — they only apply once the corporation has employees, so gating
 * on them would leave holding companies and dormant OPCs permanently short of
 * Active. They stay compliance line items, not a lifecycle gate.
 */
export function isPostIncorporationComplete(corp: LifecycleFields): boolean {
  return Boolean(corp.birCorDate) && Boolean(corp.businessPermitNo || corp.businessPermitIssuedDate);
}

/**
 * The status implied by the registration record, or null when the corporation
 * hasn't reached SEC registration yet and the status is the human's to set.
 *
 * Dissolved always wins: it's a fact about the entity that no registration
 * field can contradict.
 */
export function deriveCorporationStatus(corp: LifecycleFields): CorporationStatus | null {
  if (corp.status === 'Dissolved') return 'Dissolved';
  if (!corp.secRegistrationDate) return null;
  return isPostIncorporationComplete(corp) ? 'Active' : 'Registered';
}

/** True when the corporation's status is computed and the dropdown shouldn't offer it. */
export function hasDerivedStatus(corp: LifecycleFields): boolean {
  return deriveCorporationStatus(corp) !== null && corp.status !== 'Dissolved';
}

/**
 * The COR facts required to record a registration. Kept here so the jump
 * modal, the PATCH route, and the COR extractor all agree on what "enough to
 * mark this registered" means.
 */
export interface RegistrationFacts {
  approvedName: string;
  secRegistrationNo: string;
  secRegistrationDate: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function missingRegistrationFacts(facts: Partial<RegistrationFacts>): string[] {
  const missing: string[] = [];
  if (!facts.approvedName?.trim()) missing.push('approved name');
  if (!facts.secRegistrationNo?.trim()) missing.push('SEC registration number');
  if (!facts.secRegistrationDate?.trim()) missing.push('SEC registration date');
  else if (!ISO_DATE.test(facts.secRegistrationDate.trim())) missing.push('a valid SEC registration date');
  return missing;
}

type ChainFields = Pick<
  Corporation,
  | 'clientId'
  | 'engagingClientId'
  | 'isUnderRetainer'
  | 'handlesPostIncorporation'
  | 'handlesHousekeeping'
  | 'incorporationMatterId'
  | 'postIncorporationMatterId'
  | 'housekeepingMatterId'
>;

const andList = (items: string[]) => new Intl.ListFormat('en', { type: 'conjunction' }).format(items);

/**
 * What recording the registration sets off for this corporation, led by
 * `lead` ("Saving …"). Same conditions as runSecApprovalAutoChain
 * (lib/corporations/sec-approval-chain): a corporation engaged by an existing
 * client has no client row to rename, and one under a general retainer gets
 * no matters of its own.
 */
export function registrationEffects(corp: ChainFields, lead: string): string {
  const scoped = [
    corp.handlesPostIncorporation && !corp.postIncorporationMatterId && 'Post-Incorporation',
    corp.handlesHousekeeping && !corp.housekeepingMatterId && 'Housekeeping',
  ].filter((m): m is string => !!m);
  const opens = !corp.isUnderRetainer && !!(corp.clientId ?? corp.engagingClientId) && scoped.length > 0;
  const effects = [
    'marks the corporation Registered',
    corp.incorporationMatterId && 'closes the Incorporation matter',
    corp.clientId && 'renames the client to the approved name',
    opens && `opens the ${andList(scoped)} matter${scoped.length === 1 ? '' : 's'}`,
    'schedules the year-1 GIS, AFS, BIR and business-permit deadlines',
  ].filter((e): e is string => !!e);
  return [
    `${lead} ${andList(effects)}.`,
    !corp.clientId && corp.engagingClientId && 'The engaging client keeps its name — this corporation has no client record of its own.',
    corp.isUnderRetainer && scoped.length > 0 && `${andList(scoped)} work stays under the general retainer, so no separate matter${scoped.length === 1 ? ' is' : 's are'} opened.`,
  ].filter(Boolean).join(' ');
}
