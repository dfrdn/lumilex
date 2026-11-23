import type { Corporation, CorporationFile, CorporationFileCategory, CorporationPerson } from '@/types/corporations';
import { isPostIncorporationComplete } from '@/lib/corporation-lifecycle';

/**
 * The corporate lifecycle as a sequence of stages, each declaring what it needs
 * to be complete.
 *
 * This is derived from the same registration record that drives
 * trg_corporations_derive_status — it is a reading of the data, never a stored
 * checklist, so it cannot drift out of sync with the status pill or be left
 * half-ticked by someone who skipped a step.
 */
export type StageKey = 'pre_incorporation' | 'in_sec' | 'registered' | 'post_incorporation' | 'active';

/** Where the user has to go to satisfy an item. */
export type ItemAction =
  | { kind: 'upload'; category: CorporationFileCategory }
  /** `field` names the input (its data-field) that "Fill in" focuses. */
  | { kind: 'field'; tab: 'overview' | 'people' | 'registrations'; field?: string }
  | { kind: 'record_registration' };

export interface StageItem {
  key: string;
  label: string;
  /** Why it matters — shown when the item is outstanding. */
  detail?: string;
  done: boolean;
  action: ItemAction;
}

export interface Stage {
  key: StageKey;
  label: string;
  items: StageItem[];
  complete: boolean;
}

export interface LifecyclePlan {
  stages: Stage[];
  /** The earliest incomplete stage — what the firm is actually working on. */
  currentStage: Stage | null;
  /** First outstanding item of the current stage. */
  nextItem: StageItem | null;
  outstandingCount: number;
}

interface PlanInput {
  corporation: Corporation;
  files: CorporationFile[];
  people: CorporationPerson[];
}

function hasFile(files: CorporationFile[], category: CorporationFileCategory): boolean {
  return files.some((f) => f.category === category);
}

const filled = (v: unknown): boolean =>
  v !== null && v !== undefined && (typeof v !== 'string' || v.trim() !== '');

/**
 * Build the plan for one corporation.
 *
 * Scope is respected: a corporation the firm doesn't handle post-incorporation
 * for doesn't get chased for a BIR COR it will never see. Dissolved entities
 * get no plan at all — there is nothing left to do.
 */
export function buildLifecyclePlan({ corporation: c, files, people }: PlanInput): LifecyclePlan {
  if (c.status === 'Dissolved') {
    return { stages: [], currentStage: null, nextItem: null, outstandingCount: 0 };
  }

  const registered = filled(c.secRegistrationDate);
  const incorporators = people.filter((p) => p.role === 'Incorporator').length;

  const preIncorporation: StageItem[] = [
    {
      key: 'proposed_name',
      label: 'Proposed corporate name',
      detail: 'At least one name to reserve with SEC.',
      done: c.proposedNames.filter(Boolean).length > 0 || filled(c.approvedName),
      action: { kind: 'field', tab: 'overview', field: 'proposedNames' },
    },
    {
      key: 'company_type',
      label: 'Company type',
      done: filled(c.companyType),
      action: { kind: 'field', tab: 'overview', field: 'companyType' },
    },
    {
      key: 'primary_purpose',
      label: 'Primary purpose',
      detail: 'The purpose clause that goes into the Articles.',
      done: filled(c.primaryPurpose),
      action: { kind: 'field', tab: 'overview', field: 'primaryPurpose' },
    },
    {
      key: 'principal_office',
      label: 'Principal office address',
      done: filled(c.principalOfficeAddress),
      action: { kind: 'field', tab: 'overview', field: 'principalOfficeAddress' },
    },
    {
      key: 'capital',
      label: 'Capital structure',
      detail: 'Authorised capital and par value.',
      done: filled(c.authorizedCapitalStock) && filled(c.parValue),
      action: { kind: 'field', tab: 'overview', field: 'authorizedCapitalStock' },
    },
    {
      key: 'incorporators',
      label: 'Incorporators',
      detail: 'The people who will sign the Articles.',
      done: incorporators > 0,
      action: { kind: 'field', tab: 'overview', field: 'incorporators' },
    },
    {
      key: 'aoi',
      label: 'Articles of Incorporation',
      done: hasFile(files, 'AOI'),
      action: { kind: 'upload', category: 'AOI' },
    },
    {
      key: 'bylaws',
      label: 'By-Laws',
      done: hasFile(files, 'By-Laws'),
      action: { kind: 'upload', category: 'By-Laws' },
    },
  ];

  const inSec: StageItem[] = [
    {
      key: 'esparc_submitted',
      label: 'eSPARC application submitted',
      done: filled(c.esparcSubmittedDate) || filled(c.esparcApplicationNo) || registered,
      action: { kind: 'field', tab: 'overview', field: 'esparcApplicationNo' },
    },
    {
      key: 'filing_receipt',
      label: 'SEC filing receipt',
      done: hasFile(files, 'SEC Filing Receipt') || registered,
      action: { kind: 'upload', category: 'SEC Filing Receipt' },
    },
  ];

  // The one item that carries the whole transition — uploading the certificate
  // reads it and records the registration in one move.
  const registeredItems: StageItem[] = [
    {
      key: 'sec_cor',
      label: 'SEC Certificate of Incorporation',
      detail: 'Upload it and the registration details are read off it automatically.',
      done: registered,
      action: hasFile(files, 'SEC COR')
        ? { kind: 'record_registration' }
        : { kind: 'upload', category: 'SEC COR' },
    },
  ];

  const postIncorporation: StageItem[] = c.handlesPostIncorporation ? postIncorporationItems(c, files) : [];

  const stages: Stage[] = [
    { key: 'pre_incorporation', label: 'Pre-Incorporation', items: preIncorporation, complete: false },
    { key: 'in_sec', label: 'Filed with SEC', items: inSec, complete: false },
    { key: 'registered', label: 'SEC Registration', items: registeredItems, complete: false },
    { key: 'post_incorporation', label: 'Post-Incorporation', items: postIncorporation, complete: false },
  ];

  for (const s of stages) s.complete = s.items.every((i) => i.done);

  // Everything before registration is history once the COR is in — the firm
  // often inherits an already-registered corporation and was never going to
  // hold its Articles or filing receipt.
  if (registered) {
    for (const s of stages) {
      if (s.key === 'pre_incorporation' || s.key === 'in_sec' || s.key === 'registered') s.complete = true;
    }
  }

  // Active isn't a checklist — it's the steady state, and its work lives in the
  // compliance deliverables (GIS, AFS, permit renewals) rather than here.
  if (isPostIncorporationComplete(c)) {
    stages.push({ key: 'active', label: 'Active', items: [], complete: true });
  }

  const currentStage = stages.find((s) => !s.complete) ?? null;
  const nextItem = currentStage?.items.find((i) => !i.done) ?? null;
  const outstandingCount = stages
    .filter((s) => !s.complete)
    .reduce((n, s) => n + s.items.filter((i) => !i.done).length, 0);

  return { stages, currentStage, nextItem, outstandingCount };
}

/**
 * The post-incorporation registrations, whether or not the firm handles them —
 * the status engine lists them greyed for a company whose registrations are
 * someone else's.
 */
export function postIncorporationItems(c: Corporation, files: CorporationFile[]): StageItem[] {
  return [
    {
      key: 'bir_cor',
      label: 'BIR Certificate of Registration',
      detail: 'Carries the TIN and RDO code.',
      done: filled(c.birCorDate),
      action: { kind: 'upload', category: 'BIR COR' },
    },
    {
      key: 'bir_books',
      label: 'Books of account registered',
      done: filled(c.birBooksRegistrationDate),
      action: { kind: 'upload', category: 'BIR Books' },
    },
    {
      key: 'bir_atp',
      label: 'Authority to Print',
      detail: 'Needed before the corporation can issue official receipts.',
      done: filled(c.birOrAuthorityDate),
      action: { kind: 'upload', category: 'Authority to Print' },
    },
    {
      key: 'bir_orus',
      label: 'BIR ORUS enrolment',
      detail: 'The online account used for BIR updates and filings.',
      done: filled(c.birOrusUsername) || filled(c.birOrusEnrolledDate),
      action: { kind: 'field', tab: 'registrations', field: 'birOrusUsername' },
    },
    {
      key: 'business_permit',
      label: 'Business permit',
      detail: "The LGU Mayor's Permit.",
      done: filled(c.businessPermitNo) || filled(c.businessPermitIssuedDate),
      action: { kind: 'upload', category: 'Business Permit' },
    },
    {
      key: 'barangay_clearance',
      label: 'Barangay clearance',
      done: hasFile(files, 'Barangay Clearance'),
      action: { kind: 'upload', category: 'Barangay Clearance' },
    },
    {
      key: 'sanitary_permit',
      label: 'Sanitary permit',
      done: hasFile(files, 'Sanitary Permit'),
      action: { kind: 'upload', category: 'Sanitary Permit' },
    },
    {
      key: 'fire_safety',
      label: 'Fire safety inspection certificate',
      done: hasFile(files, 'Fire Safety Inspection'),
      action: { kind: 'upload', category: 'Fire Safety Inspection' },
    },
    {
      key: 'sss',
      label: 'SSS employer registration',
      done: filled(c.sssEmployerNo),
      action: { kind: 'upload', category: 'SSS R-1' },
    },
    {
      key: 'philhealth',
      label: 'PhilHealth employer registration',
      done: filled(c.philhealthEmployerNo),
      action: { kind: 'upload', category: 'PhilHealth ER1' },
    },
    {
      key: 'pagibig',
      label: 'Pag-IBIG employer registration',
      done: filled(c.pagibigEmployerNo),
      action: { kind: 'upload', category: 'Pag-IBIG EFR' },
    },
    {
      key: 'sec_efast',
      label: 'SEC eFAST enrolment',
      detail: 'Required to file the annual GIS and AFS — enrol before the first deadline.',
      done: filled(c.secEfastUsername) || filled(c.secEfastEnrolledDate),
      action: { kind: 'field', tab: 'registrations', field: 'secEfastUsername' },
    },
    {
      key: 'sec_habor',
      label: 'SEC HABOR enrolment',
      done: filled(c.secHaborUsername) || filled(c.secHaborEnrolledDate),
      action: { kind: 'field', tab: 'registrations', field: 'secHaborUsername' },
    },
  ];
}
