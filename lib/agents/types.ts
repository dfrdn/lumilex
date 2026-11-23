/** Autonomy ceiling for an agent. There is deliberately no 'auto' tier —
 *  every agent-initiated change to firm data lands in agent_proposals and
 *  waits for a person. */
export type Autonomy = 'read_only' | 'propose' | 'disabled';

export type RunTrigger = 'cron' | 'chat' | 'manual' | 'webhook';

export type RunStatus = 'running' | 'succeeded' | 'failed';

export interface AgentRecord {
  id: string;
  name: string;
  description: string;
  autonomy: Autonomy;
  supervisorPersonId: string | null;
}

/** Token counts from one Claude call, in the shape the SDK reports them. */
export interface ModelUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Handle passed to the body of a run so it can report what it did. */
export interface RunHandle {
  runId: number;
  /** Firm the run acts for. */
  firmId: string;
  agent: AgentRecord;
  /** Accumulate token usage from a Claude call onto this run's ledger. */
  recordUsage(usage: ModelUsage | null | undefined, model?: string): void;
  /** Count a tool invocation. */
  countToolCall(n?: number): void;
  /** Human-readable one-liner stored on the run. */
  setSummary(text: string): void;
}
