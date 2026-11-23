import { describe, it, expect } from 'vitest';
import { clientIdFromMatters } from '@/lib/billing/persist-invoice';

describe('clientIdFromMatters', () => {
  it("takes the client every matter names", () => {
    expect(clientIdFromMatters('Example Corp', ['client-1', 'client-1', null])).toBe('client-1');
  });

  it('returns null when no matter names a client, so the caller falls back to the name', () => {
    expect(clientIdFromMatters('Example Corp', [null, null])).toBeNull();
    expect(clientIdFromMatters('Example Corp', [])).toBeNull();
  });

  it('refuses a bundle whose matters belong to two clients instead of guessing', () => {
    expect(() => clientIdFromMatters('Example Corp', ['client-1', 'client-2'])).toThrow(/2 different client records/);
  });
});
