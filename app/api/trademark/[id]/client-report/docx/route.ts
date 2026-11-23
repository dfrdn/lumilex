import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { validateBody, trademarkClientReportSchema } from '@/lib/validation';
import { attachmentDisposition } from '@/lib/download-headers';
import { loadClientReport, noReport, reportDocx, reportFileName } from '@/lib/trademarks/client-report-server';
import { DOCX_TYPE } from '@/lib/client-reports/server';

/** POST /api/trademark/[id]/client-report/docx — the report as a Word file, to check or finish by hand. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const validation = await validateBody(req, trademarkClientReportSchema);
  if (!validation.success) return validation.response;
  const { event, letter, annexes } = validation.data;

  const { id } = await params;
  const loaded = await loadClientReport(session.firmId, id, event, session.user.notionUserId, letter, annexes);
  if (typeof loaded === 'string') return noReport(loaded);

  const docx = await reportDocx(session.firmId, loaded.report);
  return new NextResponse(new Uint8Array(docx), {
    headers: {
      'Content-Type': DOCX_TYPE,
      'Content-Disposition': attachmentDisposition(reportFileName(loaded.trademark, event, loaded.report.eventDate)),
    },
  });
}
