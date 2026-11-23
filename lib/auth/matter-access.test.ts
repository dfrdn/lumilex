import { describe, it, expect } from 'vitest';
import { readsEveryMatter } from './matter-access';

describe('readsEveryMatter', () => {
  it('mirrors the role branch of has_matter_access()', () => {
    for (const role of ['partner', 'admin', 'super_user', 'finance', 'chief_liaison_officer', 'liaison_officer']) {
      expect(readsEveryMatter(role), role).toBe(true);
    }
  });

  it('leaves a lawyer to the matters they are staffed on', () => {
    expect(readsEveryMatter('lawyer')).toBe(false);
    expect(readsEveryMatter(null)).toBe(false);
    expect(readsEveryMatter(undefined)).toBe(false);
  });
});
