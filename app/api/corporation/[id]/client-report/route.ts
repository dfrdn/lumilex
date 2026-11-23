import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { loadOutboundIdentity } from '@/lib/firm/outbound-identity';
import { reportsGoAsPdf } from '@/lib/client-reports/server';
import { signStoragePaths } from '@/lib/storage-sign';
import { isCorporateReportEvent } from '@/lib/corporations/client-report';
import { corporationReportAnnexesSchema } from '@/lib/validation';
import { loadCorporateReport, noCorporateReport } from '@/lib/corporations/client-report-server';

/**
 * GET /api/corporation/[id]/client-report?event=bir_registration[&itemId=…][&annexes=<json>]
 * The report on something done for the company, to review before it goes
 * out: the email's subject and opening, the caption, what the record is
 * missing, the papers going as its annexes (by default the event's own
 * paper as Annex "A"), and every paper on the company to pick from, each
 * with a link to show it beside the letter.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const event = url.searchParams.get('event');
  if (!isCorporateReportEvent(event)) return NextResponse.json({ error: 'Unknown report' }, { status: 400 });

  const annexParam = url.searchParams.get('annexes');
  let annexChoice;
  if (annexParam !== null) {
    let raw: unknown;
    try { raw = JSON.parse(annexParam); } catch { raw = null; }
    const parsed = corporationReportAnnexesSchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid annexes' }, { status: 400 });
    annexChoice = parsed.data;
  }

  const { id } = await params;
  const [loaded, identity, pdf] = await Promise.all([
    loadCorporateReport(session.firmId, id, event, url.searchParams.get('itemId'), session.user.notionUserId, undefined, annexChoice),
    loadOutboundIdentity(session.firmId),
    reportsGoAsPdf(session.firmId),
  ]);
  if (typeof loaded === 'string') return noCorporateReport(loaded);
  const { report, annexes, files, context } = loaded;
  // One request for the whole list: each storage request in flight holds a pooler connection.
  const urls = await signStoragePaths(getServiceDbForFirm(session.firmId), 'files', files.map((f) => f.storagePath), 60 * 60);

  return NextResponse.json({
    eventDate: report.eventDate,
    subject: report.subject,
    message: report.message,
    caption: report.emailCaption,
    refNo: context.refNo,
    problems: report.problems,
    to: loaded.to,
    addressee: context.clientName,
    attention: loaded.attention,
    annexes: annexes.map((a) => ({ fileId: a.id, document: a.document })),
    files: files.map((f) => ({ id: f.id, name: f.name, sizeBytes: f.sizeBytes, group: f.group, document: f.document, url: urls.get(f.storagePath) ?? null })),
    // The firm's own compliance mailbox the report goes out from; blank until set.
    from: identity.complianceAddress,
    // Whether the letter goes as a PDF (the firm converts Word files) or as the Word file.
    pdf,
  });
}
