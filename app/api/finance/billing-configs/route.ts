import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { MATTER_STATUS } from '@/lib/matter-status';

/**
 * GET /api/finance/billing-configs
 * List all matter billing configurations with matter details.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  if (!['finance', 'super_user', 'admin', 'partner'].includes(role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = await getSupabaseServerAuthClient();

  // Fetch all billing configs
  const { data: configs, error: configErr } = await supabase
    .from('matter_billing_configs')
    .select('*')
    .order('updated_at', { ascending: false });

  if (configErr) {
    return NextResponse.json({ error: configErr.message }, { status: 500 });
  }

  // Fetch matter details for all configured matters
  const matterIds = (configs ?? []).map((c: { matter_id: string }) => c.matter_id);

  let mattersMap: Record<string, { name: string; client_name: string; status: string }> = {};
  if (matterIds.length > 0) {
    const { data: matters } = await supabase
      .from('matters')
      .select('notion_id, name, client_name, status')
      .in('notion_id', matterIds);

    (matters ?? []).forEach((m: { notion_id: string; name: string; client_name: string; status: string }) => {
      mattersMap[m.notion_id] = { name: m.name, client_name: m.client_name, status: m.status };
    });
  }

  // Also get unconfigured active matters for the "set up" list
  const showUnconfigured = req.nextUrl.searchParams.get('includeUnconfigured') === 'true';
  let unconfiguredMatters: { matterId: string; name: string; clientName: string }[] = [];

  if (showUnconfigured) {
    const { data: allMatters } = await supabase
      .from('matters')
      .select('notion_id, name, client_name')
      .eq('status', MATTER_STATUS.ONGOING)
      .order('client_name', { ascending: true });

    const configuredSet = new Set(matterIds);
    unconfiguredMatters = (allMatters ?? [])
      .filter((m: { notion_id: string }) => !configuredSet.has(m.notion_id))
      .map((m: { notion_id: string; name: string; client_name: string }) => ({
        matterId: m.notion_id,
        name: m.name,
        clientName: m.client_name,
      }));
  }

  const enriched = (configs ?? []).map((c: Record<string, unknown>) => ({
    ...c,
    matterName: mattersMap[c.matter_id as string]?.name ?? 'Unknown Matter',
    clientName: mattersMap[c.matter_id as string]?.client_name ?? '',
    matterStatus: mattersMap[c.matter_id as string]?.status ?? '',
  }));

  return NextResponse.json({
    configs: enriched,
    unconfiguredMatters,
  });
}
