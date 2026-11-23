import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { assembleDraftGrounding } from '@/lib/ai/draft-grounding';

/**
 * GET /api/drafting/grounding?matterId=&documentType=
 *
 * Preview what a draft would be grounded on (matter brief, prior filings,
 * KMS pages) without spending a drafting call. Powers the studio's
 * "grounded on…" panel.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const matterId = req.nextUrl.searchParams.get('matterId');
  const documentType = req.nextUrl.searchParams.get('documentType') ?? 'legal document';
  // Status-report generation runs with includeAuthorities: false, so the
  // preview must too — otherwise the panel shows curatable authorities that
  // are dead input.
  const isStatusReport = req.nextUrl.searchParams.get('format') === 'status_report';
  if (!matterId) return NextResponse.json({ error: 'matterId required' }, { status: 400 });

  // RLS gate.
  const authed = await getSupabaseServerAuthClient();
  const { data: matter } = await authed.from('matters').select('notion_id').eq('notion_id', matterId).maybeSingle();
  if (!matter) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const grounding = await assembleDraftGrounding({
    firmId: session.firmId,
    matterId,
    documentType,
    includeAuthorities: !isStatusReport,
  });

  return NextResponse.json({
    hasBrief: grounding.briefBlock.length > 0,
    briefPreview: grounding.briefBlock.slice(0, 280),
    ownWork: grounding.ownWork.map((w) => ({
      title: w.title,
      origin: w.origin,
      similarity: Math.round(w.similarity * 100),
    })),
    priorWork: grounding.priorWork.map((w) => ({
      title: w.title,
      matterName: w.matterName,
      deliverableId: w.deliverableId,
      similarity: Math.round(w.similarity * 100),
    })),
    kbPages: grounding.kbPages.map((p) => ({ id: p.id, title: p.title, kind: p.kind, status: p.status })),
    authorities: grounding.authorities.map((a) => ({
      caseNumber: a.caseNumber,
      title: a.title,
      date: a.date,
      url: a.url,
      similarity: Math.round(a.similarity * 100),
    })),
  });
}
