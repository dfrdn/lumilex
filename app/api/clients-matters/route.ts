import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { MATTER_STATUS } from '@/lib/matter-status';
import { pgInList } from '@/lib/postgrest';

/**
 * GET /api/clients-matters
 * Returns all clients + active matters for the DTR modal dropdowns.
 * Matters are grouped by client_id so the frontend can filter dynamically.
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = await getSupabaseServerAuthClient();

  const [{ data: clients }, { data: matters }, { data: activeTeam }] = await Promise.all([
    supabase
      .from('clients')
      .select('notion_id, name')
      .order('name'),
    supabase
      .from('matters')
      .select('notion_id, name, matter_code, client_id, client_name, team_person_ids, type')
      .not('status', 'in', pgInList([MATTER_STATUS.ARCHIVED, MATTER_STATUS.DONE]))
      .order('name'),
    supabase
      .from('team')
      .select('person_id')
      .eq('active', true),
  ]);

  // Strip inactive members from every matter's team so auto-derive flows
  // (AddDeliverableModal, AddFilingModal, AddMeetingModal, AddHearingModal,
  // AddRowModal) never propagate them onto new entities. The underlying
  // matter.team_person_ids column is left intact so reactivation restores
  // membership.
  const activeIds = new Set((activeTeam ?? []).map((r: { person_id: string }) => r.person_id));

  return NextResponse.json({
    clients: (clients ?? []).map((c: { notion_id: string; name: string }) => ({
      id: c.notion_id,
      name: c.name,
    })),
    matters: (matters ?? []).map((m: { notion_id: string; name: string; matter_code: string; client_id: string; client_name: string; team_person_ids: string[]; type: string }) => ({
      id: m.notion_id,
      name: m.name,
      code: m.matter_code,
      clientId: m.client_id,
      teamPersonIds: (m.team_person_ids ?? []).filter((id) => activeIds.has(id)),
      type: m.type ?? '',
    })),
  });
}
