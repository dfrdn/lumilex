import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { validateBody, corporationClientReportSchema } from '@/lib/validation';
import { attachmentDisposition } from '@/lib/download-headers';
import { DOCX_TYPE, reportDocx } from '@/lib/client-reports/server';
import { corporateReportFileName, loadCorporateReport, noCorporateReport } from '@/lib/corporations/client-report-server';

/** POST /api/corporation/[id]/client-report/docx — the report as a Word file, to check or finish by hand. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const validation = await validateBody(req, corporationClientReportSchema);
  if (!validation.success) return validation.response;
  const { event, itemId, letter, annexes } = validation.data;

  const { id } = await params;
  const loaded = await loadCorporateReport(session.firmId, id, event, itemId, session.user.notionUserId, letter, annexes);
  if (typeof loaded === 'string') return noCorporateReport(loaded);

  const docx = await reportDocx(session.firmId, loaded.report.paragraphs);
  return new NextResponse(new Uint8Array(docx), {
    headers: {
      'Content-Type': DOCX_TYPE,
      'Content-Disposition': attachmentDisposition(corporateReportFileName(loaded)),
    },
  });
}
