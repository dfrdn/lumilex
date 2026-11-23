import { redirect } from 'next/navigation';
import { requireRouteAccess } from '@/lib/nav/guard';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

export const revalidate = 0;

/**
 * The prospect page's entry into the proposal builder. Proposals are no longer
 * addressed only to prospects, so they live under their own route and are keyed
 * by proposal rather than by intake — this hop resolves the prospect's newest
 * version, or opens the draft dialog on the list with the prospect chosen.
 */
export default async function ProspectProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireRouteAccess(`/dashboard/prospects/${id}/proposal`);

  const intakeId = parseInt(id, 10);
  if (isNaN(intakeId)) redirect('/dashboard/prospects');

  const supabase = await getSupabaseServerAuthClient();
  const { data: latest } = await supabase
    .from('engagement_proposals')
    .select('id')
    .eq('intake_id', intakeId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  redirect(
    latest
      ? `/dashboard/prospects/proposals/${latest.id}`
      : `/dashboard/prospects/proposals?new=prospect:${intakeId}`,
  );
}
