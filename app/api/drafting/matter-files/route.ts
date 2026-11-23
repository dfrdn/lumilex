import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

/**
 * GET /api/drafting/matter-files?matterId=
 *
 * Lists the matter's files that can be fed to the drafter as the document
 * being responded to — i.e. those we can actually read (a Claude Files API id
 * or extracted text on an analysis). Powers the Drafting Studio's "Responding
 * to" picker for responsive pleadings.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const matterId = req.nextUrl.searchParams.get('matterId');
  if (!matterId) return NextResponse.json({ error: 'matterId required' }, { status: 400 });

  // RLS gate: the authed read returns null unless the caller can access the matter.
  const authed = await getSupabaseServerAuthClient();
  const { data: matter } = await authed.from('matters').select('notion_id').eq('notion_id', matterId).maybeSingle();
  if (!matter) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Service-role for the file + analysis read (the matter ownership decision is
  // already made above). Pull the matter's files, then which of them have
  // readable content from an analysis.
  const service = getServiceDbForFirm(session.firmId);
  const { data: files } = await service
    .from('files')
    .select('notion_id, name, document_date, date_received, created_time, is_court_record')
    .eq('matter_id', matterId)
    .order('created_time', { ascending: false, nullsFirst: false })
    .limit(500);

  // Which of those files Claude can actually read. A file can have many
  // analysis rows (re-analyses, page splits, backfills), so filter to the
  // readable ones server-side and page through them — an unfiltered fetch is
  // capped at 1000 rows by PostgREST and would silently drop files past the cap.
  const fileIds = (files ?? []).map((f) => f.notion_id);
  const readable = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; fileIds.length > 0; from += PAGE) {
    const { data: analyses, error } = await service
      .from('file_analyses')
      .select('file_id')
      .in('file_id', fileIds)
      .or('claude_file_id.not.is.null,extracted_text.not.is.null')
      .range(from, from + PAGE - 1);
    if (error || !analyses || analyses.length === 0) break;
    for (const a of analyses) if (a.file_id) readable.add(a.file_id);
    if (analyses.length < PAGE) break;
  }

  const rows = (files ?? [])
    .filter((f) => readable.has(f.notion_id))
    .map((f) => ({
      id: f.notion_id,
      name: f.name ?? 'Untitled file',
      date: f.document_date || f.date_received || f.created_time || null,
      isCourtRecord: !!f.is_court_record,
    }));

  return NextResponse.json({ files: rows });
}
