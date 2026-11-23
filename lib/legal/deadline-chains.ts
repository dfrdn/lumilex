import type { SupabaseClient } from '@supabase/supabase-js';
import { calculateDeadlinesFromRuleSet } from '@/lib/legal/date-calculator';
import { fetchRuleSetById } from '@/lib/legal/court-rules';
import { mintId } from '@/lib/ids';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';
import { toManilaInstant } from '@/lib/dates';

export interface CreateDeadlineChainArgs {
  firmId: string;
  matterId: string;
  ruleSetId: string;
  triggerDate: string; // YYYY-MM-DD
  createdBy: string;
  /** Reuse an already-created deliverable as the first chain entity (filing modal flow). */
  existingFirstEntityId?: string | null;
}

export interface CreateDeadlineChainResult {
  chain: Record<string, unknown> | null;
  error: string | null;
  status: number;
}

/**
 * Compute a rule set's deadlines from a trigger date, create the deliverables
 * and hearings, and record the chain + items. Shared by POST /api/deadlines
 * (manual entry) and deadline-proposal confirmation (Court-Mail Autopilot).
 *
 * The caller picks the client: the authed client keeps RLS as the gate
 * (matter access), the service client is for cron paths.
 */
export async function createDeadlineChain(
  supabase: SupabaseClient,
  args: CreateDeadlineChainArgs,
): Promise<CreateDeadlineChainResult> {
  const { firmId, matterId, ruleSetId, triggerDate, createdBy, existingFirstEntityId } = args;

  const ruleSet = await fetchRuleSetById(ruleSetId);
  if (!ruleSet) {
    return { chain: null, error: 'Invalid ruleSetId', status: 400 };
  }

  // Get matter details for denormalized fields
  const { data: matter } = await supabase
    .from('matters')
    .select('notion_id, name, client_name')
    .eq('notion_id', matterId)
    .single();

  if (!matter) {
    return { chain: null, error: 'Matter not found', status: 404 };
  }

  // Compute all deadlines from the rule set
  const computedDeadlines = await calculateDeadlinesFromRuleSet(ruleSetId, triggerDate);
  if (computedDeadlines.length === 0) {
    return { chain: null, error: 'No deadlines computed', status: 400 };
  }

  // Insert chain record. Every insert below stamps firm_id explicitly: both
  // callers hand this helper the authed client, which (unlike
  // getServiceDbForFirm) does not inject it, and the column's transitional
  // default is gone.
  const { data: chain, error: chainError } = await supabase
    .from('deadline_chains')
    .insert({
      firm_id: firmId,
      matter_id: matterId,
      rule_set_id: ruleSetId,
      trigger_date: triggerDate,
      created_by: createdBy,
    })
    .select()
    .single();

  if (chainError || !chain) {
    console.error('[deadline-chains] Chain insert error:', chainError?.message);
    return { chain: null, error: 'Failed to create deadline chain', status: 500 };
  }

  const chainItems: Array<{
    firm_id: string;
    chain_id: number;
    rule_deadline_id: string;
    entity_type: string;
    entity_id: string;
    label: string;
    legal_basis: string;
    due_date: string;
    is_reglementary: boolean;
    notes: string;
  }> = [];

  for (let idx = 0; idx < computedDeadlines.length; idx++) {
    const dl = computedDeadlines[idx];

    if (dl.entityType === 'deliverable') {
      // If this is the first item and we already have an entity (from filing modal), reuse it
      if (idx === 0 && existingFirstEntityId) {
        // Update priority to High if reglementary
        if (dl.isReglementary) {
          await supabase
            .from('deliverables')
            .update({ priority: 'High' })
            .eq('notion_id', existingFirstEntityId);
        }

        chainItems.push({
          firm_id: firmId,
          chain_id: chain.id,
          rule_deadline_id: dl.id,
          entity_type: 'deliverable',
          entity_id: existingFirstEntityId,
          label: dl.label,
          legal_basis: dl.legalBasis,
          due_date: dl.computedDate,
          is_reglementary: dl.isReglementary,
          notes: dl.notes ?? '',
        });
        continue;
      }

      const notionId = mintId('deliverable');

      const { error: dlError } = await supabase.from('deliverables').insert({
        firm_id: firmId,
        notion_id: notionId,
        name: dl.label,
        matter_id: matterId,
        matter_name: matter.name,
        client_name: matter.client_name,
        type: 'External',
        status: DELIVERABLE_STATUS.NOT_STARTED,
        external_due_date: dl.computedDate,
        priority: dl.isReglementary ? 'High' : 'Medium',
      });

      if (dlError) {
        console.error('[deadline-chains] Deliverable insert error:', dlError.message);
        continue;
      }

      chainItems.push({
        firm_id: firmId,
        chain_id: chain.id,
        rule_deadline_id: dl.id,
        entity_type: 'deliverable',
        entity_id: notionId,
        label: dl.label,
        legal_basis: dl.legalBasis,
        due_date: dl.computedDate,
        is_reglementary: dl.isReglementary,
        notes: dl.notes ?? '',
      });
    } else if (dl.entityType === 'hearing') {
      const notionId = mintId('hearing');

      const { error: hError } = await supabase.from('hearings').insert({
        firm_id: firmId,
        notion_id: notionId,
        name: dl.label,
        date: toManilaInstant(`${dl.computedDate}T09:00:00`),
        matter_id: matterId,
        matter_name: matter.name,
        type: dl.hearingType ?? 'Initial Hearing',
        status: 'Scheduled',
      });

      if (hError) {
        console.error('[deadline-chains] Hearing insert error:', hError.message);
        continue;
      }

      chainItems.push({
        firm_id: firmId,
        chain_id: chain.id,
        rule_deadline_id: dl.id,
        entity_type: 'hearing',
        entity_id: notionId,
        label: dl.label,
        legal_basis: dl.legalBasis,
        due_date: dl.computedDate,
        is_reglementary: dl.isReglementary,
        notes: dl.notes ?? '',
      });
    }
  }

  // Insert chain items
  if (chainItems.length > 0) {
    const { error: itemsError } = await supabase
      .from('deadline_chain_items')
      .insert(chainItems);

    if (itemsError) {
      console.error('[deadline-chains] Chain items insert error:', itemsError.message);
    }
  }

  // Return the full chain with items
  const { data: fullChain } = await supabase
    .from('deadline_chains')
    .select('*, deadline_chain_items(*)')
    .eq('id', chain.id)
    .single();

  return { chain: fullChain ?? chain, error: null, status: 201 };
}

export interface DeleteDeadlineChainResult {
  /** Entities actually removed, so the caller can report what it undid. */
  removed: { deliverables: number; hearings: number };
  error: string | null;
}

/**
 * Tear down a chain created by createDeadlineChain: delete the deliverables and
 * hearings it auto-created, then delete the chain (items cascade). Subscribers'
 * calendars follow on their own — the feed is derived from these rows, so a
 * deleted hearing simply stops appearing.
 *
 * The inverse of createDeadlineChain, and the reason confirming a deadline
 * proposal is a reversible decision rather than a one-way door. Shared by
 * DELETE /api/deadlines and the proposal undo path.
 */
export async function deleteDeadlineChain(
  supabase: SupabaseClient,
  chainId: number,
  firmId: string,
): Promise<DeleteDeadlineChainResult> {
  const removed = { deliverables: 0, hearings: 0 };

  const { data: items } = await supabase
    .from('deadline_chain_items')
    .select('entity_type, entity_id')
    .eq('chain_id', chainId);

  for (const item of items ?? []) {
    if (item.entity_type === 'deliverable') {
      await supabase.from('deliverables').delete().eq('notion_id', item.entity_id);
      removed.deliverables++;
    } else {
      await supabase.from('hearings').delete().eq('notion_id', item.entity_id);
      removed.hearings++;
    }
  }

  const { error } = await supabase.from('deadline_chains').delete().eq('id', chainId);
  if (error) {
    console.error('[deadline-chains] Chain delete error:', error.message);
    return { removed, error: 'Failed to delete deadline chain' };
  }

  return { removed, error: null };
}
