// Helpers for marking a matter's brief as out-of-sync with its underlying
// data. A scheduled job at /api/matter-summary/refresh-stale picks up any
// matter_summaries row with needs_refresh = TRUE and regenerates. Idempotent
// and safe to call fire-and-forget.

import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

/**
 * Mark a single matter's brief as stale.
 */
export async function markMatterBriefStale(matterId: string, firmId: string): Promise<void> {
  if (!matterId) return;
  const supabase = getServiceDbForFirm(firmId);
  // Update in place if a row exists; no-op if not (first brief will set itself
  // to not-stale on generation).
  await supabase
    .from('matter_summaries')
    .update({ needs_refresh: true, refresh_requested_at: new Date().toISOString() })
    .eq('matter_id', matterId);
}

/**
 * Mark a single matter's health row as stale, upserting if missing so the cron
 * always has work to pick up.
 */
export async function markMatterHealthStale(matterId: string, firmId: string): Promise<void> {
  if (!matterId) return;
  const supabase = getServiceDbForFirm(firmId);
  await supabase
    .from('matter_health')
    .upsert(
      { matter_id: matterId, needs_refresh: true, refresh_requested_at: new Date().toISOString() },
      { onConflict: 'matter_id' },
    );
}

/**
 * Mark both the brief and the health artifact stale for a matter. Use this
 * from triggers (file analysis complete, deliverable status change, exhibit
 * mutated) so the two artifacts refresh in lockstep.
 */
export async function markMatterArtifactsStale(matterId: string, firmId: string): Promise<void> {
  if (!matterId) return;
  await Promise.all([markMatterBriefStale(matterId, firmId), markMatterHealthStale(matterId, firmId)]);
}

/**
 * Mark a matter's brief stale given a file notion_id — resolves matter_id via
 * the files table. Used after a file analysis completes.
 */
export async function markBriefStaleForFile(fileId: string, firmId: string): Promise<void> {
  const supabase = getServiceDbForFirm(firmId);
  const { data } = await supabase
    .from('files')
    .select('matter_id')
    .eq('notion_id', fileId)
    .maybeSingle();
  if (data?.matter_id) await markMatterBriefStale(data.matter_id, firmId);
}

/**
 * Mark a matter's brief stale given a deliverable_file id — resolves matter_id
 * via the deliverable_files -> deliverables chain. Used after a deliverable
 * version analysis completes.
 */
export async function markBriefStaleForDeliverableFile(deliverableFileId: number, firmId: string): Promise<void> {
  const supabase = getServiceDbForFirm(firmId);
  const { data: df } = await supabase
    .from('deliverable_files')
    .select('deliverable_id')
    .eq('id', deliverableFileId)
    .maybeSingle();
  if (!df?.deliverable_id) return;
  const { data: d } = await supabase
    .from('deliverables')
    .select('matter_id')
    .eq('notion_id', df.deliverable_id)
    .maybeSingle();
  if (d?.matter_id) await markMatterBriefStale(d.matter_id, firmId);
}
