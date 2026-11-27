import { describe, expect, it } from 'vitest';
import { buttonClass } from './Button';
import { BTN_OUTLINE, BTN_PRIMARY } from './tone';

const classes = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

describe('buttonClass', () => {
  it('matches the BTN_* constants at the default size, so old and new buttons look alike', () => {
    const md = classes('px-3.5 py-1.5 rounded-full');
    expect(classes(buttonClass('primary'))).toEqual(new Set([...classes(BTN_PRIMARY), ...md]));
    expect(classes(buttonClass('outline'))).toEqual(new Set([...classes(BTN_OUTLINE), ...md]));
  });

  it('carries one text size per size', () => {
    expect(buttonClass('primary', 'lg')).toContain('text-sm');
    expect(buttonClass('primary', 'lg')).not.toContain('text-xs');
  });
});
