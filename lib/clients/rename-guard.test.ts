import { describe, expect, it } from 'vitest';
import { isCosmeticRename, renameConfirmMessage } from './rename-guard';

describe('isCosmeticRename', () => {
  it('ignores case, spacing, and punctuation', () => {
    expect(isCosmeticRename('Harbor View Condominium Corp.', 'HARBOR  view condominium corp')).toBe(true);
    expect(isCosmeticRename('A.B. Santos Builders Inc.', 'AB Santos Builders, Inc.')).toBe(true);
  });

  it('treats a different name as a real rename', () => {
    expect(isCosmeticRename('Maria Example', 'Harbor View Condominium Corp.')).toBe(false);
    expect(isCosmeticRename('Harbor View Condo Corp.', 'Harbor View Condominium Corp.')).toBe(false);
  });

  it('keeps letters outside ASCII', () => {
    expect(isCosmeticRename('Paaño', 'Paano')).toBe(false);
    expect(isCosmeticRename('Paaño', 'PAAÑO')).toBe(true);
  });
});

describe('renameConfirmMessage', () => {
  it('is null when nothing is attached', () => {
    expect(renameConfirmMessage('New Name', { portalUsers: [], proposals: 0 })).toBeNull();
  });

  it('names the portal user and the proposal', () => {
    expect(renameConfirmMessage('Harbor View Condominium Corp.', { portalUsers: ['Maria Example'], proposals: 1 })).toBe(
      'Maria Example signs in to the client portal as this client, and 1 engagement proposal was sent under its current name. '
      + 'Renaming to “Harbor View Condominium Corp.” keeps all of it on this record. '
      + 'Fix a spelling here; if this is a different client, add a new client instead.',
    );
  });

  it('lists several portal users', () => {
    expect(renameConfirmMessage('X', { portalUsers: ['A', 'B'], proposals: 0 })).toMatch(/^A and B sign in to the client portal/);
    expect(renameConfirmMessage('X', { portalUsers: ['A', 'B', 'C'], proposals: 0 })).toMatch(/^A, B and C sign in/);
    expect(renameConfirmMessage('X', { portalUsers: ['A', 'B', 'C', 'D', 'E'], proposals: 0 })).toMatch(/^A, B and 3 others sign in/);
  });

  it('warns on proposals alone', () => {
    expect(renameConfirmMessage('X', { portalUsers: [], proposals: 2 })).toMatch(/^2 engagement proposals were sent under its current name\./);
  });
});
