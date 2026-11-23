import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { loadFilingCalendar } from '@/lib/corporations/filing-calendar';
import type { FilingCalendarEntry } from '@/lib/corporations/obligations';
import {
  rowToCorporation,
  rowToCorporationPerson,
  rowToCorporationFile,
  rowToCorporationMeeting,
  rowToResolution,
  rowToResolutionTemplate,
} from '@/lib/corporation-row';
import type {
  Corporation,
  CorporationPerson,
  CorporationFile,
  CorporationMeeting,
  Resolution,
  ResolutionTemplate,
} from '@/types/corporations';
import { CORPORATION_SELECT } from '@/lib/corporations/matter-links';
import { teamOnMatters, type SubjectTeamMember } from '@/lib/queries/subject-team';
import { PORTAL_HIDDEN_ACTION, PORTAL_PREVIEW_ACTION, PORTAL_SHOWN_ACTION } from '@/lib/portal/switch-access';

/**
 * Resolve a corporation's matter ids (incorporation/post-incorp/housekeeping/
 * retainer) to a notion_id → name lookup so the UI can show readable labels
 * instead of raw UUIDs. Returns an empty object when no matters are linked.
 */
export async function getCorporationMatterNames(firmId: string, corp: Corporation): Promise<Record<string, string>> {
  const ids = [
    corp.incorporationMatterId,
    corp.postIncorporationMatterId,
    corp.housekeepingMatterId,
    corp.retainerMatterId,
  ].filter((v): v is string => !!v);
  if (ids.length === 0) return {};
  const supabase = getServiceDbForFirm(firmId);
  const { data } = await supabase
    .from('matters')
    .select('notion_id, name')
    .in('notion_id', ids);
  const out: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row?.notion_id) out[row.notion_id as string] = (row.name as string) ?? '';
  }
  return out;
}

export async function getCorporationById(firmId: string, id: string): Promise<Corporation | null> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('corporations')
    .select(CORPORATION_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return rowToCorporation(data as Record<string, unknown>);
}

export async function getCorporationPersons(firmId: string, corporationId: string): Promise<CorporationPerson[]> {
  const supabase = getServiceDbForFirm(firmId);
  const { data } = await supabase
    .from('corporation_persons')
    .select('*')
    .eq('corporation_id', corporationId)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  return (data ?? []).map((r) => rowToCorporationPerson(r as Record<string, unknown>));
}

export async function getCorporationFiles(firmId: string, corporationId: string): Promise<CorporationFile[]> {
  const supabase = getServiceDbForFirm(firmId);
  const { data } = await supabase
    .from('corporation_files')
    .select('*')
    .eq('corporation_id', corporationId)
    .order('uploaded_at', { ascending: false });
  return (data ?? []).map((r) => rowToCorporationFile(r as Record<string, unknown>));
}

export async function getCorporationMeetings(firmId: string, corporationId: string): Promise<CorporationMeeting[]> {
  const supabase = getServiceDbForFirm(firmId);
  const { data } = await supabase
    .from('corporation_meetings')
    .select('*')
    .eq('corporation_id', corporationId)
    .order('meeting_date', { ascending: false });
  return (data ?? []).map((r) => rowToCorporationMeeting(r as Record<string, unknown>));
}

export async function getCorporationResolutions(firmId: string, corporationId: string): Promise<Resolution[]> {
  const supabase = getServiceDbForFirm(firmId);
  const { data } = await supabase
    .from('resolutions')
    .select('*')
    .eq('corporation_id', corporationId)
    .order('date_of_resolution', { ascending: false });
  return (data ?? []).map((r) => rowToResolution(r as Record<string, unknown>));
}

export async function getResolutionTemplates(firmId: string, activeOnly = true): Promise<ResolutionTemplate[]> {
  const supabase = getServiceDbForFirm(firmId);
  let q = supabase
    .from('resolution_templates')
    .select('*')
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (activeOnly) q = q.eq('is_active', true);
  const { data } = await q;
  return (data ?? []).map((r) => rowToResolutionTemplate(r as Record<string, unknown>));
}

/**
 * Generate a short-lived signed URL for a corporation-scoped storage path.
 * Mirrors lib/queries/detail.ts signTrademarkPath.
 */
export async function signCorporationPath(firmId: string, path: string, expiresInSeconds = 60 * 60): Promise<string | null> {
  if (!path) return null;
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase.storage
    .from('files')
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

export const COMPLIANCE_DELIVERABLE_TYPES = ['SEC GIS', 'SEC AFS', 'BIR Filing', 'Other Compliance'];

/**
 * The corporation's compliance deliverables: those that name it, plus legacy
 * rows on its matters that name no company. A row naming a sibling that shares
 * the matter is the sibling's, not this one's.
 */
export async function getDeliverablesForCorporation(firmId: string, corp: Corporation): Promise<Array<Record<string, unknown>>> {
  const matterIds = [
    corp.retainerMatterId,
    corp.housekeepingMatterId,
    corp.postIncorporationMatterId,
    corp.incorporationMatterId,
  ].filter((id): id is string => !!id);
  const supabase = getServiceDbForFirm(firmId);
  const owned = matterIds.length
    ? `subject_id.eq.${corp.id},and(subject_id.is.null,matter_id.in.(${matterIds.map((m) => `"${m}"`).join(',')}))`
    : `subject_id.eq.${corp.id}`;
  const { data } = await supabase
    .from('deliverables')
    .select('*')
    .or(owned)
    .in('type', COMPLIANCE_DELIVERABLE_TYPES)
    .order('external_due_date', { ascending: true });
  return (data ?? []) as Array<Record<string, unknown>>;
}

/**
 * Resolve the corporation's own / engaging client ids to display names so the
 * Overview linkage section can show names + links instead of raw UUIDs.
 */
export async function getCorporationClientNames(firmId: string, corp: Corporation): Promise<Record<string, string>> {
  const ids = [corp.clientId, corp.engagingClientId].filter((v): v is string => !!v);
  if (!ids.length) return {};
  const supabase = getServiceDbForFirm(firmId);
  const { data } = await supabase
    .from('clients')
    .select('notion_id, name')
    .in('notion_id', ids);
  const out: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row?.notion_id) out[row.notion_id as string] = (row.name as string) ?? '';
  }
  return out;
}

export interface CorporationActivityEntry {
  id: number;
  action: string;
  fieldChanged: string | null;
  oldValue: string | null;
  newValue: string | null;
  performedByName: string | null;
  createdAt: string;
}

/**
 * Recent audit-log entries for a corporation. audit_log is a service-role-only
 * table (RLS on, no policies) — this read is safe to show to any team member
 * since the whole corporations surface is firm-visible.
 */
export async function getCorporationActivity(firmId: string, corporationId: string, limit = 100): Promise<CorporationActivityEntry[]> {
  const supabase = getServiceDbForFirm(firmId);
  const { data } = await supabase
    .from('audit_log')
    .select('id, action, field_changed, old_value, new_value, performed_by_name, created_at')
    .eq('entity_type', 'Corporation')
    .eq('entity_id', corporationId)
    .neq('action', PORTAL_PREVIEW_ACTION)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => {
    // The label says it all; the raw true/false stays for the audit log.
    const sentence = r.action === PORTAL_SHOWN_ACTION || r.action === PORTAL_HIDDEN_ACTION;
    return {
      id: r.id as number,
      action: (r.action as string) ?? '',
      fieldChanged: sentence ? null : ((r.field_changed as string | null) ?? null),
      oldValue: sentence ? null : ((r.old_value as string | null) ?? null),
      newValue: sentence ? null : ((r.new_value as string | null) ?? null),
      performedByName: (r.performed_by_name as string | null) ?? null,
      createdAt: (r.created_at as string) ?? '',
    };
  });
}

/**
 * What the status engine needs beyond the company's own rows: the filing
 * calendar, and which of its matters have a file request to the client still
 * open (those tracks read "waiting on client").
 */
export async function getCorporationStatusContext(
  firmId: string,
  corp: Corporation,
): Promise<{ calendar: FilingCalendarEntry[]; openRequestMatterIds: string[] }> {
  const supabase = getServiceDbForFirm(firmId);
  const matterIds = [
    corp.retainerMatterId,
    corp.housekeepingMatterId,
    corp.postIncorporationMatterId,
    corp.incorporationMatterId,
  ].filter((id): id is string => !!id);
  const [calendar, { data: requests }] = await Promise.all([
    loadFilingCalendar(supabase),
    matterIds.length
      ? supabase
          .from('file_requests')
          .select('matter_id')
          .in('matter_id', matterIds)
          .is('fulfilled_at', null)
          .is('canceled_at', null)
      : Promise.resolve({ data: [] as { matter_id: string }[] }),
  ]);
  return {
    calendar,
    openRequestMatterIds: [...new Set((requests ?? []).map((r) => r.matter_id as string))],
  };
}

export type CorporationTeamMember = SubjectTeamMember;

/** The team on the matters that cover the company. */
export async function getCorporationTeam(firmId: string, corp: Corporation): Promise<CorporationTeamMember[]> {
  return teamOnMatters(
    firmId,
    [corp.retainerMatterId, corp.housekeepingMatterId, corp.postIncorporationMatterId, corp.incorporationMatterId].filter(
      (id): id is string => !!id,
    ),
  );
}

