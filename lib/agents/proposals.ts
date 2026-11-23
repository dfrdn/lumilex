// ── Agent proposal queue ─────────────────────────────────────────────
//
// The single write path for anything an agent decides on its own
// initiative. An agent never mutates firm data directly; it files a
// proposal here and a person clears it.
//
// The autonomy check lives in this function rather than in a system
// prompt. A model can be talked out of an instruction; it cannot be
// talked out of a function that refuses to insert.

import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { canPropose } from './registry';
import type { RunHandle } from './types';

export class AgentNotPermittedError extends Error {
  constructor(agentId: string, autonomy: string) {
    super(`Agent "${agentId}" has autonomy "${autonomy}" and may not file proposals.`);
    this.name = 'AgentNotPermittedError';
  }
}

export type ProposalKind = 'deadline_chain' | 'file_entry';

/** Where the agent got the material it is proposing from. */
export interface ProposalProvenance {
  emailId?: number | null;
  emailAttachmentId?: number | null;
  fileAnalysisId?: number | null;
}

interface BaseProposal {
  matterId: string;
  /** Input channel, independent of which agent filed it (e.g. 'court_mail'). */
  source: string;
  confidence: number;
  reasoning?: string;
  documentName?: string;
  documentSummary?: string;
  provenance?: ProposalProvenance;
}

export interface FileEntryProposal extends BaseProposal {
  kind: 'file_entry';
}

export interface DeadlineChainProposal extends BaseProposal {
  kind: 'deadline_chain';
  ruleSetId: string;
  ruleSetName: string;
  /** YYYY-MM-DD */
  triggerDate: string;
  triggerLabel: string;
  /** Concrete computed deadlines, so a reviewer sees dates before clearing. */
  proposedItems: unknown[];
}

export type ProposalInput = FileEntryProposal | DeadlineChainProposal;

/**
 * File a proposal for human clearance.
 *
 * Returns the new proposal's id, or null when the insert collided with an
 * existing proposal for the same trigger — re-detection is a deliberate
 * no-op, not an error.
 */
/** Shape the agent_proposals row. Pure — the insert is the caller's job. */
export function buildProposalRow(
  agentId: string,
  runId: number,
  input: ProposalInput,
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    kind: input.kind,
    matter_id: input.matterId,
    source: input.source,
    agent_id: agentId,
    agent_run_id: runId,
    confidence: input.confidence,
    reasoning: input.reasoning ?? '',
    document_name: input.documentName ?? '',
    document_summary: input.documentSummary ?? '',
    email_id: input.provenance?.emailId ?? null,
    email_attachment_id: input.provenance?.emailAttachmentId ?? null,
    file_analysis_id: input.provenance?.fileAnalysisId ?? null,
  };

  if (input.kind === 'deadline_chain') {
    row.rule_set_id = input.ruleSetId;
    row.rule_set_name = input.ruleSetName;
    row.trigger_date = input.triggerDate;
    row.trigger_label = input.triggerLabel;
    row.proposed_items = input.proposedItems;
  }

  return row;
}

export async function fileProposal(
  run: RunHandle,
  input: ProposalInput,
): Promise<{ id: number } | null> {
  if (!canPropose(run.agent)) {
    throw new AgentNotPermittedError(run.agent.id, run.agent.autonomy);
  }

  const row = buildProposalRow(run.agent.id, run.runId, input);

  const db = getServiceDbForFirm(run.firmId);
  const { data, error } = await db
    .from('agent_proposals')
    .insert(row)
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') return null;
    console.error(`[agent:${run.agent.id}] Proposal insert failed:`, error.message);
    return null;
  }

  return { id: data.id as number };
}
