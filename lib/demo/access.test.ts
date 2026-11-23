import { describe, expect, it } from 'vitest';
import { demoAccessId, parseDemoAccessRequest } from './access';

const valid = { name: '  Maya   Santos ', email: ' Maya@SantosLaurel.law ', position: 'Partner', as: 'partner' };

describe('parseDemoAccessRequest', () => {
  it('accepts a complete request and normalises it', () => {
    const r = parseDemoAccessRequest(valid);
    expect(r).toEqual({
      ok: true,
      request: { name: 'Maya Santos', email: 'maya@santoslaurel.law', position: 'Partner', as: 'partner' },
    });
  });

  it('names every missing or malformed field', () => {
    const r = parseDemoAccessRequest({ name: ' ', email: 'not-an-email', position: '', as: 'partner' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fields.sort()).toEqual(['email', 'name', 'position']);
  });

  it('refuses a role that is not a demo persona', () => {
    for (const as of ['super_user', 'person-id', undefined]) {
      const r = parseDemoAccessRequest({ ...valid, as });
      expect(r.ok).toBe(false);
    }
  });

  it('refuses a filled honeypot', () => {
    expect(parseDemoAccessRequest({ ...valid, website: 'http://spam.example' }).ok).toBe(false);
  });

  it('refuses overlong values rather than truncating them', () => {
    expect(parseDemoAccessRequest({ ...valid, name: 'x'.repeat(121) }).ok).toBe(false);
  });

  it('ignores non-string form entries', () => {
    const file = new Blob(['x']) as unknown as FormDataEntryValue;
    expect(parseDemoAccessRequest({ ...valid, name: file }).ok).toBe(false);
  });
});

describe('demoAccessId', () => {
  it('accepts a uuid and nothing else', () => {
    expect(demoAccessId('3f2b7c1e-8d4a-4c6b-9e2f-1a2b3c4d5e6f')).toBe('3f2b7c1e-8d4a-4c6b-9e2f-1a2b3c4d5e6f');
    for (const v of [undefined, null, '', '1', "x' or 1=1", '3f2b7c1e8d4a4c6b9e2f1a2b3c4d5e6f']) {
      expect(demoAccessId(v)).toBeNull();
    }
  });
});
