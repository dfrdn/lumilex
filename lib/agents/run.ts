// ── Agent run ledger ─────────────────────────────────────────────────
//
// One row per agent wake-up. A cron agent has no person behind it and no
// chat transcript to read back, so the ledger is the only record of what
// it did, what it cost, and whether it failed. Wrap every agent entry
// point in withAgentRun.
//
// Service-role throughout: agent_runs is deny-by-default (no policies),
// and cron paths carry no JWT.

import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { getAgent, isDisabled } from './registry';
import type { RunHandle, RunTrigger } from './types';

export class AgentDisabledError extends Error {
  constructor(agentId: string) {
    super(`Agent "${agentId}" is disabled or not registered.`);
    this.name = 'AgentDisabledError';
  }
}

interface RunOptions {
  /** Firm the run acts for; scopes the agent_runs ledger row. */
  firmId: string;
  trigger: RunTrigger;
  /** person_id of whoever triggered this, when a person did. */
  triggeredBy?: string | null;
  /** Anything useful for reproducing the run (batch limit, chat id, ...). */
  input?: Record<string, unknown>;
}

/**
 * Run an agent body under the ledger. Records start, usage, and outcome;
 * refuses to start when the agent's kill switch is off.
 *
 * The body's return value is passed through untouched, so this can wrap an
 * existing entry point without changing its contract.
 */
export async function withAgentRun<T>(
  agentId: string,
  opts: RunOptions,
  body: (run: RunHandle) => Promise<T>,
): Promise<T> {
  const agent = await getAgent(agentId);
  if (isDisabled(agent)) throw new AgentDisabledError(agentId);

  const supabase = getServiceDbForFirm(opts.firmId);
  const { data: row, error } = await supabase
    .from('agent_runs')
    .insert({
      agent_id: agentId,
      trigger: opts.trigger,
      triggered_by: opts.triggeredBy ?? null,
      input: opts.input ?? {},
    })
    .select('id')
    .single();

  if (error || !row) {
    throw new Error(`Could not open an agent run: ${error?.message ?? 'no row returned'}`);
  }

  const runId = row.id as number;
  const totals = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    tool_calls: 0,
  };
  let model: string | null = null;
  let summary = '';

  const handle: RunHandle = {
    runId,
    firmId: opts.firmId,
    // isDisabled() narrowed this above.
    agent: agent!,
    recordUsage(usage, usedModel) {
      if (usedModel) model = usedModel;
      if (!usage) return;
      totals.input_tokens += usage.input_tokens ?? 0;
      totals.output_tokens += usage.output_tokens ?? 0;
      totals.cache_read_tokens += usage.cache_read_input_tokens ?? 0;
      totals.cache_write_tokens += usage.cache_creation_input_tokens ?? 0;
    },
    countToolCall(n = 1) {
      totals.tool_calls += n;
    },
    setSummary(text) {
      summary = text.slice(0, 2000);
    },
  };

  const close = async (status: 'succeeded' | 'failed', err?: unknown) => {
    const { count } = await supabase
      .from('agent_proposals')
      .select('id', { count: 'exact', head: true })
      .eq('agent_run_id', runId);

    await supabase
      .from('agent_runs')
      .update({
        status,
        summary,
        model,
        ...totals,
        proposals_created: count ?? 0,
        error: err ? String(err instanceof Error ? err.message : err).slice(0, 2000) : null,
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId);
  };

  try {
    const result = await body(handle);
    await close('succeeded');
    return result;
  } catch (err) {
    await close('failed', err);
    throw err;
  }
}
