import { describe, it, expect } from 'vitest';
import { isClientVisibleMeeting } from './meetings';

describe('isClientVisibleMeeting', () => {
  it('hides the firm’s internal discussions', () => {
    expect(isClientVisibleMeeting({ type: 'Internal Discussion' })).toBe(false);
  });

  it('shows client-facing meetings and untyped ones', () => {
    expect(isClientVisibleMeeting({ type: 'Client Meeting' })).toBe(true);
    expect(isClientVisibleMeeting({ type: 'Hearing' })).toBe(true);
    expect(isClientVisibleMeeting({ type: null })).toBe(true);
    expect(isClientVisibleMeeting({})).toBe(true);
  });
});
