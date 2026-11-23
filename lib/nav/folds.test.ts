import { describe, it, expect } from 'vitest';
import { isGroupOpen, toggleFold } from './folds';

describe('sidebar folds', () => {
  it('follow the role default for a group never touched, opening it on one of its pages', () => {
    expect(isGroupOpen(undefined, false, false)).toBe(true);
    expect(isGroupOpen(undefined, true, false)).toBe(false);
    expect(isGroupOpen(undefined, true, true)).toBe(true);
  });

  it('keep the saved choice, even on one of the group\'s pages', () => {
    expect(isGroupOpen(true, false, true)).toBe(false);
    expect(isGroupOpen(true, true, true)).toBe(false);
    expect(isGroupOpen(false, true, false)).toBe(true);
  });

  it('fold a group the person sees open, though its default is folded and they are on its page', () => {
    // A partner on My Matters: "Matters & deliverables" is folded by default but shown open.
    const shown = isGroupOpen(undefined, true, true);
    const next = toggleFold({}, 'matters', shown);
    expect(next).toEqual({ matters: true });
    expect(isGroupOpen(next.matters, true, true)).toBe(false);
    const again = toggleFold(next, 'matters', isGroupOpen(next.matters, true, true));
    expect(isGroupOpen(again.matters, true, true)).toBe(true);
  });

  it('change only the group clicked', () => {
    expect(toggleFold({ draft: true }, 'matters', false)).toEqual({ draft: true, matters: false });
  });
});
