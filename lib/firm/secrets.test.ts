import { describe, it, expect } from 'vitest';
import {
  sealSecret,
  openSecret,
  sealSecretBag,
  openSecretBag,
  parseIntegrationKey,
  getIntegrationKey,
  IntegrationKeyError,
  SealedSecretError,
} from './secrets';

// A fixed, obviously-fake key. Tests never touch INTEGRATION_CREDS_KEY, so a
// developer's real key is never a test dependency and never a test output.
const KEY = Buffer.alloc(32, 0x2b);
const OTHER_KEY = Buffer.alloc(32, 0x7c);

describe('sealSecret / openSecret', () => {
  it('round-trips a secret', () => {
    const plaintext = 'graph-client-secret~value';
    expect(openSecret(sealSecret(plaintext, KEY), KEY)).toBe(plaintext);
  });

  it('round-trips empty and multi-byte values', () => {
    for (const plaintext of ['', 'ñ – 漢字 🔐', 'x'.repeat(5000)]) {
      expect(openSecret(sealSecret(plaintext, KEY), KEY)).toBe(plaintext);
    }
  });

  it('produces a different blob every time (unique IV)', () => {
    const blobs = new Set(Array.from({ length: 20 }, () => sealSecret('same-secret', KEY)));
    expect(blobs.size).toBe(20);
  });

  it('never emits the plaintext in the blob', () => {
    expect(sealSecret('super-secret-token', KEY)).not.toContain('super-secret-token');
  });

  it('carries a version prefix', () => {
    expect(sealSecret('v', KEY).startsWith('v1.')).toBe(true);
  });

  it('rejects an unknown version prefix', () => {
    const sealed = sealSecret('v', KEY);
    expect(() => openSecret(`v9.${sealed.slice(3)}`, KEY)).toThrow(SealedSecretError);
    expect(() => openSecret(sealed.slice(3), KEY)).toThrow(SealedSecretError);
  });
});

describe('tamper detection', () => {
  /** Flip one bit at `index` of the base64url body and re-assemble the blob. */
  function corrupt(sealed: string, index: number): string {
    const body = Buffer.from(sealed.slice(3), 'base64url');
    body[index] ^= 0x01;
    return `v1.${body.toString('base64url')}`;
  }

  it('rejects a flipped ciphertext bit', () => {
    const sealed = sealSecret('transfer-to-account-1', KEY);
    // Body is iv(12) ‖ tag(16) ‖ ciphertext — index 28 is the first plaintext byte.
    expect(() => openSecret(corrupt(sealed, 28), KEY)).toThrow(SealedSecretError);
  });

  it('rejects a flipped auth tag bit', () => {
    const sealed = sealSecret('transfer-to-account-1', KEY);
    expect(() => openSecret(corrupt(sealed, 12), KEY)).toThrow(SealedSecretError);
  });

  it('rejects a flipped IV bit', () => {
    const sealed = sealSecret('transfer-to-account-1', KEY);
    expect(() => openSecret(corrupt(sealed, 0), KEY)).toThrow(SealedSecretError);
  });

  it('rejects a truncated blob', () => {
    expect(() => openSecret('v1.QUJD', KEY)).toThrow(SealedSecretError);
  });

  it('rejects the wrong key', () => {
    expect(() => openSecret(sealSecret('secret', KEY), OTHER_KEY)).toThrow(SealedSecretError);
  });

  it('does not leak the plaintext or the key in the error message', () => {
    const sealed = sealSecret('leak-me-please', KEY);
    try {
      openSecret(sealed, OTHER_KEY);
      throw new Error('expected openSecret to throw');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toContain('leak-me-please');
      expect(message).not.toContain(KEY.toString('base64'));
      expect(message).not.toContain(sealed);
    }
  });
});

describe('secret bags', () => {
  it('round-trips several named secrets', () => {
    const bag = { clientSecret: 'abc~123', botToken: '99:AA-bb_cc' };
    expect(openSecretBag(sealSecretBag(bag, KEY), KEY)).toEqual(bag);
  });

  it('drops non-string entries rather than returning them', () => {
    const sealed = sealSecret(JSON.stringify({ good: 'x', bad: 7, worse: null }), KEY);
    expect(openSecretBag(sealed, KEY)).toEqual({ good: 'x' });
  });

  it('rejects a blob that is not a JSON object', () => {
    expect(() => openSecretBag(sealSecret('"just a string"', KEY), KEY)).toThrow(SealedSecretError);
    expect(() => openSecretBag(sealSecret('[1,2]', KEY), KEY)).toThrow(SealedSecretError);
    expect(() => openSecretBag(sealSecret('not json at all', KEY), KEY)).toThrow(SealedSecretError);
  });

  it('rejects a tampered bag', () => {
    const sealed = sealSecretBag({ botToken: 'real' }, KEY);
    expect(() => openSecretBag(sealed, OTHER_KEY)).toThrow(SealedSecretError);
  });
});

describe('parseIntegrationKey', () => {
  it('accepts 64 hex characters', () => {
    expect(parseIntegrationKey('ab'.repeat(32))).toHaveLength(32);
  });

  it('accepts base64 of 32 bytes', () => {
    expect(parseIntegrationKey(KEY.toString('base64'))).toEqual(KEY);
  });

  it('accepts a key with surrounding whitespace', () => {
    expect(parseIntegrationKey(`  ${KEY.toString('base64')}\n`)).toEqual(KEY);
  });

  it('rejects a short key', () => {
    expect(() => parseIntegrationKey(Buffer.alloc(16).toString('base64'))).toThrow(IntegrationKeyError);
  });

  it('rejects an empty key', () => {
    expect(() => parseIntegrationKey('   ')).toThrow(IntegrationKeyError);
  });

  it('a key parsed from hex and from base64 seals interchangeably', () => {
    const hex = parseIntegrationKey(KEY.toString('hex'));
    const b64 = parseIntegrationKey(KEY.toString('base64'));
    expect(openSecret(sealSecret('shared', hex), b64)).toBe('shared');
  });
});

describe('getIntegrationKey', () => {
  it('throws a named error when the env var is absent', () => {
    const saved = process.env.INTEGRATION_CREDS_KEY;
    delete process.env.INTEGRATION_CREDS_KEY;
    try {
      expect(() => getIntegrationKey()).toThrow(IntegrationKeyError);
    } finally {
      if (saved !== undefined) process.env.INTEGRATION_CREDS_KEY = saved;
    }
  });

  it('reads the env var on every call, so a rotation takes effect', () => {
    const saved = process.env.INTEGRATION_CREDS_KEY;
    try {
      process.env.INTEGRATION_CREDS_KEY = KEY.toString('base64');
      expect(getIntegrationKey()).toEqual(KEY);
      process.env.INTEGRATION_CREDS_KEY = OTHER_KEY.toString('base64');
      expect(getIntegrationKey()).toEqual(OTHER_KEY);
    } finally {
      if (saved === undefined) delete process.env.INTEGRATION_CREDS_KEY;
      else process.env.INTEGRATION_CREDS_KEY = saved;
    }
  });
});
