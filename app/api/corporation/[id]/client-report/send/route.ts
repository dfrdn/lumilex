import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm, firmStoragePath } from '@/lib/tenancy/service-db';
import { sendClientMail, ClientMailError } from '@/lib/email';
import { loadOutboundIdentity, mailboxNotConfigured } from '@/lib/firm/outbound-identity';
import { logAudit, getClientIP } from '@/lib/audit';
import { validateBody, corporationClientReportSendSchema } from '@/lib/validation';
import { reportEmailHtml } from '@/lib/client-reports/letter';
import {
  attachmentType, letterFile as toLetterFile, loadReportEmailFirm, readEditedLetter, reportAttachments, reportDocx, reportPdf,
} from '@/lib/client-reports/server';
import { corporateReportLabel } from '@/lib/corporations/client-report';
import { companyName } from '@/lib/corporations/obligations';
import { corporateReportFileName, loadCorporateReport, noCorporateReport } from '@/lib/corporations/client-report-server';

/** Converting the letter to PDF goes through Microsoft Graph. */
export const maxDuration = 60;

const ALLOWED_ROLES = new Set(['admin', 'lawyer', 'partner', 'super_user']);

/**
 * POST /api/corporation/[id]/client-report/send
 * Sends the report — the letter on the firm's letterhead (as a PDF when the
 * firm converts Word files, else as the Word file) and the papers picked as
 * its annexes — from the firm's own compliance mailbox, blind-copied to it,
 * and logs it against the company (and the item it is on).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!ALLOWED_ROLES.has(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const validation = await validateBody(req, corporationClientReportSendSchema);
  if (!validation.success) return validation.response;
  const { event, itemId, letter, to, cc, subject, message, annexes: annexChoice, editedLetter } = validation.data;

  // A letter edited in Word goes instead of the generated one; it must be a Word file.
  const edited = editedLetter ? readEditedLetter(editedLetter) : null;
  if (edited && 'error' in edited) return NextResponse.json({ error: edited.error }, { status: 400 });

  const identity = await loadOutboundIdentity(session.firmId);
  if (!identity.complianceAddress) {
    return NextResponse.json(
      { error: mailboxNotConfigured('compliance mailbox (settings.email.complianceAddress)') },
      { status: 400 },
    );
  }

  const { id } = await params;
  const loaded = await loadCorporateReport(session.firmId, id, event, itemId, session.user.notionUserId, letter, annexChoice);
  if (typeof loaded === 'string') return noCorporateReport(loaded);
  const { corporation, report, annexes, context } = loaded;

  const docx = edited?.docx ?? await reportDocx(session.firmId, report.paragraphs);
  const docxName = edited?.name ?? corporateReportFileName(loaded);
  let pdf: Buffer | null;
  try {
    pdf = await reportPdf(session.firmId, docx, docxName);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not convert the letter to PDF' }, { status: 502 });
  }
  const letterFile = toLetterFile(docx, docxName, pdf);
  const read = await reportAttachments(session.firmId, { filename: letterFile.filename, content: letterFile.content }, annexes);
  if ('error' in read) return NextResponse.json({ error: read.error }, { status: read.status });

  const service = getServiceDbForFirm(session.firmId);
  const storagePath = firmStoragePath(session.firmId, `corporations/${id}/reports/${Date.now()}-${letterFile.filename}`);
  const { error: upErr } = await service.storage.from('files').upload(storagePath, letterFile.content, { contentType: letterFile.type, upsert: false });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const bodyHtml = reportEmailHtml({
    message,
    caption: report.emailCaption,
    refNo: context.refNo,
    senderName: report.signatory.name || session.user.name || '',
    senderPosition: report.signatory.position,
    salutation: letter?.salutation,
    firm: await loadReportEmailFirm(session.firmId),
  });
  try {
    // The firm's compliance mailbox is the sender, the reply-to and a blind
    // copy, so the report and the client's answer both land there.
    const mailbox = [{ address: identity.complianceAddress }];
    await sendClientMail({
      firmId: session.firmId,
      fromAddress: identity.complianceAddress,
      fromName: identity.firmName,
      subject,
      bodyHtml,
      to: to.map((address) => ({ address })),
      cc: cc.map((address) => ({ address })),
      bcc: mailbox,
      replyTo: mailbox,
      attachments: read.attachments.map((a) => ({
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
    .from('corporation_client_reports')
    .insert({
      corporation_id: id,
      event,
      item_id: itemId ?? null,
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

  const itemName = context.compliance?.name ?? context.resolution?.title ?? null;
  logAudit({
    firmId: session.firmId,
    entityType: 'Corporation',
    entityId: id,
    entityName: companyName(corporation) || undefined,
    action: 'updated',
    fieldChanged: 'client_report',
    newValue: `${corporateReportLabel(event, itemName)} sent to ${to.join(', ')}`,
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
