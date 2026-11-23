import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

/**
 * GET /api/file-analysis/batch?fileIds=id1,id2,id3
 * Returns short_summary and status for multiple files at once.
 * Used by the inbox to batch-fetch AI summaries.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const fileIdsParam = searchParams.get('fileIds');

  if (!fileIdsParam) {
    return NextResponse.json({ error: 'Missing fileIds' }, { status: 400 });
  }

  const fileIds = fileIdsParam.split(',').filter(Boolean);
  if (fileIds.length === 0) {
    return NextResponse.json({ summaries: {} });
  }

  // Cap at 100 to prevent abuse
  const ids = fileIds.slice(0, 100);

  const supabase = getServiceDbForFirm(session.firmId);

  // Fetch the latest analysis for each file (may have multiple attachments — take first)
  const { data, error } = await supabase
    .from('file_analyses')
    .select('file_id, short_summary, status')
    .in('file_id', ids)
    .in('status', ['completed', 'processing', 'pending'])
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[file-analysis-batch]', error.message); return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Deduplicate: keep only the first (most recent) per file_id
  const summaries: Record<string, { shortSummary: string | null; status: string }> = {};
  for (const row of data ?? []) {
    if (!summaries[row.file_id]) {
      summaries[row.file_id] = {
        shortSummary: row.short_summary ?? null,
        status: row.status,
      };
    }
  }

  return NextResponse.json({ summaries });
}
