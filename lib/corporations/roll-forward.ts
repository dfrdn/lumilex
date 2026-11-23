import type { SupabaseClient } from '@supabase/supabase-js';
import type { Corporation } from '@/types/corporations';
import { fetchAllRows } from '@/lib/supabase-paginate';
import { effectiveBillingMatterId, rowToCorporation } from '@/lib/corporation-row';
import { yearOf } from '@/lib/corporations/filing-history';
import { computeBusinessPermitTask, spawnBusinessPermitTask } from '@/lib/corporations/permit-task';
import {
  DELIVERABLE_OBLIGATIONS,
  OBLIGATIONS,
  deliverableName,
  dueDateInfo,
  firmHandles,
  firstFiscalYear,
  fiscalYearOf,
  obligationOfDeliverable,
  type DeliverableObligation,
  type FilingCalendarEntry,
} from '@/lib/corporations/obligations';
import { loadFilingCalendar } from '@/lib/corporations/filing-calendar';
import { manilaToday } from '@/lib/corporations/status';
import { CORPORATION_SELECT } from '@/lib/corporations/matter-links';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';

/**
 * Keep every company's next filing on the board.
 *
 * For each recurring deliverable obligation the firm files for the company
 * (its `firmFiles` switches: GIS, AFS, ITR) the next period still to fall due
 * must exist as a deliverable; when it doesn't, raise it. The business-permit
 * renewal task follows its own switch.
 * Missed past periods are not back-filled — the status engine shows them as
 * overdue with no record, which is the truth, rather than inventing a row
 * dated years ago.
 *
 * A period that exists in any status, Archived included, counts as present:
 * archiving is how someone says "not this one", and re-raising it every night
 * would overrule them.
 */

export interface ComplianceDeliverableLite {
  type: string;
  name: string;
  externalDueDate: string | null;
  status: string;
}

export interface PlannedFiling {
  obligation: DeliverableObligation;
  fy: number;
  name: string;
  type: string;
  dueDate: string;
  /** The year's deadline isn't in the filing calendar yet; projected. */
  provisional: boolean;
}

/** Annual meetings actually held, by the fiscal year they report on. */
export type HeldMeetings = Map<number, string>;

export function planRollForward(
  corp: Corporation,
  existing: ComplianceDeliverableLite[],
  today: string,
  heldMeetings: HeldMeetings = new Map(),
  calendar: FilingCalendarEntry[] = [],
): PlannedFiling[] {
  if (corp.status === 'Dissolved' || !corp.secRegistrationDate) return [];
  const fy0 = firstFiscalYear(corp);
  if (fy0 === null) return [];

  const present = new Set<string>();
  for (const d of existing) {
    const key = obligationOfDeliverable(d);
    const fy = yearOf({ notionId: '', name: d.name, type: d.type, externalDueDate: d.externalDueDate, status: d.status });
    if (key && fy !== null) present.add(`${key}|${fy}`);
  }

  const out: PlannedFiling[] = [];
  const start = Math.max(fy0, fiscalYearOf(corp, today) - 2);
  for (const key of DELIVERABLE_OBLIGATIONS) {
    if (!firmHandles(corp, key)) continue;
    for (let fy = start; fy <= start + 4; fy++) {
      const info = dueDateInfo(key, fy, { corporation: corp, heldAnnualMeeting: heldMeetings.get(fy) ?? null, calendar });
      const due = info.date;
      if (!due || due < today) continue;
      if (!present.has(`${key}|${fy}`)) {
        out.push({
          obligation: key,
          fy,
          name: deliverableName(key, corp, fy),
          type: OBLIGATIONS[key].deliverableType!,
          dueDate: due,
          provisional: info.provisional,
        });
      }
      break; // only the next period still to fall due
    }
  }
  return out;
}

// ── Runner ─────────────────────────────────────────────────────────────────

export interface RollForwardEntry {
  corporationId: string;
  corporation: string;
  matterId: string | null;
  matterName: string | null;
  assignees: string[];
  filings: PlannedFiling[];
  permit: { name: string; dueDate: string } | null;
  /** Why nothing could be raised, when that is the case. */
  skipped?: string;
}

export interface RollForwardResult {
  dryRun: boolean;
  today: string;
  created: number;
  entries: RollForwardEntry[];
}

const COMPLIANCE_TYPES = ['SEC GIS', 'SEC AFS', 'BIR Filing', 'Other Compliance'];

/**
 * Plan (and unless `dryRun`, raise) the next filings for every registered
 * company the firm carries. The firm-scoped service client — this runs from a
 * cron, once per firm.
 *
 * New filings go to the company's billing matter and are assigned to that
 * matter's team, who are notified by the deliverable insert trigger.
 */
export async function rollForwardObligations(
  supabase: SupabaseClient,
  firmId: string,
  opts: { dryRun: boolean; today?: string },
): Promise<RollForwardResult> {
  const today = opts.today ?? manilaToday();

  // Every page of companies (PostgREST stops at 1,000 rows without saying so),
  // then the rest in batches small enough for an `in (...)` filter.
  const corpRows = await fetchAllRows<Record<string, unknown>>((from, to) =>
    supabase
      .from('corporations')
      .select(CORPORATION_SELECT)
      .not('sec_registration_date', 'is', null)
      .neq('status', 'Dissolved')
      .order('id')
      .range(from, to),
  );
  const allCorps = corpRows.map((r) => rowToCorporation(r)).filter((c) => c.firmFiles.length > 0);
  const calendar = await loadFilingCalendar(supabase);
  const entries: RollForwardEntry[] = [];
  let created = 0;

  for (let i = 0; i < allCorps.length; i += BATCH) {
    const result = await rollForwardBatch(supabase, firmId, allCorps.slice(i, i + BATCH), { dryRun: opts.dryRun, today, calendar });
    entries.push(...result.entries);
    created += result.created;
  }
  return { dryRun: opts.dryRun, today, created, entries };
}

const BATCH = 100;

async function rollForwardBatch(
  supabase: SupabaseClient,
  firmId: string,
  corps: Corporation[],
  opts: { dryRun: boolean; today: string; calendar: FilingCalendarEntry[] },
): Promise<{ created: number; entries: RollForwardEntry[] }> {
  const { today, calendar } = opts;
  const corpIds = corps.map((c) => c.id);
  const matterIds = [...new Set(corps.map(effectiveBillingMatterId).filter((m): m is string => !!m))];

  const [delRows, meetingRows, { data: matterRows }] = await Promise.all([
    fetchAllRows<Record<string, unknown>>((from, to) =>
      supabase
        .from('deliverables')
        .select('notion_id, subject_id, matter_id, type, name, external_due_date, status')
        .in('subject_id', corpIds)
        .in('type', COMPLIANCE_TYPES)
        .order('notion_id')
        .range(from, to),
    ),
    fetchAllRows<Record<string, unknown>>((from, to) =>
      supabase
        .from('corporation_meetings')
        .select('id, corporation_id, meeting_type, meeting_date')
        .in('corporation_id', corpIds)
        .eq('meeting_type', 'Annual Stockholders')
        .order('id')
        .range(from, to),
    ),
    matterIds.length
      ? supabase.from('matters').select('notion_id, name, client_name, team_person_ids').in('notion_id', matterIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  const byCorp = new Map<string, ComplianceDeliverableLite[]>();
  for (const d of delRows) {
    const list = byCorp.get(d.subject_id as string) ?? [];
    list.push({
      type: d.type as string,
      name: (d.name as string) ?? '',
      externalDueDate: (d.external_due_date as string | null) ?? null,
      status: (d.status as string) ?? '',
    });
    byCorp.set(d.subject_id as string, list);
  }
  const matters = new Map((matterRows ?? []).map((m) => [m.notion_id as string, m]));

  const entries: RollForwardEntry[] = [];
  let created = 0;

  for (const corp of corps) {
    const held: HeldMeetings = new Map();
    for (const m of meetingRows) {
      if (m.corporation_id !== corp.id || !m.meeting_date) continue;
      // An annual meeting reports on the fiscal year that closed before it.
      held.set(fiscalYearOf(corp, m.meeting_date as string) - 1, m.meeting_date as string);
    }

    const filings = planRollForward(corp, byCorp.get(corp.id) ?? [], today, held, calendar);
    const permitTask = computeBusinessPermitTask(corp);
    const permit = firmHandles(corp, 'permit') && permitTask && permitTask.stage === 'renewal' && permitTask.dueDate >= today
      ? { name: permitTask.name, dueDate: permitTask.dueDate }
      : null;

    const matterId = effectiveBillingMatterId(corp);
    const matter = matterId ? matters.get(matterId) : undefined;
    const assignees = ((matter?.team_person_ids as string[] | null) ?? []).filter(Boolean);
    const entry: RollForwardEntry = {
      corporationId: corp.id,
      corporation: corp.approvedName ?? corp.proposedNames[0] ?? corp.id,
      matterId,
      matterName: (matter?.name as string | undefined) ?? null,
      assignees,
      filings,
      permit,
    };
    if (!matterId || !matter) entry.skipped = 'No billing matter linked';
    if (!filings.length && !permit) continue;
    entries.push(entry);
    if (opts.dryRun || entry.skipped) continue;

    if (filings.length) {
      // Deterministic ids: a second run, or two overlapping runs, conflict on
      // the primary key instead of raising the same filing twice.
      const rows = filings.map((f) => ({
        firm_id: firmId,
        notion_id: `temp-corp-deliv-${corp.id}-${f.obligation}-fy${f.fy}`,
        notion_url: '',
        name: f.name,
        type: f.type,
        status: DELIVERABLE_STATUS.NOT_STARTED,
        matter_id: matterId,
        subject_id: corp.id,
        matter_name: (matter?.name as string) ?? '',
        client_name: (matter?.client_name as string) ?? '',
        priority: 'High',
        external_due_date: f.dueDate,
        drafter_ids: assignees,
        currently_with_ids: assignees,
        created_time: new Date().toISOString(),
      }));
      const { data: inserted, error: insertError } = await supabase
        .from('deliverables')
        .upsert(rows, { onConflict: 'notion_id', ignoreDuplicates: true })
        .select('notion_id');
      if (insertError) {
        console.error('[roll-forward] insert failed', corp.id, insertError);
        entry.skipped = `Insert failed: ${insertError.message}`;
      } else {
        created += inserted?.length ?? 0;
      }
    }
    if (permit) await spawnBusinessPermitTask(corp, supabase, firmId, assignees);
  }

  return { created, entries };
}
