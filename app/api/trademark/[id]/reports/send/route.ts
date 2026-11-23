import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { sendClientMail, ClientMailError } from '@/lib/email';
import { loadOutboundIdentity, mailboxNotConfigured } from '@/lib/firm/outbound-identity';
import { logAudit, getClientIP } from '@/lib/audit';
import { validateBody, trademarkReportSendUploadedSchema } from '@/lib/validation';
import { refNo } from '@/lib/trademark-deadlines';
import { REPORT_EVENTS, markEmailCaption } from '@/lib/trademarks/client-report';
import { reportEmailHtml } from '@/lib/client-reports/letter';
import { loadMarkForUploadedReport, readReportUploads } from '@/lib/trademarks/client-report-server';
import { loadReportEmailFirm } from '@/lib/client-reports/server';
import { findMarkStatusReport, markStatusReportSent } from '@/lib/trademarks/report-deliverable';
import { manilaToday } from '@/lib/dates';

const ALLOWED_ROLES = new Set(['admin', 'lawyer', 'partner', 'super_user']);

/** Resend takes a message up to 40 MB; this leaves room for the body and the encoding. */
const MAX_ATTACHMENT_BYTES = 35 * 1024 * 1024;

/**
 * POST /api/trademark/[id]/reports/send
 * Sends a report on the team's own paper — the files they uploaded, as they
 * are, the letter first — from the firm's own trademark mailbox with the firm's covering email, and
 * logs it against the step it is on, or under its own title.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!ALLOWED_ROLES.has(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const validation = await validateBody(req, trademarkReportSendUploadedSchema);
  if (!validation.success) return validation.response;
  const { event, title, paths, deliverableId, to, cc, subject, message, salutation } = validation.data;

  const identity = await loadOutboundIdentity(session.firmId);
  if (!identity.ipAddress) {
    return NextResponse.json(
      { error: mailboxNotConfigured('trademark mailbox (settings.email.ipAddress)') },
      { status: 400 },
    );
  }

  const { id } = await params;
  const loaded = await loadMarkForUploadedReport(session.firmId, id, session.user.notionUserId);
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { trademark: t, sender, authed } = loaded;
  const eventDate = event ? REPORT_EVENTS[event].date(t) : null;
  if (event && !eventDate) return NextResponse.json({ error: 'That step is not recorded on this mark' }, { status: 409 });

  const statusReport = deliverableId ? await findMarkStatusReport(authed, id, deliverableId) : null;
  if (deliverableId && !statusReport) return NextResponse.json({ error: 'That status report is not on this mark' }, { status: 409 });

  const uploads = await readReportUploads(session.firmId, id, paths, { read: true });
  if ('error' in uploads) return NextResponse.json({ error: uploads.error }, { status: uploads.status });
  const attachments = uploads.files.map((f) => ({ filename: f.name, content: f.content! }));
  if (attachments.reduce((n, a) => n + a.content.length, 0) > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: 'The files come to over 35 MB, too large to email. Share the largest by link.' }, { status: 413 });
  }

  const bodyHtml = reportEmailHtml({
    message,
    caption: markEmailCaption(t),
    refNo: refNo(t),
    senderName: sender.name || session.user.name || '',
    senderPosition: sender.position,
    salutation,
    firm: await loadReportEmailFirm(session.firmId),
  });
  try {
    // The firm's trademark mailbox is the sender, the reply-to and a blind copy.
    const mailbox = [{ address: identity.ipAddress }];
    await sendClientMail({
      firmId: session.firmId,
      fromAddress: identity.ipAddress,
      fromName: identity.firmName,
      subject,
      bodyHtml,
      to: to.map((address) => ({ address })),
      cc: cc.map((address) => ({ address })),
      bcc: mailbox,
      replyTo: mailbox,
      attachments: attachments.map((a) => ({
        name: a.filename,
        contentType: /\.pdf$/i.test(a.filename) ? 'application/pdf' : 'application/octet-stream',
        contentBytes: a.content.toString('base64'),
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Email send failed' },
      { status: e instanceof ClientMailError ? 503 : 502 },
    );
  }

  const { data: row, error: insErr } = await getServiceDbForFirm(session.firmId)
    .from('trademark_client_reports')
    .insert({
      trademark_id: t.id,
      event: event ?? null,
      event_date: eventDate,
      title: title ?? null,
      sent_by: session.user.notionUserId,
      recipient_email: to[0],
      cc_emails: [...to.slice(1), ...cc],
      subject,
      body_html: bodyHtml,
      attachment_paths: uploads.files.map((f) => f.path),
      deliverable_id: statusReport?.id ?? null,
    })
    .select('id, sent_at')
    .single();

  // The email has gone, so the status report has too, whatever happens to the log.
  const statusError = statusReport
    ? await markStatusReportSent(session.firmId, statusReport, { markId: t.id, sentOn: manilaToday(), performedBy: session.user.notionUserId, ipAddress: getClientIP(req) })
      .then(() => null, (e: Error) => e.message)
    : null;

  logAudit({
    firmId: session.firmId,
    entityType: 'Trademark',
    entityId: t.id,
    entityName: t.mark || undefined,
    action: 'updated',
    fieldChanged: 'client_report',
    newValue: `${event ? REPORT_EVENTS[event].label : title} (own paper) sent to ${to.join(', ')}`,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  // The email has gone; a failed log is reported, not turned into a failure.
  return NextResponse.json({
    ok: true,
    report: row ? { id: row.id, sentAt: row.sent_at } : null,
    logError: insErr?.message ?? null,
    statusError,
  });
}
