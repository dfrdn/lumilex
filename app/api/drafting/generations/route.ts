import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

/**
 * GET /api/drafting/generations?matterId=
 *
 * Recent documents generated for a matter (Drafting Studio + Document
 * Generator share the generated_documents log). Lets a user re-download a
 * draft after the page refreshes — the on-screen signed URL is one-hour and
 * one-time, so without this a "generate-only" draft (no deliverable) was
 * stranded in storage. Each row is flagged `savedToMatter` when its file is
 * also attached to a deliverable (the durable path).
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const matterId = req.nextUrl.searchParams.get('matterId');
  if (!matterId) return NextResponse.json({ error: 'matterId required' }, { status: 400 });

  // RLS gate.
  const authed = await getSupabaseServerAuthClient();
  const { data: matter } = await authed.from('matters').select('notion_id').eq('notion_id', matterId).maybeSingle();
  if (!matter) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const service = getServiceDbForFirm(session.firmId);
  const { data: docs } = await service
    .from('generated_documents')
    .select('id, file_name, generated_by_name, created_at, storage_path')
    .eq('matter_id', matterId)
    .order('created_at', { ascending: false })
    .limit(25);

  // Which of these are also saved as a matter deliverable (durable) vs download-only.
  const paths = (docs ?? []).map((d) => d.storage_path).filter(Boolean);
  const attached = new Set<string>();
  if (paths.length > 0) {
    const { data: dfRows } = await service.from('deliverable_files').select('file_url').in('file_url', paths);
    for (const r of dfRows ?? []) if (r.file_url) attached.add(r.file_url);
  }

  const generations = (docs ?? []).map((d) => ({
    id: d.id,
    fileName: d.file_name ?? 'Document',
    generatedBy: d.generated_by_name ?? null,
    createdAt: d.created_at,
    savedToMatter: !!d.storage_path && attached.has(d.storage_path),
  }));

  return NextResponse.json({ generations });
}
