import type { SupabaseClient } from '@supabase/supabase-js';
import type { Corporation } from '@/types/corporations';
import { effectiveBillingMatterId } from '@/lib/corporation-row';
import { mintId } from '@/lib/ids';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';
import {
  DELIVERABLE_OBLIGATIONS,
  OBLIGATIONS,
  deliverableName,
  dueDate,
  firmHandles,
  firstFiscalYear,
  type FilingCalendarEntry,
} from '@/lib/corporations/obligations';
import { loadFilingCalendar } from '@/lib/corporations/filing-calendar';

/**
 * Standard PH corporate-compliance deadlines spawned when a corporation
 * receives its SEC Certificate of Registration. Each entry becomes one
 * deliverable created in the existing deliverables table.
 *
 * Deliverables only — every entry here is a document the firm authors and
 * files. Obligations the firm merely shepherds through an agency (the LGU
 * business permit) are tasks: lib/corporations/permit-task.ts.
 */
export interface ComplianceDeadline {
  name: string;
  type: 'SEC GIS' | 'SEC AFS' | 'BIR Filing';
  dueDate: string; // YYYY-MM-DD
  priority: 'High' | 'Medium' | 'Low';
}

/**
 * Compute the year-1 compliance deadlines for a freshly SEC-registered corp:
 * the deliverable obligations the firm files for it (its `firmFiles`
 * switches) for the fiscal year its
 * registration falls in. The rules live in lib/corporations/obligations.ts,
 * shared with the nightly roll-forward that raises every later year.
 *
 * No BIR 0605 (annual registration fee): RA 11976 (Ease of Paying Taxes Act)
 * §34 rewrote NIRC §236 and the fee is gone (RMC 91-2024). No business
 * permit: the firm files an application and the LGU issues the permit, so it
 * is a task — lib/corporations/permit-task.ts.
 */
export function computeYear1Deadlines(corp: Corporation, calendar: FilingCalendarEntry[] = []): ComplianceDeadline[] {
  const fy = firstFiscalYear(corp);
  if (fy === null) return [];
  return DELIVERABLE_OBLIGATIONS.filter((key) => firmHandles(corp, key)).map((key) => ({
    name: deliverableName(key, corp, fy),
    type: OBLIGATIONS[key].deliverableType!,
    dueDate: dueDate(key, fy, { corporation: corp, calendar })!,
    priority: 'High' as const,
  }));
}

/**
 * Spawn deliverables for the corporation's year-1 compliance deadlines.
 * Writes directly into the deliverables table — this module is native and
 * doesn't round-trip through Notion. Returns count created.
 */
export async function spawnComplianceDeliverables(
  corp: Corporation,
  supabase: SupabaseClient,
  firmId: string,
  createdBy: string,
): Promise<number> {
  const matterId = effectiveBillingMatterId(corp);
  if (!matterId) {
    console.warn('[corporation-deadlines] No effective billing matter for corp', corp.id);
    return 0;
  }

  // Resolve matter name + client name for denormalized columns the deliverables
  // listing relies on.
  const { data: matter } = await supabase
    .from('matters')
    .select('name, client_name')
    .eq('notion_id', matterId)
    .maybeSingle();

  const matterName = (matter?.name as string) ?? '';
  const clientName = (matter?.client_name as string) ?? '';

  const deadlines = computeYear1Deadlines(corp, await loadFilingCalendar(supabase));
  if (!deadlines.length) return 0;

  // Idempotency. Two paths spawn deadlines — the "already incorporated" branch
  // of the corporation POST, and the SEC-approval chain when a registration
  // date first lands — and a corporation can legitimately go through both.
  // Without this guard the second run duplicates the whole set, which is how
  // one corporation ended up with two complete copies of its year-1 deadlines
  // six minutes apart. Keyed on (type, due date) rather than name so a renamed
  // row still counts as present. The rows are recognized by the corp id
  // embedded in their notion_id; the leading % also matches rows minted before
  // the temp- prefix was dropped (temp-corp-deliv-<corp.id>-...).
  const { data: existingRows } = await supabase
    .from('deliverables')
    .select('type, external_due_date')
    .like('notion_id', `%corp-deliv-${corp.id}-%`);
  const already = new Set(
    (existingRows ?? []).map((r) => `${r.type}|${r.external_due_date}`),
  );

  const fresh = deadlines.filter((d) => !already.has(`${d.type}|${d.dueDate}`));
  if (!fresh.length) return 0;

  // firmId is a required parameter rather than derived: one caller hands this
  // helper a firm-scoped client (which stamps firm_id itself) and another the
  // authed client (which does not), so the rows carry it either way.
  const rows = fresh.map((d) => ({
    firm_id: firmId,
    notion_id: mintId(`corp-deliv-${corp.id}`),
    notion_url: '',
    name: d.name,
    type: d.type,
    status: DELIVERABLE_STATUS.NOT_STARTED,
    matter_id: matterId,
    subject_id: corp.id,
    matter_name: matterName,
    client_name: clientName,
    priority: d.priority,
    external_due_date: d.dueDate,
    drafter_ids: createdBy ? [createdBy] : [],
    currently_with_ids: createdBy ? [createdBy] : [],
    created_time: new Date().toISOString(),
  }));

  const { error } = await supabase.from('deliverables').insert(rows);
  if (error) {
    console.error('[corporation-deadlines] insert deliverables failed', error);
    return 0;
  }
  return rows.length;
}
