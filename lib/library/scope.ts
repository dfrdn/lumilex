import { isFeatureAvailable } from '@/lib/firm/features';
import { sectionOf } from '@/lib/library/model';

/**
 * Whether a firm's Library shows the pages distilled from its matters. Those
 * are AI output — the backfill reads closed matters through Claude and the
 * pages are indexed through Voyage — so they follow the `ai_search` switch the
 * old Knowledge Base page sat behind. The handbook is the firm's own writing
 * and the Rules of Court are the Supreme Court's; both are always shown.
 * Server-only: it reads the feature matrix.
 */
export async function showsDistilled(firmId: string): Promise<boolean> {
  return isFeatureAvailable(firmId, 'ai_search');
}

/** A page of this kind is out of view for the firm: a distilled page with the feature off. */
export async function isOutOfScope(firmId: string, kind: string): Promise<boolean> {
  return sectionOf(kind) === 'distilled' && !(await showsDistilled(firmId));
}
