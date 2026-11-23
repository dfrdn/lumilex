import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

/**
 * GET /api/matter-health/[id]
 *
 * Returns the cached health row for one matter. Team-only.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const supabase = getServiceDbForFirm(session.firmId);
  const { data, error } = await supabase
    .from('matter_health')
    .select('matter_id, score, tier, signals, narrative, generated_at, needs_refresh')
    .eq('matter_id', id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ health: null });

  return NextResponse.json({ health: data });
}
