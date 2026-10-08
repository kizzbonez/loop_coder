import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hint, keyFingerprint, open, parseMasterKey, seal, SecretsUnavailableError } from '../../src/lib/secrets';

const key = randomBytes(32);

describe('secrets at rest', () => {
  it('round-trips a value and never stores it in the clear', () => {
    const sealed = seal(key, 'sk-ant-api03-very-secret-value', 'provider:1');
    expect(sealed.sealed).toMatch(/^v1:[\w-]+:[\w-]+:[\w-]+$/);
    expect(sealed.sealed).not.toContain('very-secret');
    expect(open(key, sealed, 'provider:1')).toBe('sk-ant-api03-very-secret-value');
  });

  it('uses a fresh nonce every time', () => {
    expect(seal(key, 'same', 'p').sealed).not.toBe(seal(key, 'same', 'p').sealed);
  });

  it('refuses another owner, another key and any tampering', () => {
    const sealed = seal(key, 'secret', 'provider:1');
    expect(() => open(key, sealed, 'provider:2')).toThrow();
    expect(() => open(randomBytes(32), sealed, 'provider:1')).toThrow(SecretsUnavailableError);
    const [v, n, t, c] = sealed.sealed.split(':');
    const flipped = Buffer.from(c!, 'base64url');
    flipped[0]! ^= 1;
    expect(() => open(key, { ...sealed, sealed: [v, n, t, flipped.toString('base64url')].join(':') }, 'provider:1')).toThrow();
    expect(() => open(key, { ...sealed, sealed: 'v0:x:y:z' }, 'provider:1')).toThrow(/Unreadable/);
  });

  it('accepts a 32-byte master key as hex or base64 only', () => {
    expect(parseMasterKey(key.toString('hex'))?.equals(key)).toBe(true);
    expect(parseMasterKey(key.toString('base64'))?.equals(key)).toBe(true);
    expect(parseMasterKey(key.toString('base64url'))?.equals(key)).toBe(true);
    for (const bad of [undefined, '', 'short', randomBytes(16).toString('hex'), randomBytes(31).toString('base64'), 'z'.repeat(64)]) expect(parseMasterKey(bad), String(bad)).toBeNull();
    expect(keyFingerprint(key)).toMatch(/^[0-9a-f]{12}$/);
    expect(keyFingerprint(key)).toBe(keyFingerprint(Buffer.from(key)));
  });

  it('shows at most the last four characters, and nothing of short values', () => {
    expect(hint('sk-ant-api03-abcdefgh1234')).toBe('1234');
    expect(hint('short-key')).toBe('');
  });
});
