import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { validateBody, trademarkClientReportPreviewSchema } from '@/lib/validation';
import { loadClientReport, noReport, reportDocx, reportFileName } from '@/lib/trademarks/client-report-server';
import { readEditedLetter, reportPdf } from '@/lib/client-reports/server';

/** Converting the letter to PDF goes through Microsoft Graph. */
export const maxDuration = 60;

/**
 * POST /api/trademark/[id]/client-report/pdf
 * The letter as the client will get it — the PDF — to look at before sending.
 * Nothing is stored. A firm without Word-to-PDF conversion sends the letter as
 * a Word file, and is told so here.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const validation = await validateBody(req, trademarkClientReportPreviewSchema);
  if (!validation.success) return validation.response;
  const { event, letter, annexes, editedLetter } = validation.data;

  const edited = editedLetter ? readEditedLetter(editedLetter) : null;
  if (edited && 'error' in edited) return NextResponse.json({ error: edited.error }, { status: 400 });

  const { id } = await params;
  const loaded = await loadClientReport(session.firmId, id, event, session.user.notionUserId, letter, annexes);
  if (typeof loaded === 'string') return noReport(loaded);

  const docx = edited?.docx ?? await reportDocx(session.firmId, loaded.report);
  let pdf: Buffer | null;
  try {
    pdf = await reportPdf(session.firmId, docx, edited?.name ?? reportFileName(loaded.trademark, event, loaded.report.eventDate));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not convert the letter to PDF' }, { status: 502 });
  }
  if (!pdf) {
    return NextResponse.json({ error: 'This firm sends the letter as a Word file; there is no PDF to preview.' }, { status: 409 });
  }
  return new NextResponse(new Uint8Array(pdf), {
    headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' },
  });
}
