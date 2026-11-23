import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { signStoragePaths } from '@/lib/storage-sign';
import { attachmentName } from '@/lib/trademarks/report-attachments';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { logAudit, getClientIP } from '@/lib/audit';
import { validateBody, trademarkReportRecordSchema } from '@/lib/validation';
import { toManilaInstant } from '@/lib/dates';
import { REPORT_EVENTS, markReportSubject } from '@/lib/trademarks/client-report';
import { TRADEMARK_SELECT, rowToTrademark } from '@/lib/trademark-row';
import { readReportUploads } from '@/lib/trademarks/client-report-server';
import { findMarkStatusReport, markStatusReportSent } from '@/lib/trademarks/report-deliverable';
import { filedOnDay } from '@/lib/deliverable-status';

const ALLOWED_ROLES = new Set(['admin', 'lawyer', 'partner', 'super_user']);

/**
 * GET /api/trademark/[id]/reports
 * Recent client reports sent for this trademark — newest first. Used to
 * populate the "Recent client reports" panel on TrademarkDetail.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const supabase = getServiceDbForFirm(session.firmId);
  const { data, error } = await supabase
    .from('trademark_client_reports')
    .select('id, deadline_kind, deadline_due, event, event_date, sent_at, sent_by, recipient_email, cc_emails, subject, attachment_paths, sent_outside, title, notes, deliverable_id, deliverable:deliverables(name)')
    .eq('trademark_id', id)
    .order('sent_at', { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Resolve sender notion_id → display name in one round-trip.
  const senderIds = [...new Set((data ?? []).map((r) => r.sent_by as string).filter(Boolean))];
  const senderNameById = new Map<string, string>();
  if (senderIds.length > 0) {
    const { data: people } = await supabase
      .from('team')
      .select('person_id, name')
      .in('person_id', senderIds);
    for (const p of (people ?? []) as Array<{ person_id: string; name: string }>) {
      senderNameById.set(p.person_id, p.name);
    }
  }

  // Sign attachment paths so the panel can offer download links.
  const attachmentPaths = (r: { attachment_paths: unknown }) => (r.attachment_paths as string[] | null) ?? [];
  const signed = await signStoragePaths(supabase, 'files', (data ?? []).flatMap(attachmentPaths), 60 * 60, {
    download: true,
  });
  const reports = (data ?? []).map((r) => ({
    id: r.id as number,
    deadlineKind: (r.deadline_kind as string | null) ?? null,
    deadlineDue: (r.deadline_due as string | null) ?? null,
    event: (r.event as string | null) ?? null,
    eventDate: (r.event_date as string | null) ?? null,
    sentAt: r.sent_at as string,
    sentBy: r.sent_by as string,
    sentByName: senderNameById.get(r.sent_by as string) ?? null,
    recipientEmail: r.recipient_email as string,
    ccEmails: (r.cc_emails as string[] | null) ?? [],
    subject: r.subject as string,
    sentOutside: (r.sent_outside as boolean | null) ?? false,
    title: (r.title as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    deliverable: r.deliverable_id
      ? { id: r.deliverable_id as string, name: ((r.deliverable as { name?: string } | null)?.name ?? '') || 'Status report' }
      : null,
    attachments: attachmentPaths(r).map((path) => ({
      name: attachmentName(path),
      path,
      url: signed.get(path) ?? null,
    })),
  }));

  return NextResponse.json({ reports });
}

/**
 * POST /api/trademark/[id]/reports
 * Records a report that went to the client by other means — Outlook, a
 * courier — with the files that went, so it shows among the mark's reports and
 * a step it covers is no longer owed. Nothing is sent.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!ALLOWED_ROLES.has(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const validation = await validateBody(req, trademarkReportRecordSchema);
  if (!validation.success) return validation.response;
  const { event, title, paths, deliverableId, sentOn, sentTo, subject, notes } = validation.data;

  const { id } = await params;
  const authed = await getSupabaseServerAuthClient();
  const { data: row } = await authed.from('trademarks').select(TRADEMARK_SELECT).eq('id', id).maybeSingle();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const t = rowToTrademark(row);
  const eventDate = event ? REPORT_EVENTS[event].date(t) : null;
  if (event && !eventDate) return NextResponse.json({ error: 'That step is not recorded on this mark' }, { status: 409 });

  const statusReport = deliverableId ? await findMarkStatusReport(authed, id, deliverableId) : null;
  if (deliverableId && !statusReport) return NextResponse.json({ error: 'That status report is not on this mark' }, { status: 409 });
  if (statusReport && !filedOnDay(sentOn)) {
    return NextResponse.json({ error: 'Pick today or an earlier date for when it was sent' }, { status: 400 });
  }

  const uploads = await readReportUploads(session.firmId, id, paths, { read: false });
  if ('error' in uploads) return NextResponse.json({ error: uploads.error }, { status: uploads.status });

  const { data: inserted, error } = await authed
    .from('trademark_client_reports')
    .insert({
      firm_id: session.firmId,
      trademark_id: id,
      event: event ?? null,
      event_date: eventDate,
      title: title ?? null,
      sent_outside: true,
      sent_at: toManilaInstant(sentOn),
      sent_by: session.user.notionUserId,
      recipient_email: sentTo,
      cc_emails: [],
      subject: subject || markReportSubject(t, event ? REPORT_EVENTS[event].subjectName : title!),
      body_html: '',
      notes: notes || null,
      attachment_paths: uploads.files.map((f) => f.path),
      deliverable_id: statusReport?.id ?? null,
    })
    .select('id, sent_at')
    .single();
  if (error || !inserted) return NextResponse.json({ error: error?.message ?? 'Could not record the report' }, { status: 500 });
  const statusError = statusReport
    ? await markStatusReportSent(session.firmId, statusReport, { markId: id, sentOn, performedBy: session.user.notionUserId, ipAddress: getClientIP(req) })
      .then(() => null, (e: Error) => e.message)
    : null;

  logAudit({
    firmId: session.firmId,
    entityType: 'Trademark',
    entityId: id,
    entityName: t.mark || undefined,
    action: 'updated',
    fieldChanged: 'client_report',
    newValue: `${event ? REPORT_EVENTS[event].label : title} recorded as sent outside the app on ${sentOn}`,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true, report: { id: inserted.id, sentAt: inserted.sent_at }, statusError });
}
