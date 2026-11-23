/**
 * The dropdown vocabulary a new firm starts with.
 *
 * Source: `DEFAULTS` and `MATTER_TYPE_CODES` in lib/enum-options.ts and
 * lib/admin/entity-config.ts — the in-code bootstrap the app already falls back
 * to when `enum_options` is empty. Nothing here names a firm, a client, or a
 * person; the values are Philippine practice vocabulary (matter types, pleading
 * subtypes, holiday classes) that every tenant needs before its first matter.
 *
 * Seeding it rather than leaning on the fallback matters for one row group in
 * particular. `deriveMatterCode` reads `matters.type → metadata.code` through
 * `fetchMatterTypeCodes(firmId)`; with no rows it silently falls back to the
 * hardcoded map, so every firm would share one numbering scheme it cannot edit.
 * Seeded, the map is the firm's own data and /admin/settings/enums can change
 * it — which is what the admin screen's help text already promises.
 */

import { DEFAULTS } from '@/lib/enum-options';
import { MATTER_TYPE_CODES } from '@/lib/admin/entity-config';
import type { EnumOptionSeed } from './types';

function buildSeeds(): EnumOptionSeed[] {
  const seeds: EnumOptionSeed[] = [];
  for (const [entity, fields] of Object.entries(DEFAULTS)) {
    for (const [field, values] of Object.entries(fields)) {
      values.forEach((value, index) => {
        const code = entity === 'matters' && field === 'type' ? MATTER_TYPE_CODES[value] : undefined;
        seeds.push({
          entity,
          field,
          value,
          sort_order: index,
          is_active: true,
          metadata: code === undefined ? null : { code },
        });
      });
    }
  }
  return seeds;
}

export const SEED_ENUM_OPTIONS: EnumOptionSeed[] = buildSeeds();

/** The matter-type → numeric-code map the seeds encode, for assertions. */
export function seededMatterTypeCodes(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of SEED_ENUM_OPTIONS) {
    if (row.entity !== 'matters' || row.field !== 'type') continue;
    const code = (row.metadata as { code?: unknown } | null)?.code;
    if (typeof code === 'number') out[row.value] = code;
  }
  return out;
}
