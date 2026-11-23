// ── Integration credential sealing ───────────────────────────────────
//
// A firm's bring-your-own integration secrets (its Microsoft Graph client
// secret) are stored in `firm_integrations.credentials_enc`
// as ciphertext, never as plaintext columns. Postgres, its backups, its logs and
// any accidental SELECT therefore only ever hold an opaque blob.
//
// AES-256-GCM, from Node's built-in crypto — authenticated encryption, so a
// tampered blob fails to open rather than decrypting to attacker-chosen bytes.
// The key is one platform secret, INTEGRATION_CREDS_KEY; it is deliberately NOT
// per firm, because the firm is who we are protecting the value FROM disclosure
// on behalf of, not who we are keeping it from.
//
// Nothing in this module logs, stringifies, or embeds plaintext in an error
// message. An error says only that a blob could not be opened.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
/** 96-bit IV — the size GCM is specified for, and the only one Node accepts by default. */
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 'v1';

/** The configured key is absent or the wrong size. */
export class IntegrationKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrationKeyError';
  }
}

/** A sealed blob is malformed, truncated, tampered with, or under another key. */
export class SealedSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SealedSecretError';
  }
}

/**
 * Decode a configured key. Accepts 64 hex characters or standard/URL-safe
 * base64; both must decode to exactly 32 bytes.
 *
 * Generate one with:  openssl rand -base64 32
 */
export function parseIntegrationKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (!trimmed) throw new IntegrationKeyError('INTEGRATION_CREDS_KEY is empty.');

  const decoded = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');

  if (decoded.length !== KEY_BYTES) {
    throw new IntegrationKeyError(
      `INTEGRATION_CREDS_KEY must decode to ${KEY_BYTES} bytes (got ${decoded.length}). ` +
        'Generate one with: openssl rand -base64 32',
    );
  }
  return decoded;
}

/**
 * The platform key from env. Read on every call rather than memoised: the cost
 * is a base64 decode, and a cached key silently survives a rotation.
 */
export function getIntegrationKey(): Buffer {
  const raw = process.env.INTEGRATION_CREDS_KEY;
  if (!raw) {
    throw new IntegrationKeyError(
      'INTEGRATION_CREDS_KEY is not set — integration credentials cannot be sealed or opened.',
    );
  }
  return parseIntegrationKey(raw);
}

/**
 * Seal a string. Output is `v1.<base64url(iv ‖ tag ‖ ciphertext)>`; the IV is
 * fresh per call, so sealing the same value twice never produces the same blob.
 */
export function sealSecret(plaintext: string, key: Buffer = getIntegrationKey()): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}.${Buffer.concat([iv, tag, ciphertext]).toString('base64url')}`;
}

/** Open a blob produced by {@link sealSecret}. Throws on any tampering. */
export function openSecret(sealed: string, key: Buffer = getIntegrationKey()): string {
  const dot = sealed.indexOf('.');
  const version = dot === -1 ? '' : sealed.slice(0, dot);
  if (version !== VERSION) {
    throw new SealedSecretError(`Unsupported sealed-secret version "${version || '(none)'}".`);
  }

  const body = Buffer.from(sealed.slice(dot + 1), 'base64url');
  if (body.length < IV_BYTES + TAG_BYTES) {
    throw new SealedSecretError('Sealed secret is truncated.');
  }

  const iv = body.subarray(0, IV_BYTES);
  const tag = body.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = body.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // Deliberately opaque: the caller gets no oracle, and no fragment of the
    // blob or the key reaches a log line.
    throw new SealedSecretError(
      'Sealed secret failed authentication — it was tampered with, truncated, or sealed under a different key.',
    );
  }
}

/**
 * Seal a bag of named secrets. `firm_integrations.credentials_enc` is one text
 * column, so an integration that needs several values (client secret + bot
 * token) keeps them in one blob rather than one column each.
 */
export function sealSecretBag(
  values: Record<string, string>,
  key: Buffer = getIntegrationKey(),
): string {
  return sealSecret(JSON.stringify(values), key);
}

/** Open a bag written by {@link sealSecretBag}. Non-string entries are dropped. */
export function openSecretBag(
  sealed: string,
  key: Buffer = getIntegrationKey(),
): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(openSecret(sealed, key));
  } catch (err) {
    if (err instanceof SealedSecretError) throw err;
    throw new SealedSecretError('Sealed secret did not contain a JSON object.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SealedSecretError('Sealed secret did not contain a JSON object.');
  }
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string') out[name] = value;
  }
  return out;
}
