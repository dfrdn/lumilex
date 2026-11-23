/**
 * Reading the firm's current fee schedules. Shared by the admin CMS, the
 * fee-schedule PDF export, and the engagement proposal — the proposal must
 * quote the same figures the annex it attaches will print, so both go through
 * here rather than each reaching for the table.
 *
 * There is no in-code fallback. This file used to layer saved rows over a
 * `DEFAULT_FEE_SCHEDULES` constant that still held one real firm's 2026 rate
 * card, per slug — so a firm that had never saved a schedule quoted, and bound
 * as Annex "A", another firm's prices, with nothing on the page to say they
 * were not its own. A firm quoting no rates is recoverable; a firm quoting
 * someone else's is not.
 *
 * So {@link loadFeeSchedules} throws when the firm has none, and every path
 * that quotes or renders a schedule inherits that. {@link findFeeSchedules} is
 * the non-throwing reader for the settings surface — the CMS has to be able to
 * render the firm's schedules as they stand, including not at all.
 */

import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import type { FeeScheduleContent, FeeScheduleRow, ProfessionalBody } from './types';

export interface LoadedFeeSchedule {
  id: string | null;
  slug: string;
  name: string;
  content: FeeScheduleContent;
  isActive: boolean;
  sortOrder: number;
  /** True when this is an unsaved starter skeleton offered by the CMS. */
  isTemplate: boolean;
}

/**
 * Raised when the firm has no `fee_schedules` rows at all. Callers that render
 * a settings form catch it; callers that would otherwise print a rate card let
 * it through.
 */
export class FeeSchedulesNotConfigured extends Error {
  constructor() {
    super(
      'This firm has no fee schedules. Publish one under Admin → Fee schedules, ' +
        'or seed the starter set with `npx tsx scripts/seed-fee-schedules.ts <firmId>` ' +
        '(scripts/provision-firm.ts does it for a new firm).',
    );
    this.name = 'FeeSchedulesNotConfigured';
  }
}

function fromRow(row: FeeScheduleRow): LoadedFeeSchedule {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    content: row.content,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    isTemplate: false,
  };
}

/**
 * Every schedule the firm has saved, in publication order. Returns an empty
 * array for a firm that has none — only the settings surface should call this;
 * anything that quotes a figure calls {@link loadFeeSchedules}.
 *
 * Service-role: this is a firm-wide reference document with no per-user
 * scoping, and the proposal export needs it while assembling annexes.
 */
export async function findFeeSchedules(firmId: string): Promise<LoadedFeeSchedule[]> {
  const supabase = getServiceDbForFirm(firmId);
  const { data } = await supabase
    .from('fee_schedules')
    .select('*')
    .order('sort_order', { ascending: true })
    .returns<FeeScheduleRow[]>();

  return (data ?? [])
    .map(fromRow)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug));
}

/** Every schedule the firm publishes. Throws when it publishes none. */
export async function loadFeeSchedules(firmId: string): Promise<LoadedFeeSchedule[]> {
  const schedules = await findFeeSchedules(firmId);
  if (schedules.length === 0) throw new FeeSchedulesNotConfigured();
  return schedules;
}

export async function loadFeeSchedule(firmId: string, slug: string): Promise<LoadedFeeSchedule | null> {
  const all = await loadFeeSchedules(firmId);
  return all.find((s) => s.slug === slug) ?? null;
}

/**
 * The professional rate card, which is what a retainer or hourly proposal
 * quotes from. Returns null if the firm has replaced it with a body shape the
 * proposal can't read — callers fall back to free-text fee terms. A firm with
 * no schedules at all is a different case and throws.
 */
export async function loadProfessionalBody(firmId: string): Promise<{ content: FeeScheduleContent; body: ProfessionalBody } | null> {
  const schedule = await loadFeeSchedule(firmId, 'professional');
  if (!schedule || schedule.content.body.kind !== 'professional') return null;
  return { content: schedule.content, body: schedule.content.body };
}
