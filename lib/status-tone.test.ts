import { describe, expect, it } from 'vitest';
import { statusTone } from './status-tone';

describe('statusTone', () => {
  it('reads deliverable stages from the deliverable workflow', () => {
    expect(statusTone('Drafting')).toBe('blue');
    expect(statusTone('Awaiting Client')).toBe('amber');
    expect(statusTone('Filed or Sent out')).toBe('emerald');
  });

  it('ignores case and stray spaces', () => {
    expect(statusTone('Not Started')).toBe('neutral');
    expect(statusTone(' attended ')).toBe('emerald');
  });

  it('covers tasks, hearings, matters and priority', () => {
    expect(statusTone('In progress')).toBe('blue');
    expect(statusTone('Cancelled')).toBe('muted');
    expect(statusTone('Archived')).toBe('muted');
    expect(statusTone('High')).toBe('rose');
  });

  it('falls back to neutral', () => {
    expect(statusTone('')).toBe('neutral');
    expect(statusTone(null)).toBe('neutral');
    expect(statusTone('Something new')).toBe('neutral');
  });
});
