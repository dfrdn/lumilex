import type { Corporation } from '@/types/corporations';
import { companyName } from './obligations';

/**
 * A company's registrations, done as tasks on it (`tasks.subject_id`,
 * `tasks.corporation_step`). A registration is an errand at an agency — the
 * papers go in, the agency grants it — with nothing to draft or review, so it
 * is a task and not a deliverable, like the business permit
 * ([permit-task.ts](./permit-task.ts)). Recording the registration on the
 * company closes its open task (`20261031_corporation_step_tasks.sql`).
 */
export const CORPORATION_STEPS = [
  'sec_registration', 'bir_registration', 'bir_books', 'bir_atp', 'business_permit', 'sss', 'philhealth', 'pagibig',
] as const;
export type CorporationStep = (typeof CORPORATION_STEPS)[number];

/** The steps a person starts by hand. The permit's task is spawned on its own (`spawnBusinessPermitTask`). */
export const STARTABLE_STEPS = [
  'sec_registration', 'bir_registration', 'bir_books', 'bir_atp', 'sss', 'philhealth', 'pagibig',
] as const satisfies readonly CorporationStep[];
export type StartableStep = (typeof STARTABLE_STEPS)[number];

export const isCorporationStep = (v: unknown): v is CorporationStep =>
  typeof v === 'string' && (CORPORATION_STEPS as readonly string[]).includes(v);

interface StepSpec {
  /** What the work is called. */
  label: string;
  /** The date on the company that records the registration. */
  recorded: (c: Corporation) => string | null;
}

const STEPS: Record<CorporationStep, StepSpec> = {
  sec_registration: { label: 'SEC registration', recorded: (c) => c.secRegistrationDate },
  bir_registration: { label: 'BIR registration (Form 1903)', recorded: (c) => c.birCorDate },
  bir_books: { label: 'Registration of books of accounts', recorded: (c) => c.birBooksRegistrationDate },
  bir_atp: { label: 'Authority to Print', recorded: (c) => c.birOrAuthorityDate },
  business_permit: { label: 'Business permit', recorded: (c) => c.businessPermitIssuedDate },
  sss: { label: 'SSS employer registration', recorded: (c) => c.sssRegistrationDate },
  philhealth: { label: 'PhilHealth employer registration', recorded: (c) => c.philhealthRegistrationDate },
  pagibig: { label: 'Pag-IBIG employer registration', recorded: (c) => c.pagibigRegistrationDate },
};

export const stepLabel = (step: CorporationStep): string => STEPS[step].label;

export interface CorporationStepOption {
  step: StartableStep;
  label: string;
}

/**
 * The registrations a task can be started for now: SEC before the company is
 * registered, the rest after, each until it is recorded. Steps with an open
 * task (`open`) are left out.
 */
export function stepOptions(c: Corporation, open: string[] = []): CorporationStepOption[] {
  const out: CorporationStepOption[] = [];
  for (const step of STARTABLE_STEPS) {
    if (open.includes(step)) continue;
    if (step !== 'sec_registration' && !c.secRegistrationDate) continue;
    if (!STEPS[step].recorded(c)) out.push({ step, label: stepLabel(step) });
  }
  return out;
}

/** The task's name: the work, then the company — several companies can share a matter. */
export function stepTaskName(c: Corporation, step: CorporationStep): string {
  return `${stepLabel(step)} — ${companyName(c) || 'Company'}`;
}

/** The engagement the work is done under: incorporation for SEC; post-incorporation, then the retainer, for the rest. */
export function matterForStep(step: CorporationStep, c: Corporation): string | null {
  const order = step === 'sec_registration'
    ? [c.incorporationMatterId, c.retainerMatterId]
    : [c.postIncorporationMatterId, c.retainerMatterId, c.housekeepingMatterId];
  return order.find((m): m is string => !!m) ?? c.effectiveBillingMatterId;
}

/**
 * Who a company's task goes to: the team on the matter it hangs off, or — on
 * a matter with no team yet — `fallback`, so the task never goes unowned.
 */
export function matterTeamOr(team: string[] | null | undefined, fallback: string | string[]): string[] {
  const members = (team ?? []).filter(Boolean);
  return members.length > 0 ? members : (Array.isArray(fallback) ? fallback : [fallback]).filter(Boolean);
}
