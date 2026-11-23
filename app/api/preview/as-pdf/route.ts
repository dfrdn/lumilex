import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm, firmStoragePath } from '@/lib/tenancy/service-db';
import { checkPathUnder } from '@/lib/storage/upload-path';
import { channelOfAttachment } from '@/lib/chat/attachment-path';
import { convertDocxToPdf, GraphNotConfiguredError } from '@/lib/microsoft-graph';
import { isFeatureAvailable } from '@/lib/firm/features';

const DOCX_EXT = /\.docx?$/i;

/**
 * POST /api/preview/as-pdf
 * Body: { path: string, bucket?: 'chat-attachments' | 'files' }
 *
 * For docx/doc files, converts to PDF via MS Graph and returns a signed URL to
 * the converted PDF. For other types, returns a signed inline URL to the
 * original (since SFSafariViewController renders PDFs and images natively).
 *
 * Access control:
 * - chat-attachments: the key must sit under this firm's chat folder, and the
 *   caller must be a member of the channel it names.
 * - files: the key must sit under this firm's prefix (matches `/api/file-sign`).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const path: unknown = body?.path;
  const bucket: 'chat-attachments' | 'files' =
    body?.bucket === 'chat-attachments' ? 'chat-attachments' : 'files';
  if (!path || typeof path !== 'string') {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  }

  const supabase = getServiceDbForFirm(session.firmId);

  if (bucket === 'chat-attachments') {
    const channelId = channelOfAttachment(session.firmId, path);
    if (!channelId) return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    const { data: ch } = await supabase
      .from('chat_channels')
      .select('member_ids')
      .eq('id', channelId)
      .maybeSingle();
    if (!ch || !ch.member_ids.includes(session.user.notionUserId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  } else if (!checkPathUnder(path, session.firmId).ok) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  // Non-docx files don't need conversion — just hand back a fresh inline URL.
  if (!DOCX_EXT.test(path)) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, 60 * 60, { download: false });
    if (error || !data?.signedUrl) {
      return NextResponse.json({ error: error?.message ?? 'Sign failed' }, { status: 500 });
    }
    return NextResponse.json({ url: data.signedUrl });
  }

  // Cache the conversion under the firm's `_previews/<sha256>.pdf`. If a PDF
  // already exists for this exact storage path we reuse it rather than
  // burning a Graph call.
  const hash = crypto.createHash('sha256').update(path).digest('hex').slice(0, 24);
  const pdfKey = firmStoragePath(session.firmId, `_previews/${hash}.pdf`);

  const existing = await supabase.storage.from(bucket).createSignedUrl(pdfKey, 60 * 60, {
    download: false,
  });
  if (existing.data?.signedUrl && !existing.error) {
    return NextResponse.json({ url: existing.data.signedUrl, cached: true });
  }

  // Download original, convert, upload converted PDF.
  const dl = await supabase.storage.from(bucket).download(path);
  if (dl.error || !dl.data) {
    return NextResponse.json({ error: dl.error?.message ?? 'Download failed' }, { status: 500 });
  }
  const docxBuffer = Buffer.from(await dl.data.arrayBuffer());

  if (!(await isFeatureAvailable(session.firmId, 'docx_pdf'))) {
    return NextResponse.json(
      { error: 'PDF conversion is not enabled for this firm.' },
      { status: 503 },
    );
  }

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await convertDocxToPdf(session.firmId, docxBuffer, path.split('/').pop() ?? 'doc.docx');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Conversion failed';
    return NextResponse.json(
      { error: msg },
      { status: e instanceof GraphNotConfiguredError ? 503 : 502 },
    );
  }

  const up = await supabase.storage
    .from(bucket)
    .upload(pdfKey, pdfBuffer, { contentType: 'application/pdf', upsert: true });
  if (up.error) {
    return NextResponse.json({ error: up.error.message }, { status: 500 });
  }

  const signed = await supabase.storage
    .from(bucket)
    .createSignedUrl(pdfKey, 60 * 60, { download: false });
  if (signed.error || !signed.data?.signedUrl) {
    return NextResponse.json({ error: signed.error?.message ?? 'Sign failed' }, { status: 500 });
  }
  return NextResponse.json({ url: signed.data.signedUrl });
}
