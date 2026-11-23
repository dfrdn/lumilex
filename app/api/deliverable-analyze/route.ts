import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { triggerDeliverableVersionAnalysisIfFinalized } from '@/lib/ai/auto-analyze';

export const maxDuration = 10;

/**
 * POST /api/deliverable-analyze
 * Fire-and-forget analysis of the latest version of a deliverable. Called
 * exclusively from Postgres webhook triggers on `deliverables` (status flips
 * to a finalized state) and `deliverable_files` (new version inserted while
 * parent is finalized). Self-gates inside `triggerDeliverableVersionAnalysisIfFinalized`,
 * so re-firing across Filed→Submitted→Acknowledged or multi-file uploads is safe.
 *
 * Auth: cron secret bearer (same shared secret used by other DB-driven webhooks
 * via `call_app_api_post`). A payload firmId scopes the existence check — a
 * mismatched firmId finds nothing and 404s (fail-safe); a legacy payload
 * without one is resolved from the deliverable row.
 */
export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { deliverableId, firmId } = await req.json();
  if (!deliverableId || typeof deliverableId !== 'string') {
    return NextResponse.json({ error: 'Missing deliverableId' }, { status: 400 });
  }

  // firm-resolution lookup: scoped client follows. A legacy trigger payload
  // carries no firmId, so the row's own firm is read unscoped and every
  // subsequent operation runs through the firm-scoped client.
  const db = typeof firmId === 'string' ? getServiceDbForFirm(firmId) : getSupabase();
  const { data: row } = await db
    .from('deliverables')
    .select('notion_id, firm_id')
    .eq('notion_id', deliverableId)
    .maybeSingle();
  if (!row?.firm_id) {
    return NextResponse.json({ error: 'Deliverable not found' }, { status: 404 });
  }

  triggerDeliverableVersionAnalysisIfFinalized(deliverableId, row.firm_id as string);

  return NextResponse.json({ ok: true });
}
