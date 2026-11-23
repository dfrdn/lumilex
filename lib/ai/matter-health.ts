// ── Matter Health Scoring ─────────────────────────────────────────────
//
// Sibling artifact to matter_summaries. Produces a 0–100 score, a tier
// (green/yellow/red), a JSONB signals bundle, and a 1-paragraph narrative.
//
// Scoring is deterministic — computed from the signals without the LLM.
// The LLM only writes the prose, so a partner reading the narrative can
// trust that the number reflects the rules, not a model's whim.

import { anthropicFor, type AiContext } from '@/lib/ai/gate';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { OUT_STATUSES } from '@/lib/ai/matter-deliverables';
import { daysBetween, manilaDate, manilaDayEnd, manilaDayStart, manilaToday } from '@/lib/dates';

const MODEL = 'claude-haiku-4-5-20251001';

// ── Types ────────────────────────────────────────────────────────────

export type HealthTier = 'green' | 'yellow' | 'red';

export interface HealthSignals {
  /** Deliverables past their external_due_date and still open. */
  overdueDeliverableCount: number;
  /** Active deliverables (any non-terminal status). */
  pendingDeliverableCount: number;
  /** Days since the most recent activity (deliverable edit, task update, chat message). Null = no activity ever. */
  daysSinceActivity: number | null;
  /** Deliverable due_dates or matter_summaries.key_dates within the next 14 days. */
  upcomingDeadlineCount: number;
  /** Hearings in the last 90 days with status indicating no-show or postponed. */
  missedHearingCount: number;
  /** Days since matter was created. Old matters with low activity score lower. */
  matterAgeDays: number;
  /** Snapshot of which deliverable types are stuck — for the narrative. */
  overdueDeliverableSamples: { name: string; type: string | null; dueDate: string | null; daysOverdue: number }[];
}

export interface MatterHealthResult {
  score: number;
  tier: HealthTier;
  signals: HealthSignals;
  narrative: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface MatterHealthContext {
  notion_id: string;
  name: string;
  matter_code?: string | null;
  type?: string | null;
  status?: string | null;
  client_name?: string | null;
  created_time?: string | null;
  /** Scopes every read. */
  firmId: string;
}

// ── Public entry point ───────────────────────────────────────────────

export async function generateMatterHealth(matter: MatterHealthContext): Promise<MatterHealthResult> {
  const signals = await computeSignals(matter);
  const score = computeScore(signals);
  const tier = scoreToTier(score);
  const narrative = await composeNarrative(matter, signals, score, tier);

  return {
    score,
    tier,
    signals,
    narrative: narrative.text,
    inputTokens: narrative.inputTokens,
    outputTokens: narrative.outputTokens,
    model: MODEL,
  };
}

// ── Signal computation ───────────────────────────────────────────────

// A deliverable is no longer active once it has left the firm (OUT_STATUSES —
// includes "Submitted"/"Acknowledged" for internal deliverables) or reached a
// non-send terminal state. Reuse OUT_STATUSES so this can't drift from the
// authoritative lifecycle definition again.
const TERMINAL_DELIVERABLE_STATUSES = new Set([
  ...OUT_STATUSES,
  'Completed',
  'Cancelled',
]);

interface DeliverableRow {
  notion_id: string;
  name: string;
  type: string | null;
  status: string | null;
  external_due_date: string | null;
  date_done: string | null;
  notion_last_edited_at: string | null;
}

async function computeSignals(matter: MatterHealthContext): Promise<HealthSignals> {
  const supabase = getServiceDbForFirm(matter.firmId);
  const today = new Date();
  const todayIso = manilaToday();
  const ninetyDaysAgo = manilaDate(-90);
  const fourteenDaysAhead = manilaDate(14);

  const [
    { data: deliverables },
    { data: tasks },
    { data: hearings },
    { data: matterSummary },
    { data: chatMessages },
  ] = await Promise.all([
    supabase
      .from('deliverables')
      .select('notion_id, name, type, status, external_due_date, date_done, notion_last_edited_at')
      .eq('matter_id', matter.notion_id),
    supabase
      .from('tasks')
      .select('notion_last_edited_at')
      .eq('matter_id', matter.notion_id)
      .order('notion_last_edited_at', { ascending: false, nullsFirst: false })
      .limit(1),
    supabase
      .from('hearings')
      .select('date, status')
      .eq('matter_id', matter.notion_id)
      .gte('date', manilaDayStart(ninetyDaysAgo))
      .lte('date', manilaDayEnd(todayIso)),
    supabase
      .from('matter_summaries')
      .select('key_dates')
      .eq('matter_id', matter.notion_id)
      .maybeSingle(),
    supabase
      .from('chat_messages')
      .select('created_at, chat_channels!inner(matter_id)')
      .eq('chat_channels.matter_id', matter.notion_id)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  const rows = (deliverables ?? []) as DeliverableRow[];

  // Overdue deliverables.
  const overdueRows = rows.filter((d) => {
    if (!d.external_due_date) return false;
    if (d.status && TERMINAL_DELIVERABLE_STATUSES.has(d.status)) return false;
    return d.external_due_date < todayIso;
  });

  const overdueDeliverableSamples = overdueRows
    .map((d) => {
      const due = d.external_due_date!;
      const daysOverdue = daysBetween(due, todayIso);
      return { name: d.name, type: d.type, dueDate: due, daysOverdue };
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
    .slice(0, 5);

  // Pending deliverables (active).
  const pendingDeliverableCount = rows.filter(
    (d) => !d.status || !TERMINAL_DELIVERABLE_STATUSES.has(d.status),
  ).length;

  // Days since activity — most recent across deliverable edits, tasks, chat.
  // Drop any unparseable timestamp (NaN) so one bad row can't poison Math.max
  // and silently zero out the idle penalty.
  const activityTimestamps: number[] = [];
  const pushTs = (raw: string | null | undefined) => {
    if (!raw) return;
    const ms = new Date(raw).getTime();
    if (!Number.isNaN(ms)) activityTimestamps.push(ms);
  };
  for (const d of rows) pushTs(d.notion_last_edited_at);
  if (tasks && tasks.length > 0) pushTs(tasks[0].notion_last_edited_at);
  if (chatMessages && chatMessages.length > 0) pushTs(chatMessages[0].created_at);
  const lastActivityMs = activityTimestamps.length > 0 ? Math.max(...activityTimestamps) : null;
  const daysSinceActivity = lastActivityMs != null
    ? Math.floor((today.getTime() - lastActivityMs) / (24 * 60 * 60 * 1000))
    : null;

  // Upcoming deadlines (next 14d) — deliverables + key_dates from matter_summaries.
  let upcomingDeadlineCount = 0;
  for (const d of rows) {
    if (
      d.external_due_date &&
      d.external_due_date >= todayIso &&
      d.external_due_date <= fourteenDaysAhead &&
      (!d.status || !TERMINAL_DELIVERABLE_STATUSES.has(d.status))
    ) {
      upcomingDeadlineCount++;
    }
  }
  const keyDates = (matterSummary?.key_dates ?? []) as { date?: string; status?: string }[];
  for (const kd of keyDates) {
    if (
      kd.date &&
      kd.date >= todayIso &&
      kd.date <= fourteenDaysAhead &&
      kd.status !== 'past'
    ) {
      upcomingDeadlineCount++;
    }
  }

  // Missed hearings — heuristic: status contains "miss"/"postpon"/"reset"/"cancel".
  const missedHearingCount = (hearings ?? []).filter((h) => {
    const s = (h.status ?? '').toLowerCase();
    return s.includes('miss') || s.includes('postpon') || s.includes('reset') || s.includes('cancel');
  }).length;

  // Matter age.
  const createdMs = matter.created_time ? new Date(matter.created_time).getTime() : today.getTime();
  const matterAgeDays = Math.floor((today.getTime() - createdMs) / (24 * 60 * 60 * 1000));

  return {
    overdueDeliverableCount: overdueRows.length,
    pendingDeliverableCount,
    daysSinceActivity,
    upcomingDeadlineCount,
    missedHearingCount,
    matterAgeDays,
    overdueDeliverableSamples,
  };
}

// ── Score computation (deterministic) ────────────────────────────────

/**
 * 100 = perfectly healthy, 0 = critically distressed.
 *
 * Penalties:
 *   -10 per overdue deliverable, capped at -40
 *   -1 per day since activity past 14d, capped at -30
 *   -10 per missed hearing in last 90d, capped at -20
 *   -10 if upcoming deadlines > 3 AND days_since_activity > 7 (looming crunch w/o motion)
 *   -10 if matter is older than 365d with zero recent activity
 *
 * Floors at 0 so partners can compare equally distressed matters by signals.
 */
export function computeScore(s: HealthSignals): number {
  let score = 100;

  score -= Math.min(s.overdueDeliverableCount * 10, 40);

  if (s.daysSinceActivity != null && s.daysSinceActivity > 14) {
    score -= Math.min(s.daysSinceActivity - 14, 30);
  }

  score -= Math.min(s.missedHearingCount * 10, 20);

  if (s.upcomingDeadlineCount > 3 && (s.daysSinceActivity ?? 0) > 7) {
    score -= 10;
  }

  if (s.matterAgeDays > 365 && (s.daysSinceActivity == null || s.daysSinceActivity > 60)) {
    score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}

export function scoreToTier(score: number): HealthTier {
  if (score >= 80) return 'green';
  if (score >= 50) return 'yellow';
  return 'red';
}

// ── Narrative composition (LLM) ──────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior partner reviewing matter health. Given a matter's risk signals and computed score/tier, write a single concise paragraph (2-4 sentences) explaining what's going well and what needs attention.

Rules:
- Be direct. Lead with the biggest risk if tier is yellow or red.
- Reference specific signals (overdue counts, days idle) — no vague phrases.
- For green tier, briefly acknowledge what's solid.
- Do NOT propose actions or remedies — partners decide those.
- Do NOT mention the score number; it's shown separately.
- Output the paragraph only. No headers, no bullets, no preamble.`;

async function composeNarrative(
  matter: MatterHealthContext,
  signals: HealthSignals,
  score: number,
  tier: HealthTier,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Fall back to a stub narrative if no API key (dev convenience).
    return { text: stubNarrative(matter, signals, tier), inputTokens: 0, outputTokens: 0 };
  }
  const claude = await anthropicFor({ firmId: matter.firmId, feature: 'ai_analysis' });

  const userMessage = buildUserPrompt(matter, signals, score, tier);

  const response = await claude.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const content = response.content[0];
  const text = content.type === 'text' ? content.text.trim() : stubNarrative(matter, signals, tier);

  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

function buildUserPrompt(
  matter: MatterHealthContext,
  signals: HealthSignals,
  score: number,
  tier: HealthTier,
): string {
  const lines: string[] = [];
  lines.push(`Matter: ${matter.name}${matter.matter_code ? ` (${matter.matter_code})` : ''}`);
  if (matter.client_name) lines.push(`Client: ${matter.client_name}`);
  if (matter.type) lines.push(`Type: ${matter.type}`);
  if (matter.status) lines.push(`Status: ${matter.status}`);
  lines.push(`Computed score: ${score} (${tier})`);
  lines.push('');
  lines.push('Signals:');
  lines.push(`  - Overdue deliverables: ${signals.overdueDeliverableCount}`);
  if (signals.overdueDeliverableSamples.length > 0) {
    const top = signals.overdueDeliverableSamples
      .slice(0, 3)
      .map((d) => `${d.name}${d.type ? ` (${d.type})` : ''} — ${d.daysOverdue}d overdue`)
      .join('; ');
    lines.push(`      e.g. ${top}`);
  }
  lines.push(`  - Pending deliverables: ${signals.pendingDeliverableCount}`);
  lines.push(`  - Days since last activity: ${signals.daysSinceActivity ?? 'no activity recorded'}`);
  lines.push(`  - Upcoming deadlines (next 14d): ${signals.upcomingDeadlineCount}`);
  lines.push(`  - Hearings missed/postponed in last 90d: ${signals.missedHearingCount}`);
  lines.push(`  - Matter age: ${signals.matterAgeDays} days`);

  return lines.join('\n');
}

function stubNarrative(matter: MatterHealthContext, s: HealthSignals, tier: HealthTier): string {
  const bits: string[] = [];
  if (tier === 'red') bits.push(`${matter.name} is at high risk.`);
  else if (tier === 'yellow') bits.push(`${matter.name} needs attention.`);
  else bits.push(`${matter.name} looks healthy.`);
  if (s.overdueDeliverableCount > 0) bits.push(`${s.overdueDeliverableCount} deliverable(s) overdue.`);
  if (s.daysSinceActivity != null && s.daysSinceActivity > 14) {
    bits.push(`No activity in ${s.daysSinceActivity} days.`);
  }
  if (s.missedHearingCount > 0) bits.push(`${s.missedHearingCount} hearing(s) missed in the last 90d.`);
  return bits.join(' ');
}
