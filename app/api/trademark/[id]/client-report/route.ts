import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { annexDocumentFor, isReportEvent } from '@/lib/trademarks/client-report';
import { trademarkReportAnnexesSchema } from '@/lib/validation';
import { loadClientReport, noReport } from '@/lib/trademarks/client-report-server';
import { reportsGoAsPdf } from '@/lib/client-reports/server';
import { refNo } from '@/lib/trademark-deadlines';
import { loadOutboundIdentity } from '@/lib/firm/outbound-identity';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { signStoragePaths } from '@/lib/storage-sign';

/**
 * GET /api/trademark/[id]/client-report?event=filing[&annexes=<json>]
 * The report for a step on the mark, to review before it goes out: the email's
 * subject and opening, the caption, what the mark is missing, the papers that
 * go as its annexes (`annexes`, as the body of a send takes them; by default
 * the step's own paper as Annex "A"), and every paper on the mark to pick
 * from, each with a link to show it beside the letter.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const event = url.searchParams.get('event');
  if (!isReportEvent(event)) return NextResponse.json({ error: 'Unknown report' }, { status: 400 });

  const annexParam = url.searchParams.get('annexes');
  let annexChoice;
  if (annexParam !== null) {
    let raw: unknown;
    try { raw = JSON.parse(annexParam); } catch { raw = null; }
    const parsed = trademarkReportAnnexesSchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid annexes' }, { status: 400 });
    annexChoice = parsed.data;
  }

  const { id } = await params;
  const [loaded, identity, pdf] = await Promise.all([
    loadClientReport(session.firmId, id, event, session.user.notionUserId, undefined, annexChoice),
    loadOutboundIdentity(session.firmId),
    reportsGoAsPdf(session.firmId),
  ]);
  if (typeof loaded === 'string') return noReport(loaded);
  const { trademark: t, report, annexes, files } = loaded;
  const urls = await signStoragePaths(getServiceDbForFirm(session.firmId), 'files', files.map((f) => f.storagePath), 60 * 60);

  return NextResponse.json({
    event,
    eventDate: report.eventDate,
    subject: report.subject,
    message: report.message,
    caption: report.emailCaption,
    refNo: refNo(t),
    problems: report.problems,
    to: t.contactEmail ? [t.contactEmail] : [],
    addressee: t.clientName,
    annexes: annexes.map((a) => ({ fileId: a.id, document: a.document })),
    files: files.map((f) => ({ id: f.id, name: f.name, sizeBytes: f.sizeBytes, group: f.step, document: annexDocumentFor(f, t), url: urls.get(f.storagePath) ?? null })),
    // The firm's own trademark mailbox the report goes out from; blank until set.
    from: identity.ipAddress,
    // Whether the letter goes as a PDF (the firm converts Word files) or as the Word file.
    pdf,
  });
}
