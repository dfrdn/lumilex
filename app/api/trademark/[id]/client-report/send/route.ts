import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm, firmStoragePath } from '@/lib/tenancy/service-db';
import { sendClientMail, ClientMailError } from '@/lib/email';
import { loadOutboundIdentity, mailboxNotConfigured } from '@/lib/firm/outbound-identity';
import { logAudit, getClientIP } from '@/lib/audit';
import { validateBody, trademarkClientReportSendSchema } from '@/lib/validation';
import { refNo } from '@/lib/trademark-deadlines';
import { REPORT_EVENTS } from '@/lib/trademarks/client-report';
import { reportEmailHtml } from '@/lib/client-reports/letter';
import { loadClientReport, noReport, reportDocx, reportFileName } from '@/lib/trademarks/client-report-server';
import {
  attachmentType, letterFile as toLetterFile, loadReportEmailFirm, readEditedLetter, reportAttachments, reportPdf,
} from '@/lib/client-reports/server';

/** Converting the letter to PDF goes through Microsoft Graph. */
export const maxDuration = 60;

const ALLOWED_ROLES = new Set(['admin', 'lawyer', 'partner', 'super_user']);

/**
 * POST /api/trademark/[id]/client-report/send
 * Sends the report on a step — the letter on the letterhead (as a PDF when the
 * firm converts Word files, else as the Word file) and the papers picked as its
 * annexes — from the firm's own trademark mailbox, blind-copied to
 * it, and logs it against the step.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!ALLOWED_ROLES.has(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const validation = await validateBody(req, trademarkClientReportSendSchema);
  if (!validation.success) return validation.response;
  const { event, letter, to, cc, subject, message, annexes: annexChoice, editedLetter } = validation.data;

  // A letter edited in Word goes instead of the generated one; it must be a Word file.
  const edited = editedLetter ? readEditedLetter(editedLetter) : null;
  if (edited && 'error' in edited) return NextResponse.json({ error: edited.error }, { status: 400 });

  const identity = await loadOutboundIdentity(session.firmId);
  if (!identity.ipAddress) {
    return NextResponse.json(
      { error: mailboxNotConfigured('trademark mailbox (settings.email.ipAddress)') },
      { status: 400 },
    );
  }

  const { id } = await params;
  const loaded = await loadClientReport(session.firmId, id, event, session.user.notionUserId, letter, annexChoice);
  if (typeof loaded === 'string') return noReport(loaded);
  const { trademark: t, report, annexes } = loaded;

  const service = getServiceDbForFirm(session.firmId);

  const docx = edited?.docx ?? await reportDocx(session.firmId, report);
  const docxName = edited?.name ?? reportFileName(t, event, report.eventDate);
  const stamp = Date.now();
  let pdf: Buffer | null;
  try {
    pdf = await reportPdf(session.firmId, docx, docxName);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not convert the letter to PDF' }, { status: 502 });
  }
  const letterFile = toLetterFile(docx, docxName, pdf);
  const fileName = letterFile.filename;
  const read = await reportAttachments(session.firmId, { filename: fileName, content: letterFile.content }, annexes);
  if ('error' in read) return NextResponse.json({ error: read.error }, { status: read.status });
  const { attachments } = read;

  const storagePath = firmStoragePath(session.firmId, `trademarks/${t.id}/reports/${stamp}-${fileName}`);
  const { error: upErr } = await service.storage.from('files').upload(storagePath, letterFile.content, { contentType: letterFile.type, upsert: false });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const bodyHtml = reportEmailHtml({
    message,
    caption: report.emailCaption,
    refNo: refNo(t),
    senderName: report.signatory.name || session.user.name || '',
    senderPosition: report.signatory.position,
    salutation: letter?.salutation,
    firm: await loadReportEmailFirm(session.firmId),
  });
  try {
    // The firm's trademark mailbox is the sender, the reply-to and a blind
    // copy, so the report and the client's answer both land there.
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
        contentType: attachmentType(a.filename),
        contentBytes: a.content.toString('base64'),
      })),
    });
  } catch (e) {
    await service.storage.from('files').remove([storagePath]);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Email send failed' },
      // A ClientMailError is a configuration answer; anything else is Resend or the network.
      { status: e instanceof ClientMailError ? 503 : 502 },
    );
  }

  const { data: row, error: insErr } = await service
    .from('trademark_client_reports')
    .insert({
      trademark_id: t.id,
      event,
      event_date: report.eventDate,
      sent_by: session.user.notionUserId,
      recipient_email: to[0],
      cc_emails: [...to.slice(1), ...cc],
      subject,
      body_html: bodyHtml,
      attachment_paths: [storagePath, ...annexes.map((a) => a.storagePath)],
    })
    .select('id, sent_at')
    .single();

  logAudit({
    firmId: session.firmId,
    entityType: 'Trademark',
    entityId: t.id,
    entityName: t.mark || undefined,
    action: 'updated',
    fieldChanged: 'client_report',
    newValue: `${REPORT_EVENTS[event].label} sent to ${to.join(', ')}`,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  // The email has gone; a failed log is reported, not turned into a failure.
  return NextResponse.json({
    ok: true,
    report: row ? { id: row.id, sentAt: row.sent_at } : null,
    logError: insErr?.message ?? null,
  });
}
