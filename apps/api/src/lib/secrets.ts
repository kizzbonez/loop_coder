import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Encryption for secrets at rest (AI provider API keys): AES-256-GCM with a random 96-bit nonce
 * per value and the owner's id as additional data, so a ciphertext copied to another record does
 * not decrypt. The master key comes from the environment (`LOOP_SECRETS_KEY`) and never touches
 * the database, so a database backup alone reveals no secret.
 */

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';

export class SecretsUnavailableError extends Error {
  constructor(message = 'Secret storage is not configured: set LOOP_SECRETS_KEY in .env (run `npm run secrets-key`) and restart.') {
    super(message);
    this.name = 'SecretsUnavailableError';
  }
}

/** Parse a 32-byte master key given as 64 hex characters or base64 (standard or URL-safe). */
export function parseMasterKey(text: string | undefined): Buffer | null {
  const value = text?.trim();
  if (!value) return null;
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  if (/^[A-Za-z0-9+/_-]{43}=?$/.test(value)) {
    const key = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (key.length === 32) return key;
  }
  return null;
}

/** A short, non-secret fingerprint of the master key, stored with each value to detect a changed key. */
export function keyFingerprint(key: Buffer): string {
  return createHash('sha256').update('loop-coder/secrets/').update(key).digest('hex').slice(0, 12);
}

export interface SealedSecret {
  /** `v1:<nonce>:<tag>:<ciphertext>`, base64url parts. */
  sealed: string;
  /** Which master key sealed it. */
  keyId: string;
}

export function seal(key: Buffer, plaintext: string, owner: string): SealedSecret {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  cipher.setAAD(Buffer.from(owner, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    sealed: [VERSION, nonce.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':'),
    keyId: keyFingerprint(key),
  };
}

/** Decrypt a sealed value; throws when it was sealed with another key, for another owner, or was altered. */
export function open(key: Buffer, secret: SealedSecret, owner: string): string {
  if (secret.keyId !== keyFingerprint(key)) throw new SecretsUnavailableError('This secret was saved with a different LOOP_SECRETS_KEY: enter it again.');
  const [version, nonce, tag, ciphertext] = secret.sealed.split(':');
  if (version !== VERSION || !nonce || !tag || ciphertext === undefined) throw new Error('Unreadable sealed secret');
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(nonce, 'base64url'));
  decipher.setAAD(Buffer.from(owner, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}

/** The last characters of a secret, enough to recognise it ("…a1b2"), never more than 4. */
export function hint(secret: string): string {
  const visible = secret.trim().slice(-4);
  return secret.trim().length >= 12 ? visible : '';
}
