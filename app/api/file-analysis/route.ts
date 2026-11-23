import { NextResponse, after } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { isSupportedFileType } from '@/lib/ai/document-parser';
import { processAnalysisBackground } from '@/lib/ai/auto-analyze';
import type { FileAnalysis } from '@/types/ai';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): FileAnalysis {
  return {
    id: row.id,
    fileId: row.file_id,
    attachmentName: row.attachment_name,
    status: row.status,
    summary: row.summary,
    entities: row.entities,
    modelUsed: row.model_used,
    shortSummary: row.short_summary ?? null,
    extractedText: row.extracted_text ?? null,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

// ── GET: Fetch cached analysis ──────────────────────────────────

export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const fileId = searchParams.get('fileId');
  const attachmentName = searchParams.get('attachmentName') ?? '';

  if (!fileId) {
    return NextResponse.json({ error: 'Missing fileId' }, { status: 400 });
  }

  const supabase = getServiceDbForFirm(session.firmId);

  // Find the most recent analysis for this file+attachment
  const { data, error } = await supabase
    .from('file_analyses')
    .select('*')
    .eq('file_id', fileId)
    .eq('attachment_name', attachmentName)
    .in('status', ['completed', 'processing', 'pending', 'failed'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[file-analysis]', error.message); return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ analysis: data ? mapRow(data) : null });
}

// ── POST: Trigger analysis ──────────────────────────────────────

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { fileId, attachmentIndex = 0, reanalyze = false } = await req.json();

  if (!fileId) {
    return NextResponse.json({ error: 'Missing fileId' }, { status: 400 });
  }

  const personId = session.user.notionUserId;
  const supabase = getServiceDbForFirm(session.firmId);

  // 1. Load file record
  const { data: file, error: fileError } = await supabase
    .from('files')
    .select('name, matter_name, file_urls')
    .eq('notion_id', fileId)
    .single();

  if (fileError || !file) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  // Parse file_urls and resolve storage paths to signed URLs
  const fileUrlsRaw: { name: string; url: string; path?: string }[] =
    typeof file.file_urls === 'string' ? JSON.parse(file.file_urls) : (file.file_urls ?? []);

  if (fileUrlsRaw.length === 0) {
    return NextResponse.json({ error: 'No attachments on this file' }, { status: 400 });
  }

  const idx = Math.min(attachmentIndex, fileUrlsRaw.length - 1);
  const raw = fileUrlsRaw[idx];

  // Resolve storage path to a fresh signed URL
  // Prefer explicit path, fall back to extracting from an existing Supabase signed URL
  let storagePath = raw.path;
  if (!storagePath) {
    const match = raw.url.match(/\/storage\/v1\/object\/sign\/files\/([^?]+)/);
    if (match) storagePath = decodeURIComponent(match[1]);
  }

  let attachmentUrl = raw.url;
  if (storagePath) {
    const { data: signData } = await supabase.storage
      .from('files')
      .createSignedUrl(storagePath, 60 * 60);
    attachmentUrl = signData?.signedUrl ?? raw.url;
  }
  const attachment = { name: raw.name, url: attachmentUrl };

  // 2. Clean up failed attempts so retries start fresh
  await supabase
    .from('file_analyses')
    .delete()
    .eq('file_id', fileId)
    .eq('attachment_name', attachment.name)
    .eq('status', 'failed');

  // 2b. If re-analyze requested, delete existing completed analysis too
  if (reanalyze) {
    await supabase
      .from('file_analyses')
      .delete()
      .eq('file_id', fileId)
      .eq('attachment_name', attachment.name);
  } else {
    // 3. Check for existing completed/processing analysis
    const { data: existing } = await supabase
      .from('file_analyses')
      .select('*')
      .eq('file_id', fileId)
      .eq('attachment_name', attachment.name)
      .in('status', ['completed', 'processing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ analysis: mapRow(existing) });
    }
  }

  // 4. Validate file type
  if (!isSupportedFileType(attachment.url)) {
    const ext = attachment.url.split('?')[0].split('.').pop()?.toLowerCase() ?? 'unknown';
    return NextResponse.json({
      error: `Unsupported file type (.${ext}). Only PDF and Word documents can be analyzed.`,
    }, { status: 400 });
  }

  // 5. Insert pending row
  const { data: row, error: insertError } = await supabase
    .from('file_analyses')
    .insert({
      file_id: fileId,
      attachment_name: attachment.name,
      attachment_url: attachment.url,
      status: 'pending',
      analyzed_by: personId,
    })
    .select('*')
    .single();

  if (insertError) {
    // Unique constraint violation — analysis already in progress
    if (insertError.code === '23505') {
      const { data: existing2 } = await supabase
        .from('file_analyses')
        .select('*')
        .eq('file_id', fileId)
        .eq('attachment_name', attachment.name)
        .in('status', ['completed', 'processing'])
        .limit(1)
        .maybeSingle();
      if (existing2) return NextResponse.json({ analysis: mapRow(existing2) });
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const analysisId = row.id;

  // 6. Process in the background — `after()` keeps the serverless function alive
  // until the work completes, unlike fire-and-forget which gets killed by Vercel.
  after(async () => {
    try {
      await processAnalysisBackground(analysisId, fileId, attachment, file.name, file.matter_name, session.firmId);
    } catch (err) {
      console.error('[file-analysis] Background processing failed:', err);
    }
  });

  return NextResponse.json({ analysis: mapRow(row) });
}

