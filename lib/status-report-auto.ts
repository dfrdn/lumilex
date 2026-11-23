/**
 * Auto-create Status Report deliverable shells when a hearing is marked
 * as attended or a filing is marked as filed.
 *
 * Called fire-and-forget from /api/mark-status. Never blocks the primary
 * action — all errors are caught and logged.
 *
 * Idempotent: re-invoking with the same parent never creates a duplicate.
 */

import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { mintId } from '@/lib/ids';
import { getMatterTeamByRole } from '@/lib/queries/team-roles';
import { resolveStatusReportReviewer } from '@/lib/status-report-reviewer';
import { filterToJuniorAssociates, JUNIOR_ASSOCIATE_POSITIONS } from '@/lib/queries/people';
import { logAudit } from '@/lib/audit';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';
import { addDays, toManilaDay } from '@/lib/dates';
import { trademarkMatterIds } from '@/lib/trademarks/trademark-matters';

export const STATUS_REPORT_TYPE = 'Status Report';
const DRAFTING_STATUS = DELIVERABLE_STATUS.DRAFTING;

type EnsureResult = {
  created: boolean;
  deliverableId: string | null;
  reason?: string;
};

/**
 * Look up the matter's client name (for the deliverables.client_name denorm column).
 */
async function getMatterClientName(matterId: string, firmId: string): Promise<{ matterName: string; clientName: string } | null> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('matters')
    .select('name, client_name')
    .eq('notion_id', matterId)
    .single();
  if (error || !data) return null;
  return { matterName: data.name ?? '', clientName: data.client_name ?? '' };
}

/**
 * Shared worker: given parent context, create a Status Report deliverable.
 * Both entry points funnel through here after gathering parent-specific data.
 */
export async function createStatusReportDeliverable(params: {
  matterId: string;
  parentName: string;
  drafterIds: string[];
  reviewerId: string | null;
  triggerDate: Date;
  linkHearingId?: string | null;
  linkSourceDeliverableId?: string | null;
  linkSourceFileId?: string | null;
  performedBy: string;
  firmId: string;
}): Promise<EnsureResult> {
  const {
    matterId,
    parentName,
    drafterIds,
    reviewerId,
    triggerDate,
    linkHearingId = null,
    linkSourceDeliverableId = null,
    linkSourceFileId = null,
    performedBy,
    firmId,
  } = params;

  const supabase = getServiceDbForFirm(firmId);

  const matterInfo = await getMatterClientName(matterId, firmId);
  if (!matterInfo) {
    return { created: false, deliverableId: null, reason: 'matter_not_found' };
  }

  const deliverableName = `Status Report — ${parentName}`.trim();
  const externalDueDate = addDays(toManilaDay(triggerDate), 2);

  // Currently With starts with drafters so it routes to them for drafting
  const currentlyWith = drafterIds.length > 0 ? drafterIds : reviewerId ? [reviewerId] : [];

  const deliverableId = mintId('deliverable');

  const nowIso = new Date().toISOString();
  const { error: insertErr } = await supabase.from('deliverables').insert({
    notion_id: deliverableId,
    notion_url: '',
    name: deliverableName,
    matter_id: matterId,
    matter_name: matterInfo.matterName,
    client_name: matterInfo.clientName,
    type: STATUS_REPORT_TYPE,
    status: DRAFTING_STATUS,
    drafter_ids: drafterIds,
    reviewer_ids: reviewerId ? [reviewerId] : [],
    currently_with_ids: currentlyWith,
    external_due_date: externalDueDate,
    review_dates: [],
    priority: '',
    date_done: null,
    revision_count: 0,
    parent_deliverable_id: null,
    related_hearing_id: linkHearingId,
    source_deliverable_id: linkSourceDeliverableId,
    source_file_id: linkSourceFileId,
    created_time: nowIso,
    notion_last_edited_at: nowIso,
    synced_at: nowIso,
  });

  if (insertErr) {
    console.error('[status-report-auto] Supabase insert failed:', insertErr.message);
    return { created: false, deliverableId: deliverableId, reason: `supabase_failed: ${insertErr.message}` };
  }

  const auditField = linkHearingId
    ? 'related_hearing_id'
    : linkSourceDeliverableId
      ? 'source_deliverable_id'
      : 'source_file_id';
  logAudit({
    firmId,
    entityType: 'deliverable',
    entityId: deliverableId,
    entityName: deliverableName,
    action: 'auto_created',
    fieldChanged: auditField,
    newValue: linkHearingId ?? linkSourceDeliverableId ?? linkSourceFileId ?? undefined,
    performedBy,
  });

  console.log(
    `[status-report-auto] Created "${deliverableName}" (${deliverableId}) — due ${externalDueDate}`,
  );

  return { created: true, deliverableId: deliverableId };
}

/**
 * Ensure a Status Report exists for an attended hearing.
 * Idempotent — returns existing if already linked.
 */
export async function ensureStatusReportForHearing(
  hearingId: string,
  opts: { performedBy: string; triggerDate?: Date; firmId: string },
): Promise<EnsureResult> {
  try {
    const { firmId } = opts;
    const supabase = getServiceDbForFirm(firmId);

    // Idempotency check
    const { data: existing } = await supabase
      .from('deliverables')
      .select('notion_id')
      .eq('related_hearing_id', hearingId)
      .eq('type', STATUS_REPORT_TYPE)
      .limit(1)
      .maybeSingle();
    if (existing?.notion_id) {
      return { created: false, deliverableId: existing.notion_id, reason: 'already_exists' };
    }

    // Load hearing
    const { data: hearing, error: hErr } = await supabase
      .from('hearings')
      .select('notion_id, name, matter_id, attendee_ids, date')
      .eq('notion_id', hearingId)
      .single();
    if (hErr || !hearing) {
      return { created: false, deliverableId: null, reason: 'hearing_not_found' };
    }
    if (!hearing.matter_id) {
      return { created: false, deliverableId: null, reason: 'hearing_missing_matter' };
    }

    // Drafters = junior associates who attended the hearing; fallback to
    // junior associates on the matter team. Partners and senior associates
    // never draft a Status Report — they review.
    const juniorPositions = new Set<string>(JUNIOR_ASSOCIATE_POSITIONS);
    let drafterIds: string[] = Array.isArray(hearing.attendee_ids)
      ? await filterToJuniorAssociates(firmId, hearing.attendee_ids)
      : [];
    const team = await getMatterTeamByRole(firmId, hearing.matter_id);
    if (drafterIds.length === 0) {
      drafterIds = team
        .filter((m) => juniorPositions.has(m.position))
        .map((m) => m.personId);
    }

    // Reviewer = the client's relationship partner. Belt-and-suspenders exclude
    // from drafters in case the partner ever shows up there by accident.
    const reviewerId = (await resolveStatusReportReviewer(hearing.matter_id, team, firmId))?.personId ?? null;
    if (reviewerId) {
      drafterIds = drafterIds.filter((id) => id !== reviewerId);
    }

    const triggerDate = opts.triggerDate ?? (hearing.date ? new Date(hearing.date) : new Date());

    return createStatusReportDeliverable({
      matterId: hearing.matter_id,
      parentName: hearing.name || 'Hearing',
      drafterIds,
      reviewerId,
      triggerDate,
      linkHearingId: hearing.notion_id,
      performedBy: opts.performedBy,
      firmId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[status-report-auto] ensureStatusReportForHearing error:', message);
    return { created: false, deliverableId: null, reason: message };
  }
}

/**
 * Ensure a Status Report exists for a deliverable that was marked filed/sent out.
 * Idempotent — returns existing if already linked.
 * Recursion guard — does nothing if the source deliverable is itself a Status Report.
 */
export async function ensureStatusReportForFiledDeliverable(
  filedDeliverableId: string,
  opts: { performedBy: string; triggerDate?: Date; firmId: string },
): Promise<EnsureResult> {
  try {
    const { firmId } = opts;
    const supabase = getServiceDbForFirm(firmId);

    // Load source deliverable
    const { data: source, error: sErr } = await supabase
      .from('deliverables')
      .select('notion_id, name, matter_id, subject_id, drafter_ids, type, date_done')
      .eq('notion_id', filedDeliverableId)
      .single();
    if (sErr || !source) {
      return { created: false, deliverableId: null, reason: 'source_not_found' };
    }

    // Recursion guard: don't spawn a status report from a status report
    if (source.type === STATUS_REPORT_TYPE) {
      return { created: false, deliverableId: null, reason: 'source_is_status_report' };
    }

    // Only External deliverables are actual filings — skip Internal/For Client/etc.
    if (source.type !== 'External') {
      return { created: false, deliverableId: null, reason: `source_type_not_external: ${source.type}` };
    }

    if (!source.matter_id) {
      return { created: false, deliverableId: null, reason: 'source_missing_matter' };
    }

    // A mark's progress is reported from its own page, so a filing for a mark —
    // or anything filed on a trademark matter — gets no status report.
    if (source.subject_id) {
      const { data: subject } = await supabase.from('subjects').select('type').eq('id', source.subject_id).maybeSingle();
      if (subject?.type === 'trademark') {
        return { created: false, deliverableId: null, reason: 'source_is_for_a_mark' };
      }
    }
    if ((await trademarkMatterIds(supabase, [source.matter_id])).size > 0) {
      return { created: false, deliverableId: null, reason: 'source_on_trademark_matter' };
    }

    // Idempotency check
    const { data: existing } = await supabase
      .from('deliverables')
      .select('notion_id')
      .eq('source_deliverable_id', filedDeliverableId)
      .eq('type', STATUS_REPORT_TYPE)
      .limit(1)
      .maybeSingle();
    if (existing?.notion_id) {
      return { created: false, deliverableId: existing.notion_id, reason: 'already_exists' };
    }

    // Drafters = the junior associates among the source deliverable's
    // original drafters; fallback to junior associates on the matter team.
    // Partners and senior associates never draft a Status Report.
    const juniorPositions = new Set<string>(JUNIOR_ASSOCIATE_POSITIONS);
    let drafterIds: string[] = Array.isArray(source.drafter_ids)
      ? await filterToJuniorAssociates(firmId, source.drafter_ids)
      : [];
    const team = await getMatterTeamByRole(firmId, source.matter_id);
    if (drafterIds.length === 0) {
      drafterIds = team
        .filter((m) => juniorPositions.has(m.position))
        .map((m) => m.personId);
    }

    const reviewerId = (await resolveStatusReportReviewer(source.matter_id, team, firmId))?.personId ?? null;
    if (reviewerId) {
      drafterIds = drafterIds.filter((id) => id !== reviewerId);
    }

    const triggerDate =
      opts.triggerDate ?? (source.date_done ? new Date(source.date_done) : new Date());

    return createStatusReportDeliverable({
      matterId: source.matter_id,
      parentName: source.name || 'Filing',
      drafterIds,
      reviewerId,
      triggerDate,
      linkSourceDeliverableId: source.notion_id,
      performedBy: opts.performedBy,
      firmId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[status-report-auto] ensureStatusReportForFiledDeliverable error:', message);
    return { created: false, deliverableId: null, reason: message };
  }
}

/**
 * Ensure a Status Report shell exists for an incoming file. Used by the
 * Inbox "Create Status Report" action — no AI, no DOCX, just the shell.
 * Idempotent — returns existing if one was already spawned from this file.
 */
export async function ensureStatusReportForFile(
  fileId: string,
  opts: { performedBy: string; triggerDate?: Date; firmId: string },
): Promise<EnsureResult> {
  try {
    const { firmId } = opts;
    const supabase = getServiceDbForFirm(firmId);

    // Idempotency check
    const { data: existing } = await supabase
      .from('deliverables')
      .select('notion_id, name')
      .eq('source_file_id', fileId)
      .eq('type', STATUS_REPORT_TYPE)
      .limit(1)
      .maybeSingle();
    if (existing?.notion_id) {
      return { created: false, deliverableId: existing.notion_id, reason: 'already_exists' };
    }

    const { data: file, error: fErr } = await supabase
      .from('files')
      .select('notion_id, name, matter_id')
      .eq('notion_id', fileId)
      .single();
    if (fErr || !file) {
      return { created: false, deliverableId: null, reason: 'file_not_found' };
    }
    if (!file.matter_id) {
      return { created: false, deliverableId: null, reason: 'file_missing_matter' };
    }

    // Drafters = junior associates on the matter team. Partners and
    // senior associates never draft a Status Report.
    const juniorPositions = new Set<string>(JUNIOR_ASSOCIATE_POSITIONS);
    const team = await getMatterTeamByRole(firmId, file.matter_id);
    const reviewerId = (await resolveStatusReportReviewer(file.matter_id, team, firmId))?.personId ?? null;
    let drafterIds = team
      .filter((m) => juniorPositions.has(m.position))
      .map((m) => m.personId);
    if (reviewerId) {
      drafterIds = drafterIds.filter((id) => id !== reviewerId);
    }

    const triggerDate = opts.triggerDate ?? new Date();
    const parentName = file.name || 'File';

    return createStatusReportDeliverable({
      matterId: file.matter_id,
      parentName,
      drafterIds,
      reviewerId,
      triggerDate,
      linkSourceFileId: file.notion_id,
      performedBy: opts.performedBy,
      firmId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[status-report-auto] ensureStatusReportForFile error:', message);
    return { created: false, deliverableId: null, reason: message };
  }
}
