import { describe, expect, it } from 'vitest';
import { generateToken, hashPassword, safeEqual, sha256, verifyPassword } from '../../src/lib/crypto';

describe('password hashing (scrypt)', () => {
  it('verifies the correct password', async () => {
    const hash = await hashPassword('s3cret password!');
    expect(await verifyPassword('s3cret password!', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('s3cret password!');
    expect(await verifyPassword('s3cret password?', hash)).toBe(false);
  });

  it('uses a random salt so equal passwords hash differently', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toEqual(b);
  });

  it('stores the parameters in a self-describing format', async () => {
    const hash = await hashPassword('x');
    expect(hash.split('$')).toHaveLength(6);
    expect(hash.startsWith('scrypt$')).toBe(true);
  });

  it('normalises unicode so visually identical passwords match', async () => {
    const composed = 'café-password';
    const decomposed = 'café-password';
    const hash = await hashPassword(composed);
    expect(await verifyPassword(decomposed, hash)).toBe(true);
  });

  it.each(['', 'plain', 'bcrypt$1$2$3$4$5', 'scrypt$1$2'])('rejects malformed hash %j', async (stored) => {
    expect(await verifyPassword('anything', stored)).toBe(false);
  });
});

describe('tokens', () => {
  it('generates prefixed, high-entropy, url-safe tokens', () => {
    const token = generateToken('lc_pat');
    expect(token).toMatch(/^lc_pat_[A-Za-z0-9_-]{43}$/);
    expect(generateToken('lc_pat')).not.toEqual(token);
  });

  it('hashes deterministically with sha256', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('compares strings in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
