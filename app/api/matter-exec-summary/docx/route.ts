import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { generateExecSummaryDocx } from '@/lib/docx/exec-summary';
import { attachmentDisposition } from '@/lib/download-headers';

export const maxDuration = 60;

/**
 * GET /api/matter-exec-summary/docx?matterId=xxx
 * Streams the latest executive summary as a DOCX attachment.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const matterId = url.searchParams.get('matterId');
  if (!matterId) {
    return NextResponse.json({ error: 'matterId required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();

  const { data: matter } = await supabase
    .from('matters')
    .select('name, matter_code, case_number, court, client_name, status')
    .eq('notion_id', matterId)
    .single();

  if (!matter) {
    return NextResponse.json({ error: 'Matter not found' }, { status: 404 });
  }

  const { data: summary } = await supabase
    .from('matter_exec_summaries')
    .select('*')
    .eq('matter_id', matterId)
    .maybeSingle();

  if (!summary) {
    return NextResponse.json({ error: 'Executive summary not generated yet' }, { status: 404 });
  }

  const generatedAt = new Date(summary.updated_at).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Manila',
  });

  const buffer = await generateExecSummaryDocx({
    matterName: matter.name,
    matterCode: matter.matter_code,
    clientName: matter.client_name,
    caseNumber: matter.case_number,
    court: matter.court,
    status: matter.status,
    generatedAt,
    overview: summary.overview ?? '',
    currentPosture: summary.current_posture ?? '',
    parties: summary.parties ?? [],
    timeline: summary.timeline ?? [],
    keyRulings: summary.key_rulings ?? [],
    openItems: summary.open_items ?? [],
    readingList: summary.reading_list ?? [],
  });

  const safeName = matter.name.replace(/[^a-zA-Z0-9-_]+/g, '_');
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': attachmentDisposition(`Executive_Summary_${safeName}.docx`),
      'Cache-Control': 'no-store',
    },
  });
}
