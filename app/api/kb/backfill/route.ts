import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { validateBody } from '@/lib/validation';
import { runKbBackfill } from '@/lib/ai/kb-backfill';

// Sonnet synthesis over a batch can run long; cap the per-request matter
// count so it stays within the function timeout. Full-archive runs use
// scripts/backfill-kb.ts instead.
export const maxDuration = 300;

const bodySchema = z.object({
  statuses: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(40).nullable().optional(),
  minContributors: z.number().int().min(1).max(10).optional(),
  kinds: z.array(z.string()).optional(),
  matterIds: z.array(z.string()).optional(),
});

/**
 * POST /api/kb/backfill — mine the matter archive into draft KB pages.
 * Admin/partner only. Bounded per request (default 25 matters).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!['partner', 'admin', 'super_user'].includes(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const validation = await validateBody(req, bodySchema);
  if (!validation.success) return validation.response;
  const body = validation.data;

  try {
    const { jobId, stats } = await runKbBackfill(
      session.firmId,
      {
        statuses: body.statuses,
        limit: body.limit === undefined ? 25 : body.limit,
        minContributors: body.minContributors,
        kinds: body.kinds as never,
        matterIds: body.matterIds,
      },
      session.user.notionUserId,
    );
    return NextResponse.json({ jobId, stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Backfill failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/kb/backfill — recent job history.
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!['partner', 'admin', 'super_user'].includes(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const { data } = await supabase
    .from('kb_jobs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(20);

  return NextResponse.json({ jobs: data ?? [] });
}
