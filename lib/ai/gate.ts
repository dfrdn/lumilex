// ── The AI gate ──────────────────────────────────────────────────────
//
// Every call that sends firm content to a third-party model goes through this
// module, and every one of them names the firm and the feature it is acting
// under. A firm that has not opted in gets a refusal from a function that will
// not run, rather than a prompt instruction or a UI check — the same rule as
// `lib/agents/` and `lib/tenancy/service-db.ts`.
//
// Why a gate and not 22 guards at the call sites: there was no chokepoint.
// Twenty-two files each built their own `new Anthropic({ apiKey })`, so the
// rule "AI is opt-in" had nowhere to live and no way to survive the next call
// site somebody adds. This is the same shape as the `firm_id` stamping bug
// that shipped four times before `getServiceDbForFirm` made omitting it
// impossible. `scripts/audit-ai-gate.ts` is the ratchet that keeps it that way.
//
// The refusal is `FeatureDisabledError`, which callers convert to a 403. It is
// deliberately not a silent no-op: a cron that quietly skips looks exactly
// like an idle day, which is how two crons stayed broken for hours.

import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import {
  requireFeature,
  FeatureDisabledError,
  type AiFeatureKey,
} from '@/lib/firm/features';
import { isAnthropicConfigured } from '@/lib/ai/anthropic-config';
import { getFirmConfig } from '@/lib/firm/config';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

export { isAnthropicConfigured };
export type { AiFeatureKey };

/**
 * Who is asking, and under which consent.
 *
 * One value rather than two positional arguments because it threads through
 * long call chains — `auto-analyze` → `claude` → the SDK — and a bare
 * `(firmId, feature)` pair is easy to transpose silently at a call site that
 * already takes several strings.
 */
export interface AiContext {
  firmId: string;
  feature: AiFeatureKey;
}

function assertContext(ctx: AiContext): void {
  if (!ctx?.firmId) {
    throw new Error(
      `AI call requires a firmId (feature "${ctx?.feature ?? 'unknown'}").`,
    );
  }
}

/**
 * An Anthropic client for one firm, acting under one AI feature.
 *
 * Throws `FeatureDisabledError` when that firm has not opted in, and a plain
 * `Error` when the platform key is absent. Never returns a client the firm has
 * not consented to being used on its behalf.
 *
 * `firmId` is required and has no default. A default would repeat the mistake
 * the `firm_id` column defaults were: the call succeeds under the wrong firm
 * instead of refusing.
 */
export async function anthropicFor(ctx: AiContext): Promise<Anthropic> {
  assertContext(ctx);
  await requireFeature(ctx.firmId, ctx.feature);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  await spendAllowance(ctx);
  return new Anthropic({ apiKey });
}

/**
 * Charge one call against the firm's `settings.aiLimits`, or refuse.
 *
 * Here rather than at the routes because this is the one place every model
 * client is built — crons included, so a cron regenerating briefs spends the
 * same allowance a visitor does. A client is the unit, not a request: a tool
 * loop on one client counts once, which is close enough for a cost ceiling.
 * An error reading the ledger refuses rather than letting the call through;
 * a firm with a ceiling has one because unbounded spend is the thing to avoid.
 */
async function spendAllowance(ctx: AiContext): Promise<void> {
  const { aiLimits } = await getFirmConfig(ctx.firmId);
  if (!aiLimits) return;

  const { data, error } = await getServiceDbForFirm(ctx.firmId).rpc('consume_ai_call', {
    p_firm_id: ctx.firmId,
    p_per_hour: aiLimits.perHour,
    p_per_day: aiLimits.perDay,
  });
  if (error) throw new Error(`AI allowance check failed: ${error.message}`);
  if (data !== true) {
    throw new FeatureDisabledError({ key: ctx.feature, available: false, reason: 'allowance_spent' });
  }
}

/**
 * The reasons a model call legitimately has no firm behind it. Adding one is a
 * decision to write down, not a way past the gate — which is the point of
 * making it a closed union rather than a free-text argument.
 */
export type PlatformAiReason =
  /**
   * Extracting structured items from scraped government issuances. The input
   * is public source material fetched from a government site, identical for
   * every tenant; the scrape runs once and `ingestItems` fans the *result* out
   * per firm. There is no firm whose content is being read, so there is no
   * firm whose consent could be asked.
   */
  | 'issuances_extraction'
  /**
   * Maintenance on the platform's own Claude Files API storage. That store is
   * keyed by `ANTHROPIC_API_KEY` and is platform-wide, not per firm.
   */
  | 'claude_files_maintenance';

/**
 * An Anthropic client for work that genuinely has no firm behind it.
 *
 * This is not a bypass. It exists so that "no model client is constructed
 * outside `lib/ai/gate.ts`" stays literally true and `scripts/audit-ai-gate.ts`
 * can enforce it — the alternative was one exempt file, and an exemption is
 * how the next call site gets waved through. Every caller names its reason
 * from a closed set, so the exceptions are countable and reviewable.
 *
 * If the content belongs to a firm, this is the wrong function.
 */
export async function anthropicForPlatform(
  reason: PlatformAiReason,
): Promise<Anthropic> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(`ANTHROPIC_API_KEY is not set (platform call: ${reason})`);
  }
  return new Anthropic({ apiKey });
}

/**
 * Assert a firm has opted in, without building a client.
 *
 * For the Voyage paths — `lib/ai/voyage.ts` is a plain `fetch`, so there is no
 * client to hand back — and for a route that would rather refuse before doing
 * the work of assembling a prompt.
 */
export async function requireAi(ctx: AiContext): Promise<void> {
  assertContext(ctx);
  await requireFeature(ctx.firmId, ctx.feature);
}

/**
 * Turn a gate refusal into a 403 a caller can act on; anything else stays
 * unhandled.
 *
 * Since AI is off until a firm turns it on, the refusal is now the *normal*
 * answer for most firms rather than an edge case — so it has to arrive as
 * "your firm has not enabled this", not as an unhandled 500 that reads like a
 * broken deployment. 403 rather than 404: the caller is authenticated and the
 * surface exists, it just is not switched on for them.
 *
 * Usage at a route boundary:
 *
 *   try { ... } catch (err) {
 *     const refusal = aiRefusalResponse(err);
 *     if (refusal) return refusal;
 *     throw err;
 *   }
 */
export function aiRefusalResponse(err: unknown): NextResponse | null {
  if (!(err instanceof FeatureDisabledError)) return null;
  if (err.state.reason === 'allowance_spent') {
    return NextResponse.json(
      {
        error: 'This workspace has used its AI allowance for now. It refills on the hour and resets at midnight.',
        feature: err.state.key,
        reason: err.state.reason,
      },
      { status: 429 },
    );
  }
  return NextResponse.json(
    {
      error: 'This AI feature is not enabled for your firm.',
      feature: err.state.key,
      reason: err.state.reason,
    },
    { status: 403 },
  );
}

/**
 * Resolve an AI feature up front and hand back a 403 when it is off.
 *
 * The route-boundary form of {@link requireAi}: refusing before a handler
 * loads history, assembles a prompt or uploads a file is both cheaper and
 * clearer than letting the throw surface from somewhere deeper. Returns null
 * when the firm has opted in, so the call reads as a guard.
 */
export async function refuseIfDisabled(
  firmId: string,
  feature: AiFeatureKey,
): Promise<NextResponse | null> {
  try {
    await requireAi({ firmId, feature });
    return null;
  } catch (err) {
    const refusal = aiRefusalResponse(err);
    if (refusal) return refusal;
    throw err;
  }
}
