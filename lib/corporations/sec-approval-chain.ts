import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { rowToCorporation } from '@/lib/corporation-row';
import { cascadeClientRename } from '@/lib/clients/cascade-rename';
import { findClientByName } from '@/lib/clients/find-or-create';
import { spawnComplianceDeliverables } from '@/lib/corporation-deadlines';
import { spawnBusinessPermitTask } from '@/lib/corporations/permit-task';
import { deriveMatterCode } from '@/lib/matters/derive-matter-code';
import { logAudit } from '@/lib/audit';
import { mintId } from '@/lib/ids';
import { CORPORATION_SELECT, setMatterLink } from '@/lib/corporations/matter-links';

/**
 * When SEC issues a COR, run the auto-create chain:
 *  - update placeholder client name to SEC-approved name (a corporation
 *    engaged by an existing client has no client row of its own — that client
 *    is the client, and keeps the matters),
 *  - close the Incorporation matter,
 *  - open Post-Incorporation + Housekeeping matters where scope is enabled,
 *  - spawn compliance deliverables and the initial business-permit task.
 *
 * Runs entirely on the service-role client: the authorization decision already
 * happened (the caller's RLS-gated corporation update succeeded), and the
 * chain touches tables the caller may not be allowed to write directly —
 * `clients` is partner/admin/finance-only and a lawyer's matter update only
 * hits matters they're teamed on. On the authed client those steps silently
 * no-op (0 rows / 42501), leaving the corporation half-transitioned.
 */
export async function runSecApprovalAutoChain(
  firmId: string,
  corpRow: Record<string, unknown>,
  userId: string,
) {
  const supabase = getServiceDbForFirm(firmId);
  const corp = rowToCorporation(corpRow);
  const approvedName = corp.approvedName ?? corp.proposedNames[0] ?? null;

  // 1. Update the corp's own client row, when it has one.
  //    A corporation engaged by an existing client doesn't: that client owns
  //    the engagement, and minting a second row here at approval time is what
  //    forked the name across two clients. The work follows the engaging
  //    client instead.
  const corpClientId = corp.clientId;
  const workClientId = corpClientId ?? corp.engagingClientId;
  if (corpClientId && approvedName) {
    const { data: priorClient } = await supabase
      .from('clients').select('name').eq('notion_id', corpClientId).maybeSingle();

    // Another client already answers to the SEC-approved name. Renaming into it
    // would violate clients_name_unique_ci, and merging the two automatically
    // would fold one client's DTRs and invoices into another's billing bundles
    // — leave the placeholder name in place for a human to resolve.
    const collision = await findClientByName(supabase, approvedName);
    if (collision && collision.notionId !== corpClientId) {
      // Skip the rename only — the rest of the approval chain (closing the
      // Incorporation matter, opening Post-Incorp, spawning compliance
      // deliverables) is unaffected and still has to run. The corporation is
      // left registered under the placeholder client name, which diverges from
      // the matter titles that carry the approved name, so record an audit row
      // rather than leaving the mismatch only in the Vercel logs.
      console.error(
        `[sec-approval-chain] skipped renaming client ${corpClientId} to "${approvedName}": ` +
        `client ${collision.notionId} (code ${collision.clientCode}) already owns that name`,
      );
      logAudit({
        firmId,
        entityType: 'Corporation',
        entityId: corp.id,
        entityName: approvedName,
        action: 'client_rename_blocked',
        fieldChanged: 'client_name',
        oldValue: `${priorClient?.name ?? ''} (${corpClientId})`,
        newValue: `blocked: "${approvedName}" already owned by client ${collision.notionId} (code ${collision.clientCode})`,
        performedBy: userId,
      });
    } else {
      const { error: renameError } = await supabase.from('clients').update({
        name: approvedName,
        full_company_name: approvedName,
      }).eq('notion_id', corpClientId);
      // cascadeClientRename assumes the clients.name update already landed — if
      // it failed (e.g. a name inserted between the collision check and here),
      // running the cascade would rewrite client_name across the denormalized
      // tables to a name the clients row doesn't have. Only cascade on success.
      if (renameError) {
        console.error('[sec-approval-chain] client rename failed, skipping cascade', renameError);
      } else if (priorClient?.name && priorClient.name !== approvedName) {
        // The SEC-approved name replaces the placeholder client name — cascade it to
        // every table that denormalizes client_name (DTRs, invoices, the finance
        // Review bundles, deposits, …) so nothing keeps showing the old name. Run it
        // on the service-role client (not an authed one) so RLS can't
        // silently drop a finance-table update — same as the admin rename path.
        await cascadeClientRename(supabase, {
          clientId: corpClientId,
          oldName: priorClient.name,
          newName: approvedName,
        });
        logAudit({
          firmId,
          entityType: 'clients',
          entityId: corpClientId,
          entityName: approvedName,
          action: 'update',
          fieldChanged: 'name',
          oldValue: priorClient.name,
          newValue: approvedName,
          performedBy: userId,
        });
      }
    }
  }

  // 2. Close the Incorporation matter.
  if (corp.incorporationMatterId) {
    await supabase.from('matters').update({ status: 'Done' }).eq('notion_id', corp.incorporationMatterId);
  }

  // 3. Open Post-Incorporation matter if scope is on and not yet linked — and
  //    not already covered by a general retainer, same as housekeeping below.
  //    Status is left to trg_corporations_derive_status — this write just has
  //    to touch a column so the trigger fires.
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (corp.handlesPostIncorporation && !corp.postIncorporationMatterId && !corp.isUnderRetainer && workClientId) {
    const matterId = mintId('matter-postincorp');
    const { data: client } = await supabase.from('clients').select('name').eq('notion_id', workClientId).maybeSingle();
    const { error: matterError } = await supabase.from('matters').insert({
      notion_id: matterId,
      name: `Post-Incorporation — ${approvedName ?? ''}`,
      client_id: workClientId,
      client_name: (client?.name as string) ?? '',
      matter_code: await deriveMatterCode(supabase, firmId, { clientId: workClientId, type: 'Post-Incorporation' }),
      type: 'Post-Incorporation',
      status: 'Ongoing',
      team_person_ids: [userId],
      created_time: new Date().toISOString(),
    });
    if (matterError) console.error('[sec-approval-chain] post-incorp matter insert failed', matterError);
    else await setMatterLink(supabase, firmId, corp.id, 'post_incorporation', matterId);
  }

  // 4. Open Corporate Housekeeping matter if scope is on AND not under retainer.
  if (corp.handlesHousekeeping && !corp.housekeepingMatterId && !corp.isUnderRetainer && workClientId) {
    const matterId = mintId('matter-housekeeping');
    const { data: client } = await supabase.from('clients').select('name').eq('notion_id', workClientId).maybeSingle();
    const { error: matterError } = await supabase.from('matters').insert({
      notion_id: matterId,
      name: `Corporate Housekeeping — ${approvedName ?? ''}`,
      client_id: workClientId,
      client_name: (client?.name as string) ?? '',
      matter_code: await deriveMatterCode(supabase, firmId, { clientId: workClientId, type: 'Corporate Housekeeping' }),
      type: 'Corporate Housekeeping',
      status: 'Ongoing',
      team_person_ids: [userId],
      created_time: new Date().toISOString(),
    });
    if (matterError) console.error('[sec-approval-chain] housekeeping matter insert failed', matterError);
    else await setMatterLink(supabase, firmId, corp.id, 'housekeeping', matterId);
  }

  await supabase.from('corporations').update(updates).eq('id', corp.id);

  // 5. Spawn compliance deliverables + the permit task. Re-read so we have
  //    the latest matter IDs.
  const { data: fresh } = await supabase.from('corporations').select(CORPORATION_SELECT).eq('id', corp.id).single();
  if (fresh) {
    const refreshed = rowToCorporation(fresh as Record<string, unknown>);
    try {
      await spawnComplianceDeliverables(refreshed, supabase, firmId, userId);
      await spawnBusinessPermitTask(refreshed, supabase, firmId, userId);
    } catch (e) {
      console.error('[sec-approval-chain] spawn deliverables failed', e);
    }
  }
}
