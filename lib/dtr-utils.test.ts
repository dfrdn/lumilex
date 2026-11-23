import { describe, it, expect } from 'vitest';
import { toDecimal } from './dtr-utils';

describe('toDecimal', () => {
  it('returns whole hours unchanged when minutes are zero', () => {
    expect(toDecimal(0, 0)).toBe(0);
    expect(toDecimal(3, 0)).toBe(3);
  });

  it('rounds minutes up to the next 6-minute (0.1) increment', () => {
    // 6 min is exactly one increment
    expect(toDecimal(1, 6)).toBeCloseTo(1.1, 5);
    // 1 min still ceilings to a full increment
    expect(toDecimal(1, 1)).toBeCloseTo(1.1, 5);
    // 5 min is below one increment but still ceilings up
    expect(toDecimal(1, 5)).toBeCloseTo(1.1, 5);
    // 7 min crosses into the second increment
    expect(toDecimal(2, 7)).toBeCloseTo(2.2, 5);
    // 12 min is exactly two increments
    expect(toDecimal(1, 12)).toBeCloseTo(1.2, 5);
  });
});
