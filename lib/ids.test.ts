import { describe, it, expect } from 'vitest';
import { mintId } from './ids';

describe('mintId', () => {
  it('mints entity-prefixed UUID ids', () => {
    expect(mintId('task')).toMatch(/^task-[0-9a-f-]{36}$/);
  });

  it('returns distinct values across rapid calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => mintId('task')));
    expect(ids.size).toBe(1000);
  });
});
