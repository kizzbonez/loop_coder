import { beforeAll, describe, expect, it } from 'vitest';
import { bootstrap } from '../../src/bootstrap';
import { assertPasswordPolicy, passwordPolicyError } from '../../src/modules/auth/password-policy';

beforeAll(() => bootstrap());

describe('password policy', () => {
  it('accepts a long passphrase', () => {
    expect(passwordPolicyError('correct horse battery staple')).toBeNull();
  });

  it('enforces the configured minimum length (default 12)', () => {
    expect(passwordPolicyError('short1!')).toMatch(/at least 12/);
    expect(passwordPolicyError('exactly12chr')).toBeNull();
  });

  it('rejects overly long passwords', () => {
    expect(passwordPolicyError('a'.repeat(100) + 'b'.repeat(157))).toMatch(/at most 256/);
  });

  it('rejects a single repeated character', () => {
    expect(passwordPolicyError('aaaaaaaaaaaaaaaa')).toMatch(/repeated/);
  });

  it('rejects common passwords regardless of case', () => {
    expect(passwordPolicyError('Password1234')).toMatch(/too common/);
  });

  it('rejects passwords containing the email local part', () => {
    expect(passwordPolicyError('my-jonathan-pass', { email: 'jonathan@example.com' })).toMatch(/email/);
    expect(passwordPolicyError('jonathan@example.com', { email: 'jonathan@example.com' })).toMatch(/email/);
  });

  it('rejects the user name as password', () => {
    expect(passwordPolicyError('Grace Hopper!', { name: 'grace hopper!' })).toMatch(/name/);
  });

  it('throws a 400 HttpError with field details', () => {
    expect(() => assertPasswordPolicy('short')).toThrowError(expect.objectContaining({ status: 400 }));
  });
});
