/**
 * The shape of a firm's feature flags, and the pure functions over it.
 *
 * Deliberately free of server imports: the resolved flags ride to the browser
 * through a React context, so the client bundle needs the key set and the
 * `FeatureFlags` shape without pulling in `lib/firm/features.ts` — which
 * reaches `node:crypto` (credential sealing) and web-push through its platform
 * predicates. Same split, and the same reason, as `brand-shape.ts`.
 *
 * The guard matrix itself stays in `features.ts`, which re-exports everything
 * here so server call sites keep a single import.
 */

/**
 * The integrations that are genuinely optional per firm. A key that isn't here
 * is not a feature — it's a typo, and `isFeatureKey` says so.
 */
export const FEATURE_KEYS = [
  'portal',
  'sharepoint',
  'docx_pdf',
  'push',
  'issuances',
  'drafting',
  'red_team',
  'ai_analysis',
  'ai_search',
  'ai_assistant',
  'ai_client_chat',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

/**
 * The keys under which firm content leaves the platform for a third-party
 * model. Every one of them is opt-in, and a firm that has consented to one has
 * not thereby consented to the others — which is the whole point of splitting
 * them:
 *
 *   ai_analysis     Claude reads stored matter and client documents.
 *   ai_search       Voyage embeds firm content; the vectors are stored and
 *                   searched. Distinct from `ai_analysis` because it is a
 *                   different subprocessor and a durable derived copy, not a
 *                   one-shot read.
 *   ai_assistant    The staff assistant, which holds write tools.
 *   ai_client_chat  AI answering the firm's *clients* in the portal. Enabling
 *                   `portal` is not consent to this; a firm can be happy for
 *                   its own lawyers to use AI and not for its clients to be
 *                   answered by one.
 *
 * `drafting`, `red_team` and `issuances` also reach a model and are also
 * opt-in; they predate this group and keep their own keys, so a firm's answer
 * stays per surface rather than collapsing into one switch.
 *
 * `issuances` is in the list for a different reason from the rest: what it
 * sends a model is public government source material, not firm content, so it
 * discloses nothing. It is here because it still constructs a model client,
 * and `scripts/audit-ai-gate.ts` can only hold "no client outside the gate" if
 * *every* client goes through the gate — an exemption for the one call that
 * looks harmless is how the next one gets waved through too.
 */
export const AI_FEATURE_KEYS = [
  'ai_analysis',
  'ai_search',
  'ai_assistant',
  'ai_client_chat',
  'drafting',
  'red_team',
  'issuances',
] as const;

export type AiFeatureKey = (typeof AI_FEATURE_KEYS)[number];

export function isAiFeatureKey(value: string): value is AiFeatureKey {
  return (AI_FEATURE_KEYS as readonly string[]).includes(value);
}

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}

/** Every feature's availability for one firm, resolved once server-side. */
export type FeatureFlags = Readonly<Record<FeatureKey, boolean>>;

/**
 * What a client component sees outside any provider: everything off.
 *
 * Fail closed, because the alternative is worse than a missing link — the
 * agents-registry rule ("unregistered is disabled, never unrestricted") has to
 * survive a subtree whose layout forgot to mount the provider, and a nav entry
 * rendered on a guess lands the user on a redirect.
 */
export const NO_FEATURES: FeatureFlags = Object.freeze(
  Object.fromEntries(FEATURE_KEYS.map((key) => [key, false])) as Record<FeatureKey, boolean>,
);

/**
 * Whether a navigation entry gated on `keys` should render at all. No keys is
 * ungated. Several keys mean *any* of them: one surface can be worth showing
 * while any one of the integrations behind it is on.
 *
 * There is no "show it disabled" branch on purpose. A firm without a feature
 * gets no entry point and no upsell.
 */
export function featuresVisible(
  flags: FeatureFlags,
  keys?: readonly FeatureKey[],
): boolean {
  if (!keys || keys.length === 0) return true;
  return keys.some((key) => flags[key]);
}
