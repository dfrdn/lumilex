import { NextRequest, NextResponse } from 'next/server';
import { getPortalSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { BILLED_INVOICE_STATUSES } from '@/lib/portal/data';

/**
 * GET /api/portal/invoices/[id]/download?type=letter|breakdown
 *
 * Redirects to a short-lived signed URL for the client's own invoice
 * artifact. A client's JWT reads no firm table, so the ownership check is an
 * explicit filter on the firm-scoped service client: the session's own
 * client, billed invoices only.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getPortalSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const invoiceId = Number(id);
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
    return NextResponse.json({ error: 'Invalid invoice id' }, { status: 400 });
  }

  const type = req.nextUrl.searchParams.get('type') ?? 'letter';
  if (!['letter', 'breakdown'].includes(type)) {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  }

  const service = getServiceDbForFirm(session.firmId);
  const { data: invoice } = await service
    .from('invoices')
    .select('id, invoice_number, signed_pdf_path, pdf_storage_path, signed_breakdown_pdf_path, breakdown_pdf_storage_path, xlsx_storage_path')
    .eq('id', invoiceId)
    .eq('client_id', session.user.clientId)
    .in('status', BILLED_INVOICE_STATUSES)
    .maybeSingle();

  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Same precedence batch-send uses when emailing the client.
  const path =
    type === 'letter'
      ? invoice.signed_pdf_path ?? invoice.pdf_storage_path
      : invoice.signed_breakdown_pdf_path ?? invoice.breakdown_pdf_storage_path ?? invoice.xlsx_storage_path;

  if (!path) {
    return NextResponse.json({ error: 'No document available for this invoice' }, { status: 404 });
  }

  const ext = path.split('.').pop()?.toLowerCase() ?? 'pdf';
  const fileName = `${invoice.invoice_number}${type === 'breakdown' ? ' — breakdown' : ''}.${ext}`;

  const { data: signData, error } = await service.storage
    .from('files')
    .createSignedUrl(path, 60 * 10, { download: fileName });

  if (error || !signData?.signedUrl) {
    return NextResponse.json({ error: 'Could not sign document' }, { status: 500 });
  }

  return NextResponse.redirect(signData.signedUrl);
}
