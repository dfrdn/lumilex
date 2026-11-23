/**
 * The Anthropic platform predicate, alone in a leaf module.
 *
 * It cannot live in `lib/ai/claude.ts` beside the client: `features.ts` needs
 * it to answer level 1 for the AI keys, `claude.ts` needs `features.ts` (via
 * `lib/ai/gate.ts`) to construct a client at all, and that is a cycle. The
 * same shape as `isVoyageConfigured` in `voyage.ts`, which is a leaf by
 * accident rather than design.
 *
 * `ANTHROPIC_API_KEY` is optional: an instance may run with no AI at all. Every
 * AI feature asks this rather than assuming, so a missing key shows up as
 * `platform_unconfigured` on the firm's feature rows instead of a throw deep
 * inside a request.
 */
export function isAnthropicConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
