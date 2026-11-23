import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { logAudit } from '@/lib/audit';
import { DELIVERABLE_STATUS as S, isFinalized } from '@/lib/deliverable-status';
import { STATUS_REPORT_TYPE } from '@/lib/status-report-auto';
import { markTrademarkMatterIds } from '@/lib/trademarks/trademark-matters';

export interface MarkStatusReport {
  id: string;
  name: string;
  status: string;
}

/**
 * The status report a client report on the team's own paper can be: one the
 * mark's page lists — naming the mark, or naming nothing on one of the mark's
 * own trademark matters. Read with the person's client, so RLS decides they
 * may see it. Null when it is not one.
 */
export async function findMarkStatusReport(
  supabase: Pick<SupabaseClient, 'from'>,
  markId: string,
  deliverableId: string,
): Promise<MarkStatusReport | null> {
  const { data: d } = await supabase
    .from('deliverables')
    .select('notion_id, name, status, type, subject_id, matter_id')
    .eq('notion_id', deliverableId)
    .maybeSingle();
  if (!d || d.type !== STATUS_REPORT_TYPE || d.status === S.ARCHIVED) return null;
  if (d.subject_id !== markId) {
    if (d.subject_id || !d.matter_id) return null;
    if (!(await markTrademarkMatterIds(supabase, markId)).has(d.matter_id as string)) return null;
  }
  return { id: d.notion_id as string, name: d.name as string, status: d.status as string };
}

/**
 * The client report went: its status report names the mark and, unless it is
 * already done, is sent out on the day the report went, with no one holding it.
 * The write holds only while the status is still the one read, so a report
 * archived or sent meanwhile is left as it is. Throws when nothing is written.
 */
export async function markStatusReportSent(
  firmId: string,
  report: MarkStatusReport,
  { markId, sentOn, performedBy, ipAddress }: { markId: string; sentOn: string; performedBy: string; ipAddress?: string },
): Promise<void> {
  const supabase = getServiceDbForFirm(firmId);
  const done = isFinalized(report.status);
  const { data: updated, error } = await supabase
    .from('deliverables')
    .update(done ? { subject_id: markId } : { subject_id: markId, status: S.FILED_OR_SENT_OUT, date_done: sentOn, currently_with_ids: [] })
    .eq('notion_id', report.id)
    .eq('status', report.status)
    .select('notion_id');
  if (error) throw new Error(`was not marked sent out: ${error.message}`);
  if (!updated?.length) throw new Error('was not marked sent out: its status changed meanwhile');
  if (done) return;

  const { error: logError } = await supabase.from('deliverable_actions').insert({
    firm_id: firmId,
    deliverable_id: report.id,
    action: 'Mark as Filed/Sent Out',
    old_status: report.status,
    new_status: S.FILED_OR_SENT_OUT,
    performed_by: performedBy,
    comment: 'Sent to the client as a client report from the mark’s page.',
  });
  logAudit({
    firmId,
    entityType: 'deliverable',
    entityId: report.id,
    entityName: report.name,
    action: 'status_change',
    fieldChanged: 'status',
    oldValue: report.status,
    newValue: S.FILED_OR_SENT_OUT,
    performedBy,
    ipAddress,
  });
  if (logError) throw new Error(`was marked sent out, but its history was not updated: ${logError.message}`);
}
