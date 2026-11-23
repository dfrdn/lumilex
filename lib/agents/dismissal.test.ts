import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DISMISS_REASONS,
  DISMISS_REASON_HINTS,
  DISMISS_REASON_LABELS,
  isDismissReason,
  wasAgentCorrect,
} from './dismissal';

describe('dismiss reasons', () => {
  it('gives every reason a label and a hint', () => {
    for (const reason of DISMISS_REASONS) {
      expect(DISMISS_REASON_LABELS[reason], `label for ${reason}`).toBeTruthy();
      expect(DISMISS_REASON_HINTS[reason], `hint for ${reason}`).toBeTruthy();
    }
    expect(Object.keys(DISMISS_REASON_LABELS).sort()).toEqual([...DISMISS_REASONS].sort());
    expect(Object.keys(DISMISS_REASON_HINTS).sort()).toEqual([...DISMISS_REASONS].sort());
  });

  // The column has a CHECK constraint listing these values. Adding a reason
  // here without adding it there fails at runtime with a 23514, on dismissal,
  // in production — so pin the two together.
  it('matches the CHECK constraint in the schema baseline', () => {
    const sql = readFileSync(
      join(__dirname, '../../supabase/migrations/00000000000001_baseline.sql'),
      'utf8',
    );
    const inClause = sql.match(/agent_proposals_dismiss_reason_check[^;]*?ANY \(ARRAY\[([^\]]+)\]/);
    expect(inClause, 'dismiss_reason CHECK not found in the baseline').not.toBeNull();

    const constrained = [...inClause![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(constrained.sort()).toEqual([...DISMISS_REASONS].sort());
  });

  it('recognises only known reasons', () => {
    expect(isDismissReason('already_handled')).toBe(true);
    expect(isDismissReason('made_up')).toBe(false);
    expect(isDismissReason(undefined)).toBe(false);
  });

  // The whole point of the taxonomy: a dismissal is not automatically a miss.
  it('scores already_handled as the agent being right', () => {
    expect(wasAgentCorrect('already_handled')).toBe(true);
    expect(wasAgentCorrect('not_applicable')).toBe(false);
    expect(wasAgentCorrect('incorrect')).toBe(false);
  });
});
