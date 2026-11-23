import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { rowToCorporation } from '@/lib/corporation-row';
import { CORPORATION_SELECT, linksFromRow } from '@/lib/corporations/matter-links';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';

/**
 * GET /api/corporation/[id]/deliverables
 * Every deliverable on the company, and the company's matters, for starting
 * new work on one of them.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const supabase = await getSupabaseServerAuthClient();
  const { data: row } = await supabase.from('corporations').select(CORPORATION_SELECT).eq('id', id).maybeSingle();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const corporation = rowToCorporation(row);

  const { data, error } = await supabase
    .from('deliverables').select('notion_id, name, status, type, external_due_date, date_done')
    .eq('subject_id', id).neq('status', DELIVERABLE_STATUS.ARCHIVED)
    .order('created_time', { ascending: false }).limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const matterIds = [...new Set(Object.values(linksFromRow(row)).filter((m): m is string => !!m))];
  const { data: matters } = matterIds.length
    ? await supabase.from('matters').select('notion_id, name, matter_code').in('notion_id', matterIds)
    : { data: [] };

  return NextResponse.json({
    deliverables: (data ?? []).map((r) => ({
      id: r.notion_id as string,
      name: r.name as string,
      status: r.status as string,
      type: (r.type as string | null) ?? null,
      due: (r.external_due_date as string | null) ?? null,
      doneOn: (r.date_done as string | null) ?? null,
    })),
    matters: (matters ?? []).map((m) => ({ id: m.notion_id as string, name: m.name as string, code: (m.matter_code as string | null) ?? '' })),
    defaultMatterId: corporation.effectiveBillingMatterId,
  });
}
