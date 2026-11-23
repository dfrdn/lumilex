/**
 * The one place a system prompt learns whose firm it is speaking for.
 *
 * Every generation path in the app — matter briefs, exec summaries, status
 * report letters, the KMS writers, the drafting studio, the assistant —
 * opens its system prompt by asserting an identity to the
 * model. Hardcoding that identity is the single worst branding leak in the
 * codebase: unlike a logo or a footer, the model *acts* on it, so a tenant's
 * assistant introduces itself as another firm and a tenant's client letter is
 * signed by one. Sixteen separately-worded assertions also drift.
 *
 * So there is one block, injected at the top of every system prompt, and no
 * prompt names a firm inline. Fail-loud: a firm with no name throws rather than
 * letting the model invent one or inherit the last tenant's.
 */

import { getFirmConfig, type FirmConfig } from '@/lib/firm/config';

/**
 * The firm-identity preamble. Prepend it to a system prompt; do not interpolate
 * the firm name into the prompt's own sentences, or the next prompt author has
 * to remember to do it too.
 */
export function firmPromptContext(config: FirmConfig): string {
  const name = config.branding.documentName.trim() || config.name.trim();
  if (!name) {
    throw new Error(
      `Firm ${config.id} has no name configured — set branding.documentName before running AI generation.`,
    );
  }
  const short = config.shortName.trim();
  const alias = short && short !== name ? ` ("${short}")` : '';

  return `FIRM CONTEXT
You are working inside the practice-management system of ${name}${alias}, a Philippine law firm. "The firm", "we", "our" and "us" refer to ${name} and no one else. Never state, imply, or sign as any other law firm, and never invent a firm name: if you need to refer to the firm and the name above does not fit the sentence, write "the Firm".`;
}

/** Convenience for call sites that hold a firm id rather than a loaded config. */
export async function loadFirmPromptContext(firmId: string): Promise<string> {
  return firmPromptContext(await getFirmConfig(firmId));
}
