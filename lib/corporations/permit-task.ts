import type { SupabaseClient } from '@supabase/supabase-js';
import type { Corporation } from '@/types/corporations';
import { effectiveBillingMatterId } from '@/lib/corporation-row';
import { TASK_STATUS } from '@/lib/task-status';
import { matterTeamOr } from './step-tasks';

/**
 * The LGU business permit, tracked as a task rather than a deliverable.
 *
 * The firm doesn't produce a Mayor's Permit — it files an application and the
 * LGU issues the permit. There is no draft, no review, no signature and no
 * work product, so the deliverable machinery has nothing to act on; a permit
 * filed as one had to be exempted from the Efficient Use of Paper Rule just to
 * sit there. What the obligation actually needs is a due date, an owner, a
 * reminder and somewhere to talk about it, which is a task.
 *
 * The permit document itself already has a home: the Post-Incorporation
 * checklist uploads it to `corporation_files` under category "Business
 * Permit", and the number and dates are columns on `corporations`.
 */

/**
 * Working target for the initial Mayor's Permit, counted from SEC
 * registration. Not a statutory clock — no national rule sets one; the LGU
 * simply requires the permit before the corporation commences business, and
 * RA 11032 governs the LGU's processing time rather than the applicant's. The
 * firm resets the date once the barangay clearance and lease are in hand.
 */
const INITIAL_PERMIT_TARGET_DAYS = 30;

/** Working target for chasing down a permit the firm holds but never recorded. */
const RECORD_PERMIT_TARGET_DAYS = 14;

/**
 * Past this age, a corporation with no permit on record is read as a blank
 * record rather than a missing permit.
 *
 * A firm onboards corporations that have been trading for years — one
 * registered two decades ago plainly holds a permit; nobody has typed the
 * number in. Dating an "initial application" to registration
 * for those produced deadlines in 2006. Inside the first year the opposite
 * reading is the right one: the corporation is new and the permit really may
 * not exist yet.
 */
const INHERITED_AFTER_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

export type PermitStage = 'initial' | 'record' | 'renewal';

export interface BusinessPermitTask {
  /** Stable per corporation + stage, so re-running the spawn can't duplicate. */
  key: string;
  stage: PermitStage;
  name: string;
  dueDate: string; // YYYY-MM-DD
  priority: 'High' | 'Medium' | 'Low';
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toISO(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function filled(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Whether an LGU permit is on record. Mirrors the `business_permit` item on
 * the Post-Incorporation checklist (lib/corporations/stages.ts) so the two
 * surfaces can't disagree about whether the corporation holds one.
 */
export function hasBusinessPermit(corp: Corporation): boolean {
  return filled(corp.businessPermitNo) || filled(corp.businessPermitIssuedDate);
}

/**
 * The permit obligation that is actually next.
 *
 * Three shapes, because a blank permit field means two different things. A
 * freshly registered corporation has nothing to renew — its first LGU step is
 * the initial application. One the firm inherited years ago is not missing a
 * permit, it is missing the record of one. And once a permit is on file the
 * renewal takes over.
 *
 * Generating "Business Permit Renewal" for all three read as though the permit
 * already existed, and left whatever was genuinely outstanding with no due
 * date, no assignee and no reminder: it existed only as a checkbox on the
 * Post-Incorporation checklist.
 */
export function computeBusinessPermitTask(corp: Corporation): BusinessPermitTask | null {
  const regDate = corp.secRegistrationDate;
  if (!regDate) return null;

  // Every name carries the corporation: several corporations can share one
  // billing matter, and a task list grouped by matter would otherwise show
  // identical rows with no way to tell whose obligation each one is.
  const who = corp.approvedName ?? corp.proposedNames[0] ?? 'Corporation';

  if (hasBusinessPermit(corp)) {
    // LGU permits are calendar-year: one covers the year it was issued in and
    // lapses on 31 December, whenever in that year it was granted. So the
    // issue date is what fixes the renewal, and the expiry column is only a
    // fallback for a permit recorded without one. Reading expiry first looked
    // safer and was worse — several rows hold issue + 1 year rather than a
    // date off the permit, which pushed the renewal a full year late.
    const anchor = corp.businessPermitIssuedDate ?? corp.businessPermitExpiryDate ?? regDate;
    const renewalYear = new Date(anchor).getUTCFullYear() + 1;
    return {
      key: `renewal-${renewalYear}`,
      stage: 'renewal',
      name: `Business Permit Renewal — ${who} (${renewalYear})`,
      dueDate: `${renewalYear}-01-20`, // LGC §167: first twenty days of January
      priority: 'High',
    };
  }

  const reg = new Date(regDate);
  const inherited = Date.now() - reg.getTime() > INHERITED_AFTER_DAYS * DAY_MS;

  if (inherited) {
    const due = new Date(Date.now() + RECORD_PERMIT_TARGET_DAYS * DAY_MS);
    return {
      key: 'record',
      stage: 'record',
      name: `Confirm and record business permit — ${who}`,
      dueDate: toISO(due),
      priority: 'Medium',
    };
  }

  const due = new Date(reg);
  due.setUTCDate(due.getUTCDate() + INITIAL_PERMIT_TARGET_DAYS);
  return {
    key: 'initial',
    stage: 'initial',
    name: `Initial Business Permit (Mayor's Permit) — ${who}`,
    dueDate: toISO(due),
    priority: 'High',
  };
}

/**
 * Create the corporation's outstanding permit task. Returns the task's id, or
 * null when there was nothing to create.
 *
 * Idempotent by construction: `notion_id` is the tasks primary key and is
 * derived from the corporation and the stage, so the three paths that call
 * this (corporation POST for an already-incorporated entry, the SEC approval
 * chain, and the PATCH that first records a permit) can all run without
 * duplicating. The deliverable spawn learned this the hard way — one
 * corporation ended up with two complete copies of its year-1 deadlines six
 * minutes apart.
 */
export async function spawnBusinessPermitTask(
  corp: Corporation,
  supabase: SupabaseClient,
  firmId: string,
  /** Who the task goes to when the matter has no team — usually the creator. */
  fallback: string | string[],
): Promise<string | null> {
  const task = computeBusinessPermitTask(corp);
  if (!task) return null;

  const matterId = effectiveBillingMatterId(corp);
  if (!matterId) {
    console.warn('[permit-task] No effective billing matter for corp', corp.id);
    return null;
  }

  const { data: matter } = await supabase
    .from('matters')
    .select('name, team_person_ids')
    .eq('notion_id', matterId)
    .maybeSingle();
  const assigneeIds = matterTeamOr(matter?.team_person_ids as string[] | null, fallback);

  const notionId = `temp-corp-permit-${corp.id}-${task.key}`;
  const { error } = await supabase.from('tasks').insert({
    firm_id: firmId,
    notion_id: notionId,
    notion_url: '',
    name: task.name,
    matter_id: matterId,
    matter_name: (matter?.name as string) ?? '',
    subject_id: corp.id,
    corporation_step: 'business_permit',
    due_date: task.dueDate,
    status: TASK_STATUS.NOT_STARTED,
    priority: task.priority,
    done: false,
    assignee_ids: assigneeIds,
    notes: '',
    created_time: new Date().toISOString(),
  });

  if (error) {
    // 23505 is the primary-key conflict: the task is already there, which is
    // the whole point of the deterministic id.
    if (error.code === '23505') return notionId;
    console.error('[permit-task] insert failed', error);
    return null;
  }
  return notionId;
}
