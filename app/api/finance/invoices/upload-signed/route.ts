import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm, firmStoragePath } from '@/lib/tenancy/service-db';

/**
 * POST /api/finance/invoices/upload-signed
 *
 * Upload signed PDF versions of the billing letter and the breakdown,
 * browser-to-storage in two phases. Phase 1 (`{ invoiceId, slots }`) mints a
 * signed upload URL per slot; phase 2 (`{ commit: true, uploaded }`) points the
 * invoice at whichever landed.
 *
 * Both paths are deterministic and deliberately overwrite a previous signed
 * copy, so the URLs are minted with `upsert: true` — deleting first would leave
 * the invoice briefly with no signed PDF at all.
 *
 * Scanned signed invoices routinely clear Vercel's 4.5MB serverless request-body
 * cap, which the previous multipart version hit at the platform edge with no
 * server-side trace.
 */
type Slot = 'billingLetterPdf' | 'breakdownPdf';

const SLOT_CONFIG: Record<Slot, { file: string; column: string }> = {
  billingLetterPdf: { file: 'signed-letter.pdf', column: 'signed_pdf_path' },
  breakdownPdf: { file: 'signed-breakdown.pdf', column: 'signed_breakdown_pdf_path' },
};

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user.role ?? 'lawyer';
  if (!['admin', 'super_user', 'finance'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  const invoiceId = String(body.invoiceId ?? '');
  if (!invoiceId) {
    return NextResponse.json({ error: 'invoiceId required' }, { status: 400 });
  }

  const supabase = getServiceDbForFirm(session.firmId);
  // New signed uploads are firm-prefixed; the columns store the full path, so
  // invoices whose signed copies landed pre-tenancy keep resolving as stored.
  const folder = firmStoragePath(session.firmId, `invoices/${invoiceId}`);

  if (body.commit !== true) {
    // Phase 1: one signed URL per slot the caller intends to upload.
    const slots: Slot[] = (Array.isArray(body.slots) ? body.slots : []).filter(
      (sl: unknown): sl is Slot => sl === 'billingLetterPdf' || sl === 'breakdownPdf',
    );
    if (slots.length === 0) {
      return NextResponse.json({ error: 'At least one PDF file required' }, { status: 400 });
    }

    const uploads: Record<string, { storagePath: string; signedUrl: string; token: string }> = {};
    for (const slot of slots) {
      const path = `${folder}/${SLOT_CONFIG[slot].file}`;
      const { data, error } = await supabase.storage
        .from('files')
        .createSignedUploadUrl(path, { upsert: true });
      if (error || !data) {
        console.error('[invoices/upload-signed] createSignedUploadUrl failed', error);
        return NextResponse.json({ error: `Failed to prepare upload for ${slot}` }, { status: 500 });
      }
      uploads[slot] = { storagePath: path, signedUrl: data.signedUrl, token: data.token };
    }
    return NextResponse.json({ uploads });
  }

  // ── Phase 2: confirm each object landed, then point the invoice at it ────
  const uploaded: Slot[] = (Array.isArray(body.uploaded) ? body.uploaded : []).filter(
    (sl: unknown): sl is Slot => sl === 'billingLetterPdf' || sl === 'breakdownPdf',
  );
  if (uploaded.length === 0) {
    return NextResponse.json({ error: 'At least one PDF file required' }, { status: 400 });
  }

  const { data: listed } = await supabase.storage.from('files').list(folder);
  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };

  for (const slot of uploaded) {
    const { file, column } = SLOT_CONFIG[slot];
    if (!listed?.some((o) => o.name === file)) {
      return NextResponse.json(
        { error: `The ${slot === 'billingLetterPdf' ? 'letter' : 'breakdown'} upload did not complete.` },
        { status: 409 },
      );
    }
    updateData[column] = `${folder}/${file}`;
  }

  const { error: updateError } = await supabase
    .from('invoices')
    .update(updateData)
    .eq('id', invoiceId);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  // The caller mirrors these into local state — it was previously reading
  // fields this route never returned, so the optimistic update wrote undefined.
  return NextResponse.json({
    ok: true,
    signedPdfPath: (updateData.signed_pdf_path as string) ?? null,
    signedBreakdownPdfPath: (updateData.signed_breakdown_pdf_path as string) ?? null,
  });
}
