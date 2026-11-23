import { getSupabase } from '@/lib/supabase';
import type { AgentRecord, Autonomy } from './types';

/** Known agent ids. Adding one means adding a row to `agents` too. */
export const AGENT_IDS = {
  assistant: 'lumilex-assistant',
} as const;

/**
 * Load an agent's registry row. Returns null if the agent isn't registered —
 * an unregistered agent is treated as disabled, not as unrestricted.
 *
 * Service-role: the registry is consulted from cron paths with no JWT.
 */
export async function getAgent(agentId: string): Promise<AgentRecord | null> {
  const { data } = await getSupabase()
    .from('agents')
    .select('id, name, description, autonomy, supervisor_person_id')
    .eq('id', agentId)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    autonomy: data.autonomy as Autonomy,
    supervisorPersonId: data.supervisor_person_id,
  };
}

/** True when the agent may file proposals. */
export function canPropose(agent: AgentRecord): boolean {
  return agent.autonomy === 'propose';
}

/** True when the agent is switched off entirely. */
export function isDisabled(agent: AgentRecord | null): boolean {
  return !agent || agent.autonomy === 'disabled';
}
