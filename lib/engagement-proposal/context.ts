/**
 * Assembles the drafting context for a proposal's recipient: what the record
 * holds, who the client is, and which existing clients the conflict check put
 * on the other side. This is everything the proposal is allowed to know about
 * the recipient — the model never reads the database itself.
 *
 * A prospect brings its intake: consultation notes, proposed services, the
 * conflict result. An existing client brings none of those — the firm already
 * acts for it, so there was no intake — and the drafter's instructions carry
 * the steer instead.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConflictCheckResponse } from '@/types/conflicts';
import type { ProspectContext } from '@/lib/ai/engagement-proposal';

export interface IntakeForProposal {
  id: number;
  client_id: string;
  stage: string;
  assigned_lawyer_id: string | null;
  source: string | null;
  referral_source: string | null;
  consultation_notes: string | null;
  proposed_services: string[] | null;
  proposed_fee: number | string | null;
  conflict_check_result: ConflictCheckResponse | null;
  clients?: { name: string; full_company_name: string | null } | null;
}

/**
 * Existing clients the conflict check found on the other side of this
 * prospect's affairs. Only conflicts that actually name another client are
 * usable — a bare name or TIN match has nothing to disclose *about*.
 */
export function conflictClientNames(result: ConflictCheckResponse | null): string[] {
  const names = (result?.conflicts ?? [])
    .filter((c) => c.severity !== 'low' && c.relatedClientName)
    .map((c) => c.relatedClientName as string);
  return [...new Set(names)];
}

export async function loadProspectContext(
  supabase: SupabaseClient,
  intakeId: number,
): Promise<{ intake: IntakeForProposal; context: ProspectContext } | null> {
  const { data } = await supabase
    .from('client_intakes')
    .select('*, clients!inner(name, full_company_name)')
    .eq('id', intakeId)
    .maybeSingle<IntakeForProposal>();

  if (!data) return null;

  const clientName = data.clients?.name ?? data.client_id;
  return {
    intake: data,
    context: {
      clientName,
      clientFullName: data.clients?.full_company_name || null,
      proposedServices: data.proposed_services ?? [],
      proposedFee: data.proposed_fee == null ? null : Number(data.proposed_fee),
      consultationNotes: data.consultation_notes ?? null,
      source: data.source ?? null,
      referralSource: data.referral_source ?? null,
      conflictNames: conflictClientNames(data.conflict_check_result),
    },
  };
}

export interface ClientForProposal {
  notion_id: string;
  name: string;
  full_company_name: string | null;
  point_persons: string | null;
}

/**
 * The drafting context for an engagement proposed to a client the firm already
 * acts for. There is deliberately no conflict list: the existing relationship
 * was cleared when the client was taken on, and a fresh check belongs to the
 * new matter rather than to this letter.
 */
export async function loadClientContext(
  supabase: SupabaseClient,
  clientId: string,
): Promise<{ client: ClientForProposal; context: ProspectContext } | null> {
  const { data } = await supabase
    .from('clients')
    .select('notion_id, name, full_company_name, point_persons')
    .eq('notion_id', clientId)
    .maybeSingle<ClientForProposal>();

  if (!data) return null;

  return {
    client: data,
    context: {
      clientName: data.name,
      clientFullName: data.full_company_name || null,
      proposedServices: [],
      proposedFee: null,
      consultationNotes: null,
      source: null,
      referralSource: null,
      conflictNames: [],
    },
  };
}
