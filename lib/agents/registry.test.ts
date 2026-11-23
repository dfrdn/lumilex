import { describe, it, expect } from 'vitest';
import { canPropose, isDisabled } from './registry';
import type { AgentRecord } from './types';

const agent = (autonomy: AgentRecord['autonomy']): AgentRecord => ({
  id: 'test-agent',
  name: 'Test Agent',
  description: '',
  autonomy,
  supervisorPersonId: null,
});

describe('canPropose', () => {
  it('allows only the propose tier', () => {
    expect(canPropose(agent('propose'))).toBe(true);
    expect(canPropose(agent('read_only'))).toBe(false);
    expect(canPropose(agent('disabled'))).toBe(false);
  });
});

describe('isDisabled', () => {
  it('treats an explicit disabled tier as off', () => {
    expect(isDisabled(agent('disabled'))).toBe(true);
    expect(isDisabled(agent('propose'))).toBe(false);
    expect(isDisabled(agent('read_only'))).toBe(false);
  });

  it('treats an unregistered agent as off, not as unrestricted', () => {
    expect(isDisabled(null)).toBe(true);
  });
});
