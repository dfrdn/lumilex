import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { attachmentDisposition } from '@/lib/download-headers';
import JSZip from 'jszip';

export const maxDuration = 60;

const STORAGE_BUCKET = 'files';

function fileExt(path: string): string {
  const m = path.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : 'bin';
}
const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
function safeName(name: string): string {
  // eslint-disable-next-line no-useless-escape
  return name.replace(/[\/\\:*?"<>|]+/g, '-').trim();
}

/**
 * POST /api/finance/invoices/bulk-download  { month, clients?: string[] }
 *
 * Zips the generated invoice documents — the billing letter (signed PDF →
 * auto PDF → DOCX fallback) and the breakdown PDF (signed → auto) — for the
 * selected clients in a month. Returns the single file when there's exactly one,
 * else a zip. The Review dashboard's "Download invoices" bulk action.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== 'finance' && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { month, clients } = body as { month?: string; clients?: string[] };
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month must be in YYYY-MM format' }, { status: 400 });
  }

  const supabase = getServiceDbForFirm(session.firmId);
  let query = supabase
    .from('invoices')
    .select('invoice_number, client_name, signed_pdf_path, pdf_storage_path, docx_storage_path, signed_breakdown_pdf_path, breakdown_pdf_storage_path')
    .eq('billing_month', month)
    .order('invoice_number', { ascending: true });
  if (Array.isArray(clients) && clients.length > 0) {
    query = query.in('client_name', clients);
  }
  const { data: invoices, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!invoices || invoices.length === 0) {
    return NextResponse.json({ error: 'No invoices found for the selected clients/month.' }, { status: 404 });
  }

  const files: { filename: string; buffer: Buffer }[] = [];
  for (const inv of invoices) {
    const letterPath = inv.signed_pdf_path || inv.pdf_storage_path || inv.docx_storage_path;
    const breakdownPath = inv.signed_breakdown_pdf_path || inv.breakdown_pdf_storage_path;
    const baseName = safeName(`${inv.invoice_number} - ${inv.client_name}`);
    if (letterPath) {
      const { data, error: dErr } = await supabase.storage.from(STORAGE_BUCKET).download(letterPath);
      if (!dErr && data) {
        files.push({ filename: `${baseName} Letter.${fileExt(letterPath)}`, buffer: Buffer.from(await data.arrayBuffer()) });
      }
    }
    if (breakdownPath) {
      const { data, error: dErr } = await supabase.storage.from(STORAGE_BUCKET).download(breakdownPath);
      if (!dErr && data) {
        files.push({ filename: `${baseName} Breakdown.${fileExt(breakdownPath)}`, buffer: Buffer.from(await data.arrayBuffer()) });
      }
    }
  }

  if (files.length === 0) {
    return NextResponse.json({ error: 'The selected invoices have no downloadable documents yet.' }, { status: 404 });
  }

  const [y, m] = month.split('-');
  const display = new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  if (files.length === 1) {
    return new NextResponse(files[0].buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': MIME_BY_EXT[fileExt(files[0].filename)] ?? 'application/octet-stream',
        'Content-Disposition': attachmentDisposition(files[0].filename),
      },
    });
  }

  const zip = new JSZip();
  for (const f of files) zip.file(f.filename, f.buffer);
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  return new NextResponse(zipBuffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': attachmentDisposition(`Invoices ${display}.zip`),
    },
  });
}
