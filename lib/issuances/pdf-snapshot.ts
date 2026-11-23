import { getSupabase } from '@/lib/supabase';
import { getServiceDbForFirm, firmStoragePath } from '@/lib/tenancy/service-db';

/**
 * Download a PDF from a gov.ph source URL and store it in the public
 * `issuances` storage bucket as `<id>.pdf`, then write the bucket's public URL
 * back to the row's `pdf_path`.
 *
 * The bucket is public (issuances are published government documents, not
 * confidential material), so the UI links the stored URL directly — no signed
 * URL, no proxy route.
 *
 * Best-effort: called fire-and-forget from the ingest path. Failures are
 * logged but do not propagate — the row is still useful with just the
 * source_url; we can re-snapshot later via a maintenance script if needed.
 */
const BUCKET = 'issuances';

export async function downloadAndStorePdf(
  firmId: string,
  pdfUrl: string,
  issuanceId: number,
): Promise<void> {
  // Browser-like UA: several gov sites 403 the default node-fetch UA (and any
  // obviously-bot UA). Some sit behind a WAF that blocks server-side fetches
  // regardless — those simply fail the best-effort snapshot and fall back to
  // the direct source_url link.
  const res = await fetch(pdfUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      Accept: 'application/pdf,*/*',
    },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('pdf')) {
    // Some sources serve the PDF behind an HTML splash. Skip rather than
    // store the wrong artifact — the source_url is still usable.
    throw new Error(`Expected PDF, got content-type "${contentType}"`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());

  // Hard cap at ~50MB. Anything larger is almost certainly an indexing
  // mistake, and Vercel's response budget can't hold the upload anyway.
  if (buffer.byteLength > 50 * 1024 * 1024) {
    throw new Error(`PDF too large: ${buffer.byteLength} bytes`);
  }

  // Raw client for the storage handle only; the row update below is scoped.
  const supabase = getSupabase();
  const storagePath = firmStoragePath(firmId, `${issuanceId}.pdf`);
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: 'application/pdf', upsert: true });
  if (uploadErr) throw uploadErr;

  const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  const publicUrl = publicUrlData.publicUrl;

  const { error: updateErr } = await getServiceDbForFirm(firmId)
    .from('issuances')
    .update({ pdf_path: publicUrl, updated_at: new Date().toISOString() })
    .eq('id', issuanceId);
  if (updateErr) throw updateErr;
}
