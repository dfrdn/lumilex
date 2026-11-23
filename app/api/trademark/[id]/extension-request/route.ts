import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { loadOutboundIdentity } from '@/lib/firm/outbound-identity';
import { DOCX_TYPE, loadReportEmailFirm } from '@/lib/client-reports/server';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { validateBody, trademarkExtensionRequestSchema } from '@/lib/validation';
import { TRADEMARK_SELECT, rowToTrademark } from '@/lib/trademark-row';
import { manilaToday } from '@/lib/dates';
import { isAbroad } from '@/lib/trademark-deadlines';
import { attachmentDisposition } from '@/lib/download-headers';
import { buildLetterBody } from '@/lib/docx/letter-body';
import { placeOnLetterhead } from '@/lib/docx/on-letterhead';
import { buildExtensionRequest, extensionFileName } from '@/lib/trademarks/extension-request';

/**
 * POST /api/trademark/[id]/extension-request — the request for extension of
 * time to IPOPHL as a Word file on the letterhead, signed by the person
 * drafting it as counsel. The mark is read on their JWT, so one they can't
 * see is not found.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const validation = await validateBody(req, trademarkExtensionRequestSchema);
  if (!validation.success) return validation.response;

  const { id } = await params;
  const authed = await getSupabaseServerAuthClient();
  const { data: row } = await authed.from('trademarks').select(TRADEMARK_SELECT).eq('id', id).maybeSingle();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const trademark = rowToTrademark(row);
  if (isAbroad(trademark)) {
    return NextResponse.json({ error: 'IPOPHL isn’t examining this designation; more time is asked of its own office, through the local agent.' }, { status: 409 });
  }

  const { data: me } = await getServiceDbForFirm(session.firmId).from('team').select('name, position').eq('person_id', session.user.notionUserId).maybeSingle();
  const today = manilaToday();
  const paragraphs = buildExtensionRequest(trademark, validation.data, {
    today,
    signatory: { name: me?.name ?? session.user.name ?? '', position: me?.position ?? null },
    firm: { ...(await loadReportEmailFirm(session.firmId)), email: (await loadOutboundIdentity(session.firmId)).ipAddress },
  });
  const docx = await placeOnLetterhead(session.firmId, (parts) => buildLetterBody(paragraphs, parts));

  return new NextResponse(new Uint8Array(docx), {
    headers: {
      'Content-Type': DOCX_TYPE,
      'Content-Disposition': attachmentDisposition(extensionFileName(trademark, today)),
    },
  });
}
